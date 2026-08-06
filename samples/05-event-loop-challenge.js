let x = 1;
((y) => {
  Promise.resolve().then(() => console.log("A", x, y));
  setTimeout(() => console.log("B", x++, y++), 0);
  return async () => {
    x += await Promise.resolve(2);
    console.log("C", x, y);
  };
})(x++)().then(() => console.log("D", x));
queueMicrotask(() => console.log("E", x));
setTimeout(() => Promise.resolve().then(() => console.log("F", x)), 0);
console.log("G", x);
(() => {
  let x = 10;
  Promise.resolve().then(() => console.log("H", x));
  x += 5;
})();
Promise.resolve().then(() => console.log("I", x));
console.log("J");
