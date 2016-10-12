/**
 * Copyright (c) 2015 SPARKL Limited. All Rights Reserved.
 * Author <jacoby@sparkl.com> Jacoby Thwaites.
 *
 * Event object and handler implementation.
 */

/***************************************************************************
 *
 * Event object constructor.
 *
 * The eventType is a string, the event data is any data that goes
 * with the event (e.g. the service instance in the case of an open event).
 *
 ***************************************************************************/
var EventObject = function(source, eventType, eventData) {
  this.source = source;
  this.type = eventType;
  this.data = eventData;
};

/***************************************************************************
 *
 * Event handler constructor.
 *
 * Abstracts event listener registration and event firing.
 *
 * The owner object is used as the return value from the on() function,
 * and as the context object for event callbacks.
 *
 * The on() and fireEvent() methods are added to the owner object for
 * convenience.
 *
 ***************************************************************************/
var EventHandler = function(source, eventTypes) {
  var eventHandler = this;

  if (!(eventTypes instanceof Array)) {
    throw "Must specify array of event types";
  }

  this.source = source;
  this.eventTypes = eventTypes;
  this.listeners = [];
};

// Creates the .on and .fireEvent methods on the event handler's
// source object for convenience.
EventHandler.prototype.delegate = function() {
  var eventHandler = this;

  eventHandler.source.on = function(eventType, callback) {
    return eventHandler.on(eventType, callback);
  };

  eventHandler.source.fireEvent = function(eventType, event) {
    return eventHandler.fireEvent(eventType, event);
  };
};

EventHandler.prototype.on = function(eventType, callback) {
  var eventHandler = this;

  if (eventType === "all" || eventHandler.eventTypes.indexOf(eventType) >= 0) {
    eventHandler.listeners.push({
      eventType: eventType,
      callback: callback
    });
  }
  else {
    console.log("Supported event types: " +
      eventHandler.eventTypes.join(","));
  }
  return eventHandler.source;
};

EventHandler.prototype.fireEvent = function(eventType, eventData) {
  var eventHandler = this;
  var source = eventHandler.source;
  var event = new EventObject(source, eventType, eventData);
  var listeners = eventHandler.listeners;
  var i, listener;

  for (i = 0; i < listeners.length; i++) {
    listener = listeners[i];
    if (listener.eventType === "all" || listener.eventType === eventType) {
      try {
        listener.callback.call(eventHandler.source, event);
      }
      catch (e) {
        console.error(e);
      }
    }
  }
};

module.exports = EventHandler;
