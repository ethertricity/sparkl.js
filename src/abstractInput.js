/***************************************************************************
 *
 * Implementation callback argument object constructors.
 *
 ***************************************************************************/

/**
 * Base prototype for one-way, request and response.
 */
var AbstractInput = function (event, serviceInstance) {
  this.event = event;
  this.serviceInstance = serviceInstance;
};

AbstractInput.prototype.value = function (nameOrId) {
  var abstractInput = this;
  var metadata = abstractInput.serviceInstance.metadata();
  var field = metadata.content("field", nameOrId);
  var fieldId = field ? field.id() : false;
  return fieldId ?
    abstractInput.event.content("field", fieldId).content() :
    false;
};

AbstractInput.prototype.values = function () {
  var abstractInput = this;
  var metadata = abstractInput.serviceInstance.metadata();
  var fields = abstractInput.event.content("field");
  var i;
  var field, fieldId, fieldName;
  var values = {};

  for (i = 0; i < fields.length; i++) {
    field = fields[i];
    fieldId = field.id();
    fieldName = metadata.content("field", fieldId).name();
    values[fieldName] = field.content();
  }
  return values;
};
