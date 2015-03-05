/**
 * Copyright (c) 2014 Sparkl Limited. All Rights Reserved.
 * Author: jacoby@sparkl.com
 *
 * The sparkl tabserver library. Requires HTML5 support for:
 *   - WebSockets
 *
 * This defines the global 'sparkl' object.
 */
(function (global) {

  // Constants.
  var MSG_ID = // Matches MSG_ID in SPARKL tabserver_yapp.
    "_msgid";

  /** Not used
   var OPEN_TIMEOUT_MILLIS = // Time to await connection open-event.
   5000;
   */
  var PROP_BROWSER_SOURCE = // Where a browser loads service implementation.
    "tabserver.browser.src";
  var PROP_NODEJS_MODULE = // Where node.js loads a service implementation.
    "tabserver.nodejs.module";
  var EE_BROWSER = // Execution environment is browser.
    "browser";
  var EE_NODEJS = // Execution environment is node.js.
    "nodejs";
  var EE_UNKNOWN = // Execution environment is unknown.
    "unknown";


  /***************************************************************************
   *
   * Utility functions.
   *
   ***************************************************************************/

  /**
   * Mixes the own props only from the first object into the second,
   * excluding any props listed in the third argument, if present.
   */
  var mix = function (from, to, ignore) {
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
  var mirror = function (from, to, propList) {
    propList.forEach(function (prop) {
      var fun = from[prop];
      to[prop] = function () {
        return fun.apply(from, arguments);
      };
    });
  };


  /**
   * Returns the execution environment (browser or node.js) by
   * looking for well-known properties on the global object.
   */
  var executionEnvironment = function () {
    var ee = EE_UNKNOWN;

    if (typeof module !== "undefined") {
      return EE_NODEJS;
    }
    if (typeof window !== "undefined") {
      return EE_BROWSER;
    }

    console.log("Execution environment: " + ee);
    return ee;
  };

  /**
   * Function to return a self-contained turnaround counter
   * initialized to zero. Used to generate unique IDs.
   */
  var counter = function () {
    var count = 0;

    return function () {
      if (count < 4294967295) {
        return count++;
      } else {
        return count = 0;
      }
    };
  };

  /*
   var counter = function() {
   var count = 0;

   return function() {
   return count < 4294967295 ? count++ : 0;
   };
   };
   */

  /**
   * Returns true if browser has required functionality, otherwise
   * logs error and returns false.
   */
  if (typeof WebSocket === "undefined") {
    if (executionEnvironment() === EE_NODEJS) {
      WebSockets = require("ws");
    } else {
      console.error("This browser does not support WebSocket");
      return;
    }
  }

  if (typeof Promise === "undefined") {
    if (executionEnvironment() === EE_NODEJS) {
      Promise = require("promise");
    }
  }

  /**
   * Var used to hold error reason throughout.
   */
  var reason;

  /***************************************************************************
   *
   * Foreach function is applied to each property of the object. The context
   * is the original object, the single argument is the value of the property.
   *
   ***************************************************************************/
  var foreach = function (object, fun) {
    var prop, value;

    for (prop in object) {
      if (object.hasOwnProperty(prop)) {
        value = object[prop];
        fun.call(object, prop);
      }
    }
  };

  //
  //= include ['*', '!core.js']
  //

  /**
   * The SPARKL object.
   * The sparkl.service function property is created
   * just-in-time by the ServiceInstance loadJS method.
   */
  var sparkl = {
    Connection: Connection,
    ServiceInstance: ServiceInstance,
    Struct: Struct,
    service: null
  };

  /**
   * The location.getParam() function is very useful for people using this
   * library in a browser.
   */
  if ((typeof window !== "undefined") &&
    window.location && !window.location.getParam) {
    window.location.getParam = function (name) {
      name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
      var regexS = "[\\?&]" + name + "=([^&#]*)";
      var regex = new RegExp(regexS);
      var results = regex.exec(window.location.search);
      if (results == null) {
        return "";
      } else {
        return decodeURIComponent(results[1].replace(/\+/g, " "));
      }
    };
  }

  /*
   * Export the sparkl object.
   */
  if (typeof module !== "undefined") {
    module.exports = sparkl;
  }

  if (executionEnvironment() === EE_BROWSER) {
    global.sparkl = sparkl;
  } else if (executionEnvironment() === EE_NODEJS) {
    module.exports = sparkl;
  } else {
    console.error("Unsupported environment");
  }

})(this);
