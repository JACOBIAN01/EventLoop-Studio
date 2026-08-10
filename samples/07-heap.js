const a = { x: 1, y: { z: 2 } };
const b = a;
const c = { ...a };
const d = JSON.parse(JSON.stringify(a));

b.y.z = 10;
c.x = 20;
c.y.z++;
d.y.z = 100;

console.log(a.x, a.y.z);
console.log(b.x, b.y.z);
console.log(c.x, c.y.z);
console.log(d.x, d.y.z);
