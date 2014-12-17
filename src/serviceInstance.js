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
        require(module)
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
