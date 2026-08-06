let x = 1;

const obj = {
    x: 10,
    get() {
        return () => this.x;
    }
};

const fn = obj.get();

class Counter {
    static x = 100;

    constructor() {
        this.x = 20;
    }

    async inc() {
        this.x += await Promise.resolve(5);
        console.log("A", this.x);
    }
}

const c = new Counter();

Promise.resolve().then(() => {
    console.log("B", fn());
});

queueMicrotask(() => {
    console.log("C", x);
});

setTimeout(() => {
    console.log("D", x++);
}, 0);

(async () => {
    console.log("E", x);

    const g = (function* () {
        yield x++;
        yield ++x;
        return x;
    })();

    console.log("F", g.next().value);

    await c.inc();

    console.log("G", g.next().value);
    console.log("H", g.next().value);

    x += 10;
})();

new Proxy(
    { x: 50 },
    {
        get(target, prop) {
            console.log("I", prop);
            return target[prop];
        }
    }
).x;

console.log("J", x);