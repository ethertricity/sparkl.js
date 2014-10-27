/*
 * Response is a 'super-class' of AbstractInput.
 */
var Response = function (responseEvent, serviceInstance) {
  AbstractInput.call(this, responseEvent, serviceInstance);
};

Response.prototype = new AbstractInput();
