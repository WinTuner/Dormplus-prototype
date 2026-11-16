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
  // ---- overdue: counted on the server from the Bangkok date, which the test pins through _ledger
  require("./api/_ledger").bangkokToday = () => "2026-11-02";
  const putRoom = (room, bills) => {
    values.set(`bills:${room}`, bills.map((b) => b.period));
    for (const b of bills) values.set(`bill:${b.period}:${room}`, { room, ...b });
    values.set(`bill:${room}`, { room, ...bills[0] });
  };
  putRoom("205", [
    { period: "2026-11", total: 400, status: "unpaid", due: "2026-11-16", issuedAt: "2026-11-01T00:00:00Z" },
    { period: "2026-10", total: 300, status: "unpaid", due: "2026-10-31", issuedAt: "2026-10-16T00:00:00Z" },
    { period: "2026-09", total: 200, status: "unpaid", due: "2026-09-16", issuedAt: "2026-09-16T00:00:00Z" },
    { period: "2026-08", total: 100, status: "pending", due: "2026-08-16", issuedAt: "2026-08-16T00:00:00Z" },
  ]);
  putRoom("206", [{ period: "2026-11", total: 500, status: "unpaid", due: "2026-11-02" }]); // due today: not late
  putRoom("207", [{ period: "2026-11", total: 500, status: "unpaid", due: null }]);
  putRoom("208", [{ period: "2026-10", total: 500, status: "void", due: "2026-10-01" }]);
  putRoom("209", [{ period: "2026-10", total: 700, status: "unpaid", due: "2026-11-01" }]);
  values.set("user-room:tenant205", "205");
  values.set("tenancy:205", { since: "2026-10-01T00:00:00Z" }); // the September bill is the previous tenant's

  result = await call(bill, { query: { overdue: "1" }, user: "owner" });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.today, "2026-11-02");
  assert.deepStrictEqual(result.body.rooms.map((r) => [r.room, r.count, r.total, r.maxDaysOverdue]), [["205", 2, 500, 47], ["209", 1, 700, 1]], "pending, due today, no due and void are not overdue");
  assert.deepStrictEqual(result.body.rooms[0].items.map((i) => [i.period, i.daysOverdue]), [["2026-09", 47], ["2026-10", 2]], "oldest due first; 31 Oct to 2 Nov is 2 days across the month boundary");
  assert.deepStrictEqual([result.body.count, result.body.total], [3, 1200]);
  result = await call(bill, { query: { overdue: "1", room: "209" }, user: "owner" });
  assert.deepStrictEqual(result.body.rooms.map((r) => r.room), ["209"], "room= narrows");
  assert.strictEqual((await call(bill, { query: { overdue: "1", room: "999" }, user: "owner" })).status, 404);

  result = await call(bill, { query: { overdue: "1" }, user: "tenant205" });
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual([result.body.room, result.body.count, result.body.total, result.body.maxDaysOverdue], ["205", 1, 300, 2], "the previous tenant's September bill is hidden");
  assert.deepStrictEqual(result.body.items, [{ period: "2026-10", total: 300, due: "2026-10-31", daysOverdue: 2 }]);
  assert.strictEqual((await call(bill, { query: { overdue: "1", room: "209" }, user: "tenant205" })).status, 403, "not another room");

  // ---- income: by the day it was paid in Bangkok, whatever the bill's period
  putRoom("210", [{ period: "2026-10", total: 4000, status: "paid", paidAt: "2026-10-31T17:30:00Z" }]); // 1 Nov 00:30 in Bangkok
  putRoom("211", [{ period: "2026-11", total: 3000, status: "paid", paidAt: "2026-11-01T05:00:00Z" }]);
  putRoom("212", [{ period: "2026-10", total: 2000, status: "void", paidAt: "2026-11-02T05:00:00Z" }]);
  putRoom("213", [{ period: "2026-10", total: 1000, status: "paid", paidAt: "2026-10-31T16:59:59Z" }]); // still October there
  putRoom("214", [{ period: "2025-11", total: 900, status: "paid", paidAt: "2026-11-03T05:00:00Z" }]); // paid a year late: still looked up
  putRoom("215", [{ period: "2025-10", total: 800, status: "paid", paidAt: "2026-11-03T06:00:00Z" }]); // 13 months back: out of the window
  result = await call(bill, { query: { income: "2026-11" }, user: "owner" });
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.body.items.map((i) => [i.room, i.period]), [["210", "2026-10"], ["211", "2026-11"], ["214", "2025-11"]], "sorted by paidAt; October bill counts in November, void does not");
  assert.deepStrictEqual([result.body.month, result.body.count, result.body.total], ["2026-11", 3, 7900]);
  assert.ok(result.body.items[0].receiptNo, "each row carries a receipt number");
  result = await call(bill, { query: { income: "2026-10" }, user: "owner" });
  assert.deepStrictEqual(result.body.items.map((i) => i.room), ["213"], "the 17:00Z payment is October in Bangkok");
  assert.strictEqual((await call(bill, { query: { income: "2026-11" }, user: "tenant205" })).status, 403);
  for (const bad of ["2026-13", "abc", "2026-1"]) {
    assert.strictEqual((await call(bill, { query: { income: bad }, user: "owner" })).status, 400, bad);
  }
  console.log("reads OK — bounded concurrency, ordering, legacy history, binding, auth, overdue and income");
})().catch((error) => { console.error(error); process.exit(1); });
