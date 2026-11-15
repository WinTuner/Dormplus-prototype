// Offline tests of the daily reminder cron (api/cron.js + api/_remind.js).
// Same approach as smoke-handlers.js: in-memory store, stubbed LINE fetch, no node_modules needed.
const assert = require("assert");
const path = require("path");

process.env.LINE_CHANNEL_SECRET = "test-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
process.env.LIFF_ID = "2000000000-testliff";
process.env.OWNER_USER_ID = "Uowner";
process.env.ROOMS = "203,205,207";
const SECRET = "a-long-enough-cron-secret";
process.env.CRON_SECRET = SECRET;

const data = new Map();
const store = {
  get: async (k) => (data.has(k) ? data.get(k) : null),
  set: async (k, v) => data.set(k, v),
};
const api = (name) => path.join(__dirname, "api", name);
require.cache[require.resolve(api("_store"))] = { id: api("_store.js"), filename: api("_store.js"), loaded: true, exports: store };

// Nothing in the reminder path needs it today, but a future import of _qr must not break the suite.
const Module = require("module");
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "qrcode-svg") return class { svg() { return "<svg/>"; } };
  return realLoad.call(this, request, ...rest);
};

let pushed = [];
let failPushTo = null; // userId whose pushes fail
global.fetch = async (url, opts = {}) => {
  if (String(url).includes("/message/push")) {
    const body = JSON.parse(opts.body);
    if (failPushTo && body.to === failPushTo) return { ok: false, status: 500, text: async () => "boom", json: async () => ({}) };
    pushed.push(body);
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
};

const cron = require("./api/cron");
const { runReminders } = require("./api/_remind");
const { saveBill } = require("./api/_bills");

function call(headers) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(obj) { resolve({ status: this.statusCode, body: obj }); return this; },
    };
    Promise.resolve(cron({ method: "GET", query: {}, headers: { host: "test.local", ...headers } }, res)).catch(reject);
  });
}

const bill = (room, period, extra = {}) => ({
  room, period, total: 3796, rent: 3500, water: 100, elec: 196, due: "2026-11-16", status: "unpaid",
  issuedAt: "2026-11-01T00:00:00.000Z", ...extra,
});
const reset = () => { data.clear(); pushed = []; failPushTo = null; };
const tenant = (room, user = `U${room}`) => data.set(`room-user:${room}`, user);
const texts = () => pushed.map((p) => p.messages[0].altText || p.messages[0].text);
const kinds = (r) => r.sent.map((s) => `${s.room}:${s.period}:${s.kind}`);

(async () => {
  // ---------------------------------------------------------------- auth
  delete process.env.CRON_SECRET;
  let r = await call({ authorization: `Bearer ${SECRET}` });
  assert.strictEqual(r.status, 503, "no CRON_SECRET = not configured");
  assert.strictEqual(r.body.error.code, "NOT_CONFIGURED");
  process.env.CRON_SECRET = "short";
  assert.strictEqual((await call({ authorization: "Bearer short" })).status, 503, "a short secret does not count");
  process.env.CRON_SECRET = SECRET;
  assert.strictEqual((await call({})).status, 401, "no header");
  r = await call({ authorization: "Bearer wrong-wrong-wrong-wrong" });
  assert.strictEqual(r.status, 401, "wrong secret");
  assert.strictEqual(r.body.error.code, "UNAUTHORIZED");
  r = await call({ authorization: `Bearer ${SECRET}` });
  assert.strictEqual(r.status, 200, "right secret");
  assert.deepStrictEqual(r.body.sent, []);
  assert.strictEqual(r.body.failed, 0);
  assert.match(r.body.today, /^\d{4}-\d{2}-\d{2}$/);

  // ---------------------------------------------------------------- each kind on the right day
  const cases = [
    ["2026-11-12", null], // 4 days ahead: too early
    ["2026-11-13", "before_3"],
    ["2026-11-15", "before_3"], // 1 day left is still the before window
    ["2026-11-16", "due_0"],
    ["2026-11-17", "after_1"],
    ["2026-11-20", "after_1"],
    ["2026-11-21", "after_5"],
    ["2026-11-25", "after_5"],
    ["2026-11-26", "after_10"],
    ["2026-12-30", "after_10"],
  ];
  for (const [today, kind] of cases) {
    reset();
    tenant("203");
    await saveBill(bill("203", "2026-11"));
    r = await runReminders({ today });
    assert.deepStrictEqual(kinds(r), kind ? [`203:2026-11:${kind}`] : [], `${today} -> ${kind}`);
    assert.strictEqual(pushed.length - (kind && kind.startsWith("after_") ? 1 : 0), kind ? 1 : 0, `${today}: one message to the tenant (+ owner summary when late)`);
  }

  // ---------------------------------------------------------------- message text
  reset(); tenant("203");
  await saveBill(bill("203", "2026-11"));
  await runReminders({ today: "2026-11-13" });
  assert.strictEqual(pushed[0].to, "U203");
  assert.strictEqual(texts()[0], "แจ้งเตือน: บิลห้อง 203 รอบ พ.ย. 2569 ยอด 3,796 บาท ครบกำหนด 16 พ.ย. (อีก 3 วัน)");
  assert.strictEqual(pushed[0].messages[0].type, "flex");
  assert.ok(JSON.stringify(pushed[0].messages[0]).includes("https://liff.line.me/2000000000-testliff?room=203"), "LIFF link");
  pushed = [];
  await runReminders({ today: "2026-11-16" });
  assert.ok(texts()[0].includes("ครบกำหนดวันนี้"));
  pushed = [];
  await runReminders({ today: "2026-11-21" });
  assert.ok(texts()[0].includes("เลยกำหนดมา 5 วันแล้ว"));

  // ---------------------------------------------------------------- dedup and next window
  reset(); tenant("203");
  await saveBill(bill("203", "2026-11"));
  assert.strictEqual((await runReminders({ today: "2026-11-13" })).sent.length, 1);
  assert.strictEqual((await runReminders({ today: "2026-11-13" })).sent.length, 0, "same day twice sends nothing");
  assert.strictEqual((await runReminders({ today: "2026-11-14" })).sent.length, 0, "same window, already sent");
  assert.strictEqual((await runReminders({ today: "2026-11-15" })).sent.length, 0);
  assert.deepStrictEqual(kinds(await runReminders({ today: "2026-11-16" })), ["203:2026-11:due_0"], "next kind when its window starts");
  assert.ok(typeof data.get("reminded:203:2026-11:before_3:1") === "string", "marked with an ISO time");
  assert.deepStrictEqual(kinds(await runReminders({ today: "2026-11-17" })), ["203:2026-11:after_1"]);
  assert.strictEqual((await runReminders({ today: "2026-11-18" })).sent.length, 0);

  // ---------------------------------------------------------------- a missed cron day still sends
  reset(); tenant("203");
  await saveBill(bill("203", "2026-11"));
  assert.deepStrictEqual(kinds(await runReminders({ today: "2026-11-19" })), ["203:2026-11:after_1"], "first run is 3 days late: still after_1");

  // ---------------------------------------------------------------- statuses and missing due
  for (const [label, extra] of [["pending", { status: "pending" }], ["paid", { status: "paid" }], ["void", { status: "void" }], ["no due", { due: null }]]) {
    reset(); tenant("203");
    await saveBill(bill("203", "2026-11", extra));
    r = await runReminders({ today: "2026-11-20" });
    assert.deepStrictEqual(r.sent, [], `${label} is skipped`);
    assert.strictEqual(pushed.length, 0, `${label}: nothing pushed, no owner summary`);
  }

  // ---------------------------------------------------------------- older unpaid period from the index
  reset(); tenant("203");
  await saveBill(bill("203", "2026-10", { due: "2026-10-16" }));
  await saveBill(bill("203", "2026-11"));
  r = await runReminders({ today: "2026-11-20" });
  assert.deepStrictEqual(kinds(r), ["203:2026-10:after_10", "203:2026-11:after_1"], "old unpaid bill is reminded too");
  reset(); tenant("203");
  await saveBill(bill("203", "2026-10", { due: "2026-10-16", status: "paid" }));
  await saveBill(bill("203", "2026-11"));
  assert.deepStrictEqual(kinds(await runReminders({ today: "2026-11-20" })), ["203:2026-11:after_1"], "old paid bill is not");

  // ---------------------------------------------------------------- unbound room, hidden bill
  reset();
  await saveBill(bill("203", "2026-11"));
  r = await runReminders({ today: "2026-11-20" });
  assert.deepStrictEqual(r.sent, [], "unbound room skipped");
  assert.strictEqual(pushed.length, 0);

  reset(); tenant("203");
  await saveBill(bill("203", "2026-10", { due: "2026-10-16" })); // issued before the new tenant moved in
  await saveBill(bill("203", "2026-11", { issuedAt: "2026-11-05T00:00:00.000Z" }));
  data.set("tenancy:203", { since: "2026-11-03T00:00:00.000Z" });
  r = await runReminders({ today: "2026-11-20" });
  assert.deepStrictEqual(kinds(r), ["203:2026-11:after_1"], "the previous tenant's bill is not sent to the new one");
  assert.ok(!texts().some((t) => t.includes("2569") && t.includes("ต.ค.")), "no October text leaked");

  // ---------------------------------------------------------------- failed push is retried
  reset(); tenant("203");
  await saveBill(bill("203", "2026-11"));
  failPushTo = "U203";
  const origErr = console.error; console.error = () => {};
  r = await runReminders({ today: "2026-11-13" });
  console.error = origErr;
  assert.strictEqual(r.failed, 1);
  assert.deepStrictEqual(r.sent, []);
  assert.strictEqual(data.has("reminded:203:2026-11:before_3:1"), false, "failed push is not marked");
  failPushTo = null;
  r = await runReminders({ today: "2026-11-14" });
  assert.deepStrictEqual(kinds(r), ["203:2026-11:before_3"], "retried on the next run");
  assert.strictEqual(r.failed, 0);

  // one room failing must not stop the others
  reset(); tenant("203"); tenant("205");
  await saveBill(bill("203", "2026-11"));
  await saveBill(bill("205", "2026-11"));
  failPushTo = "U203";
  console.error = () => {};
  r = await runReminders({ today: "2026-11-13" });
  console.error = origErr;
  assert.deepStrictEqual(kinds(r), ["205:2026-11:before_3"]);
  assert.strictEqual(r.failed, 1);

  // ---------------------------------------------------------------- owner summary
  reset(); tenant("203"); tenant("205"); tenant("207");
  await saveBill(bill("203", "2026-11"));
  await saveBill(bill("205", "2026-11"));
  await saveBill(bill("207", "2026-11", { status: "paid" }));
  r = await runReminders({ today: "2026-11-17" });
  assert.strictEqual(r.sent.length, 2);
  const summary = pushed.filter((p) => p.to === "Uowner");
  assert.strictEqual(summary.length, 1, "one summary");
  assert.strictEqual(summary[0].messages[0].text, "สรุปทวงวันนี้: เลยกำหนด 2 ห้อง (203, 205) · ส่งเตือนแล้ว 2 ข้อความ");
  pushed = [];
  await runReminders({ today: "2026-11-17" });
  assert.strictEqual(pushed.length, 0, "nothing sent, no summary");

  reset(); tenant("203");
  await saveBill(bill("203", "2026-11"));
  await runReminders({ today: "2026-11-13" });
  assert.ok(!pushed.some((p) => p.to === "Uowner"), "no summary when only before/due reminders went out");
  pushed = [];
  await runReminders({ today: "2026-11-16" });
  assert.ok(!pushed.some((p) => p.to === "Uowner"), "due_0 is not late");

  // ---------------------------------------------------------------- one push per room, marks that cannot abort the rest
  // 203 has two bills in a reminder window at once (Oct late, Nov due soon): one push, two cards.
  reset(); tenant("203");
  await saveBill(bill("203", "2026-10", { due: "2026-11-01" }));
  await saveBill(bill("203", "2026-11", { due: "2026-11-16" }));
  r = await runReminders({ today: "2026-11-13" });
  assert.deepStrictEqual(kinds(r), ["203:2026-10:after_10", "203:2026-11:before_3"]);
  const toTenant = pushed.filter((p) => p.to === "U203");
  assert.deepStrictEqual([toTenant.length, toTenant[0].messages.length], [1, 2], "both cards travel in one push");
  assert.ok(data.get("reminded:203:2026-10:after_10:1") && data.get("reminded:203:2026-11:before_3:1"), "each kind is marked on its own");
  pushed = [];
  await runReminders({ today: "2026-11-13" });
  assert.strictEqual(pushed.filter((p) => p.to === "U203").length, 0, "and not sent again");

  // A re-issued bill (rev 2) is a new bill: rev 1's mark must not silence it.
  await saveBill(bill("203", "2026-11", { rev: 2, due: "2026-11-16" }));
  assert.deepStrictEqual(kinds(await runReminders({ today: "2026-11-13" })), ["203:2026-11:before_3"], "rev 2 is reminded while rev 1 stays marked");

  // A mark written before revisions existed still counts, so the first run after deploy repeats nothing.
  reset(); tenant("203");
  await saveBill(bill("203", "2026-11"));
  data.set("reminded:203:2026-11:before_3", "2026-11-13T00:00:00.000Z");
  assert.deepStrictEqual(kinds(await runReminders({ today: "2026-11-13" })), [], "a pre-deploy mark is honoured");

  // More than 5 cards for one room: pushed in batches of 5 (LINE's limit).
  reset(); tenant("203");
  for (let m = 1; m <= 7; m++) await saveBill(bill("203", `2026-0${m}`, { due: "2026-07-01" }));
  r = await runReminders({ today: "2026-11-13" });
  assert.strictEqual(r.sent.length, 7);
  assert.deepStrictEqual(pushed.filter((p) => p.to === "U203").map((p) => p.messages.length), [5, 2]);

  // A mark that cannot be written is logged, not thrown: the card is already with the tenant.
  reset(); tenant("203");
  await saveBill(bill("203", "2026-11"));
  const realSet = store.set;
  store.set = async (k, v) => { if (k.startsWith("reminded:")) throw new Error("blob down"); return realSet(k, v); };
  const logged = []; console.error = (...a) => logged.push(a.join(" "));
  r = await runReminders({ today: "2026-11-13" });
  store.set = realSet; console.error = origErr;
  assert.deepStrictEqual([kinds(r), r.failed], [["203:2026-11:before_3"], 0], "counted as sent, not failed");
  assert.ok(logged.some((l) => l.includes("reminder mark failed")));

  // A bill with no due date is never reminded about (and never prints "null").
  reset(); tenant("203");
  await saveBill(bill("203", "2026-11", { due: null }));
  r = await runReminders({ today: "2026-11-30" });
  assert.deepStrictEqual([r.sent, pushed.length], [[], 0]);

  // ---------------------------------------------------------------- through the handler
  reset(); tenant("203");
  await saveBill(bill("203", "2026-11"));
  r = await call({ authorization: `Bearer ${SECRET}` });
  assert.strictEqual(r.status, 200);

  console.log("cron OK — auth, 6 reminder windows, dedup, catch-up, skips, tenancy, retry, owner summary, one push per room");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
