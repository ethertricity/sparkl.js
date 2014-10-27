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
