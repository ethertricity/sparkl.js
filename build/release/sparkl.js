/**
 * Copyright (c) 2014 Sparkl Limited. All Rights Reserved.
 * Author: jacoby@sparkl.com
 *
 * The sparkl tabserver library. Requires HTML5 support for:
 *   - WebSockets
 *
 * This defines the global 'sparkl' object.
 */
(function (global) {

  // Constants.
  var MSG_ID = // Matches MSG_ID in SPARKL tabserver_yapp.
    "_msgid";

  /** Not used
   var OPEN_TIMEOUT_MILLIS = // Time to await connection open-event.
   5000;
   */
  var PROP_BROWSER_SOURCE = // Where a browser loads service implementation.
    "tabserver.browser.src";
  var PROP_NODEJS_MODULE = // Where node.js loads a service implementation.
    "tabserver.nodejs.module";
  var EE_BROWSER = // Execution environment is browser.
    "browser";
  var EE_NODEJS = // Execution environment is node.js.
    "nodejs";
  var EE_UNKNOWN = // Execution environment is unknown.
    "unknown";


  /***************************************************************************
   *
   * Utility functions.
   *
   ***************************************************************************/

  /**
   * Mixes the own props only from the first object into the second,
   * excluding any props listed in the third argument, if present.
   */
  var mix = function (from, to, ignore) {
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
  var mirror = function (from, to, propList) {
    propList.forEach(function (prop) {
      var fun = from[prop];
      to[prop] = function () {
        return fun.apply(from, arguments);
      };
    });
  };


  /**
   * Returns the execution environment (browser or node.js) by
   * looking for well-known properties on the global object.
   */
  var executionEnvironment = function () {
    var ee = EE_UNKNOWN;

    if (typeof module !== "undefined") {
      return EE_NODEJS;
    }
    if (typeof window !== "undefined") {
      return EE_BROWSER;
    }

    console.log("Execution environment: " + ee);
    return ee;
  };

  /**
   * Function to return a self-contained turnaround counter
   * initialized to zero. Used to generate unique IDs.
   */
  var counter = function () {
    var count = 0;

    return function () {
      if (count < 4294967295) {
        return count++;
      } else {
        return count = 0;
      }
    };
  };

  /**
   * Requires libraries used by node.js version
   */
  if (executionEnvironment() === EE_NODEJS) {
    WebSocket = require("ws");
    Promise = require("promise");
  }

  /**
   * Returns true if browser has required functionality, otherwise
   * logs error and returns false.
   */
  if (typeof WebSocket === "undefined") {
    if (executionEnvironment() === EE_BROWSER) {
      console.error("This browser does not support WebSocket");
      return;
    }
  }

  /**
   * Var used to hold error reason throughout.
   */
  var reason;

  /***************************************************************************
   *
   * Foreach function is applied to each property of the object. The context
   * is the original object, the single argument is the value of the property.
   *
   ***************************************************************************/
  var foreach = function (object, fun) {
    var prop, value;

    for (prop in object) {
      if (object.hasOwnProperty(prop)) {
        value = object[prop];
        fun.call(object, prop);
      }
    }
  };
  /***************************************************************************
   *
   * Implementation callback argument object constructors.
   *
   ***************************************************************************/
  
  /**
   * Base prototype for one-way, request and response.
   */
  var AbstractInput = function (event, serviceInstance) {
    this.event = event;
    this.serviceInstance = serviceInstance;
  };
  
  AbstractInput.prototype.value = function (nameOrId) {
    var abstractInput = this;
    var metadata = abstractInput.serviceInstance.metadata();
    var field = metadata.content("field", nameOrId);
    var fieldId = field ? field.id() : false;
    return fieldId ?
      abstractInput.event.content("field", fieldId).content() :
      false;
  };
  
  AbstractInput.prototype.values = function () {
    var abstractInput = this;
    var metadata = abstractInput.serviceInstance.metadata();
    var fields = abstractInput.event.content("field");
    var i;
    var field, fieldId, fieldName;
    var values = {};
  
    for (i = 0; i < fields.length; i++) {
      field = fields[i];
      fieldId = field.id();
      fieldName = metadata.content("field", fieldId).name();
      values[fieldName] = field.content();
    }
    return values;
  };
  
  /*
   * Base prototype for notification, solicit and reply.
   */
  var AbstractOutput = function (serviceInstance) {
    this.serviceInstance = serviceInstance;
    this.fieldValues = {};
  };
  
  AbstractOutput.prototype.value = function (nameOrId, value) {
    var abstractOutput = this;
    var metadata = abstractOutput.serviceInstance.metadata();
    var field = metadata.content("field", nameOrId);
    var fieldId = field.id();
    abstractOutput.fieldValues[fieldId] = value;
    return abstractOutput;
  };
  
  AbstractOutput.prototype.values = function (values) {
    var abstractOutput = this;
    var nameOrId, value, field, fieldId;
    for (nameOrId in values) {
      if (values.hasOwnProperty(nameOrId)) {
        value = values[nameOrId];
        abstractOutput.value(nameOrId, value);
      }
    }
    return abstractOutput;
  };
  
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
  var EventHandler = function (source, eventTypes) {
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
  EventHandler.prototype.delegate = function () {
    var eventHandler = this;
  
    eventHandler.source.on = function (eventType, callback) {
      return eventHandler.on(eventType, callback);
    };
  
    eventHandler.source.fireEvent = function (eventType, event) {
      return eventHandler.fireEvent(eventType, event);
    };
  };
  
  EventHandler.prototype.on = function (eventType, callback) {
    var eventHandler = this;
  
    if (eventType === "all" || eventHandler.eventTypes.indexOf(eventType) >= 0) {
      eventHandler.listeners.push({
        eventType: eventType,
        callback: callback
      });
    } else {
      console.log("Supported event types: " +
        eventHandler.eventTypes.join(","));
    }
    return eventHandler.source;
  };
  
  EventHandler.prototype.fireEvent = function (eventType, eventData) {
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
        } catch (e) {
          console.error(e);
        }
      }
    }
  };
  
  /***************************************************************************
   *
   * Event object constructor.
   *
   * The eventType is a string, the event data is any data that goes
   * with the event (e.g. the service instance in the case of an open event).
   *
   ***************************************************************************/
  var EventObject = function (source, eventType, eventData) {
    this.source = source;
    this.type = eventType;
    this.data = eventData;
  };
  
  /***************************************************************************
   *
   * Function queue. Used to serialise Javascript loads.
   *
   ***************************************************************************/
  var FunQueue = function (isRunning) {
    this.isRunning = isRunning ? true : false; // Let's be boolean.
    this.queue = [];
  };
  
  // Callback is passed one function argument, and MUST call it when
  // it's happy for the next in the queue to execute.
  FunQueue.prototype.push = function (callback) {
    var funQueue = this;
    var toExecute = function () {
      callback(function () {
        funQueue.next.call(funQueue);
      })
    };
  
    funQueue.queue.push(toExecute);
  
    if (!funQueue.isRunning) {
      funQueue.next();
    }
  };
  
  FunQueue.prototype.next = function () {
    var funQueue = this;
    var toExecute = funQueue.queue.shift();
  
    if (toExecute) {
      funQueue.isRunning = true;
      setTimeout(toExecute, 0);
    } else {
      funQueue.isRunning = false;
    }
  };
  
  /*
   * Notify is a 'super-class' of AbstractOutput.
   * Note the AbstractOutput.call(this, ...) to initialise instance properties
   * in this and the other event constructors.
   */
  var Notify = function (op, serviceInstance) {
    AbstractOutput.call(this, serviceInstance);
    this.op = op;
  };
  
  Notify.prototype = new AbstractOutput();
  
  Notify.prototype.send = function (fulfil, reject) {
    var notify = this;
    var opId = notify.op.id();
    var fieldValues = notify.fieldValues;
    notify.serviceInstance.notify(opId, fieldValues)
      .then(fulfil, reject);
  };
  
  /**
   * OneWay is a 'super-class' of AbstractInput.
   * Note the AbstractInput.call(this, ...) to initialise instance properties
   * in this and the other event constructors.
   */
  var OneWay = function (oneWayEvent, serviceInstance) {
    AbstractInput.call(this, oneWayEvent, serviceInstance);
    this.opTag = "one-way";
  };
  
  OneWay.prototype = new AbstractInput();
  
  OneWay.prototype.opId = function () {
    return this.event.opId()
  };
  
  /*
   * Reply is a 'super-class' of AbstractOutput.
   */
  var Reply = function (requestEvent, serviceInstance) {
    AbstractOutput.call(this, serviceInstance);
    this.requestEvent = requestEvent;
  };
  
  Reply.prototype = new AbstractOutput();
  
  Reply.prototype.set = function (setName) {
    var reply = this;
    reply.setName = setName;
    return reply;
  };
  
  Reply.prototype.send = function (fulfil, reject) {
    var reply = this;
    reply.serviceInstance
      .reply(reply.requestEvent, reply.setName, reply.fieldValues)
      .then(fulfil, reject);
  };
  
  /**
   * Request is a 'super-class' of AbstractInput.
   */
  var Request = function (requestEvent, serviceInstance) {
    AbstractInput.call(this, requestEvent, serviceInstance);
  };
  
  Request.prototype = new AbstractInput();
  
  Request.prototype.opId = function () {
    return this.event.opId();
  };
  
  /*
   * Response is a 'super-class' of AbstractInput.
   */
  var Response = function (responseEvent, serviceInstance) {
    AbstractInput.call(this, responseEvent, serviceInstance);
  };
  
  Response.prototype = new AbstractInput();
  
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
  
  var ServiceImpl = function (serviceInstance, implementation) {
    this.serviceInstance = serviceInstance;
    mix(implementation, this);
    mirror(serviceInstance, this, [
      "metadata"
    ]);
  };
  
  ServiceImpl.prototype.onInit = function (openEvent) {
    console.log("No implementation onInit()");
  };
  
  ServiceImpl.prototype.onClose = function (closeEvent) {
    console.log("No implementation onClose()");
  };
  
  ServiceImpl.prototype.onOneWay = function (oneWayEvent) {
    var serviceImpl = this;
    var metadata = serviceImpl.metadata();
    var oneWay = new OneWay(oneWayEvent, serviceImpl.serviceInstance);
    var opId = oneWay.opId();
    var opName = metadata.content("one-way", opId).name();
  
    if (typeof serviceImpl[opName] === "function") {
      try {
        serviceImpl[opName].call(serviceImpl, oneWay);
      } catch (e) {
        console.error(e);
      }
    } else {
      reason = "Missing implementation: " + opName;
      console.error(reason);
    }
  };
  
  ServiceImpl.prototype.onRequest = function (requestEvent) {
    var serviceImpl = this;
    var metadata = serviceImpl.metadata();
    var request = new Request(requestEvent, serviceImpl.serviceInstance);
    var opId = request.opId();
    var op = metadata.content("request-reply", opId);
    var opName = op ? op.name() : false;
    var reply = new Reply(requestEvent, serviceImpl.serviceInstance);
  
    if (opName && typeof serviceImpl[opName] === "function") {
      try {
        serviceImpl[opName].apply(serviceImpl, [request, reply]);
      } catch (e) {
        console.error(e);
      }
    } else if (opName) {
      reason = "Missing implementation: " + opName;
      console.error(reason);
    } else {
      reason = "Unrecognized op id: " + requestEvent.opId();
      console.error(reason);
    }
  };
  
  ServiceImpl.prototype.solicit = function (op) {
    var serviceInstance = this.serviceInstance;
    return new Solicit(op, serviceInstance);
  };
  
  ServiceImpl.prototype.notify = function (op) {
    var serviceInstance = this.serviceInstance;
    return new Notify(op, serviceInstance);
  };
  
  //@TODO: make jsLoadQueue a field of ServiceInstance
  // Queue of Javascript loads which have to be done one by one.
  var jsLoadQueue = new FunQueue();
  
  /***************************************************************************
   *
   * ServiceInstance object constructor.
   *
   * The openEvent property is a sparkl.Struct, and always exists. It holds
   * the metadata about the service against which this instance was opened.
   *
   * The aggregateEvents property is a list of sparkl.Struct, with one
   * entry per aggregator. Each holds the metadata about the aggregator which
   * references this service.
   *
   * The metadata() method aggregates these into a single list of struct.
   *
   ***************************************************************************/
  
  var ServiceInstance = function (connection, openEvent) {
    this.connection = connection;
    this.openEvent = openEvent;
    this.eventQueue = new FunQueue(true); // Queue halted until open completes.
    this.resolver = null; // Optional resolver for URLs.
    this.serviceImpl = undefined; // User implementation object.
    this.pendingResponses = {}; // Solicit responses by solicit ID.
    this.aggregateEvents = []; // Populated by aggregate-events.
    this.eventHandler = // Our event handler.
      new EventHandler(this, [
        "aggregate", "close",
        "notification", "one-way",
        "request", "reply",
        "solicit", "response"
      ]);
  
    this.eventHandler.delegate();
  };
  
  ServiceInstance.prototype.setResolver = function (resolver) {
    var serviceInstance = this;
  
    console.log("A URL resolver has been set");
    serviceInstance.resolver = resolver;
  };
  
  ServiceInstance.prototype.enqueue = function (message) {
    var serviceInstance = this;
    var handler = function (finish) {
      serviceInstance.handleEvent(message);
      finish();
    };
  
    serviceInstance.eventQueue.push(handler);
  };
  
  ServiceInstance.prototype.handleEvent = function (message) {
    var serviceInstance = this;
  
    if (message.tag() === "aggregate-event") {
      serviceInstance.onAggregate(message);
    } else if (message.tag() === "one-way-event") {
      serviceInstance.onOneWay(message);
    } else if (message.tag() === "request-event") {
      serviceInstance.onRequest(message);
    } else if (message.tag() === "response-event") {
      serviceInstance.onResponse(message);
    } else if (message.tag() === "close-event") {
      serviceInstance.onClose(message);
    } else {
      reason = "Unexpected: " + message.tag();
      console.warn(reason);
    }
  };
  
  ServiceInstance.prototype.open = function () {
    var serviceInstance = this;
  
    return new Promise(function (fulfil, reject) {
      var loadNext = function (finished) {
        serviceInstance.loadImplJavascript()
          .then(
          function () {
            try {
              console.log("Load complete");
              finished(); // Allow next JS file load to start.
              serviceInstance.onInit(serviceInstance.openEvent);
              serviceInstance.eventQueue.next(); // Free up the event queue
              fulfil(); // Load and initialisation complete.
            } catch (e) {
              var closeEvent = {
                tag: "error",
                attr: [
                  {
                    "reason": reason
                  }
                ]
              };
              console.error(e);
              reject(e);
              serviceInstance.onClose(closeEvent);
            }
          },
  
          function (error) {
            reject("Failed to load service implementation: " + error);
          });
      };
  
      jsLoadQueue.push(loadNext);
    });
  };
  
  ServiceInstance.prototype.loadImplJavascript = function () {
    var serviceInstance = this;
    var ee = executionEnvironment();
  
    if (ee === EE_BROWSER) {
      return serviceInstance.loadBrowserJavascript();
    } else if (ee === EE_NODEJS) {
      return serviceInstance.loadNodeJSJavascript();
    } else {
      return new Promise(function (fulfil, reject) {
        reject("Unsupported environment: " + ee);
      });
    }
  };
  
  ServiceInstance.prototype.loadBrowserJavascript = function () {
    var serviceInstance = this;
    var service = serviceInstance.openEvent.content("service")[0];
    var resolver = serviceInstance.resolver; // May have been set.
    var url = service.prop(PROP_BROWSER_SOURCE);
  
    if (typeof resolver == "function") {
      url = resolver.call(this, url);
    }
  
    console.log("Loading implementation: " + url);
  
    return new Promise(function (fulfil, reject) {
      var script = document.createElement("script");
  
      if (url) {
  
        console.log("Creating sparkl.service object");
        sparkl.service = function (implementation) {
          serviceInstance.serviceImpl =
            new ServiceImpl(serviceInstance, implementation);
        };
  
        // Add nocache if prop is defined.
        if (service.prop("nocache")) {
          if (url.indexOf("?") === -1) {
            url += "?nocache=" + new Date().getTime();
          } else {
            url += "&nocache=" + new Date().getTime();
          }
        }
  
        console.log(
            "Loading implementation for "
  
            + service.id() + " from '" + url + "'");
  
        script.setAttribute("type", "text/javascript");
        script.setAttribute("src", url);
  
        script.addEventListener("load",
          function (event) {
            delete sparkl.service;
            console.log("Loaded " + url + ", deleted sparkl.service");
            script.parentNode.removeChild(script);
            fulfil();
          }, true);
  
        script.addEventListener("error",
          function () {
            var reason = "Failed to load " + url +
              ", deleted sparkl.service";
            delete sparkl.service;
            console.error(reason);
            script.parentNode.removeChild(script);
            reject(reason);
          }, true);
  
        document.getElementsByTagName("head")[0].appendChild(script);
      } else {
        console.warn(service.id() +
            ": No implementation, awaiting open events on dependent services"
        );
        fulfil();
      }
    });
  };
  
  ServiceInstance.prototype.loadNodeJSJavascript = function () {
    var serviceInstance = this;
    var service = serviceInstance.openEvent.content("service")[0];
    var module =
      service.prop(PROP_NODEJS_MODULE) ||
      service.prop(PROP_BROWSER_SOURCE);
  
    return new Promise(function (fulfil, reject) {
      if (module) {
  
        console.log("Creating sparkl.service object");
        sparkl.service = function (implementation) {
          serviceInstance.serviceImpl =
            new ServiceImpl(serviceInstance, implementation);
        };
  
        try {
          var requiredModule = require(module);
          if (typeof requiredModule === 'function') {
            new requiredModule();
          }
          fulfil();
        } catch (error) {
          console.error(error);
          reject("Failed to load module: " + module);
        }
      } else {
        reject("Missing service prop: " + PROP_NODEJS_MODULE);
      }
    });
  };
  
  // Returns the sparkl.Struct that is the aggregate of the _content_ only
  // of the service instance's openEvent and any aggregateEvents.
  ServiceInstance.prototype.metadata = function () {
    var serviceInstance = this;
    var openEvent = serviceInstance.openEvent;
    var aggregateEvents = serviceInstance.aggregateEvents;
    var metadata = new sparkl.Struct({
      tag: "metadata",
      attr: {},
      content: []
    });
    var aggregateContent = metadata.json.content;
    var i, aggregateEvent;
  
    aggregateContent.push.apply(aggregateContent,
      openEvent.json.content);
    for (i = 0; i < aggregateEvents.length; i++) {
      aggregateEvent = aggregateEvents[i];
      aggregateContent.push.apply(aggregateContent,
        aggregateEvent.json.content);
    }
  
    return metadata;
  };
  
  ServiceInstance.prototype.onInit = function (openEvent) {
    var serviceInstance = this;
  
    try {
      serviceInstance.serviceImpl &&
      serviceInstance.serviceImpl.onInit(openEvent);
    } catch (e) {
      console.error(e);
    }
  };
  
  ServiceInstance.prototype.onAggregate = function (aggregateEvent) {
    var serviceInstance = this;
  
    console.log("Aggregate event from: " +
      aggregateEvent.aggregatorInstanceId() + " (" +
      aggregateEvent.content()[0].name() + ")");
    serviceInstance.aggregateEvents.push(aggregateEvent);
  };
  
  ServiceInstance.prototype.onClose = function (closeEvent) {
    var serviceInstance = this;
  
    try {
      serviceInstance.serviceImpl &&
      serviceInstance.serviceImpl.onClose(closeEvent);
    } catch (e) {
      console.error(e);
    }
    console.warn("Closed: " + serviceInstance.openEvent.instanceId());
    serviceInstance.fireEvent("close", closeEvent);
  };
  
  ServiceInstance.prototype.onOneWay = function (oneWayEvent) {
    var serviceInstance = this;
    var serviceImpl = serviceInstance.serviceImpl;
  
    serviceInstance.fireEvent("oneway", oneWayEvent);
    try {
      serviceImpl.onOneWay.apply(serviceImpl, [oneWayEvent]);
    } catch (e) {
      console.error(e);
    }
  };
  
  ServiceInstance.prototype.onRequest = function (requestEvent) {
    var serviceInstance = this;
    var serviceImpl = serviceInstance.serviceImpl;
  
    serviceInstance.fireEvent("request", requestEvent);
    try {
      serviceImpl.onRequest.call(serviceImpl, requestEvent);
    } catch (e) {
      console.error(e);
    }
  };
  
  ServiceInstance.prototype.onResponse = function (responseEvent) {
    var serviceInstance = this;
    var pendingResponses = serviceInstance.pendingResponses;
    var solicitId = responseEvent.solicitId();
    var inputName = responseEvent.inputName();
    var pendingResponse = pendingResponses[solicitId];
  
    if (pendingResponse) {
      console.log("Response to solicit id: " + solicitId);
      delete pendingResponses[solicitId];
      pendingResponse.fulfil(responseEvent); // @TODO When do we reject?
      serviceInstance.fireEvent("response", responseEvent);
    } else {
      reason = "Response to unknown solicit: " + solicitId;
      console.error(reason);
    }
  };
  
  ServiceInstance.prototype.reply = function (requestEvent, setName, fields) {
    var serviceInstance = this;
    var replyEvent = {
      tag: "reply",
      replyTo: requestEvent.replyTo(),
      outputName: setName,
      output: fields
    };
    return new Promise(function (fulfil, reject) {
      serviceInstance.connection
        .sendMessageAwaitAck(replyEvent)
        .then(
        function () {
          fulfil();
          serviceInstance.fireEvent("reply", replyEvent);
        },
  
        function (error) {
          reason = "Reply error: " + error;
          console.error(reason);
          reject(reason);
        }
      );
    });
  };
  
  ServiceInstance.prototype.notify = function (opId, fields) {
    var serviceInstance = this;
    var notificationEvent = {
      tag: "notification",
      instanceId: serviceInstance.openEvent.instanceId(),
      opId: opId,
      output: fields || {}
    };
  
    return new Promise(function (fulfil, reject) {
      serviceInstance.connection.sendMessageAwaitAck(notificationEvent)
        .then(
        function () {
          fulfil();
          serviceInstance.fireEvent("notification", notificationEvent);
        },
  
        function (error) {
          reject(error);
        });
    });
  };
  
  ServiceInstance.prototype.solicit = function (opId, fields) {
    var serviceInstance = this;
    var solicitId = serviceInstance.connection.nextSolicitId();
    var solicitEvent = {
      tag: "solicit",
      instanceId: serviceInstance.openEvent.instanceId(),
      opId: opId,
      solicitId: solicitId,
      fields: fields || {}
    };
  
    return new Promise(function (fulfil, reject) {
      serviceInstance.connection.sendMessageAwaitAck(solicitEvent)
        .then(
        function () {
          var pendingResponse = {
            fulfil: fulfil,
            reject: reject
          };
          serviceInstance.pendingResponses[solicitId] = pendingResponse;
          serviceInstance.fireEvent("solicit", solicitEvent);
        },
  
        function (error) {
          reason = "Solicit error: " + error;
          console.error(reason);
          reject(reason);
        });
    });
  };
  
  /*
   * Solicit is a 'super-class' of AbstractOutput.
   */
  var Solicit = function (op, serviceInstance) {
    AbstractOutput.call(this, serviceInstance);
    this.op = op;
  };
  
  Solicit.prototype = new AbstractOutput();
  
  Solicit.prototype.send = function (fulfil, reject) {
    var solicit = this;
    var opId = solicit.op.id();
    var fieldValues = solicit.fieldValues;
    solicit.serviceInstance.solicit(opId, fieldValues)
      .then(fulfil, reject);
  };
  
  /***************************************************************************
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
   *   var result = new Struct(json);
   *   var allFolders = result.content("folder")
   *   var oneStruct = result.content(2)
   *   var oneFolder = result.content("folder", "foo")
   *   var oneFolder = result.content("folder", 0)
   *   var allNotifications = foo.content("notification")
   *   var allAttributeValues = foo.attr()
   *   var someAttribute = foo.attr("someAttribute")
   *   var listOfPropNames = foo.prop()
   *   var specificProp = foo.prop("specific.prop")
   *
   ***************************************************************************/
  
  var Struct = function (json) {
    var struct = this;
  
    struct.json = (typeof json === "string") ? JSON.parse(json) : json;
  
    if (struct.json && struct.json.tag) {
      if (struct.json.attr) {
        for (var prop in struct.json.attr) {
          if (struct.json.attr.hasOwnProperty(prop)) {
            (function (name) {
              if (!struct[name]) {
                struct[name] = function () {
                  return struct.json.attr[name];
                }
              }
            })(prop);
          }
        }
      }
    } else {
      console.error(
        ["Struct object must have 'tag' and 'attr' props", struct.json]);
    }
  };
  
  Struct.prototype.tag = function () {
    var struct = this;
    return struct.json.tag;
  };
  
  Struct.prototype.attr = function (name) {
    var struct = this;
    if (name) {
      return struct.json.attr[name];
    } else {
      return struct.json.attr;
    }
  };
  
  Struct.prototype.prop = function (name) {
    var struct = this;
    var prop = struct.content("prop", name);
    var names = []; // Return list of names if no name specified.
  
    if (prop instanceof Array) {
      for (var i = 0; i < prop.length; i++) {
        names.push(prop[i].name());
      }
      return names;
    } else if (prop && prop.type() === "number") {
      return Number(prop.content());
    } else if (prop && prop.content) {
      return prop.content();
    } else {
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
  Struct.prototype.content = function () {
    var struct = this;
    var arg0 = arguments[0];
    var arg1 = arguments[1];
  
    if (typeof arg0 == "undefined") {
      return struct.contentAll();
    } else if (typeof arg0 === "number") {
      return struct.contentAll()[arg0];
    } else if (typeof arg0 === "string") {
      if (typeof arg1 === "undefined") {
        return struct.contentWithTag(arg0);
      } else if (typeof arg1 === "string") {
        if (arg1.indexOf(" ") === -1) {
          return struct.contentWithTagAndName(arg0, arg1);
        } else {
          return struct.contentWithTagAndNames(arg0, arg1.split(" "));
        }
      } else if (typeof arg1 === "number") {
        return struct.contentWithTag(arg0)[arg1];
      } else if (arg1 instanceof Array) {
        return struct.contentWithTagAndNames(arg0, arg1);
      }
    }
    return false;
  };
  
  Struct.prototype.contentWithTag = function (tag) {
    var struct = this;
    var content = struct.json.content;
    var result = [];
  
    if (content && content instanceof Array) {
      content.every(function (item) {
        if (item.tag && item.tag === tag) {
          result.push(new Struct(item));
        }
        return true;
      });
    }
  
    return result;
  };
  
  Struct.prototype.contentWithTagAndName = function (tag, nameOrId) {
    var struct = this;
    var content = struct.json.content;
    var result = undefined;
  
    if (content && content instanceof Array) {
      content.some(function (item) {
        if (item.tag && item.tag === tag) {
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
  
  Struct.prototype.contentWithTagAndNames = function (tag, namesOrIds) {
    var struct = this;
    var content = struct.json.content;
    var result = [];
  
    if (content && content instanceof Array) {
      content.every(function (item) {
        if (item.tag && item.tag === tag) {
          if (namesOrIds.indexOf(item.attr.id) >= 0 || namesOrIds.indexOf(
            item.attr.name) >= 0) {
            result.push(new Struct(item));
          }
        }
        return true; // Iterate through all items.
      });
    }
  
    return result;
  };
  
  Struct.prototype.contentAll = function () {
    var struct = this;
    var content = struct.json.content;
    var result = [];
  
    if (content && content instanceof Array) {
      content.every(function (item) {
        if (item.tag) { // Tagged items are pushed onto the list.
          result.push(new Struct(item));
          return true;
        } else { // We don't handle mixed content.
          result = item;
          return false;
        }
      });
    }
  
    return result;
  };
  

  //

  /**
   * The SPARKL object.
   * The sparkl.service function property is created
   * just-in-time by the ServiceInstance loadJS method.
   */
  var sparkl = {
    Connection: Connection,
    ServiceInstance: ServiceInstance,
    Struct: Struct,
    service: null
  };

  /**
   * The location.getParam() function is very useful for people using this
   * library in a browser.
   */
  if ((typeof window !== "undefined") &&
    window.location && !window.location.getParam) {
    window.location.getParam = function (name) {
      name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
      var regexS = "[\\?&]" + name + "=([^&#]*)";
      var regex = new RegExp(regexS);
      var results = regex.exec(window.location.search);
      if (results == null) {
        return "";
      } else {
        return decodeURIComponent(results[1].replace(/\+/g, " "));
      }
    };
  }

  /*
   * Export the sparkl object.
   */
  if (typeof module !== "undefined") {
    module.exports = sparkl;
  }

  if (executionEnvironment() === EE_BROWSER) {
    global.sparkl = sparkl;
  } else if (executionEnvironment() === EE_NODEJS) {
    module.exports = sparkl;
  } else {
    console.error("Unsupported environment");
  }

})(this);
