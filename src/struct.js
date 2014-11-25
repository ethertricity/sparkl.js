/***************************************************************************
 *
 * Struct object constructor.
 *
 * Use this to simplify access to content in SPARKL structs like:
 * {
 *   tag : "foo",
 *   attr : { a : "one", b : "two"},
 *   content : [
 *     <<structs including props>>
 *   ]
 * }
 *
 * Usage:
 *   var result = new Struct(json);
 *   var allFolders = result.content("folder")
 *   var oneStruct = result.content(2)
 *   var oneFolder = result.content("folder", "foo")
 *   var oneFolder = result.content("folder", 0)
 *   var allNotifications = foo.content("notification")
 *   var allAttributeValues = foo.attr()
 *   var someAttribute = foo.attr("someAttribute")
 *   var listOfPropNames = foo.prop()
 *   var specificProp = foo.prop("specific.prop")
 *
 ***************************************************************************/

var Struct = function (json) {
  var struct = this;

  struct.json = (typeof json === "string") ? JSON.parse(json) : json;

  if (struct.json && struct.json.tag) {
    if (struct.json.attr) {
      for (var prop in struct.json.attr) {
        if (struct.json.attr.hasOwnProperty(prop)) {
          (function (name) {
            if (!struct[name]) {
              struct[name] = function () {
                return struct.json.attr[name];
              }
            }
          })(prop);
        }
      }
    }
  } else {
    console.error(
      ["Struct object must have 'tag' and 'attr' props", struct.json]);
  }
};

Struct.prototype.tag = function () {
  var struct = this;
  return struct.json.tag;
};

Struct.prototype.attr = function (name) {
  var struct = this;
  if (name) {
    return struct.json.attr[name];
  } else {
    return struct.json.attr;
  }
};

Struct.prototype.prop = function (name) {
  var struct = this;
  var prop = struct.content("prop", name);
  var names = []; // Return list of names if no name specified.

  if (prop instanceof Array) {
    for (var i = 0; i < prop.length; i++) {
      names.push(prop[i].name());
    }
    return names;
  } else if (prop && prop.type() === "number") {
    return Number(prop.content());
  } else if (prop && prop.content) {
    return prop.content();
  } else {
    return undefined;
  }
};

/**
 * Returns all or selected content structs, depending on the supplied
 * arguments. You can use the argument-specific content functions instead
 * if that's clearer.
 *
 *   () - returns array of all content.
 *   (0..n) - returns a single struct. Same as ()[n].
 *   ("tag") - returns array of content structs whose tag matches.
 *   ("tag", "nameOrId") - returns single struct whose name or id matches.
 *   ("tag", 0..n) - returns a single struct. Same as ("tag")[n].
 *   ("tag", "nameOrId nameOrId") - returns array of content structs whose
 *     tag matches and whose name or id matches any of those in the
 *     space-separated list.
 *   ("tag", [namesOrIds]) - returns array of content structs whose tag
 *     matches and whose name or id matches any of those in the array.
 *   Anything else - returns array of all content.
 */
Struct.prototype.content = function () {
  var struct = this;
  var arg0 = arguments[0];
  var arg1 = arguments[1];

  if (typeof arg0 == "undefined") {
    return struct.contentAll();
  } else if (typeof arg0 === "number") {
    return struct.contentAll()[arg0];
  } else if (typeof arg0 === "string") {
    if (typeof arg1 === "undefined") {
      return struct.contentWithTag(arg0);
    } else if (typeof arg1 === "string") {
      if (arg1.indexOf(" ") === -1) {
        return struct.contentWithTagAndName(arg0, arg1);
      } else {
        return struct.contentWithTagAndNames(arg0, arg1.split(" "));
      }
    } else if (typeof arg1 === "number") {
      return struct.contentWithTag(arg0)[arg1];
    } else if (arg1 instanceof Array) {
      return struct.contentWithTagAndNames(arg0, arg1);
    }
  }
  return false;
};

Struct.prototype.contentWithTag = function (tag) {
  var struct = this;
  var content = struct.json.content;
  var result = [];

  if (content && content instanceof Array) {
    content.every(function (item) {
      if (item.tag && item.tag === tag) {
        result.push(new Struct(item));
      }
      return true;
    });
  }

  return result;
};

Struct.prototype.contentWithTagAndName = function (tag, nameOrId) {
  var struct = this;
  var content = struct.json.content;
  var result = undefined;

  if (content && content instanceof Array) {
    content.some(function (item) {
      if (item.tag && item.tag === tag) {
        if (item.attr.id === nameOrId || item.attr.name === nameOrId) {
          result = new Struct(item);
          return true;
        }
      }
      return false;
    });
  }

  return result;
};

Struct.prototype.contentWithTagAndNames = function (tag, namesOrIds) {
  var struct = this;
  var content = struct.json.content;
  var result = [];

  if (content && content instanceof Array) {
    content.every(function (item) {
      if (item.tag && item.tag === tag) {
        if (namesOrIds.indexOf(item.attr.id) >= 0 || namesOrIds.indexOf(
            item.attr.name) >= 0) {
          result.push(new Struct(item));
        }
      }
      return true; // Iterate through all items.
    });
  }

  return result;
};

Struct.prototype.contentAll = function () {
  var struct = this;
  var content = struct.json.content;
  var result = [];

  if (content && content instanceof Array) {
    content.every(function (item) {
      if (item.tag) { // Tagged items are pushed onto the list.
        result.push(new Struct(item));
        return true;
      } else { // We don't handle mixed content.
        result = item;
        return false;
      }
    });
  }

  return result;
};
