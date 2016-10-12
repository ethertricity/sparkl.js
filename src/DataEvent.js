/**
 * Copyright (c) 2015 SPARKL Limited. All Rights Reserved.
 * Author: <jacoby@sparkl.com> Jacoby Thwaites.
 *
 * Implements the data event which is used to carry data to and
 * from the SSE. This provides methods to set and get data where
 * named fields are used for the keys.
 *
 * A data event object is the prototype of the notify, solicit,
 * response, request, reply and consume objects which are exposed
 * as sparkl globals.
 *
 * The data event object contains a sparkl.Struct. If not provided
 * to the constructor, an empty data_event struct is created ready
 * for new attributes and content.
 *
 * Provides a utility method .alias(name) which returns the fieldname
 * corresponding to the alias. Aliases are setup using a prop as follows:
 *
 * <reply name="Ok" fields="fieldA fieldB">
 *   <prop name="aliases" foo="fieldA" bar="fieldB"/>
 * </reply>
 *
 * Depends on sparkl.Struct.js.
 */

var Util = require('./Util');
var Struct = require('./Struct');
var genId = new Util.IdGenerator("N");

/**
 * Constructor creates a data event using the enclosed struct or creating
 * a blank one if necessary.
 * The subject is a notify, solicit, response, request, reply or consume.
 * Field values can be set by name, which is looked up in the subject and
 * resolved to an id.
 */
var DataEvent = function(serviceInstance, struct) {
  this.serviceInstance = serviceInstance;

  if (struct && struct.constructor === Struct) {
    this.struct = struct;
  }
  else {
    this.struct = new Struct({
      tag: "data_event",
      attr: {
        id: genId()
      },
      content: []
    });
  }
};

DataEvent.prototype.setStruct = function(struct) {
  var dataEvent = this;
  dataEvent.struct = struct;
  return dataEvent;
};

/**
 * Sets the ref to a preceding request or response.
 * This only applies to reply data events.
 */
DataEvent.prototype.setRef = function(ref) {
  var dataEvent = this;
  dataEvent.struct.json.attr["ref"] = ref;
  return dataEvent;
};

/**
 * Sets the subject of this data event, for example a solicit
 * or a reply object. This is used when resolving field names
 * and defines the type of event.
 */
DataEvent.prototype.setSubject = function(subject) {
  var dataEvent = this;
  dataEvent.subject = subject;
  dataEvent.struct.json.attr["subject"] = subject.id();
  return dataEvent;
};

/**
 * Returns the fieldname corresponding to the alias, or undefined
 * if the alias is not defined as an attribute on the aliases prop.
 */
DataEvent.prototype.alias = function(alias) {
  var dataEvent = this;
  var aliases =
    dataEvent.subject.content("prop", "aliases");
  return aliases && aliases.attr(alias);
};

/**
 * Resolves the values map if supplied, setting the values in
 * the data event field values.
 *
 * If no map is supplied, returns a map of values keyed by name
 * dereferenced from the data event id map.
 */
DataEvent.prototype.values = function(values) {
  var dataEvent = this;
  var namedMap, fields;

  if (values) {
    Util.foldl(
      function(name, value) {
        dataEvent.value(name, value);
      }, null, values);
    return dataEvent;
  }

  else {
    fields =
      dataEvent.serviceInstance.openEvent
        .content("fields")[0];
    namedMap =
      Util.foldl(
        function(id, datum, acc) {
          var fieldId = datum.field();
          var fieldValue = datum.content();
          var field = fields.content("field", fieldId);
          var name = field.name();
          acc[name] = fieldValue;
          return acc;
        }, {}, dataEvent.struct.content("datum"));
    return namedMap;
  }
};

/**
 * Resolves the name using the data event's subject, and
 * either sets or gets the field value.
 */
DataEvent.prototype.value = function(name, value) {
  var dataEvent = this;
  var field =
    dataEvent.fieldByName(name)
  var fieldId =
    field.id();
  var datum, i;

  // Value not supplied means get.
  if (typeof value === "undefined") {
    for (i = 0; i < dataEvent.struct.content().length; i++) {
      datum =
        dataEvent.struct.content("datum")[i];
      if (datum.field() === fieldId) {

        // A datum struct can have exactly one primitive element
        // as its content.
        return datum.content()[0];
      }
    }
    return undefined;
  }

  // Value supplied means set, so long as the field has a type.
  // The value type is coerced by the SSE, so it does not have to be
  // done here.
  else if (field.type()) {
    datum = {
      tag: "datum",
      attr: {
        field: fieldId
      },
      content: [value]
    };

    dataEvent.struct.json.content.push(datum);
  }

  return dataEvent;
};

/**
 * Returns the first field from the list of ids whose name matches
 * the key.
 */
DataEvent.prototype.fieldByName = function(name) {
  var dataEvent = this;
  var subject =
    dataEvent.subject;
  var candidateIds =
    subject.fields().split(" ");
  var openEvent =
    dataEvent.serviceInstance.openEvent;
  var i, field, candidateId;

  for (i = 0; i < candidateIds.length; i++) {
    candidateId =
      candidateIds[i];
    field =
      openEvent
        .content("fields")[0]
        .content("field", candidateId);
    if (field.name() === name) {
      return field;
    }
  }

  throw "No field " + name +
  " on " + subject.tag() +
  ": " + subject.name();
};

/**
 * Sends the message, returning a promise.
 *
 * The promise is fulfilled or rejected depending on subject
 * as follows:
 * - notify
 *   Fulfilled immediately.
 *
 * - solicit
 *   Fulfilled when a data_event arrives referencing the solicit.
 *   Rejected when an error_event arrives referencing the solicit,
 *   or when a local timeout occurs.
 *
 * - reply
 *   Fulfilled immediately.
 */
DataEvent.prototype.send = function() {
  var dataEvent =
    this;
  var connection =
    dataEvent.serviceInstance.connection;

  return new Promise(
    function(fulfil, reject) {
      var subjectCodes = {
        "H": "notify",
        "I": "solicit",
        "L": "reply"
      };

      var subject =
        subjectCodes[
          dataEvent.struct.attr("subject")[0]];

      var timeoutMillis, timeout;

      // Just in case the SSE doesn't send a response timeout
      // error event, we do a local timeout with a delta of 5s
      // over the actual timeout.
      var localDelta = +5000;

      if (subject === "notify" || subject === "reply") {
        connection.sendMessage(
          dataEvent.struct.json);
        fulfil();
      }

      else if (subject === "solicit") {
        connection.sendMessage(
          dataEvent.struct.json);

        timeoutMillis =
          dataEvent.serviceInstance.openEvent
            .content("solicits")[0]
            .content("solicit", dataEvent.struct.attr("subject"))
            .attr("timeout") + localDelta;

        timeout =
          setTimeout(
            function() {
              reject("Local timeout");
            }, timeoutMillis);

        connection.addPendingResponse({
          ref: dataEvent.struct.id(),
          instance: dataEvent.serviceInstance,
          fulfil: fulfil,
          reject: reject,
          timeout: timeout
        });
      }

      else {
        reject("Cannot send: " + tag)
      }
    });
};

module.exports = DataEvent;