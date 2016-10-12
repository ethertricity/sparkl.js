(function e (t, n, r) {
  function s (o, u) {
    if (!n[o]) {
      if (!t[o]) {
        var a = typeof require == "function" && require;
        if (!u && a)return a(o, !0);
        if (i)return i(o, !0);
        var f = new Error("Cannot find module '" + o + "'");
        throw f.code = "MODULE_NOT_FOUND", f
      }
      var l = n[o] = {exports: {}};
      t[o][0].call(l.exports, function(e) {
        var n = t[o][1][e];
        return s(n ? n : e)
      }, l, l.exports, e, t, n, r)
    }
    return n[o].exports
  }

  var i = typeof require == "function" && require;
  for (var o = 0; o < r.length; o++)s(r[o]);
  return s
})({
  1: [function(require, module, exports) {
    module.exports = {
      Util: require('./src/Util'),
      Struct: require('./src/Struct'),
      ServiceInstance: require('./src/ServiceInstance'),
      ServiceImpl: require('./src/ServiceImpl'),
      EventHandler: require('./src/EventHandler'),
      DataEvent: require('./src/DataEvent'),
      Connection: require('./src/Connection'),
      Container: require('./src/Container')
    };
  }, {
    "./src/Connection": 2,
    "./src/Container": 3,
    "./src/DataEvent": 4,
    "./src/EventHandler": 5,
    "./src/ServiceImpl": 6,
    "./src/ServiceInstance": 7,
    "./src/Struct": 8,
    "./src/Util": 9
  }],
  2: [function(require, module, exports) {
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

    var EventHandler = require('./EventHandler');
    var DataEvent = require('./DataEvent');
    var ServiceInstance = require('./ServiceInstance');
    var Util = require('./Util');

    var Connection = function Connection (url) {
      this.url = url;
      this.ws = null;             // Websocket to SPARKL.
      this.serviceInstances = {}; // Service instances keyed by instance id.
      this.eventHandler =         // Our event handler.
        new EventHandler(this, [
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

      Util.foldl(
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
        new Struct(rawMessage.data); // Message is wrapped.
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
              new DataEvent(serviceInstance, message)
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
        new ServiceInstance(connection, openEvent);

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

    module.exports = Connection;
  }, {"./DataEvent": 4, "./EventHandler": 5, "./ServiceInstance": 7, "./Util": 9}],
  3: [function(require, module, exports) {
    module.exports = {};
  }, {}],
  4: [function(require, module, exports) {
    /**
     * Copyright (c) 2015 SPARKL Limited. All Rights Reserved.
     * Author: <jacoby@sparkl.com> Jacoby Thwaites.
     *
     * Implements the data event which is used to carry data to and
     * from the SSE. This provides methods to set and get data where
     * named fields are used for the keys.
     *
     * A data event object is the prototype of the notify, solicit,
     * response, request, reply and consume objects which are exposed
     * as sparkl globals.
     *
     * The data event object contains a sparkl.Struct. If not provided
     * to the constructor, an empty data_event struct is created ready
     * for new attributes and content.
     *
     * Provides a utility method .alias(name) which returns the fieldname
     * corresponding to the alias. Aliases are setup using a prop as follows:
     *
     * <reply name="Ok" fields="fieldA fieldB">
     *   <prop name="aliases" foo="fieldA" bar="fieldB"/>
     * </reply>
     *
     * Depends on sparkl.Struct.js.
     */

    var Util = require('./Util');
    var Struct = require('./Struct');
    var genId = new Util.IdGenerator("N");

    /**
     * Constructor creates a data event using the enclosed struct or creating
     * a blank one if necessary.
     * The subject is a notify, solicit, response, request, reply or consume.
     * Field values can be set by name, which is looked up in the subject and
     * resolved to an id.
     */
    var DataEvent = function(serviceInstance, struct) {
      this.serviceInstance = serviceInstance;

      if (struct && struct.constructor === Struct) {
        this.struct = struct;
      }
      else {
        this.struct = new Struct({
          tag: "data_event",
          attr: {
            id: genId()
          },
          content: []
        });
      }
    };

    DataEvent.prototype.setStruct = function(struct) {
      var dataEvent = this;
      dataEvent.struct = struct;
      return dataEvent;
    };

    /**
     * Sets the ref to a preceding request or response.
     * This only applies to reply data events.
     */
    DataEvent.prototype.setRef = function(ref) {
      var dataEvent = this;
      dataEvent.struct.json.attr["ref"] = ref;
      return dataEvent;
    };

    /**
     * Sets the subject of this data event, for example a solicit
     * or a reply object. This is used when resolving field names
     * and defines the type of event.
     */
    DataEvent.prototype.setSubject = function(subject) {
      var dataEvent = this;
      dataEvent.subject = subject;
      dataEvent.struct.json.attr["subject"] = subject.id();
      return dataEvent;
    };

    /**
     * Returns the fieldname corresponding to the alias, or undefined
     * if the alias is not defined as an attribute on the aliases prop.
     */
    DataEvent.prototype.alias = function(alias) {
      var dataEvent = this;
      var aliases =
        dataEvent.subject.content("prop", "aliases");
      return aliases && aliases.attr(alias);
    };

    /**
     * Resolves the values map if supplied, setting the values in
     * the data event field values.
     *
     * If no map is supplied, returns a map of values keyed by name
     * dereferenced from the data event id map.
     */
    DataEvent.prototype.values = function(values) {
      var dataEvent = this;
      var namedMap, fields;

      if (values) {
        Util.foldl(
          function(name, value) {
            dataEvent.value(name, value);
          }, null, values);
        return dataEvent;
      }

      else {
        fields =
          dataEvent.serviceInstance.openEvent
            .content("fields")[0];
        namedMap =
          Util.foldl(
            function(id, datum, acc) {
              var fieldId = datum.field();
              var fieldValue = datum.content();
              var field = fields.content("field", fieldId);
              var name = field.name();
              acc[name] = fieldValue;
              return acc;
            }, {}, dataEvent.struct.content("datum"));
        return namedMap;
      }
    };

    /**
     * Resolves the name using the data event's subject, and
     * either sets or gets the field value.
     */
    DataEvent.prototype.value = function(name, value) {
      var dataEvent = this;
      var field =
        dataEvent.fieldByName(name)
      var fieldId =
        field.id();
      var datum, i;

      // Value not supplied means get.
      if (typeof value === "undefined") {
        for (i = 0; i < dataEvent.struct.content().length; i++) {
          datum =
            dataEvent.struct.content("datum")[i];
          if (datum.field() === fieldId) {

            // A datum struct can have exactly one primitive element
            // as its content.
            return datum.content()[0];
          }
        }
        return undefined;
      }

      // Value supplied means set, so long as the field has a type.
      // The value type is coerced by the SSE, so it does not have to be
      // done here.
      else if (field.type()) {
        datum = {
          tag: "datum",
          attr: {
            field: fieldId
          },
          content: [value]
        };

        dataEvent.struct.json.content.push(datum);
      }

      return dataEvent;
    };

    /**
     * Returns the first field from the list of ids whose name matches
     * the key.
     */
    DataEvent.prototype.fieldByName = function(name) {
      var dataEvent = this;
      var subject =
        dataEvent.subject;
      var candidateIds =
        subject.fields().split(" ");
      var openEvent =
        dataEvent.serviceInstance.openEvent;
      var i, field, candidateId;

      for (i = 0; i < candidateIds.length; i++) {
        candidateId =
          candidateIds[i];
        field =
          openEvent
            .content("fields")[0]
            .content("field", candidateId);
        if (field.name() === name) {
          return field;
        }
      }

      throw "No field " + name +
      " on " + subject.tag() +
      ": " + subject.name();
    };

    /**
     * Sends the message, returning a promise.
     *
     * The promise is fulfilled or rejected depending on subject
     * as follows:
     * - notify
     *   Fulfilled immediately.
     *
     * - solicit
     *   Fulfilled when a data_event arrives referencing the solicit.
     *   Rejected when an error_event arrives referencing the solicit,
     *   or when a local timeout occurs.
     *
     * - reply
     *   Fulfilled immediately.
     */
    DataEvent.prototype.send = function() {
      var dataEvent =
        this;
      var connection =
        dataEvent.serviceInstance.connection;

      return new Promise(
        function(fulfil, reject) {
          var subjectCodes = {
            "H": "notify",
            "I": "solicit",
            "L": "reply"
          };

          var subject =
            subjectCodes[
              dataEvent.struct.attr("subject")[0]];

          var timeoutMillis, timeout;

          // Just in case the SSE doesn't send a response timeout
          // error event, we do a local timeout with a delta of 5s
          // over the actual timeout.
          var localDelta = +5000;

          if (subject === "notify" || subject === "reply") {
            connection.sendMessage(
              dataEvent.struct.json);
            fulfil();
          }

          else if (subject === "solicit") {
            connection.sendMessage(
              dataEvent.struct.json);

            timeoutMillis =
              dataEvent.serviceInstance.openEvent
                .content("solicits")[0]
                .content("solicit", dataEvent.struct.attr("subject"))
                .attr("timeout") + localDelta;

            timeout =
              setTimeout(
                function() {
                  reject("Local timeout");
                }, timeoutMillis);

            connection.addPendingResponse({
              ref: dataEvent.struct.id(),
              instance: dataEvent.serviceInstance,
              fulfil: fulfil,
              reject: reject,
              timeout: timeout
            });
          }

          else {
            reject("Cannot send: " + tag)
          }
        });
    };

    module.exports = DataEvent;
  }, {"./Struct": 8, "./Util": 9}],
  5: [function(require, module, exports) {
    /**
     * Copyright (c) 2015 SPARKL Limited. All Rights Reserved.
     * Author <jacoby@sparkl.com> Jacoby Thwaites.
     *
     * Event object and handler implementation.
     */

    /***************************************************************************
     *
     * Event object constructor.
     *
     * The eventType is a string, the event data is any data that goes
     * with the event (e.g. the service instance in the case of an open event).
     *
     ***************************************************************************/
    var EventObject = function(source, eventType, eventData) {
      this.source = source;
      this.type = eventType;
      this.data = eventData;
    };

    /***************************************************************************
     *
     * Event handler constructor.
     *
     * Abstracts event listener registration and event firing.
     *
     * The owner object is used as the return value from the on() function,
     * and as the context object for event callbacks.
     *
     * The on() and fireEvent() methods are added to the owner object for
     * convenience.
     *
     ***************************************************************************/
    var EventHandler = function(source, eventTypes) {
      var eventHandler = this;

      if (!(eventTypes instanceof Array)) {
        throw "Must specify array of event types";
      }

      this.source = source;
      this.eventTypes = eventTypes;
      this.listeners = [];
    };

// Creates the .on and .fireEvent methods on the event handler's
// source object for convenience.
    EventHandler.prototype.delegate = function() {
      var eventHandler = this;

      eventHandler.source.on = function(eventType, callback) {
        return eventHandler.on(eventType, callback);
      };

      eventHandler.source.fireEvent = function(eventType, event) {
        return eventHandler.fireEvent(eventType, event);
      };
    };

    EventHandler.prototype.on = function(eventType, callback) {
      var eventHandler = this;

      if (eventType === "all" || eventHandler.eventTypes.indexOf(eventType) >= 0) {
        eventHandler.listeners.push({
          eventType: eventType,
          callback: callback
        });
      }
      else {
        console.log("Supported event types: " +
          eventHandler.eventTypes.join(","));
      }
      return eventHandler.source;
    };

    EventHandler.prototype.fireEvent = function(eventType, eventData) {
      var eventHandler = this;
      var source = eventHandler.source;
      var event = new EventObject(source, eventType, eventData);
      var listeners = eventHandler.listeners;
      var i, listener;

      for (i = 0; i < listeners.length; i++) {
        listener = listeners[i];
        if (listener.eventType === "all" || listener.eventType === eventType) {
          try {
            listener.callback.call(eventHandler.source, event);
          }
          catch (e) {
            console.error(e);
          }
        }
      }
    };

    module.exports = EventHandler;

  }, {}],
  6: [function(require, module, exports) {
    /**
     * Copyright (c) 2015 SPARKL Limited. All Rights Reserved.
     * Author <jacoby@sparkl.com> Jacoby Thwaites.
     *
     * Service Implementation callback argument object constructors.
     *
     * The service implementation is optional, is driven by events from
     * a service instance, and talks names rather than IDs.
     */

    var Util = require('./Util');
    var DataEvent = require('./DataEvent');

    /***************************************************************************
     *
     * ServiceImpl object constructor. Provides convenience functions.
     *
     * The constructor sets the serviceInstance property and mixes the original
     * implementation properties into the new service implementation object.
     *
     * Several serviceInstance functions are mirrored on this object for
     * convenience.
     *
     * The onXXX function props can all be overridden by the user implementation.
     *
     ***************************************************************************/

    var ServiceImpl = function(serviceInstance, implementation) {
      this.serviceInstance = serviceInstance;
      Util.mix(implementation, this);
      Util.mirror(serviceInstance, this, [
        "openEvent"]);
    };//+

    ServiceImpl.prototype.onInit = function(openEvent) {
      console.log("No implementation onInit()");
    };

    ServiceImpl.prototype.onClose = function(closeEvent) {
      console.log("No implementation onClose()");
    };

    ServiceImpl.prototype.onData = function(dataEvent) {
      var serviceImpl =
        this;
      var serviceInstance =
        serviceImpl.serviceInstance;
      var subject =
        dataEvent.struct.subject();
      var replies =
      {};
      var subjectName, i;
      var replyStruct, replyStructs;
      var replyDataEvent, replyDataEvents;

      // Request subject.
      if (subject.startsWith("K-")) {
        dataEvent.subject =
          serviceInstance.openEvent
            .content("requests")[0]
            .content("request", subject);
      }

      // Consume subject.
      else if (subject.startsWith("M-")) {
        dataEvent.subject =
          serviceInstance.openEvent
            .content("consumes")[0]
            .content("consume", subject);
      }

      // Response subject.
      else if (subject.startsWith("J-")) {
        console.warn("Response");
      }

      else {
        console.error("Unrecognized subject: " + subject);
      }

      // Build the map of reply data events. The user selects
      // one at runtime.
      replyStructs =
        dataEvent.subject.content("reply");

      for (i = 0; i < replyStructs.length; i++) {
        replyStruct =
          replyStructs[i];

        replyDataEvent =
          new sparkl.DataEvent(serviceInstance)
            .setRef(dataEvent.struct.id())
            .setSubject(replyStruct);

        replies[replyStruct.name()] =
          replyDataEvent;
      }

      subjectName =
        dataEvent.subject.name();

      if (serviceImpl[subjectName]) {
        serviceImpl[subjectName].apply(
          serviceImpl, [dataEvent, replies]);
      }

      else {
        console.error("No implementation for " + subjectName);
      }

    };

    ServiceImpl.prototype.solicit = function(name) {
      var serviceInstance =
        this.serviceInstance;
      var solicit =
        serviceInstance.openEvent
          .content("solicits")[0]
          .content("solicit", name);

      return new DataEvent(serviceInstance)
        .setSubject(solicit);
    };

    ServiceImpl.prototype.notify = function(name) {
      var serviceInstance =
        this.serviceInstance;
      var notify =
        serviceInstance.openEvent
          .content("notifies")[0]
          .content("notify", name);

      return new DataEvent(serviceInstance)
        .setSubject(notify);
    };

    module.exports = ServiceImpl;

  }, {"./DataEvent": 4, "./Util": 9}],
  7: [function(require, module, exports) {
    /***************************************************************************
     *
     * ServiceInstance object constructor.
     *
     * The service instance talks IDs and events, and sits below the optional
     * service implementation.
     *
     * The openEvent property is a sparkl.Struct, and always exists. It holds
     * the metadata about the service against which this instance was opened.
     *
     ***************************************************************************/

    var EventHandler = require('./EventHandler');
    var DataEvent = require('./DataEvent');
    var ServiceImpl = require('./ServiceImpl');
    var Util = require('./Util');
    var Container = require('./Container');

    /***************************************************************************
     *
     * Function queue. Used to serialise Javascript loads.
     *
     ***************************************************************************/
    var FunQueue = function(isRunning) {
      this.isRunning = isRunning ? true : false; // Let's be boolean.
      this.queue = [];
    };

// Callback is passed one function argument, and MUST call it when
// it's happy for the next in the queue to execute.
    FunQueue.prototype.push = function(callback) {
      var funQueue = this;
      var toExecute = function() {
        callback(function() {
          funQueue.next.call(funQueue);
        })
      };

      funQueue.queue.push(toExecute);

      if (!funQueue.isRunning) {
        funQueue.next();
      }
    };

    FunQueue.prototype.next = function() {
      var funQueue = this;
      var toExecute = funQueue.queue.shift();

      if (toExecute) {
        funQueue.isRunning = true;
        setTimeout(toExecute, 0);
      }
      else {
        funQueue.isRunning = false;
      }
    };

// Queue of Javascript loads which have to be done one by one.
    var jsLoadQueue = new FunQueue();

    /***************************************************************************
     *
     * Service Instance object constructor and methods.
     *
     ***************************************************************************/

    var ServiceInstance = function(connection, openEvent) {
      this.connection = connection;
      this.openEvent = openEvent;           // The initial open event.
      this.aggregateEvents = [];            // Subsequent aggregate event(s).
      this.eventQueue = new FunQueue(true); // Queue halted until open completes.
      this.resolver = null;                 // Optional resolver for URLs.
      this.serviceImpl = undefined;         // User implementation object.
      this.eventHandler =                   // Our event handler.
        new EventHandler(this, [
          "aggregate", "close",
          "notify", "solicit", "response",
          "request", "reply", "consume"]);

      this.eventHandler.delegate();
    };

    ServiceInstance.prototype.setResolver = function(resolver) {
      var serviceInstance = this;

      console.log("A URL resolver has been set");
      serviceInstance.resolver = resolver;
    };

    ServiceInstance.prototype.enqueue = function(message) {
      var serviceInstance = this;
      var handler = function(finish) {
        serviceInstance.handleEvent(message);
        finish();
      };

      serviceInstance.eventQueue.push(handler);
    };

    ServiceInstance.prototype.onClose = function() {
      var serviceInstance = this;
      var serviceImpl = serviceInstance.serviceImpl;
      serviceImpl &&
      serviceImpl.onClose();
      console.log("Instance closed");
    };

    ServiceInstance.prototype.handleEvent = function(message) {
      var serviceInstance = this;

      if (message.tag() === "data_event") {
        serviceInstance.onData(
          new DataEvent(serviceInstance, message));
      }

      else if (message.tag() === "error_event") {
        serviceInstance.onError(message);
      }

      else if (message.tag() === "close_event") {
        serviceInstance.onClose(message);
      }

      else {
        reason = "Unexpected: " + message.tag();
        console.warn(reason);
      }
    };

    ServiceInstance.prototype.open = function() {
      var serviceInstance = this;

      console.log('Service Instance Opening!');

      return new Promise(function(fulfil, reject) {
        var loadNext = function(finished) {
          serviceInstance.loadImplJavascript()
            .then(
              function() {
                try {
                  console.log("Load complete");
                  finished(); // Allow next JS file load to start.

                  serviceInstance
                    .onInit(
                      serviceInstance.openEvent);

                  serviceInstance.eventQueue.next(); // Free up the event queue
                  fulfil();   // Load and initialisation complete.
                }
                catch (e) {
                  var closeEvent = {
                    tag: "error",
                    attr: [{"reason": reason}]
                  };
                  console.error(e);
                  reject(e);
                  serviceInstance.onClose(closeEvent);
                }
              },

              function(error) {
                reject("Failed to load service implementation: " + error);
              });
        };

        jsLoadQueue.push(loadNext);
      });
    };

    ServiceInstance.prototype.loadImplJavascript = function() {
      var serviceInstance = this;
      var ee = Util.environment();

      if (ee === "browser") {
        return serviceInstance.loadBrowserJavascript();
      }
      else if (ee === "nodejs") {
        return serviceInstance.loadNodeJSJavascript();
      }
      else {
        return new Promise(function(fulfil, reject) {
          reject("Unsupported environment: " + ee);
        });
      }
    };

    /**
     * The service (or pool or whatever) is the first item in the
     * content of the open event.
     *
     * If the tabserver.browser.src prop has a src="href" attribute,
     * then the source is fetched from the href using the resolver
     * previously set on this instance, if any.
     * Otherwise, the source is the prop value itself.
     *
     * The global sparkl.service function is a closure invoked
     * by the loaded Javascript. It associates the newly loaded
     * implementation with the lower-level service instance object
     * by calling the sparkl.ServiceImpl/2 constructor.
     */
    ServiceInstance.prototype.loadBrowserJavascript = function() {
      var serviceInstance = this;
      var service = serviceInstance.openEvent.content()[0];
      var jsProp = service.content("prop", "tabserver.browser.src");

      console.log("Creating sparkl.service object");

      Container.service = function(implementation) {
        serviceInstance.serviceImpl =
          new ServiceImpl(serviceInstance, implementation);
      };

      if (jsProp) {
        if (jsProp.src) {
          return new Promise(function(fulfil, reject) {
            var url = jsProp.src();
            var resolver = serviceInstance.resolver; // May have been set.
            var script = document.createElement("script");

            if (typeof resolver == "function") {
              url = resolver.call(this, url);
            }

            if (url) {

              console.log(
                "Loading implementation for " +
                service.id() +
                " from '" +
                url + "'");

              script.setAttribute("type", "text/javascript");
              script.setAttribute("src", url);

              script.addEventListener("load",
                function(event) {
                  delete Container.service;
                  console.log("Loaded " + url + ", deleted sparkl.service");
                  script.parentNode.removeChild(script);
                  fulfil();
                }, true);

              script.addEventListener("error",
                function() {
                  var reason = "Failed to load " + url + ", deleted sparkl.service";
                  delete Container.service;
                  console.error(reason);
                  script.parentNode.removeChild(script);
                  reject(reason);
                }, true);

              document.getElementsByTagName("head")[0].appendChild(script);
            }
            else {
              console.warn(service.id() +
                ": No implementation, awaiting open events on dependent services");
              fulfil();
            }
          });
        }

        else {
          return new Promise(function(fulfil, reject) {
            var script = jsProp.content();

            console.log("Inline Javascript (" + script.length + " chars)");
            try {
              eval(script);
              console.log("Script evaluated");
              fulfil();
            }
            catch (e) {
              console.error(e);
              reject(e);
            }
            finally {
              console.log("Deleted sparkl.service");
              delete Container.service;
            }
          });
        }
      }
      else {
        return new Promise(function(fulfil, reject) {
          console.warn("No javascript specified");
          fulfil();
        });
      }
    };

    ServiceInstance.prototype.loadNodeJSJavascript = function() {
      var serviceInstance = this;
      var service = serviceInstance.openEvent.content("service")[0];
      var module =
        service.prop(PROP_NODEJS_MODULE) ||
        service.prop(PROP_BROWSER_SOURCE);

      return new Promise(function(fulfil, reject) {
        if (module) {

          console.log("Creating sparkl.service object");
          Container.service = function(implementation) {
            serviceInstance.serviceImpl =
              new ServiceImpl(serviceInstance, implementation);
          };

          try {
            require(module)
            fulfil();
          }
          catch (error) {
            console.error(error);
            reject("Failed to load module: " + module);
          }
        }
        else {
          reject("Missing service prop: " + PROP_NODEJS_MODULE);
        }
      });
    };

    ServiceInstance.prototype.onInit = function(openEvent) {
      var serviceInstance = this;

      try {
        serviceInstance.serviceImpl &&
        serviceInstance.serviceImpl.onInit(openEvent);
      }
      catch (e) {
        console.error(e);
      }
    };

    ServiceInstance.prototype.onClose = function(closeEvent) {
      var serviceInstance = this;

      try {
        serviceInstance.serviceImpl &&
        serviceInstance.serviceImpl.onClose(closeEvent);
      }
      catch (e) {
        console.error(e);
      }
      console.warn("Closed: " + serviceInstance.openEvent.ref());
      serviceInstance.fireEvent("close", closeEvent);
    };

    /**
     * The data event can be handled by the onData callback of
     * the service implementation, if loaded.
     *
     * The service implementation is loaded by the sparkl.service(Impl) call in
     * the loaded Javascript.
     *
     * If the onData() function is _not_ specified in the Impl object, the
     * default implementation is used which calls back to named function
     * properties on that Impl object.
     *
     * If the sparkl.service(Impl) call is not made by the loaded Javascript,
     * or there is no loaded Javascript at all, then a console error is logged.
     */
    ServiceInstance.prototype.onData = function(dataEvent) {
      var serviceInstance = this;
      var serviceImpl = serviceInstance.serviceImpl;

      serviceInstance.fireEvent("data", dataEvent);

      if (serviceImpl && serviceImpl.onData) {
        serviceImpl.onData.call(serviceImpl, dataEvent);
      }
      else {
        console.error(
          "Loaded Javascript should execute sparkl.service(ImplObject)");
      }
    };

    module.exports = ServiceInstance;

  }, {"./Container": 3, "./DataEvent": 4, "./EventHandler": 5, "./ServiceImpl": 6, "./Util": 9}],
  8: [function(require, module, exports) {
    /**
     * Copyright (c) 2015 SPARKL Limited. All Rights Reserved.
     * Author <jacoby@sparkl.com> Jacoby Thwaites.
     *
     * Struct object constructor.
     *
     * Use this to simplify access to content in SPARKL structs like:
     * {
 *   tag : "foo",
 *   attr : { a : "one", b : "two"},
 *   content : [
 *     <<structs including props>>
 *   ]
 * }
     *
     * Usage:
     *   var struct             = new Struct(json);
     *   var contentLength      = struct.content().length
     *   var allFolders         = struct.content("folder")
     *   var oneStruct          = struct.content(2)
     *   var oneNamedFolder     = struct.content("folder", "foo")
     *   var oneIndexedFolder   = struct.content("folder", 0)
     *   var allRequests        = struct.content("request")
     *   var allAttributeValues = struct.attr()
     *   var someAttribute      = struct.attr("someAttribute")
     *   var listOfPropNames    = struct.prop()
     *   var specificProp       = struct.prop("specific.prop")
     *
     */
    "use strict";

    var matches = function(tag, test) {
      if (test instanceof RegExp) {
        return test.test(tag);
      }
      else {
        return tag === test;
      }
    };

    /**
     * If the JSON string or object is supplied, it is set at
     * construction time.
     *
     * Otherwise, use the .json method.
     */
    var Struct = function(json) {
      var struct = this;
      if (json) {
        struct.json(json);
      }
    };

    /**
     * Sets the JSON string or object, or returns it if no arg
     * is supplied. This creates function properties on the object
     * to retrieve attributes etc.
     */
    Struct.prototype.json = function(json) {
      var struct = this;

      if (json) {
        struct.json = (typeof json === "string") ?
          JSON.parse(json) :
          json;

        if (struct.json && struct.json.tag) {
          if (struct.json.attr) {
            for (var prop in struct.json.attr) {
              if (struct.json.attr.hasOwnProperty(prop)) {
                (function(name) {
                  if (!struct[name]) {
                    struct[name] = function() {
                      return struct.json.attr[name];
                    }
                  }
                })(prop);
              }
            }
          }
        }
        else {
          console.error(
            ["Struct object must have 'tag' and 'attr' props", struct.json]);
        }
      }
      else {
        return struct.json;
      }
    };

    Struct.prototype.tag = function() {
      var struct = this;
      return struct.json.tag;
    };

    Struct.prototype.attr = function(name) {
      var struct = this;
      if (name) {
        return struct.json.attr[name];
      }
      else {
        return struct.json.attr;
      }
    };

    Struct.prototype.prop = function(name) {
      var struct = this;
      var prop = struct.content("prop", name);
      var names = []; // Return list of names if no name specified.

      if (prop instanceof Array) {
        for (var i = 0; i < prop.length; i++) {
          names.push(prop[i].name());
        }
        return names;
      }
      else if (prop && prop.type() === "number") {
        return Number(prop.content());
      }
      else if (prop && prop.content) {
        return prop.content();
      }
      else {
        return undefined;
      }
    };

    /**
     * Returns all or selected content structs, depending on the supplied
     * arguments. You can use the argument-specific content functions instead
     * if that's clearer.
     *
     *   () - returns array of all content.
     *   (0..n) - returns a single struct. Same as ()[n].
     *   ("tag") - returns array of content structs whose tag matches.
     *   ("tag", "nameOrId") - returns single struct whose name or id matches.
     *   ("tag", 0..n) - returns a single struct. Same as ("tag")[n].
     *   ("tag", "nameOrId nameOrId") - returns array of content structs whose
     *     tag matches and whose name or id matches any of those in the
     *     space-separated list.
     *   ("tag", [namesOrIds]) - returns array of content structs whose tag
     *     matches and whose name or id matches any of those in the array.
     *   Anything else - returns array of all content.
     */
    Struct.prototype.content = function() {
      var struct = this;
      var arg0 = arguments[0];
      var arg1 = arguments[1];

      if (typeof arg0 == "undefined") {
        return struct.contentAll();
      }
      else if (typeof arg0 === "number") {
        return struct.contentAll()[arg0];
      }
      else if (typeof arg0 === "string") {
        if (typeof arg1 === "undefined") {
          return struct.contentWithTag(arg0);
        }
        else if (typeof arg1 === "string") {
          if (arg1.indexOf(" ") === -1) {
            return struct.contentWithTagAndName(arg0, arg1);
          }
          else {
            return struct.contentWithTagAndNames(arg0, arg1.split(" "));
          }
        }
        else if (typeof arg1 === "number") {
          return struct.contentWithTag(arg0)[arg1];
        }
        else if (arg1 instanceof Array) {
          return struct.contentWithTagAndNames(arg0, arg1);
        }
      }
      return false;
    };

    Struct.prototype.contentWithTag = function(tag) {
      var struct = this;
      var content = struct.json.content;
      var result = [];

      if (content && content instanceof Array) {
        content.every(function(item) {
          if (matches(item.tag, tag)) {
            result.push(new Struct(item));
          }
          return true;
        });
      }

      return result;
    };

    Struct.prototype.contentWithTagAndName = function(tag, nameOrId) {
      var struct = this;
      var content = struct.json.content;
      var result = undefined;

      if (content && content instanceof Array) {
        content.some(function(item) {
          if (matches(item.tag, tag)) {
            if (item.attr.id === nameOrId || item.attr.name === nameOrId) {
              result = new Struct(item);
              return true;
            }
          }
          return false;
        });
      }

      return result;
    };

    Struct.prototype.contentWithTagAndNames = function(tag, namesOrIds) {
      var struct = this;
      var content = struct.json.content;
      var result = [];

      if (content && content instanceof Array) {
        content.every(function(item) {
          if (matches(item.tag, tag)) {
            if (namesOrIds.indexOf(item.attr.id) >= 0
              || namesOrIds.indexOf(item.attr.name) >= 0) {
              result.push(new Struct(item));
            }
          }
          return true; // Iterate through all items.
        });
      }

      return result;
    };

    Struct.prototype.contentAll = function() {
      var struct = this;
      var content = struct.json.content;
      var result = [];

      if (content && content instanceof Array) {
        content.every(function(item) {

          // Tagged items are converted to structs and pushed on the list.
          if (item && item.tag) {
            result.push(new Struct(item));
          }

          // Primitive and all other values are pushed directly on the list.
          else {
            result.push(item);
          }

          return true;
        });
      }

      return result;
    };

    module.exports = Struct;
  }, {}],
  9: [function(require, module, exports) {
    (function(global) {
      /**
       * Copyright (c) 2014, 2015 Sparkl Limited. All Rights Reserved.
       * Author: jacoby@sparkl.com
       *
       * The sparkl tabserver library. Requires HTML5 support for:
       *   - WebSockets
       *
       * This defines the global 'sparkl' object.
       */
      "use strict";

      /**
       * Returns a generator for ids whose format matches the SSE gen_id.
       * The first character is used to identify the id type, per the
       * SSE id types in sse_cfg.hrl.
       */
      var IdGenerator = function(prefix) {
        var node =
          hashCode(window.location.href, 16)
            .toString(36)
            .toUpperCase();
        var rti =
          hashCode(new Date(), 16)
            .toString(36)
            .toUpperCase();
        var next = new Counter();

        return function() {
          var count =
            next()
              .toString(36)
              .toUpperCase();
          var id =
            prefix + "-" + node + "-" + rti + "-" + count;
          return id;
        }
      };

      /**
       * Returns the execution environment (browser or node.js) by
       * looking for well-known properties on the global object.
       */
      var environment = function() {
        var ee = "unknown";

        if (typeof module !== "undefined") {
          ee = "nodejs";
        }
        else if (typeof window !== "undefined") {
          ee = "browser";
        }

        console.log("Execution environment: " + ee);
        return ee;
      };

      /***************************************************************************
       *
       * Utility functions.
       *
       ***************************************************************************/

      /**
       * Folds the function over the array elements or object properties,
       * returning the accumulator whose initial value is supplied.
       *
       * The callback fun is invoked with 3 args being:
       * 1. the array index or the property name
       * 2. the array element or property value
       * 3. the accumulator value so far
       *
       * The context 'this' of the callback fun is the array or object being
       * folded over.
       */
      var foldl = function(fun, acc, foldable) {
        var type =
          Object.prototype.toString.call(foldable);
        var prop, i, value;
        if (type === "[object Array]") {
          for (i = 0; i < foldable.length; i++) {
            value =
              foldable[i];
            acc =
              fun.call(foldable, i, value, acc);
          }
          return acc;
        }
        else if (type === "[object Object]") {
          for (prop in foldable) {
            if (foldable.hasOwnProperty(prop)) {
              value =
                foldable[prop];
              acc =
                fun.call(foldable, prop, value, acc);
            }
          }
          return acc;
        }
        throw "foldl needs array or object";
      };

      /**
       * Mixes the own props only from the first object into the second,
       * excluding any props listed in the third argument, if present.
       */
      var mix = function(from, to, ignore) {
        for (var prop in from) {
          if (from.hasOwnProperty(prop)) {
            if (!ignore || ignore.indexOf(prop) === -1) {
              to[prop] = from[prop];
            }
          }
        }
      };

      /**
       * Mirrors methods on the from object so that they are
       * directly accessible on the to object. Only methods that
       * are listed are mirrored.
       * @param from the object whose methods are mirrored.
       * @param to the object on which the methods are mirrored.
       * @param propList the array of strings naming the methods to be mirrored.
       */
      var mirror = function(from, to, propList) {
        propList.forEach(function(prop) {
          var fun = from[prop];
          to[prop] = function() {
            return fun.apply(from, arguments);
          };
        });
      };

      /**
       * Returns true if browser has required functionality, otherwise
       * logs error and returns false.
       */
      var compatible = function() {
        var compatible = true;
        if (typeof WebSocket === "undefined") {
          console.error("This browser does not support WebSocket");
          compatible = false;
        }

        return compatible;
      };

      /**
       * Var used to hold error reason throughout.
       */
      var reason;

      /**
       * The location.getParam() function is very useful for people using this
       * library in a browser.
       */
      if ((typeof window !== "undefined") &&
        window.location && !window.location.getParam) {
        window.location.getParam = function(name) {
          name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
          var regexS = "[\\?&]" + name + "=([^&#]*)";
          var regex = new RegExp(regexS);
          var results = regex.exec(window.location.search);
          if (results == null) {
            return "";
          }
          else {
            return decodeURIComponent(results[1].replace(/\+/g, " "));
          }
        };
      }

      /**
       * Function to return a self-contained turnaround counter
       * initialized to zero. Used to generate unique IDs.
       */
      var Counter = function() {
        var count = 0;

        return function() {
          if (count < 4294967295) {
            return count++;
          }
          else {
            return count = 0;
          }
        };
      };

      /**
       * Generates a 32-bit signed hashcode on the string.
       * If the bits arg is supplied, only the least significant
       * bits are returned, where 31 or less ensures a positive
       * result since the sign bit is the most significant.
       * Thanks to: http://werxltd.com/wp/2010/05/13/
       */
      var hashCode = function(str, length) {
        var ch, i, hash = 0;
        var bits = length || 16;
        var mask = (Math.pow(2, bits) - 1);

        if (str.length == 0) {
          return hash;
        }

        for (i = 0; i < str.length; i++) {
          ch = str.charCodeAt(i);
          hash = ((hash << 5) - hash) + ch;
          hash = hash & hash;
        }
        return hash & mask;
      };

      /**
       * SPARKL globals.
       */
      if (typeof sparkl === "undefined") {
        global.sparkl = {};
      }

      var util = {};

      util.foldl = foldl;
      util.mix = mix;
      util.mirror = mirror;
      util.environment = environment;
      util.Counter = Counter;
      util.IdGenerator = IdGenerator;

      module.exports = util;

    }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
  }, {}]
}, {}, [1]);
