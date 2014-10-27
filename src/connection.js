/***************************************************************************
 *
 * Connection object constructor.
 *
 * The constructor URL points to the SPARKL websocket address.
 *
 * The first connection.open(serviceId) call opens the websocket,
 * where the service ID or pathname is appended to the websocket URL. That's
 * important because execute permission on the referenced service is
 * required to open the websocket.
 *
 ***************************************************************************/

var Connection = function Connection(url) {
  this.url = url;
  this.pendingReplies = {}; // Pending replies keyed by id.
  this.pendingResponses = {}; // Pending Sparkl responses keyed by id
  this.nextRequestId = counter();
  this.nextSolicitId = counter();
  this.ws = null; // Websocket to SPARKL router.
  this.serviceInstances = {}; // Service instances keyed by instance ID.
  this.eventHandler = // Our event handler.
    new EventHandler(this, ["preopen", "open"]);

  this.eventHandler.delegate();
};

Connection.READYSTATE_CONNECTING = 0;
Connection.READYSTATE_OPEN = 1;
Connection.READYSTATE_CLOSING = 2;
Connection.READYSTATE_CLOSED = 3;

// The connection is open if the websocket is open and the open
// for the connection itself has been received.
Connection.prototype.isWebSocketOpen = function () {
  var connection = this;
  return connection.ws && (connection.ws.readyState === Connection.READYSTATE_OPEN);
};

// The web socket is opened upon first service open.
Connection.prototype.openWebSocket = function (serviceId) {
  var connection = this;

  return new Promise(function (fulfil, reject) {
    console.log("Opening: " + connection.url);

    connection.ws = new WebSocket(connection.url + "/" + serviceId);

    connection.ws.onopen = function (event) {
      console.log("Websocket opened");
      fulfil();
    };

    connection.ws.onclose = function (event) {
      console.log("Websocket closed");
      connection.onClose();
    };

    connection.ws.onmessage = function (message) {
      connection.onMessage(message);
    };

    connection.ws.onerror = function (event) {
      reason = "Failed to open websocket";
      console.error(reason);
      reject(reason);
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
Connection.prototype.open = function (serviceId) {
  var connection = this;

  return new Promise(function (fulfil, reject) {

    // If the websocket isn't open, open it.
    // The open event will follow.
    if (!connection.isWebSocketOpen()) {
      connection.openWebSocket(serviceId).then(
        function () {
          fulfil();
        },

        function (error) {
          reason = "Service: " + serviceId + ", error: " + error;
          console.error(reason);
          reject(reason);
        });
    }

    // If the websocket is open, send an open request.
    // The open event will follow.
    else {
      connection.sendMessageAwaitAck({
        "tag": "open",
        "serviceId": serviceId
      })
        .then(
        function () {
          fulfil();
        },

        function (reply) {
          console.error(reply.reason());
          reject("Rejected: " + reply.reason());
        });
    }
  });
};

Connection.prototype.onClose = function () {
  var connection = this;

  foreach(connection.serviceInstances,
    function (serviceInstance) {
      serviceInstance.onClose();
    });

  connection.fireEvent("close");
  console.log("Closed all service instances");
};

Connection.prototype.sendMessage = function (message) {
  var connection = this;
  connection.ws.send(JSON.stringify(message));
};

Connection.prototype.sendMessageAwaitAck =
  function (message, timeout) {
    var connection = this;

    return new Promise(function (fulfil, reject) {
      var messageId = "req" + connection.nextRequestId();
      var timeoutMillis = timeout || 5000; // Default 5s message timeout.
      var timeout = setTimeout(
        function () {
          reason = "Timeout" + messageId;
          delete connection.pendingReplies[messageId];
          console.error(reason);
          reject(reason);
        }, timeoutMillis);
      var pendingReply = {
        msgid: messageId,
        fulfil: fulfil,
        reject: reject,
        timeout: timeout
      };

      connection.pendingReplies[messageId] = pendingReply;
      message[MSG_ID] = messageId;
      connection.ws.send(JSON.stringify(message));
    });
  };

Connection.prototype.onMessage = function (rawMessage) {
  var connection = this;
  var message = new sparkl.Struct(rawMessage.data); // Message is wrapped.
  var msgId = message.attr(MSG_ID);
  var pendingReply = msgId ?
    connection.pendingReplies[msgId] :
    false;

  if (pendingReply) {
    delete connection.pendingReplies[message._msgid()];
    clearTimeout(pendingReply.timeout);

    if (message.tag() === "error") {
      pendingReply.reject(message);
    } else if (message.tag() === "ok") { // Dependent service open-event.
      pendingReply.fulfil(message);
    }
  }

  // The connection open-event is sent asynchronously by SPARKL.
  else if (message.tag() === "open-event") {
    connection.createNewServiceInstance(message);
  }

  // All other messages are aimed at an opened service instance.
  else {
    var serviceInstance =
      connection.serviceInstances[message.instanceId()];

    if (serviceInstance) {
      serviceInstance.enqueue(message);
    } else {
      reason = "Invalid instance ID: " + message.instanceId();
      console.error(reason);
    }
  }
};

/**
 * Creates a new service instance.
 *
 * Two events are fired:
 *   preopen - allows actions such as setting Javascript base URL.
 *   open    - fired upon successful load and initialisation.
 *
 * @param openEvent the open event received from SPARKL.
 */
Connection.prototype.createNewServiceInstance = function (openEvent) {
  var connection = this;
  var instanceId = openEvent.instanceId();
  var serviceInstance = new ServiceInstance(connection, openEvent);

  console.log("Opening instance: " + instanceId);
  connection.serviceInstances[instanceId] = serviceInstance;
  connection.fireEvent("preopen", serviceInstance);

  serviceInstance.open().then(
    function () {
      connection.fireEvent("open", serviceInstance);
    },

    function (error) {
      console.error("Failed to open service instance: " + error);
    });
};
