// async/await is just Promises with nicer syntax under the hood: everything
// before the first `await` runs synchronously, then the function suspends
// and the rest of `main`'s caller keeps going.
async function main() {
  console.log('A');
  await null;
  console.log('B');
}

console.log('start');
main();
console.log('end');

// Expected console order: start, A, end, B
