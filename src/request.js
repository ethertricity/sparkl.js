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
