console.log('1: main() start');

// Microtask - process.nextTick (highest priority, drains before Promises)
process.nextTick(() => console.log('2: nextTick'));

// Microtask - Promise
Promise.resolve().then(() => console.log('3: promise.then'));

// Also a microtask - queueMicrotask (same queue as Promises)
queueMicrotask(() => console.log('4: queueMicrotask'));

// Timers phase
setTimeout(() => console.log('5: setTimeout(0)'), 0);

// Check phase
setImmediate(() => {
  console.log('6: setImmediate (check phase)');

  // Nested inside a check-phase callback, to see re-ordering
  process.nextTick(() => console.log('7: nextTick inside setImmediate'));
  setTimeout(() => console.log('8: setTimeout inside setImmediate'), 0);
  setImmediate(() => console.log('9: setImmediate inside setImmediate'));
});

console.log('10: main() end');