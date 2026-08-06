// Nested promises show how the microtask queue grows *while it's draining*:
// a .then() callback that schedules another .then() goes to the back of the
// line, behind promises that were already waiting.
console.log('A');

Promise.resolve().then(() => {
  console.log('B');
  Promise.resolve().then(() => console.log('C'));
});

Promise.resolve().then(() => {
  console.log('D');
});

console.log('E');

// Expected console order: A, E, B, D, C
