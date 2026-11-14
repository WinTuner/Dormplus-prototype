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
const store = {
  get: async (k) => (data.has(k) ? data.get(k) : null),
  set: async (k, v) => data.set(k, v),
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
  if (u.includes("/message/push")) {
    const body = JSON.parse(opts.body);
    if (failPushTo.has(body.to)) return { ok: false, status: 500, text: async () => "push down", json: async () => ({}) };
    pushed.push(body);
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
const { MAX_FAILURES } = require("./api/_limit");

// ---------------------------------------------------------------- runner
const results = [];
async function tc(id, title, fn) {
  // every block starts from an empty dorm, so blocks never depend on each other
  data.clear();
  files.clear();
  pushed.length = replies.length = menuLinks.length = unlinked.length = 0;
  failPushTo.clear();
  failRichMenu = false;
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

  await tc("TC-02-6", "ไม่ส่ง water/elec (หรือส่ง null) นับเป็น 0 หน่วย ไม่ใช่ error", async () => {
    const r = await issue([{ room: "201" }, { room: "202", water: null, elec: null }]);
    assert.ok(!r.body.rooms[0].error && !r.body.rooms[1].error);
    assert.strictEqual(data.get("bill:2026-11:201").total, 3500, "rent only");
    assert.strictEqual(data.get("bill:2026-11:202").waterUnits, 0);
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

  // ================================================================ UC-04 ยืนยันการชำระ
  await tc("TC-04-1", "ทั้งเส้นทาง: เจ้าของขอ QR ห้อง → ผู้เช่าผูก → ออกบิล → ผู้เช่าอ่านบิล → แนบสลิป → เจ้าของกดยืนยันจากการ์ด → บิล paid", async () => {
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
    assert.ok(JSON.stringify(lastTo("Utenant").messages).includes("ชำระเงินแล้ว"), "the tenant is told");
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

  await tc("TC-07-9", "คนที่เป็นเจ้าของอยู่แล้วใช้รหัส → already:true ไม่เปลี่ยนสิทธิ์ และรหัสยังไม่ถูกใช้", async () => {
    await asOwner("Uco", "owner");
    const { body } = await invite("Uowner", "viewer");
    const r = await redeem("Uco", body.code);
    assert.deepStrictEqual([r.status, r.body.already, r.body.role], [200, true, "owner"]);
    assert.strictEqual(data.get("owner:Uco").role, "owner", "not downgraded to helper");
    assert.ok(!data.get(`owner-invite:${body.code}`).usedAt);
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

  await tc("TC-10-3", "ประวัติบิล (history=1): ทุกงวดเรียงใหม่→เก่า พร้อม total/status/due/hasSlip", async () => {
    bindDirect("Utenant", "201");
    await issue([{ room: "201", water: 1, elec: 1 }], { period: "2026-10", due: "2026-10-16" });
    await issue([{ room: "201", water: 2, elec: 2 }], { period: "2026-11", due: "2026-11-16" });
    const r = await call(bill, { method: "GET", query: { history: "1" }, user: "Utenant" });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.items.map((i) => i.period), ["2026-11", "2026-10"]);
    assert.deepStrictEqual(Object.keys(r.body.items[0]).sort(), ["due", "hasSlip", "period", "status", "total"]);
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

  await tc("TC-11-2", "แจ้งชำระโดยไม่แนบรูป (มีแต่หมายเหตุ) ได้ → pending, hasSlip=false (เจ้าของตัดสินจากหมายเหตุ/ยอดเงินเข้า)", async () => {
    bindDirect("Utenant", "201");
    putBill(mkBill("201", "2026-11", "unpaid"));
    const r = await call(slip, { user: "Utenant", body: { note: "โอนผ่านพร้อมเพย์" } });
    assert.deepStrictEqual([r.status, r.body.status, r.body.hasSlip], [200, "pending", false]);
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
    const r = await call(slip, { user: "Utenant", body: { note: "โอนพร้อมเพย์" } });
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
      assert.deepStrictEqual(Object.keys(by["201"].advance).sort(), ["hasSlip", "slipAt"]);
      assert.strictEqual(by["201"].advance.hasSlip, true);
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
    await call(slip, { user: "Utenant", body: { note: "โอนแล้วไม่มีรูป" } });
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
