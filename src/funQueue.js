/***************************************************************************
 *
 * Function queue. Used to serialise Javascript loads.
 *
 ***************************************************************************/
var FunQueue = function (isRunning) {
  this.isRunning = isRunning ? true : false; // Let's be boolean.
  this.queue = [];
};

// Callback is passed one function argument, and MUST call it when
// it's happy for the next in the queue to execute.
FunQueue.prototype.push = function (callback) {
  var funQueue = this;
  var toExecute = function () {
    callback(function () {
      funQueue.next.call(funQueue);
    })
  };

  funQueue.queue.push(toExecute);

  if (!funQueue.isRunning) {
    funQueue.next();
  }
};

FunQueue.prototype.next = function () {
  var funQueue = this;
  var toExecute = funQueue.queue.shift();

  if (toExecute) {
    funQueue.isRunning = true;
    setTimeout(toExecute, 0);
  } else {
    funQueue.isRunning = false;
  }
};
