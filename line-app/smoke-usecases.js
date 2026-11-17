// Offline test suite organised by USE CASE (see docs/TEST-CASES.md: every block here carries the
// same TC id as the table row that describes it).
//
// Same harness as smoke-handlers.js: the Blob store is an in-memory Map installed through
// require.cache before any handler loads, LINE is a stubbed fetch (an idToken "U..." verifies as
// that userId; pushes, replies and rich-menu calls are recorded), qrcode-svg gets a stand-in.
// No network and no node_modules.
//
//   cd line-app && node smoke-usecases.js
const assert = require("assert");
const crypto = require("crypto");
const path = require("path");

process.env.LINE_CHANNEL_SECRET = "test-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
process.env.LIFF_ID = "2000000000-testliff";
process.env.OWNER_USER_ID = "Uowner";
process.env.RICHMENU_OWNER_ID = "richmenu-owner";
process.env.RICHMENU_TENANT_ID = "richmenu-tenant";
for (const k of ["VERCEL_ENV", "ALLOW_SEED_BYPASS", "ROOMS", "DEFAULT_RENT", "WATER_RATE", "ELEC_RATE", "BILL_PERIOD", "BILL_DUE"]) {
  delete process.env[k];
}

// ---------------------------------------------------------------- fakes
const data = new Map();
const files = new Map();
const pathOf = (k) => `kv/${String(k).replace(/[^a-zA-Z0-9._-]/g, "-")}.json`;
// A test can set `gate` to hold a store call until it decides to let it through: that is how the
// race tests force "both requests read before either writes" (a real Blob store has no
// transactions, so the order is up to the network).
let gate = null; // async (op, key) => void
const store = {
  get: async (k) => { if (gate) await gate("get", k); return data.has(k) ? data.get(k) : null; },
  set: async (k, v) => { if (gate) await gate("set", k); data.set(k, v); if (gate) await gate("set-done", k); },
  keysWith: async (prefix) => {
    const pathPrefix = pathOf(prefix).replace(/\.json$/, "");
    return [...data.keys()]
      .filter((k) => pathOf(k).startsWith(pathPrefix))
      .map((k) => prefix + pathOf(k).slice(pathPrefix.length).replace(/\.json$/, ""));
  },
  getFile: async (p) => (files.has(p) ? { blob: { contentType: "image/png" } } : null),
  putFile: async (p, bytes) => files.set(p, bytes),
  delFile: async (p) => files.delete(p),
};

const api = (name) => path.join(__dirname, "api", name);
require.cache[require.resolve(api("_store"))] = { id: api("_store.js"), filename: api("_store.js"), loaded: true, exports: store };

const Module = require("module");
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "qrcode-svg") return class { svg() { return "<svg/>"; } };
  return realLoad.call(this, request, ...rest);
};

const pushed = []; // { to, messages }
const replies = []; // { replyToken, messages }
const menuLinks = []; // { user, menu }
const unlinked = [];
const failPushTo = new Set();
const retryKeys = new Set(); // X-Line-Retry-Key values LINE has accepted
const conflicts = []; // pushes LINE answered 409 (dropped as duplicates)
let slipok = null; // what SlipOK answers: { status, body }
const slipokCalls = [];
let failRichMenu = false;
global.fetch = async (url, opts = {}) => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const u = String(url);
  if (u.includes("/oauth2/v2.1/verify")) {
    const token = new URLSearchParams(opts.body).get("id_token");
    return token && token.startsWith("U")
      ? ok({ sub: token, exp: Math.floor(Date.now() / 1000) + 3600 })
      : { ok: false, status: 400, json: async () => ({}) };
  }
  if (u.includes("api.slipok.com")) {
    slipokCalls.push({ url: u, init: opts });
    if (!slipok) return { ok: false, status: 500, json: async () => ({}), text: async () => "{}" };
    return { ok: slipok.status === 200, status: slipok.status, json: async () => slipok.body, text: async () => JSON.stringify(slipok.body) };
  }
  if (u.includes("/message/push")) {
    const body = JSON.parse(opts.body);
    if (failPushTo.has(body.to)) return { ok: false, status: 500, text: async () => "push down", json: async () => ({}) };
    // Like LINE: a push whose X-Line-Retry-Key was already accepted is answered 409 and not delivered.
    const key = opts.headers && opts.headers["X-Line-Retry-Key"];
    if (key) {
      if (retryKeys.has(key)) { conflicts.push(body); return { ok: false, status: 409, text: async () => "conflict", json: async () => ({}) }; }
      retryKeys.add(key);
    }
    pushed.push(body); // only accepted pushes are recorded, so pushed.length is what the tenant received
  }
  if (u.includes("/message/reply")) replies.push(JSON.parse(opts.body));
  const link = /\/v2\/bot\/user\/([^/]+)\/richmenu\/([^/]+)$/.exec(u);
  if (link) {
    if (failRichMenu) return { ok: false, status: 500, text: async () => "menu down", json: async () => ({}) };
    menuLinks.push({ user: link[1], menu: link[2] });
  }
  const unlink = /\/v2\/bot\/user\/([^/]+)\/richmenu$/.exec(u);
  if (unlink && opts.method === "DELETE") unlinked.push(unlink[1]);
  const profile = /\/v2\/bot\/profile\/([^/]+)$/.exec(u);
  if (profile) return ok({ displayName: `name-${profile[1]}` });
  return ok({});
};

function call(handler, { method = "POST", query = {}, body, user, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(obj) { resolve({ status: this.statusCode, body: obj, headers: this.headers }); return this; },
      end() { resolve({ status: this.statusCode, body: null, headers: this.headers }); },
    };
    const req = {
      method,
      query,
      body,
      headers: { host: "test.local", ...(user ? { authorization: `Bearer ${user}` } : {}), ...headers },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function webhook(handler, events, { signature } = {}) {
  const raw = Buffer.from(JSON.stringify({ events }));
  const sig = signature || crypto.createHmac("sha256", "test-secret").update(raw).digest("base64");
  const req = {
    method: "POST",
    headers: { "x-line-signature": sig, host: "test.local" },
    async *[Symbol.asyncIterator]() { yield raw; },
  };
  return new Promise((resolve, reject) => {
    const res = {
      status(code) { this.code = code; return this; },
      json(obj) { resolve({ status: this.code, body: obj }); return this; },
      end() { resolve({ status: this.code || 200, body: null }); return this; },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const qr = require("./api/qr");
const run = require("./api/run");
const me = require("./api/me");
const owner = require("./api/owner");
const slip = require("./api/slip");
const slipImage = require("./api/slip-image");
const rooms = require("./api/rooms");
const bill = require("./api/bill");
const hook = require("./api/webhook");
const cron = require("./api/cron");
const { runReminders } = require("./api/_remind");
// Tests pin "today" through the ledger module (bill.js reads it from there); tc() restores it.
const ledger = require("./api/_ledger");
const realToday = ledger.bangkokToday;
const atDate = (ymd) => { ledger.bangkokToday = () => ymd; };
const { saveBill } = require("./api/_bills");
const { MAX_FAILURES } = require("./api/_limit");

// ---------------------------------------------------------------- runner
const results = [];
async function tc(id, title, fn) {
  // every block starts from an empty dorm, so blocks never depend on each other
  data.clear();
  files.clear();
  pushed.length = replies.length = menuLinks.length = unlinked.length = 0;
  failPushTo.clear();
  retryKeys.clear();
  conflicts.length = slipokCalls.length = 0;
  slipok = null;
  gate = null;
  delete process.env.SLIPOK_API_KEY;
  delete process.env.SLIPOK_BRANCH_ID;
  delete process.env.SLIP_AUTO_CONFIRM;
  failRichMenu = false;
  ledger.bangkokToday = realToday;
  process.env.OWNER_USER_ID = "Uowner";
  try {
    await fn();
    results.push({ id, ok: true });
    console.log(`✓ ${id} ${title}`);
  } catch (err) {
    results.push({ id, ok: false });
    console.log(`✗ ${id} ${title}\n    ${String(err && err.message).split("\n").join("\n    ")}`);
  }
}

// ---------------------------------------------------------------- helpers
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const bindDirect = (user, room) => { data.set(`user-room:${user}`, room); data.set(`room-user:${room}`, user); };
const issue = (readings, extra = {}, user = "Uowner") =>
  call(run, { user, body: { period: "2026-11", due: "2026-11-16", readings, ...extra } });
const tap = (user, postback) =>
  webhook(hook, [{ type: "postback", replyToken: "r", source: { userId: user }, postback: { data: postback } }]);
const say = (user, text) =>
  webhook(hook, [{ type: "message", replyToken: "r", source: { userId: user }, message: { type: "text", text } }]);
const lastTo = (to) => pushed.filter((p) => p.to === to).pop();
const sendSlip = (user, extra = {}) => call(slip, { user, body: { image: PNG, ...extra } });
const asOwner = async (userId, role) => data.set(`owner:${userId}`, { addedAt: "2026-01-01T00:00:00.000Z", role });
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const prepayOf = (room) => data.get(`prepay:${room}`) ?? null;
// A bill the owner already issued (both copies), so a block can start from "bill exists".
const putBill = (b) => { data.set(`bill:${b.period}:${b.room}`, b); data.set(`bill:${b.room}`, b); };
// Race helpers. `barrier(n)`: the first n callers wait for each other (n requests all read before any writes).
const barrier = (n) => {
  let arrived = 0;
  let open;
  const all = new Promise((r) => { open = r; });
  return () => { if (++arrived >= n) open(); return all; };
};
// `holds` freeze one store call each (the first unused hold that matches, in the order created) until
// released: that pins the interleaving of two requests instead of hoping for it.
const mkHolds = () => {
  const list = [];
  gate = async (op, key) => {
    const h = list.find((x) => !x.done && x.match(op, key));
    if (!h) return;
    h.done = true;
    h.hit();
    await h.open;
  };
  return (match) => {
    const h = { match, done: false };
    h.reached = new Promise((r) => { h.hit = r; });
    h.open = new Promise((r) => { h.release = r; });
    list.push(h);
    return h;
  };
};
const ownerCards = () =>
  pushed.filter((p) => p.to === "Uowner" && JSON.stringify(p.messages).includes("action=confirm"));
const okSlip = (amount, transRef, paidAt) => ({
  status: 200,
  body: { success: true, data: { success: true, message: "ok", amount, transRef, transTimestamp: paidAt, receivingBank: "006" } },
});
const withSlipok = () => { process.env.SLIPOK_API_KEY = "test-key"; process.env.SLIPOK_BRANCH_ID = "1234"; };
const DAY = 86400000;

const mkBill = (room, period, status = "unpaid", extra = {}) => ({
  room, period, rent: 3500, water: 250, elec: 700, total: 4450, due: `${period}-16`, status, ...extra,
});

(async () => {
  // ================================================================ UC-01 ตั้งค่าหอ (ค่าเช่า · อัตราน้ำไฟ)
  await tc("TC-01-1", "ห้องที่ไม่มีค่าตั้งเอง ใช้ค่าเริ่มต้น 3,500 / 25 / 7", async () => {
    const r = await issue([{ room: "201", water: 10, elec: 100 }]);
    const b = data.get("bill:2026-11:201");
    assert.deepStrictEqual([b.rent, b.water, b.elec, b.total], [3500, 250, 700, 4450]);
    assert.strictEqual(r.body.rooms[0].total, 4450);
  });

  await tc("TC-01-2", "ค่าเช่า/อัตราเฉพาะห้อง (room:<n>) ถูกใช้ และค่าที่ไม่ได้ตั้งตกไปใช้ค่าเริ่มต้น", async () => {
    data.set("room:202", { rent: 4000, waterRate: 20, elecRate: 8 });
    data.set("room:203", { rent: 3000 }); // only the rent is overridden
    await issue([{ room: "202", water: 5, elec: 10 }, { room: "203", water: 2, elec: 1 }]);
    const b202 = data.get("bill:2026-11:202");
    assert.deepStrictEqual([b202.rent, b202.water, b202.elec, b202.total], [4000, 100, 80, 4180]);
    const b203 = data.get("bill:2026-11:203");
    assert.deepStrictEqual([b203.rent, b203.water, b203.elec], [3000, 50, 7], "water/elec keep the default rates");
  });

  await tc("TC-01-3", "GET /api/rooms แสดงค่าตั้งของทุกห้อง (12 ห้องตาม ROOMS)", async () => {
    data.set("room:202", { rent: 4000, waterRate: 20, elecRate: 8 });
    const r = await call(rooms, { method: "GET", user: "Uowner" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.rooms.length, 12);
    assert.deepStrictEqual(r.body.rooms.map((x) => x.room).slice(0, 2), ["201", "202"]);
    assert.deepStrictEqual(r.body.rooms[0].config, { rent: 3500, waterRate: 25, elecRate: 7 });
    assert.deepStrictEqual(r.body.rooms[1].config, { rent: 4000, waterRate: 20, elecRate: 8 });
  });

  await tc("TC-01-4", "ค่าน้ำ/ไฟที่ได้เป็นทศนิยมถูกปัดเป็นบาทเต็ม", async () => {
    data.set("room:204", { waterRate: 22.5, elecRate: 7.5 });
    await issue([{ room: "204", water: 3, elec: 3 }]); // 67.5 -> 68, 22.5 -> 23
    const b = data.get("bill:2026-11:204");
    assert.deepStrictEqual([b.water, b.elec, b.total], [68, 23, 3500 + 68 + 23]);
  });

  await tc("TC-01-5", "เปลี่ยนอัตราภายหลัง ไม่กระทบบิลที่ออกไปแล้ว", async () => {
    await issue([{ room: "201", water: 10, elec: 100 }]);
    data.set("room:201", { rent: 9999, waterRate: 99, elecRate: 99 });
    bindDirect("Utenant", "201");
    const r = await call(bill, { method: "GET", user: "Utenant" });
    assert.strictEqual(r.body.total, 4450, "the issued bill keeps its own amounts");
  });

  // ================================================================ UC-02 จดมิเตอร์น้ำ–ไฟ
  await tc("TC-02-1", "หน่วยที่จดถูกเก็บเป็นมิเตอร์ล่าสุดของห้อง และ /api/rooms แสดง", async () => {
    await issue([{ room: "201", water: 12, elec: 140 }]);
    assert.deepStrictEqual(
      [data.get("meter:201").water, data.get("meter:201").elec],
      [12, 140]
    );
    const r = await call(rooms, { method: "GET", user: "Uowner" });
    const room = r.body.rooms.find((x) => x.room === "201");
    assert.strictEqual(room.meter.water, 12);
    assert.strictEqual(room.meter.elec, 140);
    assert.ok(room.meter.at, "with the time it was recorded");
  });

  await tc("TC-02-2", "หน่วยติดลบถูกปฏิเสธ ไม่เซฟมิเตอร์ ไม่ออกบิล ไม่ส่ง LINE", async () => {
    bindDirect("Utenant", "201");
    const r = await issue([{ room: "201", water: -5, elec: 30 }]);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.rooms[0].error);
    assert.strictEqual(data.get("meter:201") ?? null, null);
    assert.strictEqual(data.get("bill:201") ?? null, null);
    assert.strictEqual(pushed.length, 0);
  });

  await tc("TC-02-3", "หน่วยต้องเป็นจำนวนเต็ม: 1.5 และ 'abc' ถูกปฏิเสธ ส่วน '12' (สตริงตัวเลข) ผ่าน", async () => {
    const r = await issue([
      { room: "201", water: 1.5, elec: 1 },
      { room: "202", water: "abc", elec: 1 },
      { room: "203", water: "12", elec: "3" },
    ]);
    assert.ok(r.body.rooms[0].error);
    assert.ok(r.body.rooms[1].error);
    assert.ok(!r.body.rooms[2].error);
    assert.strictEqual(data.get("meter:203").water, 12);
  });

  await tc("TC-02-4", "ห้องที่ไม่มีในหอถูกปฏิเสธ และไม่ทำให้ห้องอื่นในคำขอเดียวกันล้ม", async () => {
    const r = await issue([{ room: "999", water: 1, elec: 1 }, { room: "201", water: 1, elec: 1 }]);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.rooms[0].error);
    assert.ok(r.body.rooms[1].total > 0);
    assert.strictEqual(data.get("bill:999") ?? null, null);
    assert.ok(data.get("bill:201"));
  });

  await tc("TC-02-5", "เพดานหน่วย: 100,000 ผ่าน, 100,001 ถูกปฏิเสธ", async () => {
    const r = await issue([{ room: "201", water: 100000, elec: 0 }, { room: "202", water: 100001, elec: 0 }]);
    assert.ok(!r.body.rooms[0].error);
    assert.ok(r.body.rooms[1].error);
  });

  await tc("TC-02-6", "ไม่ส่ง/null/ว่าง water หรือ elec ถูกปฏิเสธ (ต้องกรอกหน่วยน้ำและไฟ) ไม่ออกบิลเฉพาะค่าเช่า; 0 ที่กรอกตั้งใจผ่าน", async () => {
    const r = await issue([
      { room: "201" },
      { room: "202", water: null, elec: null },
      { room: "203", water: 5 }, // the electricity reading was forgotten
      { room: "204", water: "", elec: "  " },
      { room: "205", water: 0, elec: 0 }, // an explicit zero is a reading
    ]);
    for (let i = 0; i < 4; i++) {
      const room = ["201", "202", "203", "204"][i];
      assert.strictEqual(r.body.rooms[i].error, "ต้องกรอกหน่วยน้ำและไฟ", room);
      assert.strictEqual(data.get(`bill:${room}`) ?? null, null, `${room}: no bill`);
      assert.strictEqual(data.get(`meter:${room}`) ?? null, null, `${room}: no meter`);
    }
    assert.ok(!r.body.rooms[4].error);
    const b = data.get("bill:2026-11:205");
    assert.deepStrictEqual([b.total, b.waterUnits, b.elecUnits], [3500, 0, 0], "a real 0 is billed as rent only");
  });

  await tc("TC-02-7", "ห้องซ้ำในคำขอเดียวกัน: ห้องแรกผ่าน ห้องที่ซ้ำถูกปฏิเสธ", async () => {
    const r = await issue([{ room: "201", water: 1, elec: 1 }, { room: "201", water: 9, elec: 9 }]);
    assert.ok(!r.body.rooms[0].error);
    assert.ok(r.body.rooms[1].error);
    assert.strictEqual(data.get("meter:201").water, 1, "the first reading is the one kept");
  });

  await tc("TC-02-8", "จดมิเตอร์/ออกบิลได้เฉพาะเจ้าของ: ผู้เช่า ผู้ช่วย 403, ไม่ล็อกอิน 401", async () => {
    await asOwner("Uhelper", "viewer");
    bindDirect("Utenant", "201");
    assert.strictEqual((await issue([{ room: "201", water: 1, elec: 1 }], {}, "Utenant")).status, 403);
    assert.strictEqual((await issue([{ room: "201", water: 1, elec: 1 }], {}, "Uhelper")).status, 403);
    assert.strictEqual((await issue([{ room: "201", water: 1, elec: 1 }], {}, null)).status, 401);
    assert.strictEqual((await issue([{ room: "201", water: 1, elec: 1 }], {}, "bad-token")).status, 403, "an idToken LINE refuses");
    assert.strictEqual(data.get("meter:201") ?? null, null);
  });

  // ================================================================ UC-03 ออกบิล (คำนวณบิล + ส่งบิลทาง LINE)
  await tc("TC-03-1", "ออกบิลสำเร็จ: คำนวณยอด เก็บสองสำเนา ทำดัชนีงวด สถานะ unpaid", async () => {
    const r = await issue([{ room: "201", water: 10, elec: 100 }]);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.body.ok, r.body.period, r.body.due], [true, "2026-11", "2026-11-16"]);
    const b = data.get("bill:2026-11:201");
    assert.deepStrictEqual([b.status, b.total, b.waterUnits, b.elecUnits, b.due], ["unpaid", 4450, 10, 100, "2026-11-16"]);
    assert.deepStrictEqual(data.get("bill:201"), b, "the newest copy equals the period copy");
    assert.deepStrictEqual(data.get("bills:201"), ["2026-11"]);
  });

  await tc("TC-03-2", "period ผิดรูปแบบ (2026-13, 2026-1, ว่าง) → 400 ไม่เขียนอะไร", async () => {
    for (const period of ["2026-13", "2026-1", "202611", ""]) {
      const r = await call(run, { user: "Uowner", body: { period, readings: [{ room: "201", water: 1, elec: 1 }] } });
      assert.strictEqual(r.status, 400, `period "${period}"`);
      assert.strictEqual(r.body.error.code, "VALIDATION");
    }
    assert.strictEqual(data.size, 0);
  });

  await tc("TC-03-3", "due ผิดรูปแบบ (2026-02-31x, 16/11/2026) → 400; ไม่ส่ง due → ออกได้ due=null", async () => {
    for (const due of ["16/11/2026", "2026-11-32", "2026-13-01"]) {
      const r = await issue([{ room: "201", water: 1, elec: 1 }], { due });
      assert.strictEqual(r.status, 400, `due ${due}`);
    }
    const ok = await call(run, { user: "Uowner", body: { period: "2026-11", readings: [{ room: "201", water: 1, elec: 1 }] } });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.due, null);
    assert.strictEqual(data.get("bill:2026-11:201").due, null);
  });

  await tc("TC-03-4", "readings ว่าง/ไม่ใช่ array → 400", async () => {
    for (const readings of [[], undefined, "201", {}]) {
      const r = await call(run, { user: "Uowner", body: { period: "2026-11", readings } });
      assert.strictEqual(r.status, 400);
    }
    assert.strictEqual((await call(run, { user: "Uowner" })).status, 400, "no body at all");
  });

  await tc("TC-03-5", "วิธีเรียกอื่นนอกจาก POST → 405", async () => {
    const r = await call(run, { method: "GET", user: "Uowner" });
    assert.strictEqual(r.status, 405);
  });

  await tc("TC-03-6", "ส่งการ์ดบิล (Flex) ให้ผู้เช่าที่ผูกห้อง; ห้องที่ยังไม่มีผู้เช่าได้บิลแต่ pushed=false", async () => {
    bindDirect("Utenant", "201");
    const r = await issue([{ room: "201", water: 10, elec: 100 }, { room: "202", water: 1, elec: 1 }]);
    assert.strictEqual(r.body.rooms[0].pushed, true);
    assert.strictEqual(r.body.rooms[1].pushed, false);
    assert.ok(data.get("bill:2026-11:202"), "a vacant room still gets its bill");
    const card = lastTo("Utenant").messages[0];
    assert.strictEqual(card.type, "flex");
    assert.ok(card.altText.includes("201") && card.altText.includes("4,450"));
    assert.ok(JSON.stringify(card).includes("liff.line.me/2000000000-testliff?room=201"), "the button opens the room's LIFF page");
    assert.strictEqual(pushed.filter((p) => p.to === "Utenant").length, 1);
  });

  await tc("TC-03-7", "ส่ง LINE ล้มเหลว บิลยังถูกเก็บไว้ และ pushed=false", async () => {
    bindDirect("Utenant", "201");
    failPushTo.add("Utenant");
    const r = await issue([{ room: "201", water: 1, elec: 1 }]);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.rooms[0].pushed, false);
    assert.ok(data.get("bill:2026-11:201"), "the bill is stored before the card is sent");
  });

  await tc("TC-03-8", "ออกบิลซ้ำห้องที่ยัง unpaid แก้เลขได้ (reissued=true) และส่งการ์ดใหม่", async () => {
    bindDirect("Utenant", "201");
    await issue([{ room: "201", water: 1, elec: 1 }]);
    const r = await issue([{ room: "201", water: 2, elec: 2 }]);
    assert.strictEqual(r.body.rooms[0].reissued, true);
    assert.strictEqual(data.get("bill:2026-11:201").waterUnits, 2);
    assert.strictEqual(data.get("bill:201").waterUnits, 2, "both copies corrected");
    assert.strictEqual(data.get("bills:201").length, 1, "the period is not indexed twice");
    assert.strictEqual(pushed.filter((p) => p.to === "Utenant").length, 2);
  });

  await tc("TC-03-9", "บิลที่แจ้งชำระแล้ว (pending) หรือจ่ายแล้ว (paid) ถูกแก้ด้วยการออกซ้ำไม่ได้", async () => {
    putBill(mkBill("201", "2026-11", "pending", { slipPath: "slips/x.png" }));
    putBill(mkBill("202", "2026-11", "paid"));
    const r = await issue([{ room: "201", water: 9, elec: 9 }, { room: "202", water: 9, elec: 9 }]);
    assert.ok(r.body.rooms[0].error && r.body.rooms[1].error);
    assert.strictEqual(data.get("bill:2026-11:201").status, "pending");
    assert.strictEqual(data.get("bill:2026-11:201").total, 4450, "amount untouched");
    assert.strictEqual(data.get("bill:2026-11:202").status, "paid");
  });

  await tc("TC-03-10", "บิลเก่าที่มีแค่ bill:<room> (ไม่มีสำเนารายงวด) ที่จ่ายแล้ว ก็ยังกันการออกซ้ำ", async () => {
    data.set("bill:201", mkBill("201", "2026-11", "paid"));
    const r = await issue([{ room: "201", water: 9, elec: 9 }]);
    assert.ok(r.body.rooms[0].error);
    assert.strictEqual(data.get("bill:201").status, "paid");
  });

  await tc("TC-03-11", "ออกบิลงวดเก่าย้อนหลัง ไม่ทับบิลล่าสุด (bill:<room>) แต่เข้าประวัติ", async () => {
    await issue([{ room: "201", water: 1, elec: 1 }], { period: "2026-12", due: "2026-12-16" });
    await issue([{ room: "201", water: 2, elec: 2 }], { period: "2026-11", due: "2026-11-16" });
    assert.strictEqual(data.get("bill:201").period, "2026-12");
    assert.strictEqual(data.get("bill:2026-11:201").waterUnits, 2);
    assert.deepStrictEqual(data.get("bills:201"), ["2026-12", "2026-11"], "index newest first");
  });

  await tc("TC-03-12", "ออกบิลทั้งหอ (12 ห้อง) ในคำขอเดียว ครบทุกห้อง", async () => {
    const readings = Array.from({ length: 12 }, (_, i) => ({ room: String(201 + i), water: i, elec: i * 10 }));
    const r = await issue(readings);
    assert.strictEqual(r.body.rooms.length, 12);
    assert.ok(r.body.rooms.every((x) => !x.error && x.total > 0));
    assert.deepStrictEqual(r.body.rooms.map((x) => x.room), readings.map((x) => x.room), "answers keep input order");
    for (const x of readings) assert.ok(data.get(`bill:2026-11:${x.room}`));
  });

  await tc("TC-03-13", "ไม่ส่ง due → การ์ดบิลไม่มีบรรทัด 'ครบกำหนด' และไม่ขึ้นคำว่า null; ส่ง due แล้วขึ้นวันที่", async () => {
    bindDirect("Utenant", "201");
    await call(run, { user: "Uowner", body: { period: "2026-11", readings: [{ room: "201", water: 1, elec: 1 }] } });
    assert.strictEqual(data.get("bill:2026-11:201").due, null);
    const noDue = JSON.stringify(lastTo("Utenant").messages[0]);
    assert.ok(noDue.includes("3,532"), "it is the bill card");
    assert.ok(!noDue.includes("null") && !noDue.includes("ครบกำหนด"), "no due line at all");
    await issue([{ room: "201", water: 1, elec: 1 }]); // unpaid: re-issued with the date
    assert.ok(JSON.stringify(lastTo("Utenant").messages[0]).includes("ครบกำหนด 2026-11-16"));
  });

  // ================================================================ UC-04 ยืนยันการชำระ
  await tc("TC-04-1", "ทั้งเส้นทาง: เจ้าของขอ QR ห้อง → ผู้เช่าผูก → ออกบิล → ผู้เช่าอ่านบิล → แนบสลิป → เจ้าของกดยืนยันจากการ์ด → บิล paid → ผู้เช่าได้การ์ดใบเสร็จ", async () => {
    // owner shows the room QR, tenant scans it
    let r = await call(qr, { method: "GET", query: { room: "203" }, user: "Uowner" });
    assert.strictEqual(r.status, 200);
    r = await call(qr, { body: { code: r.body.code }, user: "Utenant" });
    assert.strictEqual(r.status, 200);
    // owner issues the bill, the tenant gets a card
    r = await issue([{ room: "203", water: 10, elec: 100 }]);
    assert.strictEqual(r.body.rooms[0].pushed, true);
    // tenant reads the bill, then attaches the slip
    r = await call(bill, { method: "GET", user: "Utenant" });
    assert.deepStrictEqual([r.body.status, r.body.total], ["unpaid", 4450]);
    r = await sendSlip("Utenant", { note: "โอนแล้วครับ" });
    assert.strictEqual(r.body.status, "pending");
    // the owner's card carries the exact bill; the owner taps it
    const card = lastTo("Uowner").messages[0];
    const postback = card.contents.footer.contents[0].action.data;
    assert.strictEqual(postback, "action=confirm&room=203&period=2026-11");
    await tap("Uowner", postback);
    const paid = data.get("bill:2026-11:203");
    assert.strictEqual(paid.status, "paid");
    assert.strictEqual(paid.confirmedBy, "Uowner");
    assert.ok(paid.paidAt);
    assert.deepStrictEqual(data.get("bill:203"), paid, "newest copy agrees");
    const receipt = lastTo("Utenant").messages[0];
    assert.strictEqual(receipt.type, "flex", "the tenant gets the receipt card");
    assert.ok(receipt.altText.includes("ใบเสร็จรับเงิน ห้อง 203"));
    assert.strictEqual(paid.receiptNo, "R202611-203");
    assert.ok(JSON.stringify(receipt).includes("R202611-203"));
    assert.ok(JSON.stringify(replies.pop().messages).includes("ยืนยันห้อง 203"), "the owner gets an acknowledgement");
    r = await call(bill, { method: "GET", user: "Utenant" });
    assert.strictEqual(r.body.status, "paid");
  });

  await tc("TC-04-2", "ผู้เช่า ผู้ช่วย (viewer) และคนแปลกหน้ากดยืนยันไม่ได้ บิลยัง pending", async () => {
    putBill(mkBill("205", "2026-11", "pending"));
    await asOwner("Uhelper", "viewer");
    for (const who of ["Utenant", "Uhelper", "Ustranger"]) {
      await tap(who, "action=confirm&room=205&period=2026-11");
      assert.strictEqual(data.get("bill:2026-11:205").status, "pending", who);
      assert.ok(JSON.stringify(replies.pop().messages).includes("เฉพาะเจ้าของหอ"));
    }
  });

  await tc("TC-04-3", "การ์ดเก่าที่ไม่มี period ยืนยันไม่ได้ แม้บิลล่าสุดจะ pending", async () => {
    putBill(mkBill("205", "2026-11", "pending"));
    await tap("Uowner", "action=confirm&room=205");
    assert.strictEqual(data.get("bill:205").status, "pending");
    assert.ok(JSON.stringify(replies.pop().messages).includes("ไม่ระบุรอบบิล"));
  });

  await tc("TC-04-4", "บิลที่ยัง unpaid (ไม่มีสลิป) ยืนยันไม่ได้", async () => {
    putBill(mkBill("205", "2026-11", "unpaid"));
    await tap("Uowner", "action=confirm&room=205&period=2026-11");
    assert.strictEqual(data.get("bill:2026-11:205").status, "unpaid");
    assert.ok(JSON.stringify(replies.pop().messages).includes("ยังไม่ได้แจ้งชำระ"));
  });

  await tc("TC-04-5", "กดยืนยันซ้ำ: ตอบว่ายืนยันไปแล้ว ไม่เปลี่ยน paidAt ไม่ส่งแจ้งผู้เช่าซ้ำ", async () => {
    bindDirect("Utenant", "205");
    putBill(mkBill("205", "2026-11", "pending"));
    await tap("Uowner", "action=confirm&room=205&period=2026-11");
    const firstPaidAt = data.get("bill:2026-11:205").paidAt;
    const pushes = pushed.length;
    await tap("Uowner", "action=confirm&room=205&period=2026-11");
    assert.strictEqual(data.get("bill:2026-11:205").paidAt, firstPaidAt);
    assert.strictEqual(pushed.length, pushes);
    assert.ok(JSON.stringify(replies.pop().messages).includes("ยืนยันไปแล้ว"));
  });

  await tc("TC-04-6", "การ์ดของรอบเก่า ปิดได้เฉพาะบิลรอบนั้น ไม่แตะบิลเดือนใหม่", async () => {
    putBill(mkBill("205", "2026-11", "pending"));
    data.set("bill:2026-12:205", mkBill("205", "2026-12", "unpaid"));
    data.set("bill:205", data.get("bill:2026-12:205"));
    await tap("Uowner", "action=confirm&room=205&period=2026-11");
    assert.strictEqual(data.get("bill:2026-11:205").status, "paid");
    assert.strictEqual(data.get("bill:2026-12:205").status, "unpaid");
    assert.strictEqual(data.get("bill:205").status, "unpaid", "the newest copy is not overwritten by the older period");
  });

  await tc("TC-04-7", "บิลที่การ์ดอ้างไม่มีอยู่จริง → ตอบ 'ไม่พบบิล' ไม่เขียนอะไร", async () => {
    await tap("Uowner", "action=confirm&room=205&period=2026-11");
    assert.ok(JSON.stringify(replies.pop().messages).includes("ไม่พบบิล"));
    assert.strictEqual(data.get("bill:2026-11:205") ?? null, null);
  });

  await tc("TC-04-8", "webhook ที่ลายเซ็นปลอม → 401 และไม่ทำอะไร", async () => {
    putBill(mkBill("205", "2026-11", "pending"));
    const ev = [{ type: "postback", replyToken: "r", source: { userId: "Uowner" }, postback: { data: "action=confirm&room=205&period=2026-11" } }];
    const forged = await webhook(hook, ev, { signature: "forged" });
    assert.strictEqual(forged.status, 401);
    assert.strictEqual(data.get("bill:2026-11:205").status, "pending");
  });

  await tc("TC-04-9", "ถ้าเจ้าของเป็นคนเดียวกับผู้เช่าห้องนั้น ไม่ส่งข้อความแจ้งตัวเองซ้ำ", async () => {
    bindDirect("Uowner", "205");
    putBill(mkBill("205", "2026-11", "pending"));
    await tap("Uowner", "action=confirm&room=205&period=2026-11");
    assert.strictEqual(data.get("bill:2026-11:205").status, "paid");
    assert.strictEqual(pushed.filter((p) => p.to === "Uowner").length, 0);
  });

  await tc("TC-04-10", "ยืนยันแล้วบิลได้เลขที่ใบเสร็จ R<yyyymm>-<ห้อง> (rev>1 ต่อท้าย -rev) ทั้งสองสำเนา; ผู้เช่าได้การ์ดใบเสร็จ; ยืนยันซ้ำไม่เปลี่ยนเลขและไม่ส่งซ้ำ", async () => {
    bindDirect("Utenant", "205");
    putBill(mkBill("205", "2026-11", "pending", { slipPath: "slips/205.png" }));
    putBill(mkBill("206", "2026-12", "pending"));
    putBill(mkBill("207", "2026-11", "pending", { rev: 2 }));
    putBill(mkBill("208", "2026-11", "pending", { rev: 1 }));
    await tap("Uowner", "action=confirm&room=205&period=2026-11");
    const b = data.get("bill:2026-11:205");
    assert.strictEqual(b.receiptNo, "R202611-205");
    assert.deepStrictEqual(data.get("bill:205"), b, "both copies carry the number");
    // another room and period, and a re-issued (rev 2) bill, each get a number of their own
    await tap("Uowner", "action=confirm&room=206&period=2026-12");
    await tap("Uowner", "action=confirm&room=207&period=2026-11");
    await tap("Uowner", "action=confirm&room=208&period=2026-11");
    assert.deepStrictEqual(
      ["206", "207", "208"].map((r) => data.get(`bill:${r}`).receiptNo),
      ["R202612-206", "R202611-207-2", "R202611-208"]
    );
    // the tenant gets the receipt card, not the old plain text
    const card = pushed.filter((p) => p.to === "Utenant").pop().messages[0];
    assert.strictEqual(card.type, "flex");
    const s = JSON.stringify(card);
    assert.ok(s.includes("เลขที่ R202611-205") && s.includes("4,450") && s.includes("ดูใบเสร็จ"));
    assert.ok(!s.includes("ชำระเงินแล้ว ✅"));
    // confirming again keeps the number and sends nothing more
    const pushes = pushed.length;
    await tap("Uowner", "action=confirm&room=205&period=2026-11");
    assert.strictEqual(data.get("bill:2026-11:205").receiptNo, "R202611-205");
    assert.strictEqual(pushed.length, pushes);
  });

  // ================================================================ UC-05 ดูห้องค้างชำระ
  const seedMixed = async () => {
    bindDirect("Utenant1", "201");
    bindDirect("Utenant2", "202");
    putBill(mkBill("201", "2026-11", "unpaid", { due: "2026-11-05" })); // overdue
    putBill(mkBill("202", "2026-11", "pending", { slipPath: "slips/202.png", slipAt: ago(1000) }));
    putBill(mkBill("203", "2026-11", "paid", { paidAt: ago(1000) }));
    // 204: no bill at all
  };

  await tc("TC-05-1", "เจ้าของเห็นทุกห้องพร้อมสถานะบิล (unpaid/pending/paid/ไม่มีบิล) และวันครบกำหนด", async () => {
    await seedMixed();
    const r = await call(rooms, { method: "GET", user: "Uowner" });
    assert.strictEqual(r.status, 200);
    const by = Object.fromEntries(r.body.rooms.map((x) => [x.room, x]));
    assert.deepStrictEqual([by["201"].bill.status, by["201"].bill.due], ["unpaid", "2026-11-05"]);
    assert.strictEqual(by["202"].bill.status, "pending");
    assert.strictEqual(by["203"].bill.status, "paid");
    assert.strictEqual(by["204"].bill, null);
    assert.strictEqual(r.headers["Cache-Control"], "no-store");
  });

  await tc("TC-05-2", "ผู้ช่วย (viewer) ดูได้ ผู้เช่า 403 ไม่ล็อกอิน 401", async () => {
    await seedMixed();
    await asOwner("Uhelper", "viewer");
    assert.strictEqual((await call(rooms, { method: "GET", user: "Uhelper" })).status, 200);
    assert.strictEqual((await call(rooms, { method: "GET", user: "Utenant1" })).status, 403);
    assert.strictEqual((await call(rooms, { method: "GET" })).status, 401);
  });

  await tc("TC-05-3", "รายการห้องไม่เปิดเผย LINE userId ของผู้เช่า (บอกแค่ว่าผูกแล้วหรือไม่)", async () => {
    await seedMixed();
    const r = await call(rooms, { method: "GET", user: "Uowner" });
    assert.ok(!JSON.stringify(r.body).includes("Utenant"), "no tenant userId in the response");
    const by = Object.fromEntries(r.body.rooms.map((x) => [x.room, x]));
    assert.strictEqual(by["201"].linked, true);
    assert.strictEqual(by["204"].linked, false);
  });

  await tc("TC-05-4", "ห้องที่แจ้งชำระแล้ว (pending) ยังมี status=pending ไม่ปนกับ unpaid (หน้าจอใช้แยก 'ค้างชำระ' กับ 'รอตรวจ')", async () => {
    await seedMixed();
    const r = await call(rooms, { method: "GET", user: "Uowner" });
    const unpaid = r.body.rooms.filter((x) => x.bill && x.bill.status === "unpaid").map((x) => x.room);
    const pending = r.body.rooms.filter((x) => x.bill && x.bill.status === "pending").map((x) => x.room);
    assert.deepStrictEqual(unpaid, ["201"]);
    assert.deepStrictEqual(pending, ["202"]);
  });

  await tc("TC-05-5", "หลายงวดค้างของห้องเดียว: /api/rooms แสดงเฉพาะบิลล่าสุด งวดก่อนหน้าดูได้จาก history", async () => {
    data.set("bills:201", ["2026-11", "2026-10"]);
    data.set("bill:2026-10:201", mkBill("201", "2026-10", "unpaid"));
    putBill(mkBill("201", "2026-11", "unpaid"));
    const r = await call(rooms, { method: "GET", user: "Uowner" });
    assert.strictEqual(r.body.rooms[0].bill.period, "2026-11");
    const h = await call(bill, { method: "GET", query: { room: "201", history: "1" }, user: "Uowner" });
    assert.deepStrictEqual(h.body.items.map((i) => [i.period, i.status]), [["2026-11", "unpaid"], ["2026-10", "unpaid"]]);
  });

  const overdueOf = (user, query = {}) => call(bill, { method: "GET", user, query: { overdue: "1", ...query } });

  await tc("TC-05-7", "เจ้าของเห็นค้างกี่งวด/ยอดรวม/เกินกี่วันต่อห้อง: ห้องที่ค้างนานสุดขึ้นก่อน · ไม่ใส่ห้องที่ไม่ค้าง · pending/กำหนดวันนี้/ไม่มี due/void ไม่นับ · ผู้ช่วยดูได้", async () => {
    atDate("2026-11-20");
    await asOwner("Uhelper", "viewer");
    data.set("bills:201", ["2026-11", "2026-10"]);
    putBill(mkBill("201", "2026-11", "unpaid", { due: "2026-11-05" })); // 15 days
    data.set("bill:2026-10:201", mkBill("201", "2026-10", "unpaid", { total: 4000, due: "2026-10-16" })); // 35 days
    putBill(mkBill("202", "2026-11", "unpaid", { due: "2026-11-18" })); // 2 days
    putBill(mkBill("203", "2026-11", "unpaid", { due: "2026-11-20" })); // due today
    putBill(mkBill("204", "2026-11", "pending", { due: "2026-11-01" }));
    putBill(mkBill("205", "2026-11", "unpaid", { due: null }));
    putBill(mkBill("206", "2026-11", "void", { due: "2026-11-01" }));
    putBill(mkBill("207", "2026-11", "paid", { due: "2026-11-01" }));
    const r = await overdueOf("Uowner");
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.rooms.map((x) => [x.room, x.count, x.total, x.maxDaysOverdue]), [["201", 2, 8450, 35], ["202", 1, 4450, 2]]);
    assert.deepStrictEqual([r.body.today, r.body.count, r.body.total], ["2026-11-20", 3, 12900]);
    assert.deepStrictEqual(r.body.rooms[0].items.map((i) => [i.period, i.due, i.daysOverdue]), [["2026-10", "2026-10-16", 35], ["2026-11", "2026-11-05", 15]]);
    assert.deepStrictEqual((await overdueOf("Uowner", { room: "202" })).body.rooms.map((x) => x.room), ["202"]);
    assert.strictEqual((await overdueOf("Uhelper")).status, 200);
    assert.strictEqual((await overdueOf("Uowner", { room: "999" })).status, 404);
    assert.strictEqual((await overdueOf(undefined)).status, 401);
  });

  await tc("TC-05-8", "จำนวนวันเกินกำหนดนับที่เซิร์ฟเวอร์ตามวันที่เวลาไทย: ข้ามเดือน/ข้ามปี/ก.พ. · กำหนดวันนี้ไม่เกิน · 17:00 UTC คือวันถัดไปในไทย", async () => {
    putBill(mkBill("201", "2026-10", "unpaid", { due: "2026-10-31" }));
    putBill(mkBill("202", "2026-02", "unpaid", { due: "2026-02-28" }));
    putBill(mkBill("203", "2025-12", "unpaid", { due: "2025-12-31" }));
    const days = async () => Object.fromEntries((await overdueOf("Uowner")).body.rooms.map((x) => [x.room, x.maxDaysOverdue]));
    atDate("2026-11-02");
    assert.deepStrictEqual(await days(), { 201: 2, 202: 247, 203: 306 });
    atDate("2026-10-31");
    assert.deepStrictEqual(await days(), { 202: 245, 203: 304 }, "due today is not overdue");
    atDate("2026-03-01");
    assert.deepStrictEqual(await days(), { 202: 1, 203: 60 }, "28 Feb to 1 Mar is one day (2026 is not a leap year)");
    atDate("2026-01-01");
    assert.deepStrictEqual(await days(), { 203: 1 }, "across the year end");
    // the real clock helpers: the dorm's date, not the server's UTC one
    assert.strictEqual(realToday(new Date("2026-10-31T17:30:00Z")), "2026-11-01");
    assert.strictEqual(realToday(new Date("2026-10-31T16:59:00Z")), "2026-10-31");
    assert.strictEqual(ledger.bangkokMonth("2026-10-31T17:30:00Z"), "2026-11");
    assert.strictEqual(ledger.bangkokMonth("nonsense"), null);
    assert.strictEqual(ledger.daysBetween("2026-10-31", "2026-11-02"), 2);
  });

  // ================================================================ UC-06 ดูรายรับ
  await tc("TC-06-1", "ข้อมูลที่หน้ารายงานใช้: ยอดรับ = ผลรวม total ของบิล paid เท่านั้น (pending/unpaid ไม่นับ)", async () => {
    putBill(mkBill("201", "2026-11", "paid", { total: 4450, paidAt: ago(1) }));
    putBill(mkBill("202", "2026-11", "paid", { total: 3800, paidAt: ago(1) }));
    putBill(mkBill("203", "2026-11", "pending", { total: 5000 }));
    putBill(mkBill("204", "2026-11", "unpaid", { total: 6000 }));
    const r = await call(rooms, { method: "GET", user: "Uowner" });
    const bills = r.body.rooms.map((x) => x.bill).filter(Boolean);
    const sum = (list) => list.reduce((s, b) => s + b.total, 0);
    assert.strictEqual(sum(bills.filter((b) => b.status === "paid")), 8250);
    assert.strictEqual(sum(bills.filter((b) => b.status === "pending")), 5000);
    assert.strictEqual(sum(bills.filter((b) => b.status === "unpaid")), 6000);
    assert.ok(bills.filter((b) => b.status === "paid").every((b) => b.paidAt), "every paid bill carries paidAt");
  });

  await tc("TC-06-2", "ผู้ช่วยเปิดดูข้อมูลรายรับได้ (อ่านอย่างเดียว) แต่ผู้เช่าไม่ได้", async () => {
    putBill(mkBill("201", "2026-11", "paid", { paidAt: ago(1) }));
    await asOwner("Uhelper", "viewer");
    assert.strictEqual((await call(rooms, { method: "GET", user: "Uhelper" })).status, 200);
    bindDirect("Utenant", "201");
    assert.strictEqual((await call(rooms, { method: "GET", user: "Utenant" })).status, 403);
  });

  await tc("TC-06-3", "รายรับของงวดก่อนไม่อยู่ใน /api/rooms (มีแต่บิลล่าสุด) ต้องอ่านผ่าน /api/bill?room&period", async () => {
    putBill(mkBill("201", "2026-10", "paid", { total: 4000, paidAt: ago(99999) }));
    putBill(mkBill("201", "2026-11", "unpaid"));
    const r = await call(rooms, { method: "GET", user: "Uowner" });
    assert.strictEqual(r.body.rooms[0].bill.period, "2026-11");
    const old = await call(bill, { method: "GET", query: { room: "201", period: "2026-10" }, user: "Uowner" });
    assert.deepStrictEqual([old.body.status, old.body.total], ["paid", 4000]);
  });

  await tc("TC-06-6", "รายรับตามวันที่ชำระ (paidAt, เวลาไทย) ไม่ใช่ตามงวด: บิล ต.ค. ที่จ่าย 2 พ.ย. นับเป็นรายรับ พ.ย. · void ไม่นับ · บิลงวดถัดไปที่ออกก่อนและจ่ายเดือนนี้ก็นับ (ธ.ค. จ่าย 20 พ.ย. = รายรับ พ.ย. ไม่ใช่ ธ.ค.) · ผู้ช่วยดูได้ ผู้เช่า 403 · เดือนผิดรูป 400", async () => {
    await asOwner("Uhelper", "viewer");
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-10", "paid", { total: 4450, paidAt: "2026-11-02T03:00:00.000Z", receiptNo: "R202610-201" }));
    putBill(mkBill("202", "2026-10", "paid", { total: 3800, paidAt: "2026-10-31T17:30:00.000Z" })); // 1 Nov 00:30 in Bangkok
    putBill(mkBill("203", "2026-10", "paid", { total: 3000, paidAt: "2026-10-31T16:00:00.000Z" })); // 31 Oct 23:00 in Bangkok
    putBill(mkBill("204", "2026-11", "void", { total: 5000, paidAt: "2026-11-05T03:00:00.000Z", statusBefore: "paid", refundDue: 5000 }));
    putBill(mkBill("205", "2026-11", "pending", { total: 6000 }));
    const income = (user, month) => call(bill, { method: "GET", user, query: { income: month } });
    let r = await income("Uowner", "2026-11");
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.items.map((i) => [i.room, i.period, i.total]), [["202", "2026-10", 3800], ["201", "2026-10", 4450]], "October bills count in November; sorted by paidAt");
    assert.deepStrictEqual([r.body.month, r.body.count, r.body.total], ["2026-11", 2, 8250]);
    assert.strictEqual(r.body.items[1].receiptNo, "R202610-201");
    r = await income("Uhelper", "2026-10");
    assert.deepStrictEqual([r.status, r.body.items.map((i) => i.room), r.body.total], [200, ["203"], 3000], "the same October bills are not October income");
    assert.strictEqual((await income("Utenant", "2026-11")).status, 403);
    assert.strictEqual((await income(undefined, "2026-11")).status, 401);
    assert.strictEqual((await income("Uowner", "2026-13")).status, 400);
    // A December bill issued early and paid on 20 November is November income, not December's:
    // the period of the bill does not matter, only the day it was paid.
    putBill(mkBill("206", "2026-12", "paid", { total: 3900, paidAt: "2026-11-20T03:00:00.000Z" }));
    r = await income("Uowner", "2026-11");
    assert.deepStrictEqual(r.body.items.map((i) => [i.room, i.period]), [["202", "2026-10"], ["201", "2026-10"], ["206", "2026-12"]], "a later period paid in this month counts");
    assert.deepStrictEqual([r.body.count, r.body.total], [3, 12150]);
    assert.deepStrictEqual((await income("Uowner", "2026-12")).body.items, [], "and it is not December income");
    assert.deepStrictEqual((await income("Uowner", "2027-01")).body.items, []);
  });

  // ================================================================ UC-07 เพิ่ม/ถอนเจ้าของและผู้ช่วย
  const invite = (user, role) => call(owner, { user, body: role ? { role } : {} });
  const redeem = (user, code) => call(owner, { user, body: { code } });

  await tc("TC-07-1", "เจ้าของคนแรกเชิญผู้ช่วย: ได้รหัส 8 ตัว role=viewer หมดอายุใน 10 นาที", async () => {
    const r = await invite("Uowner", "viewer");
    assert.strictEqual(r.status, 200);
    assert.match(r.body.code, /^[A-HJKMNP-Z2-9]{8}$/);
    assert.strictEqual(r.body.role, "viewer");
    assert.ok(r.body.url.includes("?owner=") && r.body.qr);
    const ttl = new Date(r.body.expiresAt).getTime() - Date.now();
    assert.ok(ttl > 9 * 60 * 1000 && ttl <= 10 * 60 * 1000);
  });

  await tc("TC-07-2", "ผู้ช่วยใช้รหัส: ได้สิทธิ์ดูอย่างเดียว เมนูเจ้าของ แจ้งเจ้าของคนแรก; ออกบิล/เชิญไม่ได้", async () => {
    const { body } = await invite("Uowner", "viewer");
    let r = await redeem("Uhelper", body.code.toLowerCase());
    assert.deepStrictEqual([r.status, r.body.owner, r.body.role], [200, false, "viewer"]);
    assert.strictEqual(data.get("owner:Uhelper").role, "viewer");
    assert.ok(menuLinks.some((m) => m.user === "Uhelper" && m.menu === "richmenu-owner"));
    assert.ok(JSON.stringify(lastTo("Uowner").messages).includes("ผู้ช่วย"));
    assert.strictEqual((await call(rooms, { method: "GET", user: "Uhelper" })).status, 200, "can look");
    assert.strictEqual((await issue([{ room: "201", water: 1, elec: 1 }], {}, "Uhelper")).status, 403, "cannot bill");
    assert.strictEqual((await invite("Uhelper", "viewer")).status, 403, "cannot invite");
    assert.strictEqual((await call(qr, { method: "GET", query: { room: "201" }, user: "Uhelper" })).status, 403, "cannot see room QRs");
  });

  await tc("TC-07-3", "เจ้าของคนแรกเชิญเจ้าของร่วม: ใช้รหัสแล้วออกบิลได้ แต่เชิญเจ้าของเพิ่มไม่ได้ (เชิญผู้ช่วยได้)", async () => {
    const { body } = await invite("Uowner"); // default role = owner
    assert.strictEqual(body.role, "owner");
    const r = await redeem("Uco", body.code);
    assert.deepStrictEqual([r.body.owner, r.body.role], [true, "owner"]);
    assert.strictEqual((await issue([{ room: "201", water: 1, elec: 1 }], {}, "Uco")).status, 200);
    assert.strictEqual((await invite("Uco", "owner")).status, 403);
    assert.strictEqual((await invite("Uco")).status, 403, "no role asked = owner = refused");
    assert.strictEqual((await invite("Uco", "viewer")).status, 200);
  });

  await tc("TC-07-4", "ผู้เช่า/ผู้ช่วย/คนไม่ล็อกอินเชิญไม่ได้", async () => {
    await asOwner("Uhelper", "viewer");
    bindDirect("Utenant", "201");
    assert.strictEqual((await invite("Utenant", "viewer")).status, 403);
    assert.strictEqual((await invite("Uhelper", "viewer")).status, 403);
    assert.strictEqual((await invite(undefined, "viewer")).status, 401);
  });

  await tc("TC-07-5", "รหัสใช้ได้ครั้งเดียว: ครั้งที่สอง (คนอื่น) → 410", async () => {
    const { body } = await invite("Uowner", "viewer");
    assert.strictEqual((await redeem("Uhelper", body.code)).status, 200);
    const r = await redeem("Uother", body.code);
    assert.strictEqual(r.status, 410);
    assert.strictEqual(r.body.error.code, "INVITE_EXPIRED");
    assert.strictEqual(data.get("owner:Uother") ?? null, null);
  });

  await tc("TC-07-6", "รหัสหมดอายุ (เกิน 10 นาที) → 410 และไม่ได้สิทธิ์", async () => {
    const { body } = await invite("Uowner", "viewer");
    data.set(`owner-invite:${body.code}`, { ...data.get(`owner-invite:${body.code}`), expiresAt: ago(1000) });
    const r = await redeem("Uhelper", body.code);
    assert.strictEqual(r.status, 410);
    assert.strictEqual(data.get("owner:Uhelper") ?? null, null);
  });

  await tc("TC-07-7", "รหัสผิด → 404; ผิดครบ 10 ครั้งใน 1 ชั่วโมง → 429 แม้รหัสถัดไปจะถูก", async () => {
    const { body } = await invite("Uowner", "viewer");
    for (let i = 0; i < MAX_FAILURES; i++) {
      assert.strictEqual((await redeem("Uguess", `WRONG${i}`)).status, 404);
    }
    const r = await redeem("Uguess", body.code);
    assert.strictEqual(r.status, 429);
    assert.strictEqual(r.body.error.code, "TOO_MANY_ATTEMPTS");
  });

  await tc("TC-07-8", "ยังไม่ตั้ง OWNER_USER_ID ใช้รหัสเชิญไม่ได้ (409)", async () => {
    const { body } = await invite("Uowner", "viewer");
    delete process.env.OWNER_USER_ID;
    try {
      const r = await redeem("Uhelper", body.code);
      assert.strictEqual(r.status, 409);
      assert.strictEqual(data.get("owner:Uhelper") ?? null, null);
    } finally {
      process.env.OWNER_USER_ID = "Uowner";
    }
  });

  await tc("TC-07-9", "คนที่เป็นเจ้าของ/ผู้ช่วยอยู่แล้วใช้รหัส → already:true ไม่เปลี่ยนสิทธิ์ แต่รหัสถูกใช้แล้ว (คนอื่นใช้ต่อไม่ได้ 410)", async () => {
    await asOwner("Uco", "owner");
    const { body } = await invite("Uowner", "viewer");
    const r = await redeem("Uco", body.code);
    assert.deepStrictEqual([r.status, r.body.already, r.body.role], [200, true, "owner"]);
    assert.strictEqual(data.get("owner:Uco").role, "owner", "not downgraded to helper");
    const spent = data.get(`owner-invite:${body.code}`);
    assert.ok(spent.usedAt, "the redundant redemption spends the code");
    assert.strictEqual(spent.usedBy, "Uco");
    const late = await redeem("Unew", body.code);
    assert.strictEqual(late.status, 410, "it cannot be handed on");
    assert.strictEqual(data.get("owner:Unew") ?? null, null);
    // a helper who redeems another helper code is spent the same way
    await asOwner("Uhelper", "viewer");
    const second = await invite("Uowner", "viewer");
    const again = await redeem("Uhelper", second.body.code);
    assert.deepStrictEqual([again.body.already, again.body.role], [true, "viewer"]);
    assert.ok(data.get(`owner-invite:${second.body.code}`).usedAt);
    assert.strictEqual((await redeem("Unew", second.body.code)).status, 410);
  });

  await tc("TC-07-10", "รายชื่อเจ้าของ/ผู้ช่วย: เจ้าของคนแรกเห็น userId; เจ้าของร่วมไม่เห็น; ผู้ช่วย/ผู้เช่า 403; ไม่ปนรหัสเชิญ", async () => {
    await asOwner("Uco", "owner");
    await asOwner("Uhelper", "viewer");
    await invite("Uowner", "viewer"); // leaves an owner-invite:<code> key behind
    let r = await call(owner, { method: "GET", user: "Uowner" });
    assert.strictEqual(r.body.root, true);
    assert.deepStrictEqual(r.body.members.map((m) => m.userId).sort(), ["Uco", "Uhelper", "Uowner"]);
    assert.strictEqual(r.body.members.find((m) => m.userId === "Uowner").root, true);
    r = await call(owner, { method: "GET", user: "Uco" });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.members.every((m) => m.userId === undefined), "an invited owner does not see LINE userIds");
    assert.strictEqual(r.body.members.filter((m) => m.you).length, 1);
    assert.strictEqual((await call(owner, { method: "GET", user: "Uhelper" })).status, 403);
    bindDirect("Utenant", "201");
    assert.strictEqual((await call(owner, { method: "GET", user: "Utenant" })).status, 403);
  });

  await tc("TC-07-11", "เจ้าของคนแรกถอนสิทธิ์: สิทธิ์หาย เมนูกลับค่าเริ่มต้น แจ้งผู้ถูกถอน และเข้าหน้าเจ้าของไม่ได้อีก", async () => {
    await asOwner("Uhelper", "viewer");
    data.set("menu:Uhelper", "richmenu-owner");
    const r = await call(owner, { method: "DELETE", user: "Uowner", body: { userId: "Uhelper" } });
    assert.deepStrictEqual([r.status, r.body.removed], [200, "viewer"]);
    assert.strictEqual(data.get("owner:Uhelper"), null);
    assert.strictEqual(data.get("menu:Uhelper"), null);
    assert.ok(unlinked.includes("Uhelper"), "back to the tenant menu");
    assert.ok(lastTo("Uhelper"), "told");
    assert.strictEqual((await call(rooms, { method: "GET", user: "Uhelper" })).status, 403);
    const again = await call(owner, { method: "DELETE", user: "Uowner", body: { userId: "Uhelper" } });
    assert.strictEqual(again.status, 404, "removing twice is a clean 404");
  });

  await tc("TC-07-12", "ถอนสิทธิ์: ไม่ใช่ root 403; ถอน root 409; userId รูปแบบผิด 400", async () => {
    await asOwner("Uco", "owner");
    await asOwner("Uhelper", "viewer");
    assert.strictEqual((await call(owner, { method: "DELETE", user: "Uco", body: { userId: "Uhelper" } })).status, 403);
    assert.strictEqual(data.get("owner:Uhelper").role, "viewer");
    assert.strictEqual((await call(owner, { method: "DELETE", user: "Uowner", body: { userId: "Uowner" } })).status, 409);
    for (const userId of ["", "abc", "U bad", undefined]) {
      assert.strictEqual((await call(owner, { method: "DELETE", user: "Uowner", body: { userId } })).status, 400, String(userId));
    }
  });

  await tc("TC-07-13", "รหัสเชิญที่คนมีสิทธิ์สร้างไว้ ใช้ไม่ได้อีกเมื่อคนนั้นถูกถอนสิทธิ์", async () => {
    await asOwner("Uco", "owner");
    const { body } = await invite("Uco", "viewer");
    await call(owner, { method: "DELETE", user: "Uowner", body: { userId: "Uco" } });
    const r = await redeem("Unew", body.code);
    assert.strictEqual(r.status, 410);
    assert.strictEqual(data.get("owner:Unew") ?? null, null);
  });

  await tc("TC-07-14", "/api/me บอกบทบาทถูก: เจ้าของคนแรก (root) · ผู้ช่วย · ผู้เช่า (พร้อมห้อง) · คนทั่วไป", async () => {
    await asOwner("Uhelper", "viewer");
    bindDirect("Utenant", "201");
    const get = (u) => call(me, { method: "GET", user: u });
    let r = await get("Uowner");
    assert.deepStrictEqual([r.body.role, r.body.owner, r.body.root, r.body.room], ["owner", true, true, null]);
    assert.ok(menuLinks.some((m) => m.user === "Uowner" && m.menu === "richmenu-owner"), "the first owner gets the owner menu on first open");
    r = await get("Uhelper");
    assert.deepStrictEqual([r.body.role, r.body.owner, r.body.root], ["viewer", false, false]);
    r = await get("Utenant");
    assert.deepStrictEqual([r.body.role, r.body.owner, r.body.room], [null, false, "201"]);
    r = await get("Unobody");
    assert.deepStrictEqual([r.body.role, r.body.room], [null, null]);
    assert.strictEqual((await call(me, { method: "GET" })).status, 401);
  });

  // ================================================================ UC-08 เปลี่ยนผู้เช่า / หมุน QR ห้อง
  await tc("TC-08-1", "เจ้าของขอ QR ห้อง: ได้รหัส 10 ตัว + ลิงก์ LIFF + SVG; เรียกซ้ำได้รหัสเดิม ไม่ปลดใคร", async () => {
    bindDirect("Utenant", "203");
    const a = await call(qr, { method: "GET", query: { room: "203" }, user: "Uowner" });
    assert.strictEqual(a.status, 200);
    assert.match(a.body.code, /^[A-HJKMNP-Z2-9]{10}$/);
    assert.strictEqual(a.body.url, `https://liff.line.me/2000000000-testliff?bind=${a.body.code}`);
    assert.ok(a.body.qr);
    assert.deepStrictEqual([a.body.rotated, a.body.unbound], [false, false]);
    const b = await call(qr, { method: "GET", query: { room: "203" }, user: "Uowner" });
    assert.strictEqual(b.body.code, a.body.code);
    assert.strictEqual(data.get("room-user:203"), "Utenant");
  });

  await tc("TC-08-2", "เปลี่ยนผู้เช่า (POST): รหัสใหม่ QR เก่าตาย ผู้เช่าเดิมถูกปลดสองทาง บิลเดิมอ่านไม่ได้อีก", async () => {
    let r = await call(qr, { method: "GET", query: { room: "203" }, user: "Uowner" });
    const oldCode = r.body.code;
    await call(qr, { body: { code: oldCode }, user: "Ualice" });
    await issue([{ room: "203", water: 1, elec: 1 }]);
    assert.strictEqual((await call(bill, { method: "GET", user: "Ualice" })).status, 200);

    r = await call(qr, { method: "POST", query: { room: "203" }, user: "Uowner" });
    assert.deepStrictEqual([r.body.rotated, r.body.unbound], [true, true]);
    assert.notStrictEqual(r.body.code, oldCode);
    assert.strictEqual(data.get("room-user:203"), null);
    assert.strictEqual(data.get("user-room:Ualice"), null);
    assert.strictEqual(data.get(`qr-code:${oldCode}`), null);
    assert.strictEqual((await call(qr, { body: { code: oldCode }, user: "Ubob" })).status, 404, "the old sticker is dead");
    assert.strictEqual((await call(bill, { method: "GET", user: "Ualice" })).status, 400, "Alice is bound to nothing now");
    assert.strictEqual((await call(bill, { method: "GET", query: { room: "203" }, user: "Ualice" })).status, 403);
  });

  await tc("TC-08-3", "หลังเปลี่ยนผู้เช่า ผู้เช่าใหม่ผูกด้วยรหัสใหม่ได้ และเจ้าของได้รับแจ้ง", async () => {
    bindDirect("Ualice", "203");
    const r = await call(qr, { method: "POST", query: { room: "203" }, user: "Uowner" });
    const bound = await call(qr, { body: { code: r.body.code }, user: "Ubob" });
    assert.strictEqual(bound.status, 200);
    assert.strictEqual(data.get("room-user:203"), "Ubob");
    assert.ok(JSON.stringify(lastTo("Uowner").messages).includes("203"));
  });

  await tc("TC-08-4", "หมุน QR ห้องว่าง: ได้รหัสใหม่ unbound=false", async () => {
    const first = await call(qr, { method: "GET", query: { room: "204" }, user: "Uowner" });
    const r = await call(qr, { method: "POST", query: { room: "204" }, user: "Uowner" });
    assert.deepStrictEqual([r.body.rotated, r.body.unbound], [true, false]);
    assert.notStrictEqual(r.body.code, first.body.code);
  });

  await tc("TC-08-5", "เฉพาะเจ้าของ: ผู้เช่า/ผู้ช่วย 403 (GET และ POST); ไม่ล็อกอิน 401; ห้องที่ไม่มี 404; method อื่น 405", async () => {
    await asOwner("Uhelper", "viewer");
    bindDirect("Utenant", "203");
    for (const method of ["GET", "POST"]) {
      assert.strictEqual((await call(qr, { method, query: { room: "203" }, user: "Utenant" })).status, 403);
      assert.strictEqual((await call(qr, { method, query: { room: "203" }, user: "Uhelper" })).status, 403);
      assert.strictEqual((await call(qr, { method, query: { room: "203" } })).status, 401);
    }
    assert.strictEqual(data.get("room-user:203"), "Utenant", "a refused POST unbinds nobody");
    assert.strictEqual((await call(qr, { method: "POST", query: { room: "999" }, user: "Uowner" })).status, 404);
    assert.strictEqual((await call(qr, { method: "DELETE", query: { room: "203" }, user: "Uowner" })).status, 405);
    assert.strictEqual(data.get("room-user:203"), "Utenant");
  });

  // ================================================================ UC-08 (ต่อ) ผู้เช่าใหม่ไม่เห็นบิลของผู้เช่าเก่า
  const tick = () => new Promise((r) => setTimeout(r, 4)); // issuedAt >= since compares ISO times
  const bindViaQr = async (user, room) => {
    const { body } = await call(qr, { method: "GET", query: { room }, user: "Uowner" });
    const r = await call(qr, { body: { code: body.code }, user });
    assert.strictEqual(r.status, 200, `${user} binds ${room}`);
  };
  const rotate = async (room) => { await tick(); const r = await call(qr, { method: "POST", query: { room }, user: "Uowner" }); await tick(); return r; };
  const nothingOld = async (user, room) => {
    assert.strictEqual((await call(bill, { method: "GET", user })).status, 404);
    assert.strictEqual((await call(bill, { method: "GET", user, query: { period: "2026-11" } })).status, 404);
    const h = await call(bill, { method: "GET", user, query: { history: "1" } });
    assert.deepStrictEqual(h.body.items, []);
    assert.strictEqual((await call(slipImage, { method: "GET", query: { room }, user })).status, 404);
  };

  await tc("TC-08-6", "ทั้งเส้นทาง: ผู้เช่าเก่ามีบิล+สลิป → เจ้าของเปลี่ยนผู้เช่า → ผู้เช่าใหม่ผูก → ไม่เห็นของเก่าเลย → ออกบิลใหม่ → เห็นเฉพาะบิลใหม่", async () => {
    await bindViaQr("Ualice", "203");
    await issue([{ room: "203", water: 1, elec: 1 }]);
    await sendSlip("Ualice");
    assert.strictEqual((await call(bill, { method: "GET", user: "Ualice" })).body.status, "pending");
    await rotate("203");
    await bindViaQr("Ubob", "203");
    const latest = await call(bill, { method: "GET", user: "Ubob" });
    assert.deepStrictEqual([latest.status, latest.body.error.code], [404, "NOT_FOUND"]);
    await nothingOld("Ubob", "203");
    // the owner issues Bob's first bill
    await issue([{ room: "203", water: 2, elec: 2 }], { period: "2026-12", due: "2026-12-16" });
    const mine = await call(bill, { method: "GET", user: "Ubob" });
    assert.deepStrictEqual([mine.status, mine.body.period, mine.body.status], [200, "2026-12", "unpaid"]);
    const h = await call(bill, { method: "GET", user: "Ubob", query: { history: "1" } });
    assert.deepStrictEqual(h.body.items.map((i) => i.period), ["2026-12"]);
    assert.strictEqual((await call(bill, { method: "GET", user: "Ubob", query: { period: "2026-11" } })).status, 404, "November stays Alice's");
  });

  await tc("TC-08-7", "เจ้าของและผู้ช่วยยังเห็นบิล ประวัติ และสลิปของผู้เช่าเก่าครบ", async () => {
    await bindViaQr("Ualice", "203");
    await issue([{ room: "203", water: 1, elec: 1 }]);
    await sendSlip("Ualice");
    await asOwner("Uhelper", "viewer");
    await rotate("203");
    await bindViaQr("Ubob", "203");
    for (const u of ["Uowner", "Uhelper"]) {
      const b = await call(bill, { method: "GET", user: u, query: { room: "203" } });
      assert.deepStrictEqual([b.status, b.body.period, b.body.status], [200, "2026-11", "pending"], u);
      assert.strictEqual((await call(bill, { method: "GET", user: u, query: { room: "203", period: "2026-11" } })).status, 200);
      assert.strictEqual((await call(bill, { method: "GET", user: u, query: { room: "203", history: "1" } })).body.items.length, 1);
      assert.strictEqual((await call(slipImage, { method: "GET", query: { room: "203" }, user: u })).status, 200);
    }
  });

  await tc("TC-08-8", "ผู้เช่าใหม่แนบสลิป ขณะบิลล่าสุดเป็นของผู้เช่าเก่า → เข้าทางโอนล่วงหน้า ไม่แตะบิลเก่า", async () => {
    await bindViaQr("Ualice", "203");
    await issue([{ room: "203", water: 1, elec: 1 }]); // Alice never paid: unpaid
    await rotate("203");
    await bindViaQr("Ubob", "203");
    const before = JSON.stringify(data.get("bill:2026-11:203"));
    const r = await sendSlip("Ubob");
    assert.deepStrictEqual([r.status, r.body.status], [200, "advance"]);
    assert.strictEqual(JSON.stringify(data.get("bill:2026-11:203")), before, "Alice's bill is untouched");
    assert.strictEqual(data.get("bill:203").status, "unpaid");
    assert.strictEqual(prepayOf("203").by, "Ubob");
    const b = await call(bill, { method: "GET", user: "Ubob" });
    assert.strictEqual(b.body.error.advance.hasSlip, true);
  });

  await tc("TC-08-9", "พิมพ์ \"บิล\" ในแชท: ผู้เช่าใหม่ได้ \"ยังไม่มีบิล\" ไม่ใช่การ์ดบิลของคนเก่า", async () => {
    await bindViaQr("Ualice", "203");
    await issue([{ room: "203", water: 1, elec: 1 }]);
    await say("Ualice", "บิล");
    assert.strictEqual(replies.pop().messages[0].type, "flex", "Alice still gets her card");
    await rotate("203");
    await bindViaQr("Ubob", "203");
    await say("Ubob", "บิล");
    const m = replies.pop().messages[0];
    assert.strictEqual(m.type, "text");
    assert.ok(m.text.includes("ยังไม่มีบิล"));
  });

  await tc("TC-08-10", "เจ้าของยืนยันบิลของผู้เช่าเก่าหลังเปลี่ยนผู้เช่า: บิลเป็น paid แต่ไม่ส่งข้อความ \"ชำระเงินแล้ว\" หาผู้เช่าใหม่", async () => {
    await bindViaQr("Ualice", "203");
    await issue([{ room: "203", water: 1, elec: 1 }]);
    await sendSlip("Ualice");
    await rotate("203");
    await bindViaQr("Ubob", "203");
    pushed.length = 0;
    await tap("Uowner", "action=confirm&room=203&period=2026-11");
    assert.strictEqual(data.get("bill:2026-11:203").status, "paid");
    assert.strictEqual(pushed.filter((p) => p.to === "Ubob").length, 0);
    assert.ok(JSON.stringify(replies.pop().messages).includes("ยืนยันห้อง 203"), "the owner still gets the acknowledgement");
  });

  await tc("TC-08-11", "สลิปโอนล่วงหน้าของผู้เช่าเก่าถูกเก็บเข้า prepay-old แจ้งเจ้าของ และไม่ติดบิลของผู้เช่าใหม่", async () => {
    await bindViaQr("Ualice", "203");
    await sendSlip("Ualice", { note: "โอนล่วงหน้า" });
    const old = prepayOf("203");
    pushed.length = 0;
    const r = await rotate("203");
    assert.strictEqual(r.body.prepayArchived, true);
    assert.strictEqual(prepayOf("203"), null);
    assert.deepStrictEqual(data.get(`prepay-old:203:${old.slipAt}`), old);
    assert.ok(files.has(old.slipPath), "the photo is kept");
    assert.ok(JSON.stringify(lastTo("Uowner").messages).includes("สลิปโอนล่วงหน้าค้างอยู่"));
    await bindViaQr("Ubob", "203");
    assert.strictEqual((await call(bill, { method: "GET", user: "Ubob" })).body.error.advance, null);
    const run1 = await issue([{ room: "203", water: 1, elec: 1 }]);
    assert.strictEqual(run1.body.rooms[0].prepaid, undefined);
    assert.strictEqual(data.get("bill:2026-11:203").status, "unpaid", "Bob's bill does not carry Alice's slip");
    const again = await rotate("203");
    assert.strictEqual(again.body.prepayArchived, undefined, "nothing to archive the second time");
  });

  await tc("TC-08-12", "ผู้เช่าย้ายออกด้วย confirmMove: ห้องที่ย้ายออกเริ่มสัญญาใหม่ (บิลเก่าถูกซ่อน); การผูกห้องเฉย ๆ ไม่เขียน tenancy", async () => {
    await bindViaQr("Ubob", "203");
    assert.strictEqual(data.get("tenancy:203") ?? null, null, "binding writes no tenancy");
    await issue([{ room: "203", water: 1, elec: 1 }]);
    await tick();
    data.set("qr-code:CODE204", "204");
    const r = await call(qr, { body: { code: "CODE204", confirmMove: true }, user: "Ubob" });
    assert.strictEqual(r.status, 200);
    assert.ok(data.get("tenancy:203").since);
    assert.strictEqual(data.get("tenancy:204") ?? null, null, "the room moved into is not reset");
    await tick();
    await bindViaQr("Ucarol", "203");
    await nothingOld("Ucarol", "203");
  });

  await tc("TC-08-13", "เปลี่ยนผู้เช่าห้องว่างก็เริ่มสัญญาใหม่; บิลที่ไม่มี issuedAt (ระบบเก่า) ถูกซ่อนจากผู้เช่าหลังมี tenancy", async () => {
    putBill(mkBill("203", "2026-11", "unpaid")); // no issuedAt
    const r = await rotate("203");
    assert.deepStrictEqual([r.body.rotated, r.body.unbound], [true, false]);
    assert.ok(data.get("tenancy:203").since, "written even with nobody bound");
    await bindViaQr("Ubob", "203");
    await nothingOld("Ubob", "203");
    const owner1 = await call(bill, { method: "GET", user: "Uowner", query: { room: "203" } });
    assert.strictEqual(owner1.status, 200);
  });

  await tc("TC-08-14", "ห้องที่ยังไม่เคยเปลี่ยนผู้เช่า (ไม่มี tenancy) ผู้เช่าเดิมยังเห็นบิลเก่าทั้งหมดแม้ไม่มี issuedAt", async () => {
    bindDirect("Utenant", "203");
    putBill(mkBill("203", "2026-10", "paid", { paidAt: ago(99999) }));
    putBill(mkBill("203", "2026-11", "unpaid"));
    data.set("bills:203", ["2026-11", "2026-10"]);
    assert.strictEqual((await call(bill, { method: "GET", user: "Utenant" })).status, 200);
    assert.strictEqual((await call(bill, { method: "GET", user: "Utenant", query: { period: "2026-10" } })).status, 200);
    const h = await call(bill, { method: "GET", user: "Utenant", query: { history: "1" } });
    assert.deepStrictEqual(h.body.items.map((i) => i.period), ["2026-11", "2026-10"]);
    await say("Utenant", "บิล");
    assert.strictEqual(replies.pop().messages[0].type, "flex");
  });

  await tc("TC-08-15", "บิลที่ออกใหม่ทุกใบมี issuedAt (เวลาออกบิล)", async () => {
    const before = Date.now();
    await issue([{ room: "203", water: 1, elec: 1 }]);
    const t = new Date(data.get("bill:2026-11:203").issuedAt).getTime();
    assert.ok(t >= before - 1 && t <= Date.now() + 1);
  });

  // ================================================================ UC-09 ผูกบัญชี LINE กับห้อง
  await tc("TC-09-1", "ผู้เช่าสแกน QR: ผูกห้องสองทาง ได้เมนูผู้เช่า เจ้าของได้รับแจ้ง /api/me เห็นห้อง", async () => {
    const { body } = await call(qr, { method: "GET", query: { room: "203" }, user: "Uowner" });
    const r = await call(qr, { body: { code: body.code.toLowerCase() + "  " }, user: "Ualice" });
    assert.deepStrictEqual([r.status, r.body.room, r.body.previous], [200, "203", null]);
    assert.strictEqual(data.get("user-room:Ualice"), "203");
    assert.strictEqual(data.get("room-user:203"), "Ualice");
    assert.ok(menuLinks.some((m) => m.user === "Ualice" && m.menu === "richmenu-tenant"));
    assert.ok(JSON.stringify(lastTo("Uowner").messages).includes("203"));
    const who = await call(me, { method: "GET", user: "Ualice" });
    assert.deepStrictEqual([who.body.role, who.body.room], [null, "203"]);
  });

  await tc("TC-09-2", "รหัส QR ที่ไม่มีจริง → 404 และไม่ผูกอะไร", async () => {
    const r = await call(qr, { body: { code: "NOPE" }, user: "Ualice" });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(data.get("user-room:Ualice") ?? null, null);
  });

  await tc("TC-09-3", "เดารหัสผิดครบ 10 ครั้ง → 429 (ผูกไม่ได้ชั่วโมงนั้น แม้รหัสถูก)", async () => {
    data.set("qr-code:CODE203", "203");
    for (let i = 0; i < MAX_FAILURES; i++) assert.strictEqual((await call(qr, { body: { code: `BAD${i}` }, user: "Uguess" })).status, 404);
    const r = await call(qr, { body: { code: "CODE203" }, user: "Uguess" });
    assert.strictEqual(r.status, 429);
    assert.strictEqual(data.get("room-user:203") ?? null, null);
  });

  await tc("TC-09-4", "ห้องมีผู้เช่าแล้ว → 409 ROOM_TAKEN คนเดิมไม่เสียห้อง และไม่นับเป็นเดารหัสผิด", async () => {
    data.set("qr-code:CODE203", "203");
    bindDirect("Ualice", "203");
    for (let i = 0; i < MAX_FAILURES + 2; i++) {
      const r = await call(qr, { body: { code: "CODE203" }, user: "Umallory" });
      assert.deepStrictEqual([r.status, r.body.error.code], [409, "ROOM_TAKEN"]);
    }
    assert.strictEqual(data.get("room-user:203"), "Ualice");
    assert.strictEqual(data.get("user-room:Umallory") ?? null, null);
    data.set("qr-code:FREE204", "204");
    assert.strictEqual((await call(qr, { body: { code: "FREE204" }, user: "Umallory" })).status, 200, "not locked out of a free room");
  });

  await tc("TC-09-5", "สแกนห้องตัวเองซ้ำ → 200 และไม่ส่งแจ้งเจ้าของซ้ำ", async () => {
    data.set("qr-code:CODE203", "203");
    await call(qr, { body: { code: "CODE203" }, user: "Ualice" });
    const n = pushed.length;
    const r = await call(qr, { body: { code: "CODE203" }, user: "Ualice" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(pushed.length, n);
  });

  await tc("TC-09-6", "คนที่ผูกห้องอื่นอยู่แล้ว ต้องยืนยันก่อนย้าย (409 MOVE_CONFIRM_REQUIRED); ยืนยันแล้วห้องเดิมว่าง", async () => {
    data.set("qr-code:CODE204", "204");
    bindDirect("Ubob", "203");
    let r = await call(qr, { body: { code: "CODE204" }, user: "Ubob" });
    assert.deepStrictEqual([r.status, r.body.error.code, r.body.error.current], [409, "MOVE_CONFIRM_REQUIRED", "203"]);
    assert.strictEqual(data.get("user-room:Ubob"), "203", "nothing moved yet");
    r = await call(qr, { body: { code: "CODE204", confirmMove: true }, user: "Ubob" });
    assert.deepStrictEqual([r.status, r.body.previous], [200, "203"]);
    assert.strictEqual(data.get("room-user:203"), null);
    assert.strictEqual(data.get("room-user:204"), "Ubob");
    assert.ok(JSON.stringify(lastTo("Uowner").messages).includes("ย้ายจากห้อง 203"));
  });

  await tc("TC-09-7", "confirmMove ต้องเป็น true จริง (สตริง 'true' ไม่ผ่าน)", async () => {
    data.set("qr-code:CODE204", "204");
    bindDirect("Ubob", "203");
    const r = await call(qr, { body: { code: "CODE204", confirmMove: "true" }, user: "Ubob" });
    assert.strictEqual(r.status, 409);
  });

  await tc("TC-09-8", "ตั้งเมนู LINE ล้มเหลว การผูกห้องยังสำเร็จ", async () => {
    data.set("qr-code:CODE203", "203");
    failRichMenu = true;
    const r = await call(qr, { body: { code: "CODE203" }, user: "Ualice" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(data.get("room-user:203"), "Ualice");
  });

  await tc("TC-09-9", "คำขอไม่ครบ/ผิดวิธี: ไม่มี room และ code → 400; GET พร้อม code ไม่ได้ → ไม่ผูก; ไม่ล็อกอิน 401", async () => {
    assert.strictEqual((await call(qr, { user: "Ualice", body: {} })).status, 400);
    data.set("qr-code:CODE203", "203");
    // a code arrives only in the body, which a GET does not carry
    assert.strictEqual((await call(qr, { method: "GET", user: "Ualice", body: { code: "CODE203" } })).status, 405);
    assert.strictEqual(data.get("room-user:203") ?? null, null);
    assert.strictEqual((await call(qr, { body: { code: "CODE203" } })).status, 401);
  });

  await tc("TC-09-10", "คนที่ add OA (follow) ได้ข้อความต้อนรับ; พิมพ์ 'บิล' ก่อนผูกห้องได้คำแนะนำให้สแกน QR", async () => {
    await webhook(hook, [{ type: "follow", replyToken: "r", source: { userId: "Ualice" } }]);
    assert.ok(data.get("user:Ualice"));
    assert.ok(JSON.stringify(replies.pop().messages).includes("สแกน QR"));
    await say("Ualice", "บิล");
    assert.ok(JSON.stringify(replies.pop().messages).includes("ยังไม่ได้ผูกห้อง"));
  });

  // ================================================================ UC-10 ดูบิล
  await tc("TC-10-1", "ผู้เช่าอ่านบิลล่าสุดของห้องตัวเอง (ไม่ต้องระบุห้อง) พร้อมรายการค่าเช่า/น้ำ/ไฟ", async () => {
    bindDirect("Utenant", "201");
    await issue([{ room: "201", water: 10, elec: 100 }]);
    const r = await call(bill, { method: "GET", user: "Utenant" });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(
      [r.body.room, r.body.period, r.body.rent, r.body.water, r.body.elec, r.body.total, r.body.status, r.body.due, r.body.hasSlip],
      ["201", "2026-11", 3500, 250, 700, 4450, "unpaid", "2026-11-16", false]
    );
    assert.strictEqual(r.headers["Cache-Control"], "no-store");
  });

  await tc("TC-10-2", "อ่านบิลตามงวด (period=YYYY-MM)", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-10", "paid", { total: 4000 }));
    putBill(mkBill("201", "2026-11", "unpaid"));
    const r = await call(bill, { method: "GET", query: { period: "2026-10" }, user: "Utenant" });
    assert.deepStrictEqual([r.status, r.body.period, r.body.total], [200, "2026-10", 4000]);
  });

  await tc("TC-10-3", "ประวัติบิล (history=1): ทุกงวดเรียงใหม่→เก่า พร้อม total/status/due/hasSlip/receiptNo", async () => {
    bindDirect("Utenant", "201");
    await issue([{ room: "201", water: 1, elec: 1 }], { period: "2026-10", due: "2026-10-16" });
    await issue([{ room: "201", water: 2, elec: 2 }], { period: "2026-11", due: "2026-11-16" });
    const r = await call(bill, { method: "GET", query: { history: "1" }, user: "Utenant" });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.items.map((i) => i.period), ["2026-11", "2026-10"]);
    assert.deepStrictEqual(Object.keys(r.body.items[0]).sort(), ["due", "hasSlip", "period", "receiptNo", "status", "total"]);
    assert.deepStrictEqual(r.body.items.map((i) => i.receiptNo), [null, null], "unpaid bills have no receipt number");
    data.set("bill:2026-10:201", { ...data.get("bill:2026-10:201"), status: "paid", receiptNo: "R202610-201" });
    const paid = await call(bill, { method: "GET", query: { history: "1" }, user: "Utenant" });
    assert.deepStrictEqual(paid.body.items.map((i) => i.receiptNo), [null, "R202610-201"]);
  });

  await tc("TC-10-4", "ประวัติของห้องที่มีแค่ bill:<room> (ระบบเก่า ไม่มีดัชนี) ยังไม่ว่าง", async () => {
    bindDirect("Utenant", "201");
    data.set("bill:201", mkBill("201", "2026-11", "unpaid"));
    const r = await call(bill, { method: "GET", query: { history: "1" }, user: "Utenant" });
    assert.deepStrictEqual(r.body.items.map((i) => i.period), ["2026-11"]);
  });

  await tc("TC-10-5", "ผู้เช่าอ่านบิลห้องอื่นไม่ได้ (403) แม้ระบุ room/period/history เอง", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("202", "2026-11", "unpaid"));
    for (const query of [{ room: "202" }, { room: "202", period: "2026-11" }, { room: "202", history: "1" }]) {
      assert.strictEqual((await call(bill, { method: "GET", query, user: "Utenant" })).status, 403, JSON.stringify(query));
    }
  });

  await tc("TC-10-6", "ยังไม่ผูกห้องและไม่ระบุ room → 400; ผูกแล้วแต่ยังไม่มีบิล → 404; ไม่ล็อกอิน → 401", async () => {
    assert.strictEqual((await call(bill, { method: "GET", user: "Unobody" })).status, 400);
    bindDirect("Utenant", "201");
    const r = await call(bill, { method: "GET", user: "Utenant" });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.error.code, "NOT_FOUND");
    assert.strictEqual((await call(bill, { method: "GET" })).status, 401);
  });

  await tc("TC-10-7", "period รูปแบบผิด → 400; period ที่ไม่มีบิล → 404", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "unpaid"));
    assert.strictEqual((await call(bill, { method: "GET", query: { period: "2026-1" }, user: "Utenant" })).status, 400);
    assert.strictEqual((await call(bill, { method: "GET", query: { period: "2025-01" }, user: "Utenant" })).status, 404);
  });

  await tc("TC-10-8", "เจ้าของและผู้ช่วยอ่านบิลห้องใดก็ได้ (ต้องระบุ room)", async () => {
    await asOwner("Uhelper", "viewer");
    putBill(mkBill("202", "2026-11", "unpaid"));
    for (const u of ["Uowner", "Uhelper"]) {
      const r = await call(bill, { method: "GET", query: { room: "202" }, user: u });
      assert.deepStrictEqual([r.status, r.body.room], [200, "202"]);
    }
    assert.strictEqual((await call(bill, { method: "GET", user: "Uowner" })).status, 400, "an owner with no room named has nothing to show");
  });

  await tc("TC-10-9", "พิมพ์ 'บิล' / 'bill' ในแชท → ได้การ์ดบิลล่าสุดของห้องที่ผูก; ผูกแล้วไม่มีบิล → แจ้งว่ายังไม่มี", async () => {
    bindDirect("Utenant", "201");
    await say("Utenant", "บิล");
    assert.ok(JSON.stringify(replies.pop().messages).includes("ห้อง 201 ยังไม่มีบิล"));
    putBill(mkBill("201", "2026-11", "unpaid"));
    await say("Utenant", "  Bill ");
    const card = replies.pop().messages[0];
    assert.strictEqual(card.type, "flex");
    assert.ok(card.altText.includes("4,450"));
  });

  // ================================================================ UC-11 แจ้งชำระ (แนบสลิป)
  await tc("TC-11-1", "ผู้เช่าแนบสลิป: บิลเป็น pending เก็บรูป เจ้าของได้การ์ดยืนยันที่ผูกกับงวดนั้น", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "unpaid"));
    const r = await sendSlip("Utenant", { note: "โอนแล้ว" });
    assert.deepStrictEqual([r.status, r.body.ok, r.body.status, r.body.hasSlip, r.body.total], [200, true, "pending", true, 4450]);
    const b = data.get("bill:2026-11:201");
    assert.strictEqual(b.status, "pending");
    assert.strictEqual(b.slipNote, "โอนแล้ว");
    assert.strictEqual(b.slipCount, 1);
    assert.ok(files.has(b.slipPath), "the photo is in the file store");
    assert.deepStrictEqual(data.get("bill:201"), b, "both copies agree");
    const card = JSON.stringify(lastTo("Uowner").messages[0]);
    assert.ok(card.includes("action=confirm&room=201&period=2026-11"));
  });

  await tc("TC-11-2", "แจ้งชำระโดยไม่แนบรูป: ผู้เช่า 400 ต้องแนบรูปสลิป (ทุกเส้นทาง บิลไม่เปลี่ยน) · เจ้าของบันทึกโดยไม่มีรูปได้ → pending, hasSlip=false", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "unpaid"));
    const before = JSON.stringify([...data.entries()]);
    for (const body of [{ note: "โอนผ่านพร้อมเพย์" }, {}, { periods: ["2026-11"], note: "x" }]) {
      const r = await call(slip, { user: "Utenant", body });
      assert.deepStrictEqual([r.status, r.body.error.code, r.body.error.message], [400, "VALIDATION", "ต้องแนบรูปสลิป"]);
    }
    assert.strictEqual(JSON.stringify([...data.entries()]), before, "a refused slip writes nothing");
    assert.strictEqual(pushed.length, 0, "and costs no LINE message");
    // Product decision: the photo is required for the FIRST slip. A bill that is pending but has no
    // photo (the owner recorded cash) has no slip to update, so a tenant's note-only is refused too.
    putBill(mkBill("202", "2026-11", "pending", { slipPath: null, slipAt: ago(60000), slipCount: 1 }));
    bindDirect("Utenant2", "202");
    const bare = await call(slip, { user: "Utenant2", body: { note: "ส่งแล้ว" } });
    assert.deepStrictEqual([bare.status, bare.body.error.message], [400, "ต้องแนบรูปสลิป"]);
    // Cash or a transfer seen in the bank app: the owner can still record it without a photo.
    const o = await call(slip, { user: "Uowner", body: { room: "201", note: "เงินสด" } });
    assert.deepStrictEqual([o.status, o.body.status, o.body.hasSlip], [200, "pending", false]);
    assert.strictEqual(data.get("bill:2026-11:201").slipPath, null);
  });

  await tc("TC-11-17", "แก้หมายเหตุบนสลิปที่ส่งแล้วโดยไม่แนบรูปใหม่: pending ที่มีรูปแล้ว → 200 รูปและผลตรวจเดิมอยู่ครบ (บิลเดียวและ prepay) · สลิปที่ยังไม่มีรูป/หลายงวด ยังต้องแนบรูป", async () => {
    withSlipok();
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "unpaid"));
    slipok = okSlip(5000, "REF-NOTE", new Date().toISOString()); // 550 over the bill: the facts must survive
    assert.strictEqual((await sendSlip("Utenant", { note: "ครั้งแรก" })).status, 200);
    const first = data.get("bill:2026-11:201");
    assert.ok(first.slipPath && first.slipVerify && first.overpaid === 550);
    // only the gap rule stands in the way, not the photo rule
    putBill({ ...first, slipAt: ago(60000) });
    slipokCalls.length = 0;
    pushed.length = 0;
    const r = await call(slip, { user: "Utenant", body: { note: "แก้หมายเหตุ: โอนจากบัญชีแม่" } });
    assert.deepStrictEqual([r.status, r.body.status, r.body.hasSlip], [200, "pending", true]);
    const b = data.get("bill:2026-11:201");
    assert.deepStrictEqual([b.slipPath, b.slipNote, b.slipCount], [first.slipPath, "แก้หมายเหตุ: โอนจากบัญชีแม่", 2]);
    assert.deepStrictEqual(b.slipVerify, first.slipVerify, "the check of the photo is kept");
    assert.deepStrictEqual([b.slipAmount, b.overpaid], [5000, 550], "and so are the amount facts");
    assert.ok(files.has(first.slipPath), "the photo is not deleted");
    assert.strictEqual(slipokCalls.length, 0, "no new photo, no new provider check");
    assert.deepStrictEqual(data.get("bill:201"), b, "both copies agree");
    assert.strictEqual(ownerCards().length, 1, "the owner is told about the updated slip");

    // an advance slip already sent (prepay with a photo) can be edited the same way
    bindDirect("Utenant2", "202");
    await sendSlip("Utenant2", { note: "ล่วงหน้า" });
    data.set("prepay:202", { ...prepayOf("202"), slipAt: ago(60000) });
    const adv = await call(slip, { user: "Utenant2", body: { note: "แก้ข้อความ" } });
    assert.deepStrictEqual([adv.status, adv.body.status, adv.body.hasSlip], [200, "advance", true]);
    assert.strictEqual(prepayOf("202").slipNote, "แก้ข้อความ");

    // a bill that is part of a multi-period slip is not edited one by one; the group needs a photo
    bindDirect("Utenant3", "203");
    putBill(mkBill("203", "2026-10", "unpaid"));
    putBill(mkBill("203", "2026-11", "unpaid"));
    assert.strictEqual((await sendSlip("Utenant3", { periods: ["2026-10", "2026-11"] })).status, 200);
    for (const p of ["2026-10", "2026-11"]) data.set(`bill:${p}:203`, { ...data.get(`bill:${p}:203`), slipAt: ago(60000) });
    data.set("bill:203", data.get("bill:2026-11:203"));
    const g = await call(slip, { user: "Utenant3", body: { note: "x" } });
    assert.deepStrictEqual([g.status, g.body.error.message], [400, "ต้องแนบรูปสลิป"]);
    const gp = await call(slip, { user: "Utenant3", body: { periods: ["2026-10", "2026-11"], note: "x" } });
    assert.deepStrictEqual([gp.status, gp.body.error.message], [400, "ต้องแนบรูปสลิป"]);
  });

  await tc("TC-11-3", "รูปที่ไม่ใช่ JPEG/PNG/WEBP → 400; ใหญ่เกิน 3MB → 413; ไม่เปลี่ยนบิล", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "unpaid"));
    let r = await call(slip, { user: "Utenant", body: { image: "data:image/gif;base64,R0lGOD==" } });
    assert.strictEqual(r.status, 400);
    r = await call(slip, { user: "Utenant", body: { image: "not-a-data-uri" } });
    assert.strictEqual(r.status, 400);
    r = await call(slip, { user: "Utenant", body: { image: `data:image/png;base64,${Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64")}` } });
    assert.strictEqual(r.status, 413);
    assert.strictEqual(data.get("bill:2026-11:201").status, "unpaid");
    assert.strictEqual(files.size, 0);
  });

  await tc("TC-11-4", "หมายเหตุยาวเกิน 500 ตัวอักษร หรือไม่ใช่ข้อความ → 400", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "unpaid"));
    assert.strictEqual((await sendSlip("Utenant", { note: "ก".repeat(501) })).status, 400);
    assert.strictEqual((await sendSlip("Utenant", { note: 123 })).status, 400);
    assert.strictEqual((await sendSlip("Utenant", { note: "ก".repeat(500) })).status, 200);
  });

  await tc("TC-11-5", "แจ้งชำระแทนห้องอื่นไม่ได้ (403); ยังไม่ผูกห้อง → 400; ไม่ล็อกอิน → 401; GET → 405", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("202", "2026-11", "unpaid"));
    assert.strictEqual((await call(slip, { user: "Utenant", body: { room: "202", image: PNG } })).status, 403);
    assert.strictEqual(data.get("bill:2026-11:202").status, "unpaid");
    assert.strictEqual((await call(slip, { user: "Unobody", body: { image: PNG } })).status, 400);
    assert.strictEqual((await call(slip, { body: { image: PNG } })).status, 401);
    assert.strictEqual((await call(slip, { method: "GET", user: "Utenant" })).status, 405);
  });

  await tc("TC-11-6", "ส่งสลิปถี่เกินไป (ภายใน 30 วินาที) → 429 SLIP_TOO_SOON", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "unpaid"));
    assert.strictEqual((await sendSlip("Utenant")).status, 200);
    const r = await sendSlip("Utenant");
    assert.deepStrictEqual([r.status, r.body.error.code], [429, "SLIP_TOO_SOON"]);
    assert.strictEqual(data.get("bill:2026-11:201").slipCount, 1);
  });

  await tc("TC-11-7", "ส่งสลิปบิลเดียวครบ 5 ครั้งแล้ว → 429 SLIP_LIMIT (เจ้าของไม่ถูกจำกัด)", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "unpaid"));
    for (let i = 1; i <= 5; i++) {
      const b = data.get("bill:201");
      data.set("bill:201", { ...b, slipAt: ago(60 * 1000) }); // step past the 30 s gap
      assert.strictEqual((await sendSlip("Utenant")).status, 200, `slip ${i}`);
    }
    data.set("bill:201", { ...data.get("bill:201"), slipAt: ago(60 * 1000) });
    const r = await sendSlip("Utenant");
    assert.deepStrictEqual([r.status, r.body.error.code], [429, "SLIP_LIMIT"]);
    assert.strictEqual(data.get("bill:201").slipCount, 5);
    const o = await call(slip, { user: "Uowner", body: { room: "201", image: PNG } });
    assert.strictEqual(o.status, 200, "the owner can still attach one on a tenant's behalf");
  });

  await tc("TC-11-8", "ส่งสลิปใหม่แทนใบเดิม: รูปเก่าถูกลบ เหลือรูปใหม่", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "unpaid"));
    await sendSlip("Utenant");
    const first = data.get("bill:201").slipPath;
    data.set("bill:201", { ...data.get("bill:201"), slipAt: ago(60 * 1000) });
    await new Promise((r) => setTimeout(r, 3)); // the file name carries Date.now()
    await sendSlip("Utenant");
    const second = data.get("bill:201").slipPath;
    assert.notStrictEqual(first, second);
    assert.ok(!files.has(first) && files.has(second));
    assert.strictEqual(data.get("bill:201").slipCount, 2);
  });

  await tc("TC-11-9", "ส่งการ์ดให้เจ้าของล้มเหลว ผู้เช่ายังแจ้งชำระสำเร็จ", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "unpaid"));
    failPushTo.add("Uowner");
    const r = await sendSlip("Utenant");
    assert.strictEqual(r.status, 200);
    assert.strictEqual(data.get("bill:2026-11:201").status, "pending");
  });

  await tc("TC-11-10", "ดูรูปสลิป: ผู้เช่าเจ้าของห้อง/เจ้าของ/ผู้ช่วยได้ ผู้เช่าห้องอื่น 403 ไม่ล็อกอิน 401; ยังไม่มีสลิป 404", async () => {
    bindDirect("Utenant", "201");
    bindDirect("Uother", "202");
    await asOwner("Uhelper", "viewer");
    putBill(mkBill("201", "2026-11", "unpaid"));
    assert.strictEqual((await call(slipImage, { method: "GET", query: { room: "201" }, user: "Utenant" })).status, 404, "no slip yet");
    await sendSlip("Utenant");
    for (const u of ["Utenant", "Uowner", "Uhelper"]) {
      const r = await call(slipImage, { method: "GET", query: { room: "201" }, user: u });
      assert.strictEqual(r.status, 200, u);
      assert.strictEqual(r.headers["Cache-Control"], "private, no-store");
    }
    assert.strictEqual((await call(slipImage, { method: "GET", query: { room: "201" }, user: "Uother" })).status, 403);
    assert.strictEqual((await call(slipImage, { method: "GET", query: { room: "201" } })).status, 401);
  });

  await tc("TC-11-11", "แจ้งชำระแล้วสถานะที่ผู้เช่าเห็นเป็น pending และประวัติ (history) ตรงกัน", async () => {
    bindDirect("Utenant", "201");
    await issue([{ room: "201", water: 1, elec: 1 }]);
    await sendSlip("Utenant");
    const now = await call(bill, { method: "GET", user: "Utenant" });
    assert.deepStrictEqual([now.body.status, now.body.hasSlip], ["pending", true]);
    const h = await call(bill, { method: "GET", query: { history: "1" }, user: "Utenant" });
    assert.deepStrictEqual([h.body.items[0].status, h.body.items[0].hasSlip], ["pending", true]);
  });

  await tc("TC-11-13", "การ์ดเจ้าของของสลิปที่ไม่มีรูป: ไม่มีปุ่ม \"ดูสลิป\" มีคำเตือนให้ตรวจยอดเงินเข้าเอง (ยังกดยืนยันได้) · สลิปที่มีรูปไม่มีคำเตือน", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "unpaid"));
    await call(slip, { user: "Uowner", body: { room: "201", note: "เงินสด" } });
    const bare = JSON.stringify(lastTo("Uowner").messages[0]);
    assert.ok(bare.includes("ไม่มีรูปสลิป — ตรวจยอดเงินเข้าเองก่อนยืนยัน"), "the warning is on the card");
    assert.ok(!bare.includes("ดูสลิป"), "nothing to look at");
    assert.ok(bare.includes("action=confirm&room=201&period=2026-11"), "the owner can still decide");

    bindDirect("Utenant2", "202");
    putBill(mkBill("202", "2026-11", "unpaid"));
    await sendSlip("Utenant2");
    const photo = JSON.stringify(lastTo("Uowner").messages[0]);
    assert.ok(photo.includes("ดูสลิป") && !photo.includes("ไม่มีรูปสลิป"));
  });

  // ================================================================ UC-12 ตรวจสลิปอัตโนมัติ (นโยบายสลิปเก่า)
  await tc("TC-12-7", "เวลาโอนในสลิปก่อนบิลออก/นานเกินกำหนด: เกิน 30 วัน → ok:null \"สลิปเก่า — โอนเมื่อ N วันก่อน\" (stale) · โอนก่อนบิลออก → ok:null early \"โอนก่อนบิลออก\" (บิลเดียว/กลุ่มเทียบบิลล่าสุด ไม่ใช้กับล่วงหน้า) · ไม่บล็อก · transRef ยังกันสลิปซ้ำ", async () => {
    withSlipok();
    const { markStale } = require("./api/_verify");
    // boundary: exactly 30 days is still fine, a bit more is old; unusable input is left alone
    const base = { ok: true, amount: 1, transRef: "R", paidAt: new Date(1000 * DAY).toISOString(), provider: "slipok" };
    assert.strictEqual(markStale(base, 1030 * DAY), base, "30 days exactly: untouched");
    assert.strictEqual(markStale(base, 1031 * DAY).staleDays, 31);
    assert.strictEqual(markStale({ ...base, ok: false }, 2000 * DAY).stale, undefined, "a failed check is not rewritten");
    assert.strictEqual(markStale({ ...base, paidAt: "garbage" }, 2000 * DAY).ok, true);
    assert.strictEqual(markStale(null, 0), null);

    // single bill
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "unpaid"));
    slipok = okSlip(4450, "REF-OLD", new Date(Date.now() - 45 * DAY - 3600000).toISOString());
    let r = await sendSlip("Utenant");
    assert.strictEqual(r.status, 200, "an old slip is never refused");
    const v = r.body.verify;
    assert.deepStrictEqual(
      [v.ok, v.reason, v.stale, v.staleDays, v.amount, v.transRef, v.bank, !!v.paidAt],
      [null, "สลิปเก่า — โอนเมื่อ 45 วันก่อน", true, 45, 4450, "REF-OLD", "006", true]
    );
    assert.strictEqual(r.body.status, "pending");
    assert.deepStrictEqual(data.get("bill:2026-11:201").slipVerify, v);
    assert.ok(data.get("slip-ref:REF-OLD"), "the reference is remembered before the downgrade");

    // the same old slip on another room is still caught as a reuse
    bindDirect("Utenant2", "202");
    putBill(mkBill("202", "2026-11", "unpaid"));
    r = await sendSlip("Utenant2");
    assert.deepStrictEqual([r.body.verify.ok, r.body.verify.reason], [false, "สลิปนี้ถูกใช้ไปแล้ว (ห้อง 201)"]);

    // a recent slip is untouched
    bindDirect("Utenant3", "203");
    putBill(mkBill("203", "2026-11", "unpaid"));
    slipok = okSlip(4450, "REF-NEW", new Date(Date.now() - 5 * DAY).toISOString());
    r = await sendSlip("Utenant3");
    assert.deepStrictEqual([r.body.verify.ok, r.body.verify.stale], [true, undefined]);

    // several periods at once
    bindDirect("Utenant4", "204");
    putBill(mkBill("204", "2026-10", "unpaid"));
    putBill(mkBill("204", "2026-11", "unpaid"));
    slipok = okSlip(8900, "REF-OLD-G", new Date(Date.now() - 40 * DAY).toISOString());
    r = await sendSlip("Utenant4", { periods: ["2026-10", "2026-11"] });
    assert.deepStrictEqual([r.status, r.body.verify.ok, r.body.verify.stale, r.body.verify.staleDays], [200, null, true, 40]);
    assert.strictEqual(data.get("bill:2026-10:204").status, "pending");

    // an advance slip
    bindDirect("Utenant5", "205");
    slipok = okSlip(4450, "REF-OLD-A", new Date(Date.now() - 31 * DAY).toISOString());
    r = await sendSlip("Utenant5");
    assert.deepStrictEqual([r.body.status, r.body.verify.ok, r.body.verify.stale], ["advance", null, true]);
    assert.strictEqual(prepayOf("205").slipVerify.stale, true);

    // ---- a transfer made BEFORE the bill was issued (flag, never block)
    const { markEarly } = require("./api/_verify");
    const EARLY = "โอนก่อนบิลออก — ตรวจว่าเป็นสลิปของบิลนี้";
    const at = (ms) => new Date(Date.now() + ms).toISOString();
    const HOUR = 3600000;
    const ev = { ok: true, amount: 1, transRef: "R", paidAt: "2026-11-10T00:00:00.000Z", provider: "slipok" };
    assert.strictEqual(markEarly(ev, "2026-11-10T00:00:00.000Z"), ev, "paid at the very moment of issue: not early");
    assert.strictEqual(markEarly(ev, "2026-11-09T00:00:00.000Z"), ev, "paid after issue: untouched");
    assert.strictEqual(markEarly(ev, undefined), ev, "no issuedAt (an old bill): the rule cannot run");
    assert.strictEqual(markEarly({ ...ev, paidAt: null }, "2026-11-11T00:00:00.000Z").early, undefined, "no provider paidAt: cannot run");
    assert.strictEqual(markEarly({ ...ev, paidAt: "garbage" }, "2026-11-11T00:00:00.000Z").ok, true);
    assert.strictEqual(markEarly({ ...ev, ok: false }, "2026-11-11T00:00:00.000Z").early, undefined, "a failed check is not rewritten");
    assert.strictEqual(markEarly(null, "2026-11-11T00:00:00.000Z"), null);
    const e = markEarly(ev, "2026-11-11T00:00:00.000Z");
    assert.deepStrictEqual([e.ok, e.early, e.reason, e.amount, e.transRef], [null, true, EARLY, 1, "R"]);

    // single bill: issued an hour ago, the slip says it was paid two hours ago
    bindDirect("Utenant6", "206");
    putBill(mkBill("206", "2026-11", "unpaid", { issuedAt: at(-HOUR) }));
    slipok = okSlip(4450, "REF-EARLY", at(-2 * HOUR));
    r = await sendSlip("Utenant6");
    assert.deepStrictEqual([r.status, r.body.status], [200, "pending"], "an early slip is never refused");
    assert.deepStrictEqual(
      [r.body.verify.ok, r.body.verify.early, r.body.verify.stale, r.body.verify.reason, r.body.verify.amount, r.body.verify.transRef],
      [null, true, undefined, EARLY, 4450, "REF-EARLY"]
    );
    assert.deepStrictEqual(data.get("bill:2026-11:206").slipVerify, r.body.verify);
    assert.ok(data.get("slip-ref:REF-EARLY"), "the reference is remembered before the downgrade");

    // paid after the bill was issued, and a bill with no issuedAt: untouched
    bindDirect("Utenant7", "207");
    putBill(mkBill("207", "2026-11", "unpaid", { issuedAt: at(-HOUR) }));
    slipok = okSlip(4450, "REF-AFTER", at(-60000));
    r = await sendSlip("Utenant7");
    assert.deepStrictEqual([r.body.verify.ok, r.body.verify.early], [true, undefined]);
    bindDirect("Utenant8", "208");
    putBill(mkBill("208", "2026-11", "unpaid"));
    slipok = okSlip(4450, "REF-NOISSUE", at(-5 * DAY));
    r = await sendSlip("Utenant8");
    assert.deepStrictEqual([r.body.verify.ok, r.body.verify.early], [true, undefined]);

    // both rules hit: the slip is 45 days old AND older than the bill; both facts and both reasons are kept
    bindDirect("Utenant9", "209");
    putBill(mkBill("209", "2026-11", "unpaid", { issuedAt: at(-10 * DAY) }));
    slipok = okSlip(4450, "REF-BOTH", at(-45 * DAY));
    r = await sendSlip("Utenant9");
    const both = r.body.verify;
    assert.deepStrictEqual([both.ok, both.stale, both.staleDays, both.early], [null, true, 45, true]);
    assert.strictEqual(both.reason, `สลิปเก่า — โอนเมื่อ 45 วันก่อน · ${EARLY}`);

    // several periods: compared with the NEWEST bill (the Oct bill alone would have let it through)
    bindDirect("Utenant10", "210");
    putBill(mkBill("210", "2026-10", "unpaid", { issuedAt: at(-5 * DAY) }));
    putBill(mkBill("210", "2026-11", "unpaid", { issuedAt: at(-HOUR) }));
    slipok = okSlip(8900, "REF-EARLY-G", at(-2 * DAY));
    r = await sendSlip("Utenant10", { periods: ["2026-10", "2026-11"] });
    assert.deepStrictEqual([r.status, r.body.verify.ok, r.body.verify.early, r.body.verify.reason], [200, null, true, EARLY]);
    assert.strictEqual(data.get("bill:2026-10:210").status, "pending");

    // an advance slip is meant to be older than the bill: never early, not even once it is attached
    bindDirect("Utenant11", "211");
    slipok = okSlip(4450, "REF-ADV", at(-2 * DAY));
    r = await sendSlip("Utenant11");
    assert.deepStrictEqual([r.body.status, r.body.verify.ok, r.body.verify.early], ["advance", true, undefined]);
    await issue([{ room: "211", water: 10, elec: 100 }]); // total 4450 = the slip
    const att = data.get("bill:2026-11:211");
    assert.deepStrictEqual([att.status, att.prepaid, att.slipVerify.ok, att.slipVerify.early], ["pending", true, true, undefined]);
  });

  // ================================================================ UC-12 (ต่อ) ปิดบิลอัตโนมัติเมื่อสลิปผ่านการตรวจครบ
  // A slip that SlipOK verified end to end (ok === true) for a monthly bill closes it without the
  // owner's tap. Everything else keeps today's flow: pending + the owner's confirm card.
  const { retryKeyOf } = require("./api/_line");
  const nowIso = () => new Date().toISOString();
  const receiptsTo = (user) =>
    pushed.filter((p) => p.to === user).flatMap((p) => p.messages).filter((m) => (m.altText || "").startsWith("ใบเสร็จรับเงิน"));
  const ownerNotices = () => pushed.filter((p) => p.to === "Uowner");
  const openBill = (room, extra = {}) => {
    bindDirect(`Ut${room}`, room);
    putBill(mkBill(room, "2026-11", "unpaid", { issuedAt: ago(DAY), ...extra }));
  };

  await tc("TC-12-9", "สลิปที่ตรวจผ่านครบ (ok:true ยอดตรง) ของบิลรายเดือน → ปิดบิลเอง: paid + receiptNo + autoConfirmed · ผู้เช่าได้ใบเสร็จ · เจ้าของได้ข้อความสั้น (ดูสลิป ไม่มีปุ่มยืนยัน) · push ล้มไม่ทำให้คำขอล้ม", async () => {
    withSlipok();
    openBill("201");
    slipok = okSlip(4450, "REF-AUTO", nowIso());
    const r = await sendSlip("Ut201");
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(
      [r.body.ok, r.body.status, r.body.autoConfirmed, r.body.receiptNo, r.body.total, r.body.hasSlip, r.body.verify.ok],
      [true, "paid", true, "R202611-201", 4450, true, true]
    );
    const paid = data.get("bill:2026-11:201");
    assert.deepStrictEqual(
      [paid.status, paid.autoConfirmed, paid.confirmedVia, paid.confirmedBy, paid.receiptNo, !!paid.paidAt, !!paid.slipPath, paid.slipVerify.ok],
      ["paid", true, "slipok", null, "R202611-201", true, true, true]
    );
    assert.deepStrictEqual(data.get("bill:201"), paid, "the newest copy and the per-period copy agree");
    assert.strictEqual(paid.refundDue, undefined, "an exact slip leaves nothing to refund");

    // the tenant gets the same receipt an owner confirm sends, under the same retry key
    const got = receiptsTo("Ut201");
    assert.strictEqual(got.length, 1);
    assert.ok(got[0].altText.includes("ใบเสร็จรับเงิน ห้อง 201") && JSON.stringify(got[0]).includes("R202611-201"));
    assert.ok(retryKeys.has(retryKeyOf(`receipt:201:Ut201:2026-11:1:4450:R202611-201:${paid.slipAt}`)), "receipt retry key format is unchanged");

    // the owner gets a short notice: no confirm/reject button, a "ดูสลิป" button, one message only
    assert.strictEqual(ownerCards().length, 0, "no confirm card");
    const notes = ownerNotices();
    assert.strictEqual(notes.length, 1);
    const note = notes[0].messages[0];
    assert.strictEqual(note.altText, "ห้อง 201 ชำระแล้ว 4,450 บาท (ตรวจสลิปอัตโนมัติ)");
    const text = JSON.stringify(note);
    assert.ok(text.includes("ชำระแล้ว 4,450 บาท (ตรวจสลิปอัตโนมัติ)") && text.includes("ดูสลิป") && text.includes("https://liff.line.me/2000000000-testliff"));
    assert.ok(!text.includes("postback") && !text.includes("ยืนยันการชำระ"));
    assert.ok(retryKeys.has(retryKeyOf(`auto-paid:201:2026-11:${paid.slipAt}`)), "the notice carries a retry key of room, periods and slip time");

    // an old confirm tap (or a double one) finds the bill paid and sends nothing again
    pushed.length = 0;
    await tap("Uowner", "action=confirm&room=201&period=2026-11");
    assert.ok(JSON.stringify(replies.pop().messages).includes("ยืนยันไปแล้ว"));
    assert.strictEqual(pushed.length, 0);

    // the tenant reads it as paid with the receipt, and never sees who confirmed
    const t = await call(bill, { method: "GET", user: "Ut201" });
    assert.deepStrictEqual([t.body.status, t.body.receiptNo, "confirmedBy" in t.body], ["paid", "R202611-201", false]);
    const o = await call(bill, { method: "GET", user: "Uowner", query: { room: "201" } });
    assert.deepStrictEqual([o.body.status, o.body.confirmedBy, o.body.autoConfirmed], ["paid", null, true]);

    // a push that fails (owner notice, receipt) never fails the tenant's request
    openBill("202");
    failPushTo.add("Uowner");
    failPushTo.add("Ut202");
    slipok = okSlip(4450, "REF-AUTO-2", nowIso());
    const r2 = await sendSlip("Ut202");
    assert.deepStrictEqual([r2.status, r2.body.status, r2.body.autoConfirmed], [200, "paid", true]);
    assert.strictEqual(data.get("bill:2026-11:202").status, "paid");
  });

  await tc("TC-12-10", "ตรวจไม่ผ่านครบ → ยัง pending พร้อมการ์ดยืนยันของเจ้าของเหมือนเดิม: ตรวจไม่ได้ (ปิดระบบ/ผู้ให้บริการล่ม ok:null) · ยอดผิด/เกิน/ขาด · สลิปซ้ำ · สลิปเก่า · โอนก่อนบิลออก", async () => {
    // each case: [room, what SlipOK says (null = leave keys unset), bill extras, expected ok]
    const cases = [
      ["201", "off", {}, null],
      ["202", "down", {}, null],
      ["203", okSlip(4000, "REF-SHORT", nowIso()), {}, false],
      ["204", okSlip(5000, "REF-OVER", nowIso()), {}, false],
      ["205", okSlip(4450, "REF-STALE", ago(45 * DAY)), {}, null],
      ["206", okSlip(4450, "REF-EARLY2", ago(2 * 3600000)), { issuedAt: ago(3600000) }, null],
    ];
    for (const [room, says, extra, ok] of cases) {
      openBill(room, extra);
      delete process.env.SLIPOK_API_KEY;
      delete process.env.SLIPOK_BRANCH_ID;
      if (says !== "off") withSlipok();
      slipok = says === "off" || says === "down" ? null : says;
      pushed.length = 0;
      const r = await sendSlip(`Ut${room}`);
      assert.deepStrictEqual([r.status, r.body.status, r.body.autoConfirmed, r.body.verify.ok], [200, "pending", undefined, ok], `room ${room}`);
      const b = data.get(`bill:2026-11:${room}`);
      assert.deepStrictEqual([b.status, b.autoConfirmed, b.confirmedVia, b.receiptNo, b.paidAt], ["pending", undefined, undefined, undefined, undefined], `room ${room}`);
      assert.strictEqual(ownerCards().length, 1, `room ${room}: the owner still gets the confirm card`);
      assert.strictEqual(receiptsTo(`Ut${room}`).length, 0, `room ${room}: no receipt before the owner confirms`);
    }

    // a reused slip: the first room closes by itself, the same transfer on another room does not
    withSlipok();
    openBill("207");
    openBill("208");
    slipok = okSlip(4450, "REF-TWICE", nowIso());
    assert.strictEqual((await sendSlip("Ut207")).body.status, "paid");
    pushed.length = 0;
    const again = await sendSlip("Ut208");
    assert.deepStrictEqual([again.body.status, again.body.verify.ok, again.body.autoConfirmed], ["pending", false, undefined]);
    assert.strictEqual(ownerCards().length, 1);
    assert.strictEqual(data.get("bill:2026-11:208").status, "pending");
  });

  await tc("TC-12-11", "สลิปหลายงวดยอดรวมตรง (ok:true) → ปิดทุกงวดเอง: เลขใบเสร็จต่องวด · เจ้าของได้ข้อความเดียวระบุทุกงวด · ผู้เช่าได้ใบเสร็จครบ · ยอดไม่ตรง/ตรวจไม่ได้ → ยัง pending + การ์ดเดียว", async () => {
    withSlipok();
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-10", "unpaid", { issuedAt: ago(40 * DAY) }));
    putBill(mkBill("201", "2026-11", "unpaid", { issuedAt: ago(DAY) }));
    slipok = okSlip(8900, "REF-GRP-AUTO", nowIso());
    const r = await sendSlip("Utenant", { periods: ["2026-11", "2026-10"] });
    assert.deepStrictEqual(
      [r.status, r.body.status, r.body.autoConfirmed, r.body.periods, r.body.total, r.body.receiptNos, r.body.verify.ok],
      [200, "paid", true, ["2026-10", "2026-11"], 8900, ["R202610-201", "R202611-201"], true]
    );
    for (const p of ["2026-10", "2026-11"]) {
      const b = data.get(`bill:${p}:201`);
      assert.deepStrictEqual([b.status, b.autoConfirmed, b.confirmedVia, b.confirmedBy, !!b.paidAt], ["paid", true, "slipok", null, true], p);
    }
    assert.deepStrictEqual(data.get("bill:201"), data.get("bill:2026-11:201"));
    assert.strictEqual(data.get("bill:2026-10:201").slipPath, data.get("bill:2026-11:201").slipPath, "one photo");

    assert.strictEqual(ownerCards().length, 0);
    assert.strictEqual(ownerNotices().length, 1, "one notice for the whole slip");
    const note = ownerNotices()[0].messages[0];
    assert.strictEqual(note.altText, "ห้อง 201 ชำระแล้ว 8,900 บาท (ตรวจสลิปอัตโนมัติ)");
    assert.ok(JSON.stringify(note).includes("รอบ 2026-10, 2026-11") && JSON.stringify(note).includes("ดูสลิป") && !JSON.stringify(note).includes("postback"));
    const toTenant = pushed.filter((p) => p.to === "Utenant");
    assert.strictEqual(toTenant.length, 1, "one push");
    assert.strictEqual(toTenant[0].messages.length, 2, "a receipt card per period");
    assert.ok(JSON.stringify(toTenant[0].messages).includes("R202610-201") && JSON.stringify(toTenant[0].messages).includes("R202611-201"));

    // not the exact sum, or not checked: the group waits for the owner as before
    for (const [room, says] of [["202", okSlip(4450, "REF-GRP-SHORT", nowIso())], ["203", null]]) {
      bindDirect(`Ut${room}`, room);
      putBill(mkBill(room, "2026-10", "unpaid", { issuedAt: ago(40 * DAY) }));
      putBill(mkBill(room, "2026-11", "unpaid", { issuedAt: ago(DAY) }));
      slipok = says;
      pushed.length = 0;
      const g = await sendSlip(`Ut${room}`, { periods: ["2026-10", "2026-11"] });
      assert.deepStrictEqual([g.body.status, g.body.autoConfirmed], ["pending", undefined], room);
      assert.deepStrictEqual([data.get(`bill:2026-10:${room}`).status, data.get(`bill:2026-11:${room}`).status], ["pending", "pending"], room);
      assert.strictEqual(ownerCards().length, 1, room);
      assert.strictEqual(receiptsTo(`Ut${room}`).length, 0, room);
    }
  });

  await tc("TC-12-12", "สลิปล่วงหน้า (ยังไม่มีบิล) และ prepay ที่ผูกกับบิลตอนออกบิล ไม่ปิดอัตโนมัติ แม้ตรวจผ่าน → pending + การ์ดยืนยัน (เจ้าของตัดสินใจให้เป็นมือ)", async () => {
    withSlipok();
    bindDirect("Utenant", "211");
    slipok = okSlip(4450, "REF-ADV-AUTO", ago(2 * DAY));
    let r = await sendSlip("Utenant");
    assert.deepStrictEqual([r.status, r.body.status, r.body.autoConfirmed, r.body.verify.ok], [200, "advance", undefined, true]);
    assert.strictEqual(prepayOf("211").slipVerify.ok, true);
    assert.strictEqual(receiptsTo("Utenant").length, 0);
    assert.ok(ownerNotices().every((p) => !JSON.stringify(p).includes("ตรวจสลิปอัตโนมัติ")), "no auto-paid notice for an advance slip");

    // the bill is issued later and takes the slip: still pending, the owner gets the confirm card
    pushed.length = 0;
    await issue([{ room: "211", water: 10, elec: 100 }]); // total 4450 = the slip
    const att = data.get("bill:2026-11:211");
    assert.deepStrictEqual([att.status, att.prepaid, att.slipVerify.ok, att.autoConfirmed, att.receiptNo], ["pending", true, true, undefined, undefined]);
    assert.strictEqual(ownerCards().length, 1, "the owner confirms an attached prepay by hand");
    assert.strictEqual(receiptsTo("Utenant").length, 0, "no receipt before the owner confirms");

    // the owner's tap still closes it, as before
    await tap("Uowner", "action=confirm&room=211&period=2026-11");
    const paid = data.get("bill:2026-11:211");
    assert.deepStrictEqual([paid.status, paid.confirmedBy, paid.autoConfirmed], ["paid", "Uowner", undefined]);
    assert.strictEqual(receiptsTo("Utenant").length, 1);
  });

  await tc("TC-12-13", "SLIP_AUTO_CONFIRM=0 / off / false ปิดการปิดบิลเอง → ทำงานเหมือนเดิม (pending + การ์ดยืนยัน ทั้งบิลเดียวและหลายงวด) · ไม่ตั้ง/ค่าอื่น = เปิด", async () => {
    withSlipok();
    const offValues = [["201", "0"], ["202", "off"], ["203", "false"], ["204", "OFF"]];
    for (const [room, value] of offValues) {
      process.env.SLIP_AUTO_CONFIRM = value;
      openBill(room);
      slipok = okSlip(4450, `REF-OFF-${room}`, nowIso());
      pushed.length = 0;
      const r = await sendSlip(`Ut${room}`);
      assert.deepStrictEqual([r.body.status, r.body.autoConfirmed, r.body.verify.ok], ["pending", undefined, true], `${value}`);
      assert.strictEqual(data.get(`bill:2026-11:${room}`).status, "pending", `${value}`);
      assert.strictEqual(ownerCards().length, 1, `${value}`);
      assert.strictEqual(receiptsTo(`Ut${room}`).length, 0, `${value}`);
    }
    // a group slip as well
    process.env.SLIP_AUTO_CONFIRM = "off";
    bindDirect("Utenant", "205");
    putBill(mkBill("205", "2026-10", "unpaid", { issuedAt: ago(40 * DAY) }));
    putBill(mkBill("205", "2026-11", "unpaid", { issuedAt: ago(DAY) }));
    slipok = okSlip(8900, "REF-OFF-G", nowIso());
    pushed.length = 0;
    const g = await sendSlip("Utenant", { periods: ["2026-10", "2026-11"] });
    assert.deepStrictEqual([g.body.status, g.body.autoConfirmed], ["pending", undefined]);
    assert.strictEqual(ownerCards().length, 1);

    // any other value (or none) leaves it on
    for (const [room, value] of [["206", "1"], ["207", "on"], ["208", undefined]]) {
      if (value === undefined) delete process.env.SLIP_AUTO_CONFIRM; else process.env.SLIP_AUTO_CONFIRM = value;
      openBill(room);
      slipok = okSlip(4450, `REF-ON-${room}`, nowIso());
      assert.strictEqual((await sendSlip(`Ut${room}`)).body.status, "paid", `${value}`);
    }
    delete process.env.SLIP_AUTO_CONFIRM;
  });

  await tc("TC-12-14", "ไม่มีรูปใหม่ในคำขอนี้ → ไม่ปิดเอง: แก้หมายเหตุของสลิปที่ส่งไปแล้ว (แม้ผลตรวจเดิมเป็น ok:true) · เจ้าของบันทึกโดยไม่มีรูป · เจ้าของบันทึกหลายงวดไม่มีรูป", async () => {
    withSlipok();
    // a pending bill whose stored slip was verified (e.g. sent while auto-confirm was off)
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "pending", {
      issuedAt: ago(DAY), slipPath: "slips/201-old.png", slipAt: ago(60000), slipCount: 1, slipNote: "เดิม",
      slipVerify: { provider: "slipok", ok: true, amount: 4450, transRef: "REF-STORED" },
    }));
    files.set("slips/201-old.png", Buffer.from("png"));
    let r = await call(slip, { user: "Utenant", body: { note: "ขอแก้หมายเหตุ" } });
    assert.deepStrictEqual([r.status, r.body.status, r.body.autoConfirmed, r.body.verify.ok], [200, "pending", undefined, true]);
    const b = data.get("bill:2026-11:201");
    assert.deepStrictEqual([b.status, b.slipNote, b.autoConfirmed, b.receiptNo], ["pending", "ขอแก้หมายเหตุ", undefined, undefined]);
    assert.strictEqual(slipokCalls.length, 0, "no new photo, nothing sent to SlipOK");
    assert.strictEqual(ownerCards().length, 1, "the owner still decides");
    assert.strictEqual(receiptsTo("Utenant").length, 0);

    // the owner records a payment without a photo (cash, a transfer seen in the bank app)
    bindDirect("Utenant2", "202");
    putBill(mkBill("202", "2026-11", "unpaid", { issuedAt: ago(DAY) }));
    pushed.length = 0;
    r = await call(slip, { user: "Uowner", body: { room: "202", note: "เงินสด" } });
    assert.deepStrictEqual([r.status, r.body.status, r.body.autoConfirmed], [200, "pending", undefined]);
    assert.strictEqual(ownerCards().length, 1);

    // ...and for several months at once
    bindDirect("Utenant3", "203");
    putBill(mkBill("203", "2026-10", "unpaid", { issuedAt: ago(40 * DAY) }));
    putBill(mkBill("203", "2026-11", "unpaid", { issuedAt: ago(DAY) }));
    pushed.length = 0;
    r = await call(slip, { user: "Uowner", body: { room: "203", periods: ["2026-10", "2026-11"], note: "เงินสด" } });
    assert.deepStrictEqual([r.status, r.body.status, r.body.autoConfirmed], [200, "pending", undefined]);
    assert.deepStrictEqual([data.get("bill:2026-10:203").status, data.get("bill:2026-11:203").status], ["pending", "pending"]);
    assert.strictEqual(ownerCards().length, 1);
  });

  await tc("TC-12-15", "บิลที่ปิดเองยกเลิก (void) ได้ตามเดิม: paid → void, refundDue = ยอดบิล, เก็บ receiptNo/autoConfirmed เป็นหลักฐาน, อยู่ในรายการต้องคืนเงิน", async () => {
    withSlipok();
    openBill("201");
    slipok = okSlip(4450, "REF-VOID-AUTO", nowIso());
    assert.strictEqual((await sendSlip("Ut201")).body.status, "paid");
    const r = await call(bill, { user: "Uowner", body: { action: "void", room: "201", period: "2026-11", reason: "ผู้เช่าขอคืนเงิน" } });
    assert.deepStrictEqual([r.status, r.body.status, r.body.refund], [200, "void", 4450]);
    const v = data.get("bill:2026-11:201");
    assert.deepStrictEqual(
      [v.status, v.statusBefore, v.refundDue, v.receiptNo, v.autoConfirmed, v.confirmedVia, v.confirmedBy, v.voidedBy],
      ["void", "paid", 4450, "R202611-201", true, "slipok", null, "Uowner"]
    );
    const list = await call(bill, { method: "GET", user: "Uowner", query: { voided: "1", refunds: "1", room: "201" } });
    assert.deepStrictEqual(list.body.items.map((i) => [i.kind, i.refundDue]), [["void", 4450]]);
    // the tenant still does not get the staff userIds
    const t = await call(bill, { method: "GET", user: "Ut201" });
    assert.ok(!("confirmedBy" in t.body) && !("voidedBy" in t.body));
  });

  // ================================================================ UC-13 ชำระหลายงวดในสลิปเดียว
  // Two open bills of room 201 (Oct, Nov) and the tenant bound; bill:201 is the newest (Nov).
  const twoOpen = () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-10"));
    putBill(mkBill("201", "2026-11"));
  };
  const groupSlip = (user = "Utenant", extra = {}) =>
    call(slip, { user, body: { image: PNG, periods: ["2026-10", "2026-11"], ...extra } });
  const cardData = (card) => card.contents.footer.contents[0].action.data;
  const backdate = (...periods) => {
    for (const p of periods) data.set(`bill:${p}:201`, { ...data.get(`bill:${p}:201`), slipAt: ago(60000) });
    data.set("bill:201", data.get("bill:2026-11:201"));
  };

  await tc("TC-13-1", "สลิปเดียวครอบสองงวด: ทั้งคู่ pending ผูกสลิปเดียวกัน · เจ้าของได้การ์ดเดียวยอดรวม · ยืนยันครั้งเดียวปิดทั้งคู่ · ใบเสร็จแยกต่องวด", async () => {
    twoOpen();
    const r = await groupSlip("Utenant", { note: "ต.ค.+พ.ย.", periods: ["2026-11", "2026-10"] }); // order does not matter
    assert.deepStrictEqual(
      [r.status, r.body.status, r.body.periods, r.body.total, r.body.hasSlip],
      [200, "pending", ["2026-10", "2026-11"], 8900, true]
    );
    const oct = data.get("bill:2026-10:201");
    const nov = data.get("bill:2026-11:201");
    for (const b of [oct, nov]) {
      assert.deepStrictEqual([b.status, b.slipCount, b.slipNote], ["pending", 1, "ต.ค.+พ.ย."]);
      assert.deepStrictEqual(b.slipGroup, { periods: ["2026-10", "2026-11"], total: 8900 });
    }
    assert.strictEqual(oct.slipPath, nov.slipPath);
    assert.ok(files.has(nov.slipPath), "one photo stored");
    assert.deepStrictEqual(data.get("bill:201"), nov, "newest copy agrees");
    // one card for the owner, with the summed total and the periods in the button
    const toOwner = pushed.filter((p) => p.to === "Uowner");
    assert.strictEqual(toOwner.length, 1);
    assert.strictEqual(toOwner[0].messages.length, 1);
    const card = toOwner[0].messages[0];
    assert.ok(card.altText.includes("8,900") && card.altText.includes("2 งวด"));
    assert.ok(JSON.stringify(card).includes("2026-10, 2026-11"));
    const postback = cardData(card);
    assert.strictEqual(postback, "action=confirm&room=201&periods=2026-10%2C2026-11");
    // one tap closes both, each with its own receipt number
    pushed.length = 0;
    await tap("Uowner", postback);
    const [paidOct, paidNov] = [data.get("bill:2026-10:201"), data.get("bill:2026-11:201")];
    assert.deepStrictEqual([paidOct.status, paidNov.status], ["paid", "paid"]);
    assert.deepStrictEqual([paidOct.receiptNo, paidNov.receiptNo], ["R202610-201", "R202611-201"]);
    assert.ok(paidOct.paidAt && paidNov.paidAt && paidOct.confirmedBy === "Uowner");
    assert.deepStrictEqual(data.get("bill:201"), paidNov);
    const toTenant = pushed.filter((p) => p.to === "Utenant");
    assert.strictEqual(toTenant.length, 1, "one push");
    assert.strictEqual(toTenant[0].messages.length, 2, "two receipt cards");
    assert.ok(toTenant[0].messages.every((m) => m.altText.startsWith("ใบเสร็จรับเงิน ห้อง 201")));
    assert.ok(JSON.stringify(toTenant[0].messages).includes("R202610-201") && JSON.stringify(toTenant[0].messages).includes("R202611-201"));
    assert.ok(JSON.stringify(replies.pop().messages).includes("รอบ 2026-10, 2026-11"));
  });

  await tc("TC-13-4", "เลือกงวดผิด: รูปแบบผิด/ซ้ำ/เกิน 12 → 400 · ไม่มีบิล/จ่ายแล้ว/ยกเลิก/ของผู้เช่าเก่า → 409 ทั้งคำขอ (ไม่แตะงวดที่เปิดอยู่) · ห้องอื่น 403 · ห้องที่ไม่มี 404", async () => {
    twoOpen();
    putBill(mkBill("202", "2026-11"));
    await asOwner("Uhelper", "viewer");
    const post = (user, periods, extra = {}) => call(slip, { user, body: { image: PNG, periods, ...extra } });
    const untouched = () => {
      for (const p of ["2026-10", "2026-11"]) assert.strictEqual(data.get(`bill:${p}:201`).status, "unpaid", p);
      assert.strictEqual(data.get("bill:2026-11:202").status, "unpaid");
      assert.strictEqual(files.size, 0, "no photo stored");
      assert.strictEqual(pushed.length, 0, "nobody was told");
    };
    const tooMany = Array.from({ length: 13 }, (_, i) => `${2020 + i}-01`);
    for (const periods of [[], "2026-10", ["2026-1"], ["2026-10", "2026-10"], [5], tooMany]) {
      assert.strictEqual((await post("Utenant", periods)).status, 400, JSON.stringify(periods).slice(0, 40));
    }
    untouched();
    // a period that has no bill
    let r = await post("Utenant", ["2026-09", "2026-11"]);
    assert.deepStrictEqual([r.status, r.body.error.code], [409, "INVALID_STATE"]);
    untouched();
    // a paid or void period refuses the whole request: the open one is not touched either
    const oct = data.get("bill:2026-10:201");
    for (const status of ["paid", "void"]) {
      data.set("bill:2026-10:201", { ...oct, status });
      assert.strictEqual((await post("Utenant", ["2026-10", "2026-11"])).status, 409, status);
      assert.strictEqual(data.get("bill:2026-11:201").status, "unpaid", `${status}: November not half-done`);
      assert.strictEqual(files.size, 0);
    }
    data.set("bill:2026-10:201", oct);
    // someone else's room / not a tenant / not logged in / not a room
    assert.strictEqual((await post("Utenant", ["2026-11"], { room: "202" })).status, 403);
    assert.strictEqual((await post("Uhelper", ["2026-11"], { room: "201" })).status, 403);
    assert.strictEqual((await call(slip, { body: { image: PNG, periods: ["2026-11"] } })).status, 401);
    assert.strictEqual((await post("Uowner", ["2026-11"], { room: "999" })).status, 404);
    untouched();
    // a previous tenant's bills (issued before the tenancy began) are not open to the new tenant
    data.set("tenancy:201", { since: "2099-01-01T00:00:00.000Z" });
    assert.strictEqual((await post("Utenant", ["2026-10", "2026-11"])).status, 409);
    untouched();
    // the owner is not bound by tenancy
    assert.strictEqual((await post("Uowner", ["2026-10", "2026-11"], { room: "201" })).status, 200);
    assert.strictEqual(data.get("bill:2026-10:201").status, "pending");
  });

  await tc("TC-13-6", "กดการ์ดกลุ่มซ้ำ/ยืนยันค้างครึ่งทาง: ปิดเฉพาะงวดที่ยัง pending ตามการ์ด ข้ามงวดที่ขยับไปแล้วและบอกชื่อ กดซ้ำอีกไม่มีอะไรเกิด", async () => {
    twoOpen();
    await groupSlip();
    const postback = cardData(lastTo("Uowner").messages[0]);
    // a confirm that stopped half way: October was written as paid, November is still pending
    const octPaid = { ...data.get("bill:2026-10:201"), status: "paid", paidAt: ago(1000), confirmedBy: "Uowner", receiptNo: "R202610-201" };
    data.set("bill:2026-10:201", octPaid);
    pushed.length = 0;
    await tap("Uowner", postback);
    assert.strictEqual(data.get("bill:2026-11:201").status, "paid");
    assert.strictEqual(data.get("bill:2026-11:201").receiptNo, "R202611-201");
    assert.deepStrictEqual(data.get("bill:2026-10:201"), octPaid, "the bill that had already moved on is not rewritten");
    const answer = JSON.stringify(replies.pop().messages);
    assert.ok(answer.includes("รอบ 2026-11") && answer.includes("ข้าม 2026-10"));
    const receipts = pushed.filter((p) => p.to === "Utenant");
    assert.deepStrictEqual([receipts.length, receipts[0].messages.length], [1, 1], "only the bill closed now gets a receipt");
    // the same card again: nothing is waiting on it any more
    pushed.length = 0;
    await tap("Uowner", postback);
    assert.ok(JSON.stringify(replies.pop().messages).includes("ไม่มีบิลที่รอยืนยัน"));
    assert.strictEqual(pushed.length, 0);
  });

  await tc("TC-13-8", "แจ้งเฉพาะงวดเก่า (periods=[ต.ค.]): บิลพ.ย. ที่เป็นล่าสุดไม่ถูกแตะ การ์ดเป็นแบบงวดเดียวและปิดได้", async () => {
    twoOpen();
    const r = await call(slip, { user: "Utenant", body: { image: PNG, periods: ["2026-10"] } });
    assert.deepStrictEqual([r.status, r.body.status, r.body.periods, r.body.total], [200, "pending", ["2026-10"], 4450]);
    assert.strictEqual(data.get("bill:2026-10:201").status, "pending");
    assert.strictEqual(data.get("bill:2026-11:201").status, "unpaid");
    assert.strictEqual(data.get("bill:201").status, "unpaid", "the newest copy is still November's");
    const card = lastTo("Uowner").messages[0];
    assert.ok(!card.altText.includes("งวด"), "one period: the ordinary card");
    assert.strictEqual(cardData(card), "action=confirm&room=201&period=2026-10");
    await tap("Uowner", cardData(card));
    assert.strictEqual(data.get("bill:2026-10:201").status, "paid");
    assert.strictEqual(data.get("bill:2026-11:201").status, "unpaid");
    assert.strictEqual(data.get("bill:201").status, "unpaid");
  });

  await tc("TC-13-9", "ผู้เช่าส่งสลิปใหม่ของบิลล่าสุดเอง → บิลนั้นหลุดจากกลุ่ม; การ์ดกลุ่มเก่าปิดได้เฉพาะงวดที่ยังอยู่ในกลุ่ม; รูปที่อีกงวดยังใช้ไม่ถูกลบ", async () => {
    twoOpen();
    await groupSlip();
    const postback = cardData(lastTo("Uowner").messages[0]);
    const groupPhoto = data.get("bill:2026-11:201").slipPath;
    backdate("2026-10", "2026-11"); // past the 30 second gap
    const r = await sendSlip("Utenant", { note: "ส่งใหม่เฉพาะเดือนนี้" });
    assert.deepStrictEqual([r.status, r.body.status], [200, "pending"]);
    const nov = data.get("bill:2026-11:201");
    assert.strictEqual(nov.slipGroup, undefined, "a slip of its own: no longer part of the group");
    assert.strictEqual(nov.slipCount, 2);
    assert.ok(data.get("bill:2026-10:201").slipGroup, "October is still in the group");
    assert.ok(files.has(groupPhoto), "October still shows the old photo, so it is kept");
    pushed.length = 0;
    await tap("Uowner", postback);
    assert.strictEqual(data.get("bill:2026-10:201").status, "paid");
    assert.strictEqual(data.get("bill:2026-11:201").status, "pending", "its slip is a different one: needs its own confirm");
    assert.ok(JSON.stringify(replies.pop().messages).includes("ข้าม 2026-11"));
  });

  await tc("TC-13-10", "ยกเลิก (void) บิลหนึ่งงวดของกลุ่ม: กดการ์ดกลุ่มปิดเฉพาะงวดที่เหลือ แต่ยอดบนการ์ด/slipGroup ยังรวมงวดที่ยกเลิก (ข้อสังเกตที่ยังไม่ตัดสินใจ)", async () => {
    twoOpen();
    await groupSlip();
    const card = lastTo("Uowner").messages[0];
    const v = await call(bill, { user: "Uowner", body: { action: "void", room: "201", period: "2026-11", reason: "ออกผิด" } });
    assert.strictEqual(v.status, 200);
    assert.strictEqual(data.get("bill:2026-10:201").slipGroup.total, 8900, "the other bill still remembers the old total");
    assert.ok(card.altText.includes("8,900"), "and the card already sent still says so");
    await tap("Uowner", cardData(card));
    assert.strictEqual(data.get("bill:2026-10:201").status, "paid");
    assert.strictEqual(data.get("bill:2026-11:201").status, "void", "a void bill is not closed");
    assert.ok(JSON.stringify(replies.pop().messages).includes("ข้าม 2026-11"));
  });

  await tc("TC-13-11", "สลิปหลายงวดใช้ข้อจำกัดเดียวกับสลิปปกติ: ห่าง 30 วินาที · 5 ครั้งต่อบิลล่าสุด · เจ้าของไม่ถูกจำกัด · ส่งใหม่แล้วรูปเก่าถูกลบ", async () => {
    twoOpen();
    assert.strictEqual((await groupSlip()).status, 200);
    let r = await groupSlip();
    assert.deepStrictEqual([r.status, r.body.error.code], [429, "SLIP_TOO_SOON"]);
    assert.strictEqual(data.get("bill:2026-11:201").slipCount, 1);
    backdate("2026-10", "2026-11");
    await tick();
    assert.strictEqual((await groupSlip()).status, 200);
    assert.strictEqual(data.get("bill:2026-10:201").slipCount, 2);
    assert.strictEqual(files.size, 1, "the first photo was replaced, not kept");
    for (const p of ["2026-10", "2026-11"]) data.set(`bill:${p}:201`, { ...data.get(`bill:${p}:201`), slipCount: 5, slipAt: ago(60000) });
    r = await groupSlip();
    assert.deepStrictEqual([r.status, r.body.error.code], [429, "SLIP_LIMIT"]);
    assert.strictEqual((await groupSlip("Uowner", { room: "201" })).status, 200, "the owner is not limited");
    assert.strictEqual(data.get("bill:2026-11:201").slipCount, 6);
  });

  await tc("TC-13-12", "การ์ดกลุ่ม: ผู้เช่า/ผู้ช่วย/คนแปลกหน้ากดไม่ได้ · รอบในการ์ดผิดรูปแบบถูกปฏิเสธ · ยังไม่มีสลิปกลุ่ม → ไม่มีอะไรให้ยืนยัน", async () => {
    twoOpen();
    await asOwner("Uhelper", "viewer");
    await groupSlip();
    const postback = cardData(lastTo("Uowner").messages[0]);
    for (const who of ["Utenant", "Uhelper", "Ustranger"]) {
      await tap(who, postback);
      assert.ok(JSON.stringify(replies.pop().messages).includes("เฉพาะเจ้าของหอ"), who);
      assert.strictEqual(data.get("bill:2026-10:201").status, "pending", who);
    }
    const many = Array.from({ length: 13 }, (_, i) => `${2020 + i}-01`).join(",");
    for (const periods of ["2026-1", "2026-10,bad", many]) {
      await tap("Uowner", `action=confirm&room=201&periods=${periods}`);
      assert.ok(JSON.stringify(replies.pop().messages).includes("ระบุรอบบิลไม่ถูกต้อง"), periods.slice(0, 20));
    }
    assert.strictEqual(data.get("bill:2026-10:201").status, "pending");
    // a card for bills that never had a group slip
    data.clear();
    twoOpen();
    await tap("Uowner", postback);
    assert.ok(JSON.stringify(replies.pop().messages).includes("ไม่มีบิลที่รอยืนยัน"));
    assert.strictEqual(data.get("bill:2026-10:201").status, "unpaid");
  });

  await tc("TC-13-3", "ยอดไม่ตรง: ติดธงอย่างเดียว ไม่เก็บเครดิต — เกิน → slipAmount/overpaid + \"ยอดในสลิปเกินบิล X บาท\" · ขาด → shortBy · ยืนยันแล้วบิล paid มี refundDue/refundReason:overpaid + แท็กใน overpaid:<ห้อง> + ข้อความถึงเจ้าของ (บิลเดียว/หลายงวด/prepay) · ตรวจยอดไม่ได้ การ์ดต้องบอก", async () => {
    withSlipok();
    const cardText = () => JSON.stringify(lastTo("Uowner").messages[0]);
    // The slip shows 5,000 against a 4,450 bill and SlipOK did not object (older branch settings).
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "unpaid"));
    slipok = okSlip(5000, "REF-OVER", new Date().toISOString());
    let r = await sendSlip("Utenant");
    assert.strictEqual(r.status, 200);
    assert.strictEqual(slipokCalls[0].init.body.get("amount"), "4450", "the bill total is what SlipOK is asked to match");
    assert.deepStrictEqual([r.body.status, r.body.verify.ok, r.body.verify.reason, r.body.verify.amount], ["pending", false, "ยอดในสลิปเกินบิล 550 บาท", 5000]);
    let b = data.get("bill:2026-11:201");
    assert.deepStrictEqual([b.status, b.slipAmount, b.overpaid, b.shortBy], ["pending", 5000, 550, undefined], "flagged, not rejected");
    assert.strictEqual(data.get("slip-ref:REF-OVER"), undefined, "a failed check does not claim the reference");
    assert.ok(cardText().includes("ยอดในสลิปเกินบิล 550 บาท — ต้องคืนผู้เช่า"), "the owner's card shows it");

    // Short of the bill: flagged the same way, and nothing is owed back.
    bindDirect("Utenant5", "205");
    putBill(mkBill("205", "2026-11", "unpaid"));
    slipok = okSlip(4000, "REF-SHORT", new Date().toISOString());
    r = await sendSlip("Utenant5");
    assert.deepStrictEqual([r.body.verify.ok, r.body.verify.reason], [false, "ยอดในสลิปขาด 450 บาท"]);
    b = data.get("bill:2026-11:205");
    assert.deepStrictEqual([b.status, b.slipAmount, b.shortBy, b.overpaid], ["pending", 4000, 450, undefined]);
    assert.ok(cardText().includes("ยอดในสลิปขาด 450 บาท"));
    await tap("Uowner", "action=confirm&room=205&period=2026-11");
    b = data.get("bill:2026-11:205");
    assert.deepStrictEqual([b.status, b.refundDue, b.refundReason], ["paid", undefined, undefined], "a short slip owes nothing back");
    assert.strictEqual(data.get("overpaid:205"), undefined);

    // SlipOK itself answers 1013 for a wrong amount, with no amount: no figure to show or refund
    bindDirect("Utenant2", "202");
    putBill(mkBill("202", "2026-11", "unpaid"));
    slipok = { status: 400, body: { code: 1013, message: "amount mismatch" } };
    r = await sendSlip("Utenant2");
    assert.deepStrictEqual([r.body.status, r.body.verify.ok, r.body.verify.reason], ["pending", false, "ยอดในสลิปไม่ตรงกับบิล"]);
    b = data.get("bill:2026-11:202");
    assert.deepStrictEqual([b.slipAmount, b.overpaid, b.shortBy], [undefined, undefined, undefined]);
    assert.ok(cardText().includes("ยอดในสลิปไม่ตรงกับบิล"));

    // a slip that covers more than the selected periods is checked against their sum too
    bindDirect("Utenant3", "203");
    putBill(mkBill("203", "2026-10", "unpaid"));
    putBill(mkBill("203", "2026-11", "unpaid"));
    slipok = okSlip(13350, "REF-OVER-G", new Date().toISOString()); // three months for two
    r = await sendSlip("Utenant3", { periods: ["2026-10", "2026-11"] });
    assert.strictEqual(slipokCalls[slipokCalls.length - 1].init.body.get("amount"), "8900");
    assert.deepStrictEqual([r.status, r.body.verify.ok, r.body.verify.reason], [200, false, "ยอดในสลิปเกินบิล 4,450 บาท"]);
    for (const p of ["2026-10", "2026-11"]) {
      const g = data.get(`bill:${p}:203`);
      assert.deepStrictEqual([g.slipAmount, g.overpaid, g.slipGroup.slipAmount, g.slipGroup.overpaid, g.slipGroup.total], [13350, 4450, 13350, 4450, 8900]);
    }
    assert.ok(cardText().includes("ยอดในสลิปเกินบิล 4,450 บาท — ต้องคืนผู้เช่า"));

    // the owner decides: confirm one, reject another
    await tap("Uowner", "action=confirm&room=201&period=2026-11");
    b = data.get("bill:2026-11:201");
    assert.deepStrictEqual([b.status, b.refundDue, b.refundReason], ["paid", 550, "overpaid"]);
    assert.deepStrictEqual(data.get("bill:201"), b, "both copies agree");
    assert.deepStrictEqual(data.get("overpaid:201"), ["2026-11:1"]);
    assert.ok(JSON.stringify(replies.pop().messages).includes("ยอดเกิน 550 บาท — ต้องคืนผู้เช่า"), "the owner is told");
    await tap("Uowner", "action=confirm&room=201&period=2026-11"); // a second tap changes nothing
    assert.deepStrictEqual(data.get("overpaid:201"), ["2026-11:1"], "tagged once");
    assert.strictEqual(data.get("bill:2026-11:201").refundDue, 550);
    const rej = await call(bill, { user: "Uowner", body: { action: "reject", room: "202", period: "2026-11", reason: "ยอดเกิน" } });
    assert.strictEqual(rej.status, 200);
    assert.notStrictEqual(data.get("bill:2026-11:202").status, "pending");

    // the group card closes both periods; the extra is owed ONCE, on the newest period
    await tap("Uowner", "action=confirm&room=203&periods=2026-10,2026-11");
    const oct = data.get("bill:2026-10:203");
    const nov = data.get("bill:2026-11:203");
    assert.deepStrictEqual([oct.status, nov.status], ["paid", "paid"]);
    assert.deepStrictEqual([oct.refundDue, oct.refundReason], [undefined, undefined]);
    assert.deepStrictEqual([nov.refundDue, nov.refundReason], [4450, "overpaid"]);
    assert.deepStrictEqual(data.get("overpaid:203"), ["2026-11:1"]);
    assert.deepStrictEqual(data.get("bill:203"), nov);
    assert.ok(JSON.stringify(replies.pop().messages).includes("ยอดเกิน 4,450 บาท — ต้องคืนผู้เช่า"));

    // a new, exact slip replaces the over-paid one: the old amount facts go with the old photo
    bindDirect("Utenant6", "206");
    putBill(mkBill("206", "2026-11", "unpaid"));
    slipok = okSlip(5000, "REF-O1", new Date().toISOString());
    await sendSlip("Utenant6");
    assert.strictEqual(data.get("bill:2026-11:206").overpaid, 550);
    putBill({ ...data.get("bill:2026-11:206"), slipAt: ago(60000) });
    slipok = okSlip(4450, "REF-O2", new Date().toISOString());
    r = await sendSlip("Utenant6");
    b = data.get("bill:2026-11:206");
    assert.deepStrictEqual([r.body.verify.ok, b.slipAmount, b.overpaid, b.shortBy], [true, 4450, undefined, undefined]);

    // an advance slip is compared with the bill when the bill is issued
    bindDirect("Utenant7", "207");
    slipok = okSlip(5000, "REF-ADV-O", new Date().toISOString());
    assert.strictEqual((await sendSlip("Utenant7")).body.status, "advance");
    await issue([{ room: "207", water: 10, elec: 100 }]); // 4,450
    b = data.get("bill:2026-11:207");
    assert.deepStrictEqual([b.status, b.prepaid, b.slipAmount, b.overpaid, b.slipVerify.ok], ["pending", true, 5000, 550, false]);
    assert.strictEqual(b.slipVerify.reason, "ยอดในสลิปเกินบิล 550 บาท");
    assert.ok(cardText().includes("ยอดในสลิปเกินบิล 550 บาท — ต้องคืนผู้เช่า"));
    await tap("Uowner", "action=confirm&room=207&period=2026-11");
    assert.deepStrictEqual([data.get("bill:2026-11:207").refundDue, data.get("overpaid:207")], [550, ["2026-11:1"]]);

    // with the check off or the slip unreadable nothing was compared: the card must not look clean
    for (const off of [() => { delete process.env.SLIPOK_API_KEY; delete process.env.SLIPOK_BRANCH_ID; }, () => { slipok = { status: 400, body: { code: 1006 } }; }]) {
      withSlipok();
      off();
      bindDirect("Utenant8", "208");
      putBill(mkBill("208", "2026-11", "unpaid"));
      r = await sendSlip("Utenant8");
      assert.strictEqual(r.body.verify.ok, null);
      assert.ok(cardText().includes("ยังไม่ได้ตรวจยอดในสลิป — เทียบยอดเงินเข้าเอง"), "the owner is told the amount was not checked");
      assert.strictEqual(data.get("bill:2026-11:208").overpaid, undefined);
      data.delete("bill:2026-11:208"); data.delete("bill:208");
    }
    // ...and a slip whose amount was matched carries no such line. (Auto-confirm is switched off for
    // this part: a fully verified slip now closes the bill and there is no card to read.)
    process.env.SLIP_AUTO_CONFIRM = "off";
    withSlipok();
    putBill(mkBill("208", "2026-11", "unpaid"));
    slipok = okSlip(4450, "REF-FINE", new Date().toISOString());
    r = await sendSlip("Utenant8");
    assert.strictEqual(r.body.verify.ok, true);
    assert.ok(!cardText().includes("ยังไม่ได้ตรวจยอด") && !cardText().includes("ยอดในสลิป"));
    delete process.env.SLIP_AUTO_CONFIRM;

    // end to end: over-paid slip -> owner confirms -> the extra shows in the refund list -> marked -> gone
    const owed = (room) => call(bill, { method: "GET", user: "Uowner", query: { voided: "1", refunds: "1", room } });
    bindDirect("Utenant9", "209");
    putBill(mkBill("209", "2026-11", "unpaid"));
    slipok = okSlip(5000, "REF-E2E", new Date().toISOString());
    await sendSlip("Utenant9");
    await tap("Uowner", "action=confirm&room=209&period=2026-11");
    r = await owed("209");
    assert.deepStrictEqual([r.status, r.body.items.length, r.body.items[0].kind, r.body.items[0].refundDue], [200, 1, "overpaid", 550], "the extra is on the owner's refund list");
    r = await call(bill, { user: "Uowner", body: { action: "refunded", kind: "overpaid", room: "209", period: "2026-11", rev: 1 } });
    assert.deepStrictEqual([r.status, r.body.refundDue], [200, 550]);
    assert.deepStrictEqual((await owed("209")).body.items, [], "once marked, nothing is owed");
  });

  // ================================================================ UC-14 ดูยอดค้างชำระ
  await tc("TC-14-2", "ผู้เช่าเห็นยอดค้างรวมทุกงวด: จำนวนงวด · ยอดรวม · เกินกำหนดสูงสุด (เซิร์ฟเวอร์นับ) · ไม่นับ pending/จ่ายแล้ว/กำหนดวันนี้ · ไม่เห็นบิลของผู้เช่าเก่า · ห้องอื่น 403", async () => {
    atDate("2026-11-20");
    bindDirect("Utenant", "201");
    data.set("tenancy:201", { since: "2026-09-20T00:00:00.000Z" });
    data.set("bills:201", ["2026-11", "2026-10", "2026-09", "2026-08", "2026-07"]);
    putBill(mkBill("201", "2026-11", "unpaid", { due: "2026-11-20", issuedAt: "2026-11-01T00:00:00.000Z" })); // due today
    data.set("bill:2026-10:201", mkBill("201", "2026-10", "unpaid", { total: 4000, issuedAt: "2026-10-01T00:00:00.000Z" })); // due 10-16: 35 days
    data.set("bill:2026-09:201", mkBill("201", "2026-09", "unpaid", { total: 3900, issuedAt: "2026-09-25T00:00:00.000Z" })); // due 09-16: 65 days
    data.set("bill:2026-08:201", mkBill("201", "2026-08", "unpaid", { total: 9999, issuedAt: "2026-08-01T00:00:00.000Z" })); // previous tenant's
    data.set("bill:2026-07:201", mkBill("201", "2026-07", "paid", { issuedAt: "2026-09-25T00:00:00.000Z" }));
    let r = await call(bill, { method: "GET", user: "Utenant", query: { overdue: "1" } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(
      [r.body.today, r.body.room, r.body.count, r.body.total, r.body.maxDaysOverdue],
      ["2026-11-20", "201", 2, 7900, 65]
    );
    assert.deepStrictEqual(r.body.items.map((i) => [i.period, i.total, i.due, i.daysOverdue]), [["2026-09", 3900, "2026-09-16", 65], ["2026-10", 4000, "2026-10-16", 35]]);
    putBill(mkBill("201", "2026-11", "pending", { due: "2026-11-01", issuedAt: "2026-11-01T00:00:00.000Z", slipPath: "s.png" }));
    data.set("bill:2026-10:201", mkBill("201", "2026-10", "paid", { issuedAt: "2026-10-01T00:00:00.000Z" }));
    r = await call(bill, { method: "GET", user: "Utenant", query: { overdue: "1" } });
    assert.deepStrictEqual([r.body.count, r.body.total, r.body.maxDaysOverdue], [1, 3900, 65], "paid and pending drop out");
    assert.strictEqual((await call(bill, { method: "GET", user: "Utenant", query: { overdue: "1", room: "202" } })).status, 403);
    assert.strictEqual((await call(bill, { method: "GET", query: { overdue: "1" } })).status, 401);
    data.set("user-room:Uother", null);
    assert.strictEqual((await call(bill, { method: "GET", user: "Uother", query: { overdue: "1" } })).status, 400, "not bound to a room");
  });

  // ================================================================ UC-15 ดูใบเสร็จ
  await tc("TC-15-2", "ผู้เช่าเปิดใบเสร็จของงวดที่จ่ายแล้ว: เลขที่ · วันที่ชำระ · ยอดและรายการ (ไม่เห็น userId คนยืนยัน) · บิลเก่าที่ยังไม่มีเลขได้เลขที่คำนวณตรงกัน", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "pending", { slipPath: "slips/x.png" }));
    await tap("Uowner", "action=confirm&room=201&period=2026-11");
    const byPeriod = await call(bill, { method: "GET", query: { period: "2026-11" }, user: "Utenant" });
    assert.strictEqual(byPeriod.status, 200);
    assert.deepStrictEqual(
      [byPeriod.body.status, byPeriod.body.receiptNo, byPeriod.body.total, byPeriod.body.rent, byPeriod.body.water, byPeriod.body.elec],
      ["paid", "R202611-201", 4450, 3500, 250, 700]
    );
    assert.ok(byPeriod.body.paidAt);
    assert.strictEqual(byPeriod.body.confirmedBy, undefined, "the tenant does not get the owner's LINE userId");
    assert.strictEqual((await call(bill, { method: "GET", user: "Utenant" })).body.receiptNo, "R202611-201", "latest bill too");
    assert.strictEqual((await call(bill, { method: "GET", query: { period: "2026-11", room: "201" }, user: "Uowner" })).body.confirmedBy, "Uowner");
    // bills paid before receipts existed carry no stored number: it is derived the same way
    data.set("bill:2026-10:201", mkBill("201", "2026-10", "paid", { paidAt: ago(99999) }));
    data.set("bill:2026-09:201", mkBill("201", "2026-09", "paid", { paidAt: ago(99999), rev: 2 }));
    data.set("bills:201", ["2026-11", "2026-10", "2026-09"]);
    const old = await call(bill, { method: "GET", query: { period: "2026-10" }, user: "Utenant" });
    assert.strictEqual(old.body.receiptNo, "R202610-201");
    assert.strictEqual((await call(bill, { method: "GET", query: { period: "2026-09" }, user: "Utenant" })).body.receiptNo, "R202609-201-2");
    const h = await call(bill, { method: "GET", query: { history: "1" }, user: "Utenant" });
    assert.deepStrictEqual(h.body.items.map((i) => [i.period, i.receiptNo]), [["2026-11", "R202611-201"], ["2026-10", "R202610-201"], ["2026-09", "R202609-201-2"]]);
  });

  await tc("TC-15-3", "บิลที่ยังไม่จ่าย (unpaid/pending) ไม่มีเลขใบเสร็จ: receiptNo เป็น null ทั้งบิลล่าสุด งวด และประวัติ", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-10", "pending", { slipPath: "slips/x.png" }));
    putBill(mkBill("201", "2026-11", "unpaid"));
    data.set("bills:201", ["2026-11", "2026-10"]);
    const latest = await call(bill, { method: "GET", user: "Utenant" });
    assert.deepStrictEqual([latest.status, latest.body.status, latest.body.receiptNo], [200, "unpaid", null]);
    const oct = await call(bill, { method: "GET", query: { period: "2026-10" }, user: "Utenant" });
    assert.deepStrictEqual([oct.body.status, oct.body.receiptNo], ["pending", null]);
    const h = await call(bill, { method: "GET", query: { history: "1" }, user: "Utenant" });
    assert.deepStrictEqual(h.body.items.map((i) => i.receiptNo), [null, null]);
  });

  await tc("TC-15-4", "ใบเสร็จของห้องอื่น/ของผู้เช่าเก่าเปิดไม่ได้: ผู้เช่า 403 · ผู้เช่าใหม่ 404 · ไม่ล็อกอิน 401 · เจ้าของ/ผู้ช่วยเปิดได้", async () => {
    bindDirect("Utenant", "201");
    await asOwner("Uhelper", "viewer");
    putBill(mkBill("202", "2026-11", "paid", { receiptNo: "R202611-202", paidAt: ago(1000) }));
    for (const query of [{ room: "202", period: "2026-11" }, { room: "202" }, { room: "202", history: "1" }]) {
      assert.strictEqual((await call(bill, { method: "GET", query, user: "Utenant" })).status, 403, JSON.stringify(query));
    }
    assert.strictEqual((await call(bill, { method: "GET", query: { room: "202", period: "2026-11" } })).status, 401);
    const viewer = await call(bill, { method: "GET", query: { room: "202", period: "2026-11" }, user: "Uhelper" });
    assert.deepStrictEqual([viewer.status, viewer.body.receiptNo], [200, "R202611-202"]);
    // a bill paid by the previous tenant of the room
    putBill(mkBill("201", "2026-11", "paid", { receiptNo: "R202611-201", paidAt: ago(1000) }));
    data.set("tenancy:201", { since: "2099-01-01T00:00:00.000Z" });
    assert.strictEqual((await call(bill, { method: "GET", query: { period: "2026-11" }, user: "Utenant" })).status, 404);
    assert.deepStrictEqual((await call(bill, { method: "GET", query: { history: "1" }, user: "Utenant" })).body.items, []);
    assert.strictEqual((await call(bill, { method: "GET", query: { room: "201", period: "2026-11" }, user: "Uowner" })).body.receiptNo, "R202611-201");
  });

  await tc("TC-15-7", "การ์ดใบเสร็จใน LINE: altText · เลขที่ · ห้อง/รอบ · ค่าเช่า น้ำ ไฟ รวม · วันชำระ · ปุ่มเปิดหน้าใบเสร็จใน LIFF (room, receipt, #receipt/<รอบ>)", async () => {
    bindDirect("Utenant", "203");
    putBill(mkBill("203", "2026-11", "pending", { rev: 2, slipPath: "slips/a.png" }));
    await tap("Uowner", "action=confirm&room=203&period=2026-11");
    const card = pushed.filter((p) => p.to === "Utenant").pop().messages[0];
    assert.strictEqual(card.type, "flex");
    assert.strictEqual(card.altText, "ใบเสร็จรับเงิน ห้อง 203 · 4,450 บาท");
    const s = JSON.stringify(card);
    for (const part of ["เลขที่ R202611-203-2", "ห้อง 203 · รอบ 2026-11", "ค่าเช่า", "3,500", "250", "700", "รวม (บาท)", "4,450", "ชำระเมื่อ", "ดูใบเสร็จ"]) {
      assert.ok(s.includes(part), part);
    }
    const uri = card.contents.footer.contents[0].action.uri;
    assert.strictEqual(uri, "https://liff.line.me/2000000000-testliff?room=203&receipt=2026-11#receipt/2026-11");
  });

  await tc("TC-15-8", "ส่งใบเสร็จหาผู้เช่าล้มเหลว: บิลยัง paid มีเลขที่ และเจ้าของยังได้คำตอบ 'ยืนยันห้อง …'", async () => {
    bindDirect("Utenant", "205");
    putBill(mkBill("205", "2026-11", "pending"));
    failPushTo.add("Utenant");
    await tap("Uowner", "action=confirm&room=205&period=2026-11");
    const b = data.get("bill:2026-11:205");
    assert.deepStrictEqual([b.status, b.receiptNo], ["paid", "R202611-205"]);
    assert.ok(JSON.stringify(replies.pop().messages).includes("ยืนยันห้อง 205"));
  });

  await tc("TC-15-10", "เจ้าของสองคน/ดับเบิลแท็ปกดยืนยันพร้อมกัน (ทั้งคู่อ่านบิลเป็น pending ก่อนใครเขียน): ผู้เช่าได้ใบเสร็จใบเดียว — LINE ตอบ 409 ให้ push ที่ซ้ำ (X-Line-Retry-Key)", async () => {
    bindDirect("Utenant", "201");
    await asOwner("Uowner2", "owner");
    await issue([{ room: "201", water: 1, elec: 1 }]);
    await sendSlip("Utenant");
    pushed.length = replies.length = 0;
    // Both taps must read the bill before either one writes: that is the window a real Blob store leaves open.
    const meet = barrier(2);
    gate = async (op, key) => { if (op === "get" && key === "bill:2026-11:201") await meet(); };
    const pb = "action=confirm&room=201&period=2026-11";
    await Promise.all([tap("Uowner", pb), tap("Uowner2", pb)]);
    gate = null;

    assert.strictEqual(conflicts.length, 1, "both taps tried to send the receipt and LINE dropped the second");
    const receipts = pushed.filter((p) => p.to === "Utenant");
    assert.strictEqual(receipts.length, 1, "the tenant got exactly one receipt push");
    assert.strictEqual(receipts[0].messages.length, 1);
    assert.ok(receipts[0].messages[0].altText.includes("ใบเสร็จรับเงิน ห้อง 201"));
    assert.strictEqual(data.get("bill:2026-11:201").status, "paid");
    assert.strictEqual(replies.length, 2, "and both owners still got their answer");
    assert.ok(retryKeys.size >= 1 && [...retryKeys].every((k) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(k)), "LINE gets a UUID retry key");

    // A later, genuine receipt is not blocked: a re-issued bill has another rev, so another key.
    await call(bill, { user: "Uowner", body: { action: "void", room: "201", period: "2026-11", reason: "ผิดยอด" } });
    await issue([{ room: "201", water: 2, elec: 2 }]);
    await sendSlip("Utenant");
    pushed.length = 0;
    await tap("Uowner", pb);
    assert.strictEqual(pushed.filter((p) => p.to === "Utenant").length, 1, "the new revision's receipt is delivered");

    // The key holds what differs between messages. Same period and rev but another total is a
    // genuinely different receipt and must reach the tenant; an identical one is still dropped.
    bindDirect("Utenant2", "202");
    const pending202 = (extra = {}) =>
      putBill(mkBill("202", "2026-11", "pending", { rev: 1, slipAt: "2026-11-02T00:00:00.000Z", ...extra }));
    const pb202 = "action=confirm&room=202&period=2026-11";
    const before = conflicts.length;
    pushed.length = 0;
    pending202();
    await tap("Uowner", pb202);
    pending202({ total: 5000 });
    await tap("Uowner", pb202);
    assert.strictEqual(pushed.filter((p) => p.to === "Utenant2").length, 2, "another total: both receipts are delivered");
    assert.strictEqual(conflicts.length, before, "and LINE dropped nothing");
    pending202({ total: 5000 });
    await tap("Uowner", pb202);
    assert.strictEqual(conflicts.length, before + 1, "the same receipt again is a duplicate");
    pending202({ slipAt: "2026-11-03T00:00:00.000Z" });
    await tap("Uowner", pb202);
    assert.strictEqual(pushed.filter((p) => p.to === "Utenant2").length, 3, "another slip: delivered");
  });

  // ================================================================ UC-16 ทวงอัตโนมัติ (line-app: cron รายวัน)
  const remind = (today) => runReminders({ today });
  const remKinds = (r) => r.sent.map((s) => `${s.room}:${s.period}:${s.kind}`);
  const textsTo = (user) => pushed.filter((p) => p.to === user).flatMap((p) => p.messages).map((m) => m.altText || m.text);
  const quiet = async (fn) => {
    const original = console.error;
    console.error = () => {};
    try { return await fn(); } finally { console.error = original; }
  };
  const unpaidBill = (room, period, extra = {}) => saveBill(mkBill(room, period, "unpaid", extra)); // also writes the period index

  await tc("TC-16-7", "บิลที่แจ้งชำระแล้ว (pending) ไม่ถูกทวง แม้เลยกำหนด และไม่มีสรุปถึงเจ้าของ", async () => {
    bindDirect("Utenant", "201");
    await saveBill(mkBill("201", "2026-11", "pending", { slipPath: "slips/x.png" }));
    const r = await remind("2026-11-26");
    assert.deepStrictEqual(r.sent, []);
    assert.strictEqual(pushed.length, 0);
  });

  await tc("TC-16-8", "ถึงกำหนดวันนี้/ยังไม่เลยกำหนดไม่ใช่การทวง: ไม่ส่งขั้น after_* ไม่ส่งสรุปให้เจ้าของ (ก่อนกำหนด >3 วันไม่ส่งอะไร)", async () => {
    for (const [today, kind] of [["2026-11-12", null], ["2026-11-13", "before_3"], ["2026-11-15", "before_3"], ["2026-11-16", "due_0"]]) {
      data.clear();
      pushed.length = 0;
      bindDirect("Utenant", "201");
      await unpaidBill("201", "2026-11"); // due 2026-11-16
      const r = await remind(today);
      assert.deepStrictEqual(remKinds(r), kind ? [`201:2026-11:${kind}`] : [], today);
      assert.strictEqual(pushed.filter((p) => p.to === "Uowner").length, 0, `${today}: owner is not told`);
    }
  });

  await tc("TC-16-10", "ทั้งเส้นทาง line-app: ออกบิล → ก่อนกำหนด 3 วันผู้เช่าได้การ์ดเตือน → แจ้งชำระแล้วหยุดเตือน → เจ้าของยืนยัน → หยุดต่อไป", async () => {
    bindDirect("Utenant", "201");
    await issue([{ room: "201", water: 10, elec: 100 }]); // due 2026-11-16
    pushed.length = 0;
    let r = await remind("2026-11-13");
    assert.deepStrictEqual(remKinds(r), ["201:2026-11:before_3"]);
    assert.ok(textsTo("Utenant")[0].includes("ยอด 4,450 บาท"));
    await sendSlip("Utenant");
    pushed.length = 0;
    r = await remind("2026-11-20"); // five days late, but the tenant has already reported the payment
    assert.deepStrictEqual([r.sent, pushed.length], [[], 0]);
    await tap("Uowner", "action=confirm&room=201&period=2026-11");
    pushed.length = 0;
    r = await remind("2026-11-30");
    assert.deepStrictEqual([r.sent, pushed.length], [[], 0]);
  });

  await tc("TC-16-12", "GET /api/cron ป้องกันด้วย CRON_SECRET (Bearer): ไม่ได้ตั้ง/สั้นกว่า 16 → 503 · ไม่มี/ผิด/ใส่ใน URL → 401 · POST → 405 · ถูกต้อง → 200 พร้อมวันที่ (เวลาไทย)", async () => {
    const S = "a-long-enough-cron-secret";
    const hit = (headers, extra = {}) => call(cron, { method: "GET", headers, ...extra });
    try {
      delete process.env.CRON_SECRET;
      let r = await hit({ authorization: `Bearer ${S}` });
      assert.deepStrictEqual([r.status, r.body.error.code], [503, "NOT_CONFIGURED"]);
      process.env.CRON_SECRET = "short";
      assert.strictEqual((await hit({ authorization: "Bearer short" })).status, 503, "a short secret does not count");
      process.env.CRON_SECRET = S;
      assert.strictEqual((await hit({})).status, 401, "no header");
      r = await hit({ authorization: "Bearer wrong-wrong-wrong-wrong" });
      assert.deepStrictEqual([r.status, r.body.error.code], [401, "UNAUTHORIZED"]);
      assert.strictEqual((await hit({}, { query: { secret: S, token: S } })).status, 401, "a secret in the URL is not read");
      assert.strictEqual((await call(cron, { method: "POST", headers: { authorization: `Bearer ${S}` } })).status, 405);
      r = await hit({ authorization: `Bearer ${S}` });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual([r.body.ok, r.body.sent, r.body.failed], [true, [], 0]);
      assert.match(r.body.today, /^\d{4}-\d{2}-\d{2}$/);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });

  await tc("TC-16-13", "แจ้งเตือนก่อนครบกำหนด: 1–3 วันก่อนกำหนดได้การ์ด before_3 ครั้งเดียว (ข้อความ ยอด วันที่ ปุ่ม LIFF) · 4 วันก่อนยังไม่ส่ง", async () => {
    bindDirect("Utenant", "201");
    await unpaidBill("201", "2026-11"); // 4,450 baht, due 2026-11-16
    assert.deepStrictEqual((await remind("2026-11-12")).sent, [], "4 days ahead: too early");
    const r = await remind("2026-11-13");
    assert.deepStrictEqual(remKinds(r), ["201:2026-11:before_3"]);
    assert.strictEqual(textsTo("Utenant")[0], "แจ้งเตือน: บิลห้อง 201 รอบ พ.ย. 2569 ยอด 4,450 บาท ครบกำหนด 16 พ.ย. (อีก 3 วัน)");
    const card = pushed.find((p) => p.to === "Utenant").messages[0];
    assert.strictEqual(card.type, "flex");
    assert.ok(JSON.stringify(card).includes("https://liff.line.me/2000000000-testliff?room=201"), "the button opens the room");
    assert.ok(typeof data.get("reminded:201:2026-11:before_3:1") === "string", "marked with the send time");
    for (const day of ["2026-11-14", "2026-11-15"]) assert.deepStrictEqual((await remind(day)).sent, [], `${day}: same window, already sent`);
    assert.strictEqual(pushed.filter((p) => p.to === "Uowner").length, 0, "no owner summary for an early reminder");
  });

  await tc("TC-16-14", "ครบกำหนดวันนี้ได้ due_0 ครั้งเดียว แล้ววันถัดไปเป็น after_1", async () => {
    bindDirect("Utenant", "201");
    await unpaidBill("201", "2026-11");
    assert.deepStrictEqual(remKinds(await remind("2026-11-16")), ["201:2026-11:due_0"]);
    assert.ok(textsTo("Utenant")[0].includes("ครบกำหนดวันนี้ (16 พ.ย.)"));
    assert.deepStrictEqual((await remind("2026-11-16")).sent, [], "the same day twice sends nothing");
    assert.deepStrictEqual(remKinds(await remind("2026-11-17")), ["201:2026-11:after_1"]);
  });

  await tc("TC-16-15", "ทวงหลังเลยกำหนด: 1–4 วัน after_1 · 5–9 วัน after_5 · ≥10 วัน after_10 (ส่งขั้นละครั้ง ไม่ส่งซ้ำวันถัดไป)", async () => {
    bindDirect("Utenant", "201");
    await unpaidBill("201", "2026-11");
    const steps = [
      ["2026-11-17", "after_1"], ["2026-11-18", null], ["2026-11-20", null],
      ["2026-11-21", "after_5"], ["2026-11-25", null],
      ["2026-11-26", "after_10"], ["2026-11-27", null], ["2026-12-30", null],
    ];
    for (const [today, kind] of steps) {
      assert.deepStrictEqual(remKinds(await remind(today)), kind ? [`201:2026-11:${kind}`] : [], today);
    }
    assert.ok(textsTo("Utenant")[1].includes("เลยกำหนดมา 5 วันแล้ว"));
    // a tenant who is first reached on a late day (nothing sent before) gets that day's step
    data.clear();
    pushed.length = 0;
    bindDirect("Utenant", "201");
    await unpaidBill("201", "2026-11");
    assert.deepStrictEqual(remKinds(await remind("2026-12-30")), ["201:2026-11:after_10"]);
  });

  await tc("TC-16-16", "cron ไม่ทำงานบางวัน: รันครั้งแรกเลยกำหนด 3 วันได้ after_1 หนึ่งครั้ง (ไม่ตามส่ง before_3/due_0 ย้อนหลัง)", async () => {
    bindDirect("Utenant", "201");
    await unpaidBill("201", "2026-11");
    assert.deepStrictEqual(remKinds(await remind("2026-11-19")), ["201:2026-11:after_1"]);
    assert.strictEqual(pushed.filter((p) => p.to === "Utenant").length, 1);
  });

  await tc("TC-16-17", "ไม่ทวง: บิล paid / void / ไม่มี due / ห้องที่ยังไม่มีผู้เช่าผูก — ไม่ส่งอะไร ไม่มีสรุปถึงเจ้าของ", async () => {
    for (const [label, extra] of [["paid", { status: "paid" }], ["void", { status: "void" }], ["no due", { due: null }]]) {
      data.clear();
      pushed.length = 0;
      bindDirect("Utenant", "201");
      await saveBill(mkBill("201", "2026-11", extra.status || "unpaid", extra));
      const r = await remind("2026-11-20");
      assert.deepStrictEqual([r.sent, pushed.length], [[], 0], label);
    }
    data.clear();
    pushed.length = 0;
    await unpaidBill("202", "2026-11"); // nobody is bound to 202
    const r = await remind("2026-11-20");
    assert.deepStrictEqual([r.sent, pushed.length], [[], 0], "nobody to tell");
  });

  await tc("TC-16-18", "บิลของผู้เช่าเก่า (ออกก่อน tenancy) ไม่ถูกทวงผู้เช่าใหม่ — ได้เฉพาะบิลของตัวเอง", async () => {
    bindDirect("Ubob", "201");
    await unpaidBill("201", "2026-10", { due: "2026-10-16" }); // issued before Bob (no issuedAt): Alice's
    await unpaidBill("201", "2026-11", { issuedAt: "2026-11-05T00:00:00.000Z" });
    data.set("tenancy:201", { since: "2026-11-03T00:00:00.000Z" });
    const r = await remind("2026-11-20");
    assert.deepStrictEqual(remKinds(r), ["201:2026-11:after_1"]);
    assert.ok(!textsTo("Ubob").some((t) => t.includes("ต.ค.")), "no October text reached the new tenant");
    assert.strictEqual(data.get("reminded:201:2026-10:after_10:1") ?? null, null);
  });

  await tc("TC-16-19", "หลายบิลในช่วงเตือนพร้อมกัน: ห้องละ 1 push (การ์ดรวม ≤5 ต่อ push) และเตือนบิลงวดเก่าที่ค้างอยู่ด้วย", async () => {
    bindDirect("Utenant", "201");
    await unpaidBill("201", "2026-10", { due: "2026-11-01" });
    await unpaidBill("201", "2026-11");
    const r = await remind("2026-11-13");
    assert.deepStrictEqual(remKinds(r), ["201:2026-10:after_10", "201:2026-11:before_3"]);
    const toTenant = pushed.filter((p) => p.to === "Utenant");
    assert.deepStrictEqual([toTenant.length, toTenant[0].messages.length], [1, 2], "both cards in one push");
    assert.ok(data.get("reminded:201:2026-10:after_10:1") && data.get("reminded:201:2026-11:before_3:1"), "each kind is marked on its own");
    pushed.length = 0;
    await remind("2026-11-13");
    assert.strictEqual(pushed.filter((p) => p.to === "Utenant").length, 0, "and not sent again");
    // more than 5 cards for one room travel in batches of 5 (LINE's limit)
    data.clear();
    pushed.length = 0;
    bindDirect("Utenant", "201");
    for (let m = 1; m <= 7; m++) await unpaidBill("201", `2026-0${m}`, { due: "2026-07-01" });
    const many = await remind("2026-11-13");
    assert.strictEqual(many.sent.length, 7);
    assert.deepStrictEqual(pushed.filter((p) => p.to === "Utenant").map((p) => p.messages.length), [5, 2]);
  });

  await tc("TC-16-20", "สรุปถึงเจ้าของเมื่อมีการทวงหลังกำหนด: 1 ข้อความ (จำนวนห้อง/ข้อความ) · ไม่ส่งสรุปถ้าไม่มีอะไรส่ง หรือส่งแค่เตือนก่อน/ครบกำหนด", async () => {
    for (const room of ["201", "202", "203"]) bindDirect(`U${room}`, room);
    await unpaidBill("201", "2026-11");
    await unpaidBill("202", "2026-11");
    await saveBill(mkBill("203", "2026-11", "paid"));
    const r = await remind("2026-11-17");
    assert.strictEqual(r.sent.length, 2);
    const summary = pushed.filter((p) => p.to === "Uowner");
    assert.strictEqual(summary.length, 1);
    assert.strictEqual(summary[0].messages[0].text, "สรุปทวงวันนี้: เลยกำหนด 2 ห้อง (201, 202) · ส่งเตือนแล้ว 2 ข้อความ");
    pushed.length = 0;
    await remind("2026-11-17");
    assert.strictEqual(pushed.length, 0, "nothing new: no summary either");
    data.clear();
    pushed.length = 0;
    bindDirect("U201", "201");
    await unpaidBill("201", "2026-11");
    await remind("2026-11-13");
    await remind("2026-11-16");
    assert.ok(!pushed.some((p) => p.to === "Uowner"), "before_3 and due_0 are not late");
  });

  await tc("TC-16-21", "push หาผู้เช่าล้มเหลว: ไม่ลงบันทึก ส่งซ้ำรอบถัดไป · ห้องอื่นไม่ถูกกระทบ · ตัวนับ failed ถูกต้อง", async () => {
    bindDirect("U201", "201");
    bindDirect("U202", "202");
    await unpaidBill("201", "2026-11");
    await unpaidBill("202", "2026-11");
    failPushTo.add("U201");
    let r = await quiet(() => remind("2026-11-13"));
    assert.deepStrictEqual([remKinds(r), r.failed], [["202:2026-11:before_3"], 1]);
    assert.strictEqual(data.get("reminded:201:2026-11:before_3:1") ?? null, null, "a failed push marks nothing");
    failPushTo.clear();
    r = await remind("2026-11-14");
    assert.deepStrictEqual([remKinds(r), r.failed], [["201:2026-11:before_3"], 0], "retried on the next run");
  });

  await tc("TC-16-23", "runReminders สองรอบซ้อนกันวันเดียว (ทั้งคู่อ่าน reminded: ยังไม่มีก่อนใครเขียน): ผู้เช่าได้เตือนครั้งเดียว · รอบที่ซ้ำไม่นับว่าส่ง · วันถัดไปส่งตามขั้นปกติ · บิลเดิมที่ยอดเปลี่ยนวันเดียวกันไม่ถูกตัดทิ้ง", async () => {
    bindDirect("Utenant", "201");
    bindDirect("Utenant2", "202");
    await unpaidBill("201", "2026-11"); // due 2026-11-16: 6 days late on the 22nd -> after_5
    await unpaidBill("202", "2026-11");
    // Both runs must read the marks before either writes one (the mark is written after the push).
    const meet = { 201: barrier(2), 202: barrier(2) };
    gate = async (op, key) => {
      const m = /^reminded:(\d+):2026-11:after_5:1$/.exec(key);
      if (op === "get" && m) await meet[m[1]]();
    };
    const [a, b] = await Promise.all([remind("2026-11-22"), remind("2026-11-22")]);
    gate = null;

    assert.strictEqual(pushed.filter((p) => p.to === "Utenant").length, 1, "one reminder for room 201");
    assert.strictEqual(pushed.filter((p) => p.to === "Utenant2").length, 1, "and one for room 202");
    assert.strictEqual(conflicts.length, 2, "the second run's push was dropped by LINE for each room");
    assert.strictEqual(a.sent.length + b.sent.length, 2, "the duplicate is not reported as sent");
    assert.strictEqual(a.failed + b.failed, 0, "a dropped duplicate is not a failure");
    assert.ok(data.get("reminded:201:2026-11:after_5:1"), "the mark is written");
    assert.strictEqual(pushed.filter((p) => p.to === "Uowner").length, 1, "one owner summary");

    // The next day is a different batch: nothing is blocked, and nothing repeats.
    pushed.length = 0;
    assert.deepStrictEqual((await remind("2026-11-23")).sent, [], "already reminded for this window");
    assert.strictEqual(pushed.length, 0);

    // The key names the card: same rev but a new total is another message, an identical one is not.
    // Each run is on the 23rd and the mark is deleted first, so only the retry key can stop a repeat.
    const again = async (total) => {
      putBill({ ...data.get("bill:201"), total });
      data.delete("reminded:201:2026-11:after_5:1");
      pushed.length = 0;
      conflicts.length = 0;
      return remind("2026-11-23");
    };
    assert.deepStrictEqual((await again(4450)).sent.map((x) => x.room), ["201"], "first delivery that day");
    assert.deepStrictEqual([(await again(4450)).sent, conflicts.length], [[], 1], "the identical card is dropped");
    assert.deepStrictEqual([(await again(5000)).sent.map((x) => x.room), pushed.filter((p) => p.to === "Utenant").length], [["201"], 1], "a new total is delivered the same day");
  });

  // ================================================================ UC-17 แจ้งชำระก่อนบิลออก (โอนก่อน)
  const backdatePrepay = (room) => data.set(`prepay:${room}`, { ...prepayOf(room), slipAt: ago(60 * 1000) });

  await tc("TC-17-1", "ทั้งเส้นทาง: โอนก่อนบิลออก → เจ้าของเห็นในรายการห้อง → ออกบิล → บิล pending พร้อมสลิป → ยืนยัน → paid และ prepay หาย", async () => {
    bindDirect("Utenant", "201");
    // 1. no bill yet: the tenant transfers anyway
    let r = await sendSlip("Utenant", { note: "โอนค่าเดือนหน้าแล้ว" });
    assert.deepStrictEqual([r.status, r.body.ok, r.body.status, r.body.hasSlip], [200, true, "advance", true]);
    assert.ok(JSON.stringify(lastTo("Uowner").messages).includes("แจ้งโอนก่อนบิลออก"));
    // 2. the tenant's bill screen says a slip is waiting; the owner's room list shows it
    r = await call(bill, { method: "GET", user: "Utenant" });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.error.advance.hasSlip, true);
    r = await call(rooms, { method: "GET", user: "Uowner" });
    assert.strictEqual(r.body.rooms.find((x) => x.room === "201").advance.hasSlip, true);
    // 3. the owner issues the bill: it starts as pending with the slip on it
    const pushesBefore = pushed.length;
    r = await issue([{ room: "201", water: 10, elec: 100 }]);
    assert.deepStrictEqual([r.body.rooms[0].prepaid, r.body.rooms[0].pushed], [true, true]);
    const b = data.get("bill:2026-11:201");
    assert.deepStrictEqual([b.status, b.prepaid, b.slipNote, b.total], ["pending", true, "โอนค่าเดือนหน้าแล้ว", 4450]);
    assert.ok(files.has(b.slipPath), "the advance photo is now the bill's slip");
    assert.strictEqual(prepayOf("201"), null, "prepay is consumed");
    assert.ok(pushed.slice(pushesBefore).some((p) => p.to === "Uowner" && JSON.stringify(p.messages).includes("action=confirm&room=201&period=2026-11")), "owner gets the confirm card");
    // 4. the owner taps confirm
    await tap("Uowner", "action=confirm&room=201&period=2026-11");
    assert.strictEqual(data.get("bill:2026-11:201").status, "paid");
    assert.deepStrictEqual(data.get("bill:201"), data.get("bill:2026-11:201"));
    assert.strictEqual(prepayOf("201"), null);
    r = await call(bill, { method: "GET", user: "Utenant" });
    assert.deepStrictEqual([r.body.status, r.body.advance], ["paid", null]);
  });

  await tc("TC-17-2", "ยังไม่มีบิล: เก็บเป็น prepay:<ห้อง> รูปชื่อ advance แจ้งเจ้าของเป็นข้อความ", async () => {
    bindDirect("Utenant", "201");
    const r = await sendSlip("Utenant", { note: "โอนแล้ว" });
    assert.strictEqual(r.status, 200);
    const p = prepayOf("201");
    assert.deepStrictEqual([p.room, p.slipNote, p.slipCount, p.by], ["201", "โอนแล้ว", 1, "Utenant"]);
    assert.match(p.slipPath, /^slips\/201-advance-\d+\.png$/);
    assert.ok(files.has(p.slipPath));
    assert.strictEqual(data.get("bill:201") ?? null, null, "no bill is invented");
    const msg = lastTo("Uowner").messages[0];
    assert.strictEqual(msg.type, "text");
    assert.ok(msg.text.includes("ห้อง 201") && msg.text.includes("โอนแล้ว"));
  });

  await tc("TC-17-3", "บิลล่าสุดจ่ายแล้ว: แจ้งโอนรอบถัดไปเก็บเป็น prepay ไม่แตะบิลเดิม; บิล unpaid/pending ยังทำงานแบบเดิม", async () => {
    bindDirect("Utenant", "201");
    bindDirect("Utenant2", "202");
    bindDirect("Utenant3", "203");
    putBill(mkBill("201", "2026-10", "paid", { paidAt: ago(1000) }));
    putBill(mkBill("202", "2026-11", "unpaid"));
    putBill(mkBill("203", "2026-11", "pending", { slipPath: "slips/old.png", slipAt: ago(60000), slipCount: 1 }));
    files.set("slips/old.png", Buffer.from("x"));
    let r = await sendSlip("Utenant");
    assert.strictEqual(r.body.status, "advance");
    assert.strictEqual(data.get("bill:201").status, "paid", "the paid bill is untouched");
    r = await sendSlip("Utenant2");
    assert.strictEqual(r.body.status, "pending", "an unpaid bill is paid as before");
    assert.strictEqual(prepayOf("202"), null);
    r = await sendSlip("Utenant3");
    assert.strictEqual(r.body.status, "pending");
    assert.strictEqual(prepayOf("203"), null);
    assert.strictEqual(data.get("bill:203").slipCount, 2);
  });

  await tc("TC-17-4", "GET /api/bill: advance เป็น null เมื่อไม่มี prepay; มี prepay แล้วบอก slipAt/hasSlip/note (ทั้งตอนบิลล่าสุดจ่ายแล้ว)", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-10", "paid", { paidAt: ago(1000) }));
    let r = await call(bill, { method: "GET", user: "Utenant" });
    assert.strictEqual(r.body.advance, null);
    await sendSlip("Utenant", { note: "ล่วงหน้า" });
    r = await call(bill, { method: "GET", user: "Utenant" });
    assert.deepStrictEqual([r.status, r.body.period, r.body.advance.hasSlip, r.body.advance.note], [200, "2026-10", true, "ล่วงหน้า"]);
    assert.ok(r.body.advance.slipAt);
    r = await call(bill, { method: "GET", query: { period: "2026-10" }, user: "Utenant" });
    assert.strictEqual(r.body.advance, undefined, "a bill asked for by period carries no advance");
  });

  await tc("TC-17-5", "แจ้งโอนล่วงหน้าซ้ำ: แทนที่ prepay เดิม รูปเก่าถูกลบ slipCount เพิ่ม", async () => {
    bindDirect("Utenant", "201");
    await sendSlip("Utenant");
    const first = prepayOf("201").slipPath;
    backdatePrepay("201");
    await new Promise((r) => setTimeout(r, 3));
    await sendSlip("Utenant", { note: "ใบใหม่" });
    const p = prepayOf("201");
    assert.notStrictEqual(p.slipPath, first);
    assert.ok(files.has(first) && files.has(p.slipPath), "the replaced photo is kept (a bill being written may point at it)");
    assert.deepStrictEqual([p.slipCount, p.slipNote], [2, "ใบใหม่"]);
  });

  await tc("TC-17-6", "ข้อจำกัดนับบน prepay: ถี่เกิน 30 วินาที → 429; ครบ 5 ครั้ง → 429; เจ้าของไม่ถูกจำกัด", async () => {
    bindDirect("Utenant", "201");
    assert.strictEqual((await sendSlip("Utenant")).status, 200);
    let r = await sendSlip("Utenant");
    assert.deepStrictEqual([r.status, r.body.error.code], [429, "SLIP_TOO_SOON"]);
    for (let i = 2; i <= 5; i++) {
      backdatePrepay("201");
      assert.strictEqual((await sendSlip("Utenant")).status, 200, `slip ${i}`);
    }
    backdatePrepay("201");
    r = await sendSlip("Utenant");
    assert.deepStrictEqual([r.status, r.body.error.code], [429, "SLIP_LIMIT"]);
    assert.strictEqual(prepayOf("201").slipCount, 5);
    assert.strictEqual((await call(slip, { user: "Uowner", body: { room: "201", image: PNG } })).status, 200);
    assert.strictEqual(prepayOf("201").slipCount, 6);
  });

  await tc("TC-17-7", "กฎตรวจสลิปเดิมใช้กับ prepay: รูปผิดชนิด 400 · ใหญ่ 413 · หมายเหตุยาว 400 · ห้องอื่น 403 · ไม่ผูกห้อง 400 · ไม่ล็อกอิน 401", async () => {
    bindDirect("Utenant", "201");
    assert.strictEqual((await call(slip, { user: "Utenant", body: { image: "data:image/gif;base64,R0lGOD==" } })).status, 400);
    assert.strictEqual((await call(slip, { user: "Utenant", body: { image: `data:image/png;base64,${Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64")}` } })).status, 413);
    assert.strictEqual((await sendSlip("Utenant", { note: "ก".repeat(501) })).status, 400);
    assert.strictEqual((await call(slip, { user: "Utenant", body: { room: "202", image: PNG } })).status, 403);
    assert.strictEqual((await call(slip, { user: "Unobody", body: { image: PNG } })).status, 400);
    assert.strictEqual((await call(slip, { body: { image: PNG } })).status, 401);
    assert.strictEqual(prepayOf("201"), null);
    assert.strictEqual(prepayOf("202"), null);
    assert.strictEqual(files.size, 0);
  });

  await tc("TC-17-8", "โอนล่วงหน้าโดยไม่แนบรูป (มีแต่หมายเหตุ) → advance, hasSlip=false", async () => {
    bindDirect("Utenant", "201");
    // A tenant must attach the photo (TC-11-2); the owner may record an advance payment without one.
    const t = await call(slip, { user: "Utenant", body: { note: "โอนพร้อมเพย์" } });
    assert.deepStrictEqual([t.status, t.body.error.code], [400, "VALIDATION"]);
    assert.strictEqual(prepayOf("201"), null);
    const r = await call(slip, { user: "Uowner", body: { room: "201", note: "โอนพร้อมเพย์" } });
    assert.deepStrictEqual([r.status, r.body.status, r.body.hasSlip], [200, "advance", false]);
    assert.strictEqual(prepayOf("201").slipPath, null);
  });

  await tc("TC-17-9", "ส่งข้อความหาเจ้าของล้มเหลว ผู้เช่ายังแจ้งโอนล่วงหน้าสำเร็จ", async () => {
    bindDirect("Utenant", "201");
    failPushTo.add("Uowner");
    assert.strictEqual((await sendSlip("Utenant")).status, 200);
    assert.ok(prepayOf("201"));
  });

  await tc("TC-17-10", "GET /api/rooms: ห้องที่มี prepay มี advance {slipAt, hasSlip} ห้องอื่นเป็น null ผู้ช่วยเห็นได้ ผู้เช่า 403 ไม่หลุด userId", async () => {
    bindDirect("Utenant", "201");
    await asOwner("Uhelper", "viewer");
    await sendSlip("Utenant");
    for (const u of ["Uowner", "Uhelper"]) {
      const r = await call(rooms, { method: "GET", user: u });
      const by = Object.fromEntries(r.body.rooms.map((x) => [x.room, x]));
      assert.deepStrictEqual(Object.keys(by["201"].advance).sort(), ["hasSlip", "slipAt", "verify"]);
      assert.strictEqual(by["201"].advance.hasSlip, true);
      assert.strictEqual(by["201"].advance.verify?.reason, "not_configured", "no SlipOK keys in this suite");
      assert.strictEqual(by["202"].advance, null);
      assert.ok(!JSON.stringify(r.body).includes("Utenant"));
    }
    assert.strictEqual((await call(rooms, { method: "GET", user: "Utenant" })).status, 403);
  });

  await tc("TC-17-11", "ดูรูปสลิปล่วงหน้า (?advance=1): ผู้เช่าห้องนั้น เจ้าของ ผู้ช่วยได้; ห้องอื่น 403; ไม่มี prepay 404; ไม่ปนกับสลิปของบิล", async () => {
    bindDirect("Utenant", "201");
    bindDirect("Uother", "202");
    await asOwner("Uhelper", "viewer");
    const adv = (u, room = "201") => call(slipImage, { method: "GET", query: { room, advance: "1" }, user: u });
    assert.strictEqual((await adv("Utenant")).status, 404, "nothing sent yet");
    await sendSlip("Utenant");
    for (const u of ["Utenant", "Uowner", "Uhelper"]) assert.strictEqual((await adv(u)).status, 200, u);
    assert.strictEqual((await adv("Uother")).status, 403);
    assert.strictEqual((await call(slipImage, { method: "GET", query: { room: "201", advance: "1" } })).status, 401);
    assert.strictEqual((await call(slipImage, { method: "GET", query: { room: "201" }, user: "Utenant" })).status, 404, "without advance=1 it reads the bill, which has no slip");
  });

  await tc("TC-17-12", "ออกบิลห้องที่มี prepay: บิล pending คัดลอกสลิป/หมายเหตุ/เวลา/จำนวนครั้ง prepaid:true; prepay ถูกล้าง; ผู้เช่าได้การ์ดบิล เจ้าของได้การ์ดยืนยัน", async () => {
    bindDirect("Utenant", "201");
    await sendSlip("Utenant", { note: "โอนก่อน" });
    const p = prepayOf("201");
    pushed.length = 0;
    const r = await issue([{ room: "201", water: 10, elec: 100 }]);
    assert.deepStrictEqual([r.status, r.body.rooms[0].prepaid, r.body.rooms[0].total], [200, true, 4450]);
    const b = data.get("bill:2026-11:201");
    assert.deepStrictEqual(
      [b.status, b.prepaid, b.slipPath, b.slipNote, b.slipAt, b.slipCount],
      ["pending", true, p.slipPath, "โอนก่อน", p.slipAt, 1]
    );
    assert.deepStrictEqual(data.get("bill:201"), b, "both copies carry the slip");
    assert.strictEqual(prepayOf("201"), null);
    assert.strictEqual(lastTo("Utenant").messages[0].type, "flex");
    assert.ok(JSON.stringify(lastTo("Uowner").messages[0]).includes("action=confirm&room=201&period=2026-11"));
    const mine = await call(bill, { method: "GET", user: "Utenant" });
    assert.deepStrictEqual([mine.body.status, mine.body.hasSlip, mine.body.advance], ["pending", true, null]);
    assert.strictEqual((await call(slipImage, { method: "GET", query: { room: "201" }, user: "Utenant" })).status, 200, "the slip is viewable from the bill now");
  });

  await tc("TC-17-13", "ห้องไม่มี prepay ออกบิลเป็น unpaid เหมือนเดิม และ prepay ของห้องหนึ่งไม่ไปติดบิลห้องอื่น", async () => {
    bindDirect("Utenant", "201");
    await sendSlip("Utenant");
    const r = await issue([{ room: "201", water: 1, elec: 1 }, { room: "202", water: 1, elec: 1 }]);
    assert.strictEqual(r.body.rooms[0].prepaid, true);
    assert.strictEqual(r.body.rooms[1].prepaid, undefined);
    assert.strictEqual(data.get("bill:2026-11:202").status, "unpaid");
    assert.strictEqual(data.get("bill:2026-11:202").slipPath ?? null, null);
  });

  await tc("TC-17-14", "บิลงวดนี้แจ้งชำระ/จ่ายแล้ว ออกบิลซ้ำถูกปฏิเสธ และ prepay ยังอยู่ ไม่หาย", async () => {
    putBill(mkBill("201", "2026-11", "pending", { slipPath: "slips/a.png", slipCount: 1 }));
    putBill(mkBill("202", "2026-11", "paid"));
    data.set("prepay:201", { room: "201", slipPath: "slips/p1.png", slipAt: ago(1000), slipCount: 1 });
    data.set("prepay:202", { room: "202", slipPath: "slips/p2.png", slipAt: ago(1000), slipCount: 1 });
    const r = await issue([{ room: "201", water: 1, elec: 1 }, { room: "202", water: 1, elec: 1 }]);
    assert.ok(r.body.rooms[0].error && r.body.rooms[1].error);
    assert.ok(prepayOf("201") && prepayOf("202"), "the tenant's slip is not lost");
    assert.strictEqual(data.get("bill:2026-11:201").slipPath, "slips/a.png");
    assert.strictEqual(data.get("bill:2026-11:202").status, "paid");
  });

  await tc("TC-17-15", "prepay แบบไม่มีรูป → บิลใหม่ pending hasSlip=false; ส่งการ์ดหาเจ้าของล้มเหลวก็ออกบิลได้และ prepay ถูกล้าง", async () => {
    bindDirect("Utenant", "201");
    // Tenants can no longer send a photo-less slip, so the record is written as an older client or
    // an owner-side tool would have left it.
    data.set("prepay:201", { room: "201", slipPath: null, slipNote: "โอนแล้วไม่มีรูป", slipAt: ago(60000), slipCount: 1, by: "Utenant" });
    failPushTo.add("Uowner");
    const r = await issue([{ room: "201", water: 1, elec: 1 }]);
    assert.strictEqual(r.status, 200);
    const b = data.get("bill:2026-11:201");
    assert.deepStrictEqual([b.status, b.slipPath, b.slipNote], ["pending", null, "โอนแล้วไม่มีรูป"]);
    assert.strictEqual(prepayOf("201"), null);
    const mine = await call(bill, { method: "GET", user: "Uowner", query: { room: "201" } });
    assert.strictEqual(mine.body.hasSlip, false);
  });

  await tc("TC-17-16", "ออกบิลซ้ำห้องที่ยัง unpaid แล้วค่อยมี prepay: บิลที่ออกใหม่รับ prepay นั้น", async () => {
    bindDirect("Utenant", "201");
    await issue([{ room: "201", water: 1, elec: 1 }]);
    data.set("prepay:201", { room: "201", slipPath: null, slipNote: "x", slipAt: ago(1000), slipCount: 1 });
    const r = await issue([{ room: "201", water: 2, elec: 2 }]);
    assert.deepStrictEqual([r.body.rooms[0].reissued, r.body.rooms[0].prepaid], [true, true]);
    assert.strictEqual(data.get("bill:2026-11:201").status, "pending");
    assert.strictEqual(prepayOf("201"), null);
  });

  await tc("TC-17-17", "จ่ายครบรอบแล้วโอนล่วงหน้ารอบถัดไปได้อีก (วนซ้ำ) และไม่ติดบิลที่จ่ายแล้ว", async () => {
    bindDirect("Utenant", "201");
    await sendSlip("Utenant");
    await issue([{ room: "201", water: 1, elec: 1 }]);
    await tap("Uowner", "action=confirm&room=201&period=2026-11");
    const r = await sendSlip("Utenant");
    assert.strictEqual(r.body.status, "advance", "November is paid, so this slip is for December");
    const dec = await issue([{ room: "201", water: 1, elec: 1 }], { period: "2026-12", due: "2026-12-16" });
    assert.strictEqual(dec.body.rooms[0].prepaid, true);
    assert.strictEqual(data.get("bill:2026-11:201").status, "paid");
    assert.strictEqual(data.get("bill:2026-12:201").status, "pending");
  });

  await tc("TC-17-18", "แข่งกัน: สลิปล่วงหน้ากับการออกบิลสลับกันทุกแบบ — ผูกสลิปเข้าบิลเสมอ (pending, prepay ถูกล้าง, การ์ดยืนยันถึงเจ้าของใบเดียว) ไม่ค้างรอรอบหน้า · สลิปล่วงหน้าที่เจ้าของบันทึก (byStaff) ผูกได้ทั้งฝั่ง run และฝั่ง slip · การ์ดซ้ำที่เนื้อหาต่างกันไม่ถูกตัด", async () => {
    const final = () => {
      const b = data.get("bill:2026-11:201");
      assert.deepStrictEqual([b.status, b.prepaid, !!b.slipPath, b.slipCount], ["pending", true, true, 1]);
      assert.deepStrictEqual(data.get("bill:201"), b, "both copies agree");
      assert.strictEqual(prepayOf("201"), null, "the advance record is consumed");
      assert.strictEqual(ownerCards().length, 1, "the owner got exactly one accepted confirm card");
      assert.ok(ownerCards()[0].messages[0].altText.includes("3,532"));
      return b;
    };
    const billWrite = (after) => (op, key) => op === "set" && key === "bill:2026-11:201" && (!after || after.done);

    // A) run read prepay (none) -> the slip lands whole -> run writes the bill: run's second look attaches it.
    bindDirect("Utenant", "201");
    let hold = mkHolds();
    const firstWrite = hold(billWrite());
    const issuing = issue([{ room: "201", water: 1, elec: 1 }]);
    await firstWrite.reached;
    let s = await sendSlip("Utenant");
    assert.strictEqual(s.body.status, "advance", "no bill yet when the slip looked");
    assert.ok(prepayOf("201"), "so it waited as a prepay");
    firstWrite.release();
    await issuing;
    final();

    // B) the slip read the bill (none) -> run issues the bill whole -> the slip writes prepay: the slip's second look attaches it.
    data.clear(); files.clear(); pushed.length = 0; retryKeys.clear(); conflicts.length = 0;
    bindDirect("Utenant", "201");
    hold = mkHolds();
    const beforePrepay = hold((op, key) => op === "set" && key === "prepay:201");
    const sending = sendSlip("Utenant");
    await beforePrepay.reached;
    await issue([{ room: "201", water: 1, elec: 1 }]);
    assert.strictEqual(data.get("bill:2026-11:201").status, "unpaid", "run saw no slip");
    beforePrepay.release();
    s = await sending;
    assert.deepStrictEqual([s.status, s.body.status, s.body.attached, s.body.total, s.body.hasSlip], [200, "pending", true, 3532, true]);
    final();

    // C) both look at the same moment and both attach: identical writes, and LINE drops the second owner card.
    data.clear(); files.clear(); pushed.length = 0; retryKeys.clear(); conflicts.length = 0;
    bindDirect("Utenant", "201");
    hold = mkHolds();
    const runWrite1 = hold(billWrite());
    const runAttach = hold(billWrite(runWrite1)); // run's own attach write, held until the slip has attached too
    const slipWrote = hold((op, key) => op === "set-done" && key === "prepay:201");
    const issuing2 = issue([{ room: "201", water: 1, elec: 1 }]);
    await runWrite1.reached;
    const sending2 = sendSlip("Utenant");
    await slipWrote.reached; // prepay is stored; the slip has not looked at the bill yet
    runWrite1.release(); // the bill is written, run's second look finds the prepay and is about to attach
    await runAttach.reached;
    slipWrote.release(); // the slip now sees the unpaid bill and attaches first
    s = await sending2;
    assert.deepStrictEqual([s.body.status, s.body.attached], ["pending", true]);
    assert.strictEqual(ownerCards().length, 1, "the slip's card went out");
    runAttach.release();
    await issuing2;
    assert.strictEqual(conflicts.length, 1, "run's identical card was dropped by LINE (same retry key)");
    final();

    // D) run attached before the slip's second look: the slip sees it is already on the bill and sends no card of its own.
    data.clear(); files.clear(); pushed.length = 0; retryKeys.clear(); conflicts.length = 0;
    bindDirect("Utenant", "201");
    hold = mkHolds();
    const w1 = hold(billWrite());
    const wrote = hold((op, key) => op === "set-done" && key === "prepay:201");
    const issuing3 = issue([{ room: "201", water: 1, elec: 1 }]);
    await w1.reached;
    const sending3 = sendSlip("Utenant");
    await wrote.reached;
    w1.release();
    await issuing3; // run attached everything and finished
    wrote.release();
    s = await sending3;
    assert.deepStrictEqual([s.body.status, s.body.attached], ["pending", true]);
    assert.strictEqual(conflicts.length, 0, "no second card was even tried");
    final();

    // E) a previous tenant's unpaid bill is not the new tenant's: the slip stays an advance.
    data.clear(); files.clear(); pushed.length = 0; retryKeys.clear(); conflicts.length = 0;
    bindDirect("Utenant", "201");
    data.set("tenancy:201", { since: "2026-11-05T00:00:00.000Z" });
    putBill(mkBill("201", "2026-10", "unpaid", { issuedAt: "2026-10-01T00:00:00.000Z" }));
    s = await sendSlip("Utenant");
    assert.strictEqual(s.body.status, "advance");
    assert.ok(prepayOf("201"));
    assert.strictEqual(data.get("bill:2026-10:201").status, "unpaid", "the old bill is untouched");

    // F) the OWNER recorded the advance slip (cash, a transfer seen in the bank app): the tenant did
    // not send it, but it is the room's, so /api/run attaches it like a tenant's.
    data.clear(); files.clear(); pushed.length = 0; retryKeys.clear(); conflicts.length = 0;
    bindDirect("Utenant", "201");
    s = await call(slip, { user: "Uowner", body: { room: "201", image: PNG, note: "เงินสด" } });
    assert.strictEqual(s.body.status, "advance");
    assert.deepStrictEqual([prepayOf("201").by, prepayOf("201").byStaff], ["Uowner", true], "marked as recorded by the owner");
    const ran = await issue([{ room: "201", water: 1, elec: 1 }]);
    assert.strictEqual(ran.body.rooms[0].prepaid, true);
    assert.strictEqual(final().slipNote, "เงินสด");
    // a tenant's own prepay is still tied to that tenant (a stale one from a previous tenant is ignored)
    data.clear(); files.clear(); pushed.length = 0; retryKeys.clear(); conflicts.length = 0;
    bindDirect("Unew", "201");
    data.set("prepay:201", { room: "201", slipPath: null, slipAt: ago(60000), slipCount: 1, by: "Uold", slipVerify: null });
    await issue([{ room: "201", water: 1, elec: 1 }]);
    assert.strictEqual(data.get("bill:2026-11:201").status, "unpaid", "someone else's prepay is not the new tenant's");

    // G) the owner's advance slip is written while the bill is being issued: the slip-side second look attaches it.
    data.clear(); files.clear(); pushed.length = 0; retryKeys.clear(); conflicts.length = 0;
    bindDirect("Utenant", "201");
    hold = mkHolds();
    const beforeOwnerPrepay = hold((op, key) => op === "set" && key === "prepay:201");
    const recording = call(slip, { user: "Uowner", body: { room: "201", image: PNG } });
    await beforeOwnerPrepay.reached;
    await issue([{ room: "201", water: 1, elec: 1 }]);
    assert.strictEqual(data.get("bill:2026-11:201").status, "unpaid", "run saw no slip");
    beforeOwnerPrepay.release();
    s = await recording;
    assert.deepStrictEqual([s.status, s.body.status, s.body.attached, s.body.total], [200, "pending", true, 3532]);
    final();

    // H) the card's retry key holds the total: the same slip on a bill re-issued with another total
    // is a different card and is delivered, while the identical card is still dropped.
    const { confirmKey } = require("./api/_bills");
    const k = { room: "201", period: "2026-11", total: 3532, slipAt: "2026-11-02T00:00:00.000Z" };
    assert.notStrictEqual(confirmKey(k), confirmKey({ ...k, total: 4450 }));
    assert.notStrictEqual(confirmKey(k), confirmKey({ ...k, slipAt: "2026-11-03T00:00:00.000Z" }));
    assert.strictEqual(confirmKey(k), confirmKey({ ...k }));
  });

  // ================================================================ UC-18 ยกเลิกบิล (void) และออกบิลใหม่
  const voidIt = (room, period, reason, user = "Uowner") =>
    call(bill, { user, body: { action: "void", room, period, reason } });
  const voidedList = (user, query) => call(bill, { method: "GET", user, query: { voided: "1", ...query } });

  await tc("TC-18-1", "เจ้าของยกเลิกบิล unpaid: สถานะ void + เหตุผล/ผู้ยกเลิก/เวลา ทั้งสองสำเนา · ผู้เช่าได้ข้อความพร้อมเหตุผล · ยกเลิกซ้ำ 409", async () => {
    bindDirect("Utenant", "201");
    await issue([{ room: "201", water: 10, elec: 100 }]);
    pushed.length = 0;
    const r = await voidIt("201", "2026-11", "  คีย์หน่วยผิด  ");
    assert.deepStrictEqual([r.status, r.body], [200, { ok: true, room: "201", period: "2026-11", status: "void" }]);
    const b = data.get("bill:2026-11:201");
    assert.deepStrictEqual(
      [b.status, b.voidReason, b.voidedBy, b.statusBefore, b.total, b.rev],
      ["void", "คีย์หน่วยผิด", "Uowner", "unpaid", 4450, 1]
    );
    assert.ok(b.voidedAt);
    assert.deepStrictEqual(data.get("bill:201"), b, "both copies agree");
    assert.deepStrictEqual(textsTo("Utenant"), ["บิลห้อง 201 รอบ 2026-11 ถูกยกเลิก — คีย์หน่วยผิด"]);
    const again = await voidIt("201", "2026-11", "อีกครั้ง");
    assert.deepStrictEqual([again.status, again.body.error.code], [409, "INVALID_STATE"]);
    assert.strictEqual(data.get("bill:2026-11:201").voidReason, "คีย์หน่วยผิด", "the first reason stays");
  });

  await tc("TC-18-2", "ยกเลิกบิลที่จ่ายแล้ว/รอตรวจ: เลขใบเสร็จ วันที่ชำระ ผู้ยืนยัน และสลิปยังอยู่บนบิล (void คือหลักฐาน ไม่ใช่การลบ)", async () => {
    putBill(mkBill("201", "2026-11", "paid", { receiptNo: "R202611-201", paidAt: ago(1000), confirmedBy: "Uowner" }));
    putBill(mkBill("202", "2026-11", "pending", { slipPath: "slips/202.png", slipNote: "โอนแล้ว", slipCount: 1 }));
    files.set("slips/202.png", Buffer.from("png"));
    assert.strictEqual((await voidIt("201", "2026-11", "ผิดห้อง")).status, 200);
    assert.strictEqual((await voidIt("202", "2026-11", "ผิดงวด")).status, 200);
    const paid = data.get("bill:2026-11:201");
    assert.deepStrictEqual(
      [paid.status, paid.statusBefore, paid.receiptNo, paid.confirmedBy],
      ["void", "paid", "R202611-201", "Uowner"]
    );
    assert.ok(paid.paidAt);
    const pending = data.get("bill:2026-11:202");
    assert.deepStrictEqual([pending.status, pending.statusBefore, pending.slipPath, pending.slipNote], ["void", "pending", "slips/202.png", "โอนแล้ว"]);
    assert.ok(files.has("slips/202.png"), "the photo is kept");
  });

  await tc("TC-18-3", "สิทธิ์และข้อมูลที่ส่ง: ผู้เช่า/ผู้ช่วย 403 · ไม่ล็อกอิน 401 · action/ห้อง/period/เหตุผลผิด 400 · ห้องที่ไม่มี 404 · ไม่มีบิล 404 — บิลไม่เปลี่ยน", async () => {
    bindDirect("Utenant", "201");
    await asOwner("Uhelper", "viewer");
    putBill(mkBill("201", "2026-11", "unpaid"));
    const base = { action: "void", room: "201", period: "2026-11", reason: "x" };
    const post = (user, patch = {}) => call(bill, { user, body: { ...base, ...patch } });
    assert.strictEqual((await post("Utenant")).status, 403);
    assert.strictEqual((await post("Uhelper")).status, 403);
    assert.strictEqual((await post(undefined)).status, 401);
    assert.strictEqual((await post("bad-token")).status, 403);
    for (const patch of [
      { action: "cancel" }, { action: undefined }, { room: "" }, { period: "2026-1" }, { period: "2026-13" }, { period: undefined },
      { reason: undefined }, { reason: "   " }, { reason: 5 }, { reason: "ก".repeat(201) },
    ]) {
      const r = await post("Uowner", patch);
      assert.strictEqual(r.status, 400, JSON.stringify(patch).slice(0, 50));
      assert.strictEqual(r.body.error.code, "VALIDATION");
    }
    assert.strictEqual((await post("Uowner", { room: "999" })).status, 404);
    assert.strictEqual((await post("Uowner", { period: "2026-09" })).status, 404);
    assert.strictEqual(data.get("bill:2026-11:201").status, "unpaid");
    assert.strictEqual(pushed.length, 0, "nobody was told");
    assert.strictEqual((await post("Uowner", { reason: "ก".repeat(200) })).status, 200, "200 characters is the limit, and it fits");
  });

  await tc("TC-18-4", "แจ้งผู้เช่า: ห้องว่างยกเลิกได้ไม่มี push · push ล้มเหลวก็ยกเลิกสำเร็จ · บิลของผู้เช่าเก่าไม่ส่งข้อความหาผู้เช่าใหม่", async () => {
    putBill(mkBill("201", "2026-11", "unpaid")); // nobody bound
    bindDirect("Ualice", "202");
    putBill(mkBill("202", "2026-11", "unpaid"));
    bindDirect("Ubob", "203");
    putBill(mkBill("203", "2026-11", "unpaid")); // no issuedAt: older than Bob's tenancy
    data.set("tenancy:203", { since: "2099-01-01T00:00:00.000Z" });
    failPushTo.add("Ualice");
    assert.strictEqual((await voidIt("201", "2026-11", "เหตุผล")).status, 200);
    assert.strictEqual((await quiet(() => voidIt("202", "2026-11", "เหตุผล"))).status, 200);
    assert.strictEqual((await voidIt("203", "2026-11", "เหตุผล")).status, 200);
    for (const room of ["201", "202", "203"]) assert.strictEqual(data.get(`bill:2026-11:${room}`).status, "void", room);
    assert.strictEqual(pushed.length, 0, "no tenant was messaged");
  });

  await tc("TC-18-5", "บิล void ในทางอื่น: กดยืนยันไม่ได้ · พิมพ์ \"บิล\" ได้ข้อความเหตุผล (ไม่ใช่การ์ดจ่ายเงิน) · ผู้เช่าเห็นสถานะ+เหตุผลแต่ไม่เห็น userId · แนบสลิปตอนนี้เป็นโอนล่วงหน้า", async () => {
    bindDirect("Utenant", "201");
    await issue([{ room: "201", water: 10, elec: 100 }]);
    await voidIt("201", "2026-11", "ออกผิดห้อง");
    replies.length = 0;
    await tap("Uowner", "action=confirm&room=201&period=2026-11");
    assert.ok(JSON.stringify(replies.pop().messages).includes("ยกเลิกแล้ว"));
    assert.strictEqual(data.get("bill:2026-11:201").status, "void");
    await say("Utenant", "บิล");
    const m = replies.pop().messages[0];
    assert.strictEqual(m.type, "text");
    assert.ok(m.text.includes("ถูกยกเลิก") && m.text.includes("ออกผิดห้อง"));
    const mine = await call(bill, { method: "GET", user: "Utenant" });
    assert.deepStrictEqual([mine.body.status, mine.body.voidReason], ["void", "ออกผิดห้อง"]);
    assert.strictEqual(mine.body.voidedBy, undefined, "the tenant does not see who voided it");
    assert.strictEqual((await call(bill, { method: "GET", user: "Uowner", query: { room: "201" } })).body.voidedBy, "Uowner");
    const h = await call(bill, { method: "GET", user: "Utenant", query: { history: "1" } });
    assert.strictEqual(h.body.items[0].status, "void");
    // nothing open to pay: the slip waits for the re-issued bill
    const before = JSON.stringify(data.get("bill:2026-11:201"));
    const s = await sendSlip("Utenant");
    assert.deepStrictEqual([s.status, s.body.status], [200, "advance"]);
    assert.strictEqual(JSON.stringify(data.get("bill:2026-11:201")), before, "the void bill is untouched");
    assert.ok(prepayOf("201"));
  });

  await tc("TC-18-6", "ออกบิลใหม่ทับบิล void: rev+1 · บิลสด (ไม่มีเหตุผล/สลิป/เลขใบเสร็จเก่า) · บิล void ถูกเก็บใน bill-void:<งวด>:<ห้อง>:<rev> และดัชนี · ผู้เช่าได้การ์ดใหม่ · ออกซ้ำตอน unpaid ไม่เพิ่ม rev", async () => {
    bindDirect("Utenant", "201");
    await issue([{ room: "201", water: 10, elec: 100 }]);
    await issue([{ room: "201", water: 11, elec: 100 }]); // an unpaid correction is the same bill
    assert.strictEqual(data.get("bill:2026-11:201").rev, 1);
    await voidIt("201", "2026-11", "เลขผิด");
    const voided = data.get("bill:2026-11:201");
    pushed.length = 0;
    const r = await issue([{ room: "201", water: 20, elec: 100 }]);
    assert.deepStrictEqual([r.body.rooms[0].reissued, r.body.rooms[0].pushed, r.body.rooms[0].total], [true, true, 4700]);
    const b = data.get("bill:2026-11:201");
    assert.deepStrictEqual([b.rev, b.status, b.waterUnits, b.total], [2, "unpaid", 20, 4700]);
    for (const k of ["voidReason", "voidedAt", "voidedBy", "statusBefore", "paidAt", "slipPath", "receiptNo"]) assert.strictEqual(b[k], undefined, k);
    assert.deepStrictEqual(data.get("bill:201"), b);
    assert.strictEqual(data.get("bills:201").length, 1, "the period is not indexed twice");
    assert.deepStrictEqual(data.get("bill-void:2026-11:201:1"), voided, "the cancelled bill is archived as it was");
    assert.deepStrictEqual(data.get("bill-voids:201"), ["2026-11:1"]);
    const card = lastTo("Utenant").messages[0];
    assert.strictEqual(card.type, "flex");
    assert.ok(card.altText.includes("4,700"));
    await issue([{ room: "201", water: 21, elec: 100 }]); // unpaid again: still rev 2, nothing more archived
    assert.strictEqual(data.get("bill:2026-11:201").rev, 2);
    assert.deepStrictEqual(data.get("bill-voids:201"), ["2026-11:1"]);
  });

  await tc("TC-18-7", "ทั้งเส้นทางบิลที่จ่ายแล้วแล้วออกผิด: ยืนยัน (R…-201) → ยกเลิก → ออกบิลใหม่ (rev 2) → แนบสลิป → ยืนยัน ได้ใบเสร็จใหม่ R…-201-2 และใบเก่ายังอ่านได้", async () => {
    bindDirect("Utenant", "201");
    await issue([{ room: "201", water: 10, elec: 100 }]);
    await sendSlip("Utenant");
    await tap("Uowner", "action=confirm&room=201&period=2026-11");
    assert.strictEqual(data.get("bill:2026-11:201").receiptNo, "R202611-201");
    await voidIt("201", "2026-11", "ยอดผิด");
    await issue([{ room: "201", water: 12, elec: 100 }]);
    assert.deepStrictEqual([data.get("bill:2026-11:201").rev, data.get("bill:2026-11:201").status], [2, "unpaid"]);
    await sendSlip("Utenant");
    await tap("Uowner", "action=confirm&room=201&period=2026-11");
    const b = data.get("bill:2026-11:201");
    assert.deepStrictEqual([b.status, b.receiptNo, b.rev], ["paid", "R202611-201-2", 2]);
    const receipts = pushed.filter((p) => p.to === "Utenant").flatMap((p) => p.messages).filter((m) => (m.altText || "").startsWith("ใบเสร็จรับเงิน"));
    assert.strictEqual(receipts.length, 2, "one receipt per confirmation");
    assert.ok(JSON.stringify(receipts[0]).includes("R202611-201") && !JSON.stringify(receipts[0]).includes("R202611-201-2"));
    assert.ok(JSON.stringify(receipts[1]).includes("R202611-201-2"));
    const old = data.get("bill-void:2026-11:201:1");
    assert.deepStrictEqual([old.status, old.statusBefore, old.receiptNo], ["void", "paid", "R202611-201"]);
    const h = await call(bill, { method: "GET", user: "Utenant", query: { history: "1" } });
    assert.strictEqual(h.body.items[0].receiptNo, "R202611-201-2");
    const list = await voidedList("Uowner", { room: "201" });
    assert.deepStrictEqual(list.body.items.map((i) => i.receiptNo), ["R202611-201"]);
  });

  await tc("TC-18-8", "GET /api/bill?room&voided=1: เจ้าของ/ผู้ช่วยอ่านบิลที่ถูกยกเลิก เรียงงวด→rev ใหม่ก่อน · กรองด้วย period · ผู้เช่า 403 · บิลที่ยกเลิกแล้วยังไม่ออกใหม่ก็อยู่ในรายการ", async () => {
    bindDirect("Utenant", "201");
    await asOwner("Uhelper", "viewer");
    const oct = { period: "2026-10", due: "2026-10-16" };
    await issue([{ room: "201", water: 1, elec: 1 }], oct);
    await voidIt("201", "2026-10", "ต.ค. ผิด");
    await issue([{ room: "201", water: 2, elec: 1 }], oct); // October rev 2
    await issue([{ room: "201", water: 1, elec: 1 }]);
    await voidIt("201", "2026-11", "พ.ย. ผิด ครั้งที่ 1");
    await issue([{ room: "201", water: 2, elec: 1 }]); // November rev 2
    await voidIt("201", "2026-11", "พ.ย. ผิด ครั้งที่ 2");
    await issue([{ room: "201", water: 3, elec: 1 }]); // November rev 3
    await issue([{ room: "201", water: 1, elec: 1 }], { period: "2026-12", due: "2026-12-16" });
    await voidIt("201", "2026-12", "ธ.ค. ยังไม่ออกใหม่"); // void without a re-issue: archived at void time
    const all = await voidedList("Uowner", { room: "201" });
    assert.strictEqual(all.status, 200);
    assert.deepStrictEqual(all.body.items.map((i) => [i.period, i.rev, i.status]), [["2026-12", 1, "void"], ["2026-11", 2, "void"], ["2026-11", 1, "void"], ["2026-10", 1, "void"]]);
    assert.deepStrictEqual(all.body.items.map((i) => i.voidReason), ["ธ.ค. ยังไม่ออกใหม่", "พ.ย. ผิด ครั้งที่ 2", "พ.ย. ผิด ครั้งที่ 1", "ต.ค. ผิด"]);
    assert.deepStrictEqual((await voidedList("Uowner", { room: "201", period: "2026-11" })).body.items.length, 2);
    assert.deepStrictEqual((await voidedList("Uowner", { room: "201", period: "2026-09" })).body.items, []);
    assert.strictEqual((await voidedList("Uhelper", { room: "201" })).status, 200, "a viewer may read");
    assert.deepStrictEqual((await voidedList("Uowner", { room: "202" })).body.items, [], "a room with none");
    assert.strictEqual((await voidedList("Utenant", { room: "201" })).status, 403);
    assert.strictEqual((await voidedList("Utenant", {})).status, 403, "not even their own room");
    assert.strictEqual((await voidedList(undefined, { room: "201" })).status, 401);
    assert.strictEqual((await voidedList("Uowner", { room: "201", period: "2026-1" })).status, 400);
    assert.strictEqual((await call(bill, { method: "GET", user: "Uowner", query: { room: "201", period: "2026-12" } })).body.status, "void", "the December void still reads as the bill");
  });

  await tc("TC-18-9", "ออกบิลใหม่ทับบิล void ที่มี prepay รออยู่: บิลใหม่ pending พร้อมสลิป (prepaid, rev 2) · prepay ถูกล้าง · เจ้าของได้การ์ดยืนยัน", async () => {
    bindDirect("Utenant", "201");
    await issue([{ room: "201", water: 10, elec: 100 }]);
    await voidIt("201", "2026-11", "เลขผิด");
    await sendSlip("Utenant", { note: "โอนรอบิลใหม่" });
    const waiting = prepayOf("201");
    pushed.length = 0;
    const r = await issue([{ room: "201", water: 11, elec: 100 }]);
    assert.deepStrictEqual([r.body.rooms[0].reissued, r.body.rooms[0].prepaid], [true, true]);
    const b = data.get("bill:2026-11:201");
    assert.deepStrictEqual([b.rev, b.status, b.prepaid, b.slipPath, b.slipNote], [2, "pending", true, waiting.slipPath, "โอนรอบิลใหม่"]);
    assert.strictEqual(prepayOf("201"), null);
    assert.strictEqual(cardData(lastTo("Uowner").messages[0]), "action=confirm&room=201&period=2026-11");
    assert.strictEqual(data.get("bill-void:2026-11:201:1").status, "void");
  });

  await tc("TC-18-10", "บิลระบบเก่าที่มีแค่ bill:<ห้อง> (ไม่มีสำเนารายงวด) ยกเลิกและออกใหม่ได้ — ได้ rev 2 และใบเก่าถูกเก็บ", async () => {
    data.set("bill:201", mkBill("201", "2026-11", "paid", { paidAt: ago(1000) }));
    assert.strictEqual((await voidIt("201", "2026-11", "ระบบเก่า")).status, 200);
    assert.strictEqual(data.get("bill:201").status, "void");
    assert.deepStrictEqual(data.get("bill:2026-11:201"), data.get("bill:201"), "the per-period copy is written now");
    assert.deepStrictEqual(data.get("bills:201"), ["2026-11"]);
    await issue([{ room: "201", water: 1, elec: 1 }]);
    assert.deepStrictEqual([data.get("bill:2026-11:201").rev, data.get("bill:2026-11:201").status], [2, "unpaid"]);
    assert.strictEqual(data.get("bill-void:2026-11:201:1").statusBefore, "paid");
  });

  await tc("TC-18-13", "ยกเลิกบิลที่จ่ายแล้ว: เจ้าของบันทึก 'คืนเงินแล้ว' (refunded) · รายการค้างคืนเงินข้ามห้อง · ติดตามได้ว่าคืนหรือยัง · ผู้เช่า/ผู้ช่วยทำไม่ได้ · ไม่ซ้ำ · ผู้เช่าไม่เห็นผู้บันทึก · ยอดโอนเกิน (kind=overpaid) ค้างคืนและบันทึกคืนได้เช่นกัน", async () => {
    bindDirect("Utenant", "201");
    await asOwner("Uhelper", "viewer");
    putBill(mkBill("201", "2026-11", "paid", { receiptNo: "R202611-201", paidAt: ago(1000), confirmedBy: "Uowner" }));
    putBill(mkBill("202", "2026-11", "unpaid"));
    putBill(mkBill("203", "2026-11", "paid", { paidAt: ago(1000), total: 3000 }));
    assert.strictEqual((await voidIt("201", "2026-11", "ออกผิด")).body.refund, 4450);
    await voidIt("202", "2026-11", "ผิดห้อง"); // never paid: no refund owed
    await voidIt("203", "2026-11", "ผิดห้อง");
    const refunds = (user, query = {}) => call(bill, { method: "GET", user, query: { voided: "1", refunds: "1", ...query } });
    const mark = (body, user = "Uowner") => call(bill, { user, body: { action: "refunded", ...body } });

    let r = await refunds("Uowner");
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.items.map((i) => [i.room, i.refundDue]).sort(), [["201", 4450], ["203", 3000]], "all rooms, only the ones that were paid");
    assert.deepStrictEqual([r.body.count, r.body.total], [2, 7450]);
    assert.deepStrictEqual((await refunds("Uhelper", { room: "203" })).body.items.map((i) => i.room), ["203"], "a viewer reads, room= narrows");
    assert.strictEqual((await refunds("Utenant")).status, 403);
    assert.strictEqual((await refunds("Utenant", { room: "201" })).status, 403);

    // who may record it, and what must be valid
    assert.strictEqual((await mark({ room: "201", period: "2026-11", rev: 1 }, "Uhelper")).status, 403);
    assert.strictEqual((await mark({ room: "201", period: "2026-11", rev: 1 }, "Utenant")).status, 403);
    assert.strictEqual((await mark({ room: "999", period: "2026-11", rev: 1 })).status, 404);
    assert.strictEqual((await mark({ room: "201", period: "2026-11", rev: 7 })).status, 404, "no such void record");
    assert.strictEqual((await mark({ room: "201", period: "2026-11", rev: 0 })).status, 400);
    assert.strictEqual((await mark({ room: "201", period: "2026-1", rev: 1 })).status, 400);
    assert.strictEqual((await mark({ room: "201", period: "2026-11", rev: 1, note: "x".repeat(201) })).status, 400);
    const unpaidVoid = await mark({ room: "202", period: "2026-11", rev: 1 });
    assert.deepStrictEqual([unpaidVoid.status, unpaidVoid.body.error.code], [409, "INVALID_STATE"], "nothing was paid, nothing to refund");
    assert.strictEqual(data.get("bill-void:2026-11:201:1").refundedAt, undefined, "nothing changed yet");

    // the owner records it
    r = await mark({ room: "201", period: "2026-11", rev: 1, note: "  โอนคืนแล้ว  " });
    assert.deepStrictEqual([r.status, r.body.ok, r.body.refundDue], [200, true, 4450]);
    const archived = data.get("bill-void:2026-11:201:1");
    assert.deepStrictEqual([archived.refundNote, archived.refundedBy, archived.refundDue], ["โอนคืนแล้ว", "Uowner", 4450]);
    assert.ok(archived.refundedAt);
    assert.deepStrictEqual(data.get("bill:2026-11:201"), { ...data.get("bill:201") }, "both bill copies agree");
    assert.strictEqual(data.get("bill:201").refundedAt, archived.refundedAt, "the bill itself is marked while it is still that void");
    assert.deepStrictEqual((await refunds("Uowner")).body.items.map((i) => i.room), ["203"], "201 is no longer outstanding");
    const again = await mark({ room: "201", period: "2026-11", rev: 1 });
    assert.deepStrictEqual([again.status, again.body.error.code], [409, "INVALID_STATE"]);

    // the tenant sees the refund state but never the owner's userId
    const t = await call(bill, { method: "GET", user: "Utenant" });
    assert.ok(t.body.refundedAt && t.body.refundDue === 4450);
    assert.ok(!("refundedBy" in t.body) && !("voidedBy" in t.body) && !("confirmedBy" in t.body));
    assert.strictEqual((await call(bill, { method: "GET", user: "Uowner", query: { room: "201" } })).body.refundedBy, "Uowner");

    // a re-issued bill (rev 2) is a fresh bill: refunding rev 1 later must not touch it
    await issue([{ room: "203", water: 1, elec: 1 }]);
    assert.strictEqual(data.get("bill:2026-11:203").rev, 2);
    assert.strictEqual((await mark({ room: "203", period: "2026-11", rev: 1 })).status, 200);
    assert.ok(data.get("bill-void:2026-11:203:1").refundedAt);
    assert.strictEqual(data.get("bill:2026-11:203").refundedAt, undefined, "the new bill does not inherit the refund");
    assert.strictEqual(data.get("bill:2026-11:203").status, "unpaid");
    assert.deepStrictEqual((await refunds("Uowner")).body.items, []);

    // The other kind: a confirmed slip larger than the bill. The paid bill carries refundDue and an
    // "overpaid:<room>" tag (written by the confirm step); seeded here so this test stands alone.
    putBill(mkBill("204", "2026-11", "paid", { total: 3000, refundDue: 500, refundReason: "overpaid", paidAt: ago(1000), confirmedBy: "Uowner" }));
    data.set("overpaid:204", ["2026-11:1", "2026-11:1", "2026-10:1", "bad"]); // a duplicate, a missing bill and junk are ignored
    putBill(mkBill("205", "2026-11", "paid", { total: 3000, refundDue: 200, refundReason: "overpaid", rev: 2, paidAt: ago(1000) }));
    data.set("overpaid:205", ["2026-11:1"]); // tag of rev 1, but the bill is rev 2 now
    putBill(mkBill("207", "2026-11", "paid", { total: 3000, refundDue: 300, refundReason: "overpaid", refundedAt: ago(10), paidAt: ago(1000) }));
    data.set("overpaid:207", ["2026-11:1"]); // already refunded
    r = await refunds("Uowner");
    assert.deepStrictEqual(r.body.items.map((i) => [i.room, i.kind, i.refundDue]), [["204", "overpaid", 500]], "only the owed overpayment, labelled by kind");
    assert.deepStrictEqual([r.body.count, r.body.total], [1, 500]);
    putBill(mkBill("209", "2026-11", "paid", { paidAt: ago(1000) }));
    await voidIt("209", "2026-11", "ออกผิดอีกครั้ง"); // a void refund beside it
    r = await refunds("Uowner");
    assert.deepStrictEqual(r.body.items.map((i) => [i.room, i.kind]).sort(), [["204", "overpaid"], ["209", "void"]], "both kinds in one list");
    assert.deepStrictEqual((await refunds("Uhelper", { room: "204" })).body.items.map((i) => i.kind), ["overpaid"]);

    assert.strictEqual((await mark({ kind: "other", room: "204", period: "2026-11", rev: 1 })).status, 400, "unknown kind");
    const ov = (body, user = "Uowner") => mark({ kind: "overpaid", room: "204", period: "2026-11", rev: 1, ...body }, user);
    assert.strictEqual((await ov({}, "Uhelper")).status, 403);
    assert.strictEqual((await ov({ room: "999" })).status, 404);
    assert.strictEqual((await ov({ period: "2026-09" })).status, 404, "no such bill");
    assert.strictEqual((await ov({ rev: 2 })).status, 409, "another revision");
    assert.strictEqual((await mark({ kind: "overpaid", room: "202", period: "2026-11", rev: 1 })).status, 409, "a void bill is not an overpayment");
    assert.strictEqual((await mark({ kind: "overpaid", room: "207", period: "2026-11", rev: 1 })).status, 409, "already refunded");
    assert.strictEqual((await mark({ kind: "overpaid", room: "205", period: "2026-11", rev: 1 })).status, 409, "the tag is of an older revision");
    putBill(mkBill("208", "2026-11", "paid", { total: 3000 }));
    assert.strictEqual((await mark({ kind: "overpaid", room: "208", period: "2026-11", rev: 1 })).status, 409, "nothing overpaid");
    assert.strictEqual(data.get("bill:2026-11:204").refundedAt, undefined, "nothing changed yet");
    r = await ov({ note: " โอนคืนแล้ว " });
    assert.deepStrictEqual([r.status, r.body.kind, r.body.refundDue], [200, "overpaid", 500]);
    const paidBack = data.get("bill:2026-11:204");
    assert.deepStrictEqual([paidBack.status, paidBack.refundNote, paidBack.refundedBy, paidBack.total], ["paid", "โอนคืนแล้ว", "Uowner", 3000], "still a paid bill");
    assert.ok(paidBack.refundedAt && data.get("bill:204").refundedAt === paidBack.refundedAt, "both copies marked");
    assert.deepStrictEqual((await refunds("Uowner")).body.items.map((i) => i.room), ["209"], "the overpayment is no longer outstanding");
    assert.strictEqual((await ov({})).status, 409, "not twice");

    // Voiding a paid bill that also has an overpaid extra: the void refund is the total PLUS the extra
    // still owed (the paid bill drops off the overpaid list the moment it is void, so nothing else would show it).
    putBill(mkBill("210", "2026-11", "paid", { total: 3000, refundDue: 500, refundReason: "overpaid", paidAt: ago(1000) }));
    data.set("overpaid:210", ["2026-11:1"]);
    r = await voidIt("210", "2026-11", "ออกผิด");
    assert.deepStrictEqual([r.status, r.body.refund], [200, 3500], "total + the extra still owed");
    const owedBoth = (await refunds("Uowner", { room: "210" })).body;
    assert.deepStrictEqual(owedBoth.items.map((i) => [i.kind, i.refundDue]), [["void", 3500]], "one void item, no overpaid item");
    assert.strictEqual(owedBoth.total, 3500);
    const v210 = data.get("bill-void:2026-11:210:1");
    assert.deepStrictEqual([v210.refundDue, v210.refundReason, v210.priorRefund], [3500, undefined, undefined]);

    // The extra was already paid back: the void owes only the total, and the old refund mark must not
    // hide it as "already refunded"; the earlier refund stays on the record as history.
    putBill(mkBill("211", "2026-11", "paid", { total: 3000, refundDue: 300, refundReason: "overpaid", refundedAt: "2026-11-05T00:00:00.000Z", refundedBy: "Uowner", refundNote: "โอนแล้ว", paidAt: ago(1000) }));
    data.set("overpaid:211", ["2026-11:1"]);
    r = await voidIt("211", "2026-11", "ออกผิด");
    assert.deepStrictEqual([r.status, r.body.refund], [200, 3000]);
    const v211 = data.get("bill-void:2026-11:211:1");
    assert.deepStrictEqual([v211.refundDue, v211.refundedAt, v211.refundedBy, v211.refundNote, v211.refundReason], [3000, undefined, undefined, undefined, undefined], "no inherited refund mark");
    assert.deepStrictEqual(v211.priorRefund, { reason: "overpaid", amount: 300, refundedAt: "2026-11-05T00:00:00.000Z" });
    assert.deepStrictEqual((await refunds("Uowner", { room: "211" })).body.items.map((i) => [i.kind, i.refundDue]), [["void", 3000]], "the void refund is still outstanding");
  });

  // ================================================================ report
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} use case tests passed`);
  if (failed.length) {
    console.log(`failed: ${failed.map((x) => x.id).join(", ")}`);
    process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
