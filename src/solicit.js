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
