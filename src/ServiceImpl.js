/**
 * Copyright (c) 2015 SPARKL Limited. All Rights Reserved.
 * Author <jacoby@sparkl.com> Jacoby Thwaites.
 *
 * Service Implementation callback argument object constructors.
 *
 * The service implementation is optional, is driven by events from
 * a service instance, and talks names rather than IDs.
 */

var Util = require('./Util');
var DataEvent = require('./DataEvent');

/***************************************************************************
 *
 * ServiceImpl object constructor. Provides convenience functions.
 *
 * The constructor sets the serviceInstance property and mixes the original
 * implementation properties into the new service implementation object.
 *
 * Several serviceInstance functions are mirrored on this object for
 * convenience.
 *
 * The onXXX function props can all be overridden by the user implementation.
 *
 ***************************************************************************/

var ServiceImpl = function(serviceInstance, implementation) {
  this.serviceInstance = serviceInstance;
  Util.mix(implementation, this);
  Util.mirror(serviceInstance, this, [
    "openEvent"]);
};//+

ServiceImpl.prototype.onInit = function(openEvent) {
  console.log("No implementation onInit()");
};

ServiceImpl.prototype.onClose = function(closeEvent) {
  console.log("No implementation onClose()");
};

ServiceImpl.prototype.onData = function(dataEvent) {
  var serviceImpl =
    this;
  var serviceInstance =
    serviceImpl.serviceInstance;
  var subject =
    dataEvent.struct.subject();
  var replies =
  {};
  var subjectName, i;
  var replyStruct, replyStructs;
  var replyDataEvent, replyDataEvents;

  // Request subject.
  if (subject.startsWith("K-")) {
    dataEvent.subject =
      serviceInstance.openEvent
        .content("requests")[0]
        .content("request", subject);
  }

  // Consume subject.
  else if (subject.startsWith("M-")) {
    dataEvent.subject =
      serviceInstance.openEvent
        .content("consumes")[0]
        .content("consume", subject);
  }

  // Response subject.
  else if (subject.startsWith("J-")) {
    console.warn("Response");
  }

  else {
    console.error("Unrecognized subject: " + subject);
  }

  // Build the map of reply data events. The user selects
  // one at runtime.
  replyStructs =
    dataEvent.subject.content("reply");

  for (i = 0; i < replyStructs.length; i++) {
    replyStruct =
      replyStructs[i];

    replyDataEvent =
      new sparkl.DataEvent(serviceInstance)
        .setRef(dataEvent.struct.id())
        .setSubject(replyStruct);

    replies[replyStruct.name()] =
      replyDataEvent;
  }

  subjectName =
    dataEvent.subject.name();

  if (serviceImpl[subjectName]) {
    serviceImpl[subjectName].apply(
      serviceImpl, [dataEvent, replies]);
  }

  else {
    console.error("No implementation for " + subjectName);
  }

};

ServiceImpl.prototype.solicit = function(name) {
  var serviceInstance =
    this.serviceInstance;
  var solicit =
    serviceInstance.openEvent
      .content("solicits")[0]
      .content("solicit", name);

  return new DataEvent(serviceInstance)
    .setSubject(solicit);
};

ServiceImpl.prototype.notify = function(name) {
  var serviceInstance =
    this.serviceInstance;
  var notify =
    serviceInstance.openEvent
      .content("notifies")[0]
      .content("notify", name);

  return new DataEvent(serviceInstance)
    .setSubject(notify);
};

module.exports = ServiceImpl;
