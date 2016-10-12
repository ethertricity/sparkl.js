/**
 * Copyright (c) 2014, 2015 Sparkl Limited. All Rights Reserved.
 * Author: jacoby@sparkl.com
 *
 * The sparkl tabserver library. Requires HTML5 support for:
 *   - WebSockets
 *
 * This defines the global 'sparkl' object.
 */
"use strict";

/**
 * Returns a generator for ids whose format matches the SSE gen_id.
 * The first character is used to identify the id type, per the
 * SSE id types in sse_cfg.hrl.
 */
var IdGenerator = function(prefix) {
  var node =
    hashCode(window.location.href, 16)
      .toString(36)
      .toUpperCase();
  var rti =
    hashCode(new Date(), 16)
      .toString(36)
      .toUpperCase();
  var next = new Counter();

  return function() {
    var count =
      next()
        .toString(36)
        .toUpperCase();
    var id =
      prefix + "-" + node + "-" + rti + "-" + count;
    return id;
  }
};

/**
 * Returns the execution environment (browser or node.js) by
 * looking for well-known properties on the global object.
 */
var environment = function() {
  var ee = "unknown";

  if (typeof module !== "undefined") {
    ee = "nodejs";
  }
  else if (typeof window !== "undefined") {
    ee = "browser";
  }

  console.log("Execution environment: " + ee);
  return ee;
};

/***************************************************************************
 *
 * Utility functions.
 *
 ***************************************************************************/

/**
 * Folds the function over the array elements or object properties,
 * returning the accumulator whose initial value is supplied.
 *
 * The callback fun is invoked with 3 args being:
 * 1. the array index or the property name
 * 2. the array element or property value
 * 3. the accumulator value so far
 *
 * The context 'this' of the callback fun is the array or object being
 * folded over.
 */
var foldl = function(fun, acc, foldable) {
  var type =
    Object.prototype.toString.call(foldable);
  var prop, i, value;
  if (type === "[object Array]") {
    for (i = 0; i < foldable.length; i++) {
      value =
        foldable[i];
      acc =
        fun.call(foldable, i, value, acc);
    }
    return acc;
  }
  else if (type === "[object Object]") {
    for (prop in foldable) {
      if (foldable.hasOwnProperty(prop)) {
        value =
          foldable[prop];
        acc =
          fun.call(foldable, prop, value, acc);
      }
    }
    return acc;
  }
  throw "foldl needs array or object";
};

/**
 * Mixes the own props only from the first object into the second,
 * excluding any props listed in the third argument, if present.
 */
var mix = function(from, to, ignore) {
  for (var prop in from) {
    if (from.hasOwnProperty(prop)) {
      if (!ignore || ignore.indexOf(prop) === -1) {
        to[prop] = from[prop];
      }
    }
  }
};

/**
 * Mirrors methods on the from object so that they are
 * directly accessible on the to object. Only methods that
 * are listed are mirrored.
 * @param from the object whose methods are mirrored.
 * @param to the object on which the methods are mirrored.
 * @param propList the array of strings naming the methods to be mirrored.
 */
var mirror = function(from, to, propList) {
  propList.forEach(function(prop) {
    var fun = from[prop];
    to[prop] = function() {
      return fun.apply(from, arguments);
    };
  });
};

/**
 * Returns true if browser has required functionality, otherwise
 * logs error and returns false.
 */
var compatible = function() {
  var compatible = true;
  if (typeof WebSocket === "undefined") {
    console.error("This browser does not support WebSocket");
    compatible = false;
  }

  return compatible;
};

/**
 * Var used to hold error reason throughout.
 */
var reason;

/**
 * The location.getParam() function is very useful for people using this
 * library in a browser.
 */
if ((typeof window !== "undefined") &&
  window.location && !window.location.getParam) {
  window.location.getParam = function(name) {
    name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
    var regexS = "[\\?&]" + name + "=([^&#]*)";
    var regex = new RegExp(regexS);
    var results = regex.exec(window.location.search);
    if (results == null) {
      return "";
    }
    else {
      return decodeURIComponent(results[1].replace(/\+/g, " "));
    }
  };
}

/**
 * Function to return a self-contained turnaround counter
 * initialized to zero. Used to generate unique IDs.
 */
var Counter = function() {
  var count = 0;

  return function() {
    if (count < 4294967295) {
      return count++;
    }
    else {
      return count = 0;
    }
  };
};

/**
 * Generates a 32-bit signed hashcode on the string.
 * If the bits arg is supplied, only the least significant
 * bits are returned, where 31 or less ensures a positive
 * result since the sign bit is the most significant.
 * Thanks to: http://werxltd.com/wp/2010/05/13/
 */
var hashCode = function(str, length) {
  var ch, i, hash = 0;
  var bits = length || 16;
  var mask = (Math.pow(2, bits) - 1);

  if (str.length == 0) {
    return hash;
  }

  for (i = 0; i < str.length; i++) {
    ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash = hash & hash;
  }
  return hash & mask;
};

/**
 * SPARKL globals.
 */
if (typeof sparkl === "undefined") {
  global.sparkl = {};
}

var util = {};

util.foldl = foldl;
util.mix = mix;
util.mirror = mirror;
util.environment = environment;
util.Counter = Counter;
util.IdGenerator = IdGenerator;

module.exports = util;
