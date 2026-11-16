// Offline checks for bounded read concurrency, stable ordering, legacy history and auth.
const assert = require("assert");
const path = require("path");

process.env.ROOMS = Array.from({ length: 42 }, (_, i) => String(201 + i)).join(",");
const values = new Map();
let active = 0;
let peak = 0;
const reads = [];
const store = {
  async get(key) {
    reads.push(key);
    active++;
    peak = Math.max(peak, active);
    const delayGroup = [...key].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3;
    await new Promise((resolve) => setTimeout(resolve, delayGroup === 0 ? 5 : 1));
    active--;
    return values.has(key) ? values.get(key) : null;
  },
  async set(key, value) { values.set(key, value); },
};
const cache = (name, exports) => {
  const filename = path.join(__dirname, "api", `${name}.js`);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
cache("_store", store);
cache("_auth", {
  async requireUser(req) { return req.headers.authorization; },
  async canView(user) { return user === "owner"; },
});

function call(handler, { query = {}, user = "owner" } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); },
    };
    Promise.resolve(handler({ query, headers: { authorization: user } }, res)).catch(reject);
  });
}

(async () => {
  const rooms = require("./api/rooms");
  for (let i = 0; i < 12; i++) {
    values.set(`meter:${201 + i}`, { value: i });
    values.set(`bill:${201 + i}`, { total: i });
  }
  values.set("room-user:201", "Usecret-tenant-id");
  let result = await call(rooms);
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.body.rooms.map((r) => r.room), process.env.ROOMS.split(","));
  assert.ok(peak > 1, `room reads overlap (peak ${peak})`);
  assert.ok(peak <= 72, `room reads bounded to 12 rooms × 6 reads (peak ${peak})`);
  assert.ok(!JSON.stringify(result.body).includes("Usecret-tenant-id"), "the room list never carries a tenant's LINE userId");
  assert.deepStrictEqual([result.body.rooms[0].linked, result.body.rooms[1].linked], [true, false], "only whether a tenant is bound");

  const bill = require("./api/bill");
  values.set("user-room:tenant", "203");
  values.set("bill:203", { room: "203", period: "2026-12", total: 312, status: "paid" });
  const periods = Array.from({ length: 10 }, (_, i) => `2026-${String(12 - i).padStart(2, "0")}`);
  periods.push("2025-11");
  values.set("bills:203", periods);
  values.set("bill:2026-10:203", { total: 101, status: "unpaid" });
  values.set("bill:2026-11:203", { total: 202, status: "pending", due: "2026-11-20", slipPath: "s" });
  values.set("bill:2025-11:203", { total: 12, status: "paid" });
  for (const period of periods.slice(2, 10)) {
    if (period !== "2026-08") values.set(`bill:${period}:203`, { total: period, status: "unpaid" });
  }
  reads.length = 0;
  peak = 0;
  result = await call(bill, { query: { history: "1" }, user: "tenant" });
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.body.items.map((item) => item.period), [...periods].sort().reverse().filter((p) => p !== "2026-08"));
  assert.strictEqual(result.body.items.find((item) => item.period === "2026-12").total, 312, "latest-only legacy bill included");
  assert.strictEqual(result.body.items.find((item) => item.period === "2026-11").hasSlip, true);
  assert.ok(peak > 1, `history reads overlap (peak ${peak})`);
  assert.ok(peak <= 6, `history reads bounded to 6 (peak ${peak})`);
  assert.strictEqual(reads.filter((key) => key === "user-room:tenant").length, 1, "binding read once");

  result = await call(bill, { query: { room: "204" }, user: "tenant" });
  assert.strictEqual(result.status, 403, "tenant cannot read another room");
  console.log("reads OK — bounded concurrency, ordering, legacy history, binding and auth");
})().catch((error) => { console.error(error); process.exit(1); });
