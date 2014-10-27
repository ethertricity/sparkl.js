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
