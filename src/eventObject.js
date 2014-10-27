/***************************************************************************
 *
 * Event object constructor.
 *
 * The eventType is a string, the event data is any data that goes
 * with the event (e.g. the service instance in the case of an open event).
 *
 ***************************************************************************/
var EventObject = function (source, eventType, eventData) {
  this.source = source;
  this.type = eventType;
  this.data = eventData;
};
