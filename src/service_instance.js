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

(function(global) {
  var sparkl = global.sparkl;

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
      new sparkl.EventHandler(this, [
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
        new sparkl.DataEvent(serviceInstance, message));
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
                tag : "error",
                attr : [{"reason" : reason}]
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
    var ee = sparkl.util.environment();

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
    sparkl.service = function(implementation) {
      serviceInstance.serviceImpl =
        new sparkl.ServiceImpl(serviceInstance, implementation);
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
                delete sparkl.service;
                console.log("Loaded " + url + ", deleted sparkl.service");
                script.parentNode.removeChild(script);
                fulfil();
              }, true);

            script.addEventListener("error",
              function() {
                var reason = "Failed to load " + url + ", deleted sparkl.service";
                delete sparkl.service;
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
            delete sparkl.service;
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
        sparkl.service = function(implementation) {
          serviceInstance.serviceImpl =
           new sparkl.ServiceImpl(serviceInstance, implementation);
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

  /**
   * SPARKL globals.
   */
  sparkl.ServiceInstance = ServiceInstance;

})(this);
