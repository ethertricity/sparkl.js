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
