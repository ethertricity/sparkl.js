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
