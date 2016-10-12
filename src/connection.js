/**
 * Copyright (c) 2015 SPARKL Limited. All Rights Reserved.
 * Author <jacoby@sparkl.com> Jacoby Thwaites.
 *
 * Connection object constructor.
 *
 * The constructor URL points to the SPARKL websocket address.
 *
 * The first connection.open(serviceId) call opens the websocket,
 * where the service ID or pathname is appended to the websocket URL. That's
 * important because execute permission on the referenced service is
 * required to open the websocket.
 */

(function(global) {
  var sparkl = global.sparkl;

  var Connection = function Connection(url) {
    this.url = url;
    this.ws = null;             // Websocket to SPARKL.
    this.serviceInstances = {}; // Service instances keyed by instance id.
    this.eventHandler =         // Our event handler.
      new sparkl.EventHandler(this, [
        "open", "close", "service_preopen", "service_open", "service_close"]);


    // Each pending response is keyed by its ref and looks like this:
    // {
    //   ref: data_event_ref,
    //   fulfil: fulfil_fun,
    //   reject: reject_fun,
    //   timeout: timeout_reference
    // }
    this.pendingResponses = {};

    this.eventHandler.delegate();
  };

  Connection.READYSTATE_CONNECTING = 0;
  Connection.READYSTATE_OPEN = 1;
  Connection.READYSTATE_CLOSING = 2;
  Connection.READYSTATE_CLOSED = 3;

  // The connection is open if the websocket is open.
  Connection.prototype.isWebSocketOpen = function() {
    var connection = this;
    return connection.ws
      && (connection.ws.readyState === Connection.READYSTATE_OPEN);
  };

  /**
   * Returns a promise which is fulfilled when the websocket has
   * opened successfully, otherwise it is rejected.
   */
  Connection.prototype.openWebSocket = function() {
    var connection = this;

    return new Promise(function(fulfil, reject) {
      console.log("Opening: " + connection.url);

      connection.ws = new WebSocket(connection.url);

      connection.ws.onopen = function(event) {
        console.log("Websocket opened");
        fulfil();
      };

      connection.ws.onclose = function(event) {
        connection.onClose();
        console.log("Websocket closed");
      };

      connection.ws.onmessage = function(message) {
        connection.onMessage(message);
      };

      connection.ws.onerror = function(event) {
        reject(event);
      };
    });
  };

  /**
   * Opens the service. If the base URL is provided, the service Javascript
   * source href is resolved against it.
   *
   * If the base URL is a complete pathname, and there is no source property
   * in the service definition, then the base alone is the source for the
   * implementation Javascript.
   *
   * @param serviceId the service Id or pathname.
   */
  Connection.prototype.open = function() {
    var connection = this;

    return new Promise(function(fulfil, reject) {

      // If the websocket isn't open, open it.
      // The open event will follow.
      if (!connection.isWebSocketOpen()) {
        connection.openWebSocket().then(
          function() {
            connection.fireEvent("open", connection);
            fulfil();
          },

          function(error) {
            console.error(error);
            reject(error);
          });
      }

      // If the websocket is open, send an open request.
      // The open event will follow.
      else {
       reject("Websocket already open");
      }
    });
  };

  /**
   * Closes the connection by closing the websocket. This will fire
   * the onclose events set up in the openWebSocket method.
   *
   * This method does nothing if the connection is already closed.
   */
  Connection.prototype.close = function() {
    var connection = this;
    connection.ws.close();
  };

  /**
   * When the connection is closed, all service instances are also
   * closed.
   */
  Connection.prototype.onClose = function() {
    var connection = this;

    sparkl.util.foldl(
      function(serviceId, serviceInstance) {
        connection.closeService(serviceInstance);
      }, null, connection.serviceInstances);

    connection.fireEvent("close", connection);
    console.log("Closed all service instances");
  };

  /**
   * Sends the message as a JSON encoded string.
   */
  Connection.prototype.sendMessage = function(message) {
    var connection = this;
    connection.ws.send(JSON.stringify(message));
  };

  /**
   * All received messages correspond to events per the tag as follows:
   * - open_event:  opens a new service instance with metadata.
   * - close_event: closes the referenced service instance.
   * - data_event:  contains request, consume or response data.
   * - error_event: this references either a pending solicit or an instance.
   */
  Connection.prototype.onMessage = function(rawMessage) {
    var connection =
      this;
    var message =
      new sparkl.Struct(rawMessage.data); // Message is wrapped.
    var tag =
      message.tag();
    var
      id,
      ref,
      pendingResponse,
      responseId,
      serviceInstance,
      dataEvent,
      subject;

    if (tag === "open_event") {
      connection.openService(message);
    }

    else if (tag === "close_event") {
      ref = message.ref();
      serviceInstance =
        connection.serviceInstances[ref];
      connection.closeService(serviceInstance, message);
    }

    else if (tag === "data_event" || tag === "error_event") {
      ref = message.ref();
      pendingResponse =
        connection.pendingResponses[ref];

      if (pendingResponse) {
        delete connection.pendingResponses[ref];
        clearTimeout(pendingResponse.timeout);

        if (tag === "data_event") {
          responseId =
            message.attr("subject");

          serviceInstance =
            pendingResponse.instance;

          subject =
            serviceInstance.openEvent
              .content("responses")[0]
              .content("response", responseId);

          dataEvent =
            new sparkl.DataEvent(serviceInstance, message)
              .setSubject(subject);

          pendingResponse.fulfil(dataEvent);
        }
        else {
          pendingResponse.reject(message);
        }
      }

      // Message references an instance.
      else {
        serviceInstance =
          connection.serviceInstances[ref];

        if (serviceInstance) {
          serviceInstance.enqueue(message);
        }
        else {
          console.error(message);
        }
      }
    }
  };

  /**
   * Adds a pending response to our table, keyed by reference.
   */
  Connection.prototype.addPendingResponse = function(pending) {
    var connection =
      this;

    connection.pendingResponses[pending.ref] =
      pending;
  };

  /**
   * Creates a new service instance.
   *
   * The openEvent contains all the metadata about the service including
   * the operations and fields.
   *
   * Two events are fired:
   *   preopen - allows actions such as setting Javascript base URL.
   *   open    - fired upon successful load and initialisation.
   *
   * @param openEvent the open event received from SPARKL.
   */
  Connection.prototype.openService = function(openEvent) {
    var connection =
      this;
    var instance =
      openEvent.ref();
    var serviceInstance =
      new sparkl.ServiceInstance(connection, openEvent);

    // By default we resolve non-root hrefs against the folder containing
    // the service. This resolver can be replaced by the user.
    var defaultResolver =
      function(href) {
        var sourceHref, servicePathname, anchor;

        if (href.startsWith("/")) {
          return href;
        }
        else {
          sourceHref =
            "/sse_cfg/source/";
          servicePathname =
            openEvent.pathname();
          anchor =
            document.createElement("a");
          anchor.href =
            sourceHref + servicePathname + "/../" + href;
          return anchor.href;
        }
      };

    serviceInstance.setResolver(defaultResolver);

    console.log("Opening instance: " + instance);
    connection.serviceInstances[instance] = serviceInstance;
    connection.fireEvent("service_preopen", serviceInstance);

    serviceInstance
      .open()
      .then(
        function() {
          connection.fireEvent("service_open", serviceInstance);
        },

        function(error) {
          console.error("Failed to open service instance: " + error);
        });
  };

  /**
   * Closes a service instance and fires the appropriate events.
   */
  Connection.prototype.closeService = function(serviceInstance, message) {
    var connection = this;
    var instanceId = serviceInstance.openEvent.ref();
    console.log("Closing: " + instanceId);
    serviceInstance.onClose(message);
    delete connection.serviceInstances[instanceId];
    connection.fireEvent("service_close", serviceInstance);
  };

  sparkl.Connection = Connection;

})(this);
