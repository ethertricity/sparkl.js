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
