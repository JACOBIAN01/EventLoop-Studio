// Watch the Call Stack grow one frame per recursive call, then unwind.
function countdown(n) {
  console.log('count ' + n);
  if (n > 0) {
    countdown(n - 1);
  }
}
countdown(3);

// A closure: `increment` keeps a private reference to `count` even after
// makeCounter() has returned and popped off the call stack.
function makeCounter() {
  let count = 0;
  return function increment() {
    count = count + 1;
    console.log('count is ' + count);
  };
}
const counter = makeCounter();
counter();
counter();
