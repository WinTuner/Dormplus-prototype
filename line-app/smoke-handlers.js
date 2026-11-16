// Offline tests of the API handlers that guard money and room bindings.
// No network and no node_modules: the Blob store is an in-memory Map, LINE is a stubbed fetch,
// and an idToken "U…" verifies as that same userId.
const assert = require("assert");
const crypto = require("crypto");
const path = require("path");

process.env.LINE_CHANNEL_SECRET = "test-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
process.env.LIFF_ID = "2000000000-testliff";
process.env.OWNER_USER_ID = "Uowner";
delete process.env.VERCEL_ENV;
delete process.env.ALLOW_SEED_BYPASS;
process.env.SEED_TOKEN = "a-long-enough-seed-token";

// ---------------------------------------------------------------- fakes
const data = new Map();
const files = new Map();
const pathOf = (k) => `kv/${String(k).replace(/[^a-zA-Z0-9._-]/g, "-")}.json`;
const store = {
  get: async (k) => (data.has(k) ? data.get(k) : null),
  set: async (k, v) => data.set(k, v),
  // Mirror _store: the prefix goes through pathOf too, so "owner:" also matches "owner-invite:<code>".
  // A key written as null still exists as a file, so listings include it.
  keysWith: async (prefix) => {
    const pathPrefix = pathOf(prefix).replace(/\.json$/, "");
    return [...data.keys()]
      .filter((k) => pathOf(k).startsWith(pathPrefix))
      .map((k) => prefix + pathOf(k).slice(pathPrefix.length).replace(/\.json$/, ""));
  },
  getFile: async (p) => (files.has(p) ? { blob: { contentType: "image/jpeg" } } : null),
  putFile: async (p, bytes) => files.set(p, bytes),
  delFile: async (p) => files.delete(p),
};

const api = (name) => path.join(__dirname, "api", name);
require.cache[require.resolve(api("_store"))] = {
  id: api("_store.js"),
  filename: api("_store.js"),
  loaded: true,
  exports: store,
};

// qrcode-svg is a real dependency; this suite must also run without node_modules, so hand out a stand-in.
const Module = require("module");
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "qrcode-svg") return class { svg() { return "<svg/>"; } };
  return realLoad.call(this, request, ...rest);
};

const pushed = [];
const unlinked = [];
let verifyCalls = 0;
// SlipOK is the only outbound call these tests care about: `slipok` holds what it should answer.
let slipok = null;
const slipokCalls = [];
global.fetch = async (url, opts = {}) => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  if (String(url).includes("api.slipok.com")) {
    slipokCalls.push({ url: String(url), init: opts });
    if (!slipok) return { ok: false, status: 500, json: async () => ({}), text: async () => "{}" };
    return { ok: slipok.status === 200, status: slipok.status, json: async () => slipok.body, text: async () => JSON.stringify(slipok.body) };
  }
  if (String(url).includes("/oauth2/v2.1/verify")) {
    verifyCalls++;
    const token = new URLSearchParams(opts.body).get("id_token");
    return token && token.startsWith("U") ? ok({ sub: token, exp: Math.floor(Date.now() / 1000) + 3600 }) : { ok: false, status: 400, json: async () => ({}) };
  }
  if (String(url).includes("/message/push")) pushed.push(JSON.parse(opts.body));
  const user = /\/v2\/bot\/user\/([^/]+)\/richmenu$/.exec(String(url));
  if (user && opts.method === "DELETE") unlinked.push(user[1]);
  const profile = /\/v2\/bot\/profile\/([^/]+)$/.exec(String(url));
  if (profile) return ok({ displayName: `name-${profile[1]}` });
  return ok({});
};

function call(handler, { method = "POST", query = {}, body, user, headers = {} }) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(obj) { resolve({ status: this.statusCode, body: obj }); return this; },
      end() { resolve({ status: this.statusCode, body: null }); },
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

function webhook(handler, events) {
  const raw = Buffer.from(JSON.stringify({ events }));
  const signature = crypto.createHmac("sha256", "test-secret").update(raw).digest("base64");
  const req = {
    method: "POST",
    headers: { "x-line-signature": signature, host: "test.local" },
    async *[Symbol.asyncIterator]() { yield raw; },
  };
  return new Promise((resolve, reject) => {
    const res = {
      status(code) { this.code = code; return this; },
      json(obj) { resolve({ status: this.code, body: obj }); return this; },
      // slip-image answers with res.end(buffer); without this a broken authz would hang the suite.
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
const dev = require("./api/dev");
const hook = require("./api/webhook");
const { MAX_FAILURES } = require("./api/_limit");
const { saveBill } = require("./api/_bills");

(async () => {
  // ---------------------------------------------------------------- /api/dev is gone on production
  let r = await call(dev, { query: { do: "seed" }, headers: { "x-seed-token": process.env.SEED_TOKEN } });
  assert.strictEqual(r.status, 404, "/api/dev does not exist unless dev tools are allowed");
  assert.strictEqual(data.size, 0, "and it wrote nothing");

  // ---------------------------------------------------------------- QR binding
  data.set("qr-code:CODE203", "203");
  r = await call(qr, { body: { code: "code203" }, user: "Ualice" });
  assert.strictEqual(r.status, 200, "first tenant binds an empty room");
  assert.strictEqual(data.get("room-user:203"), "Ualice");
  assert.ok(pushed.some((p) => p.to === "Uowner"), "the owner is told about the new binding");

  r = await call(qr, { body: { code: "CODE203" }, user: "Umallory" });
  assert.strictEqual(r.status, 409, "a photo of the door QR cannot take an occupied room");
  assert.strictEqual(r.body.error.code, "ROOM_TAKEN");
  assert.strictEqual(data.get("room-user:203"), "Ualice", "the real tenant keeps the room");
  assert.strictEqual(data.get("user-room:Umallory") ?? null, null, "the intruder is bound to nothing");

  r = await call(qr, { body: { code: "CODE203" }, user: "Ualice" });
  assert.strictEqual(r.status, 200, "the same tenant scanning again is fine");

  r = await call(qr, { method: "GET", query: { room: "203" }, user: "Ualice" });
  assert.strictEqual(r.status, 403, "only the owner sees or changes a room's QR");

  r = await call(qr, { method: "GET", query: { room: "999" }, user: "Uowner" });
  assert.strictEqual(r.status, 404, "rooms outside ROOMS do not exist");

  r = await call(qr, { method: "GET", query: { room: "203" }, user: "Uowner" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.unbound, false, "looking at the QR unbinds nobody");

  r = await call(qr, { method: "GET", query: { room: "203" }, user: "Uowner" });
  const before = r.body.code;
  r = await call(qr, { method: "POST", query: { room: "203" }, user: "Uowner" });
  assert.strictEqual(r.body.unbound, true, "changing tenant unbinds the current one");
  assert.notStrictEqual(r.body.code, before, "and issues a new code");
  assert.strictEqual(data.get("room-user:203"), null);
  assert.strictEqual(data.get("user-room:Ualice"), null, "the old tenant can no longer read the room");
  assert.strictEqual(data.get(`qr-code:${before}`), null, "the old door QR stops working");

  r = await call(qr, { body: { code: r.body.code }, user: "Ubob" });
  assert.strictEqual(r.status, 200, "the new tenant binds with the new QR");

  // Moving rooms asks first: a forwarded ?bind= link must not move a tenant without them saying so.
  data.set("qr-code:CODE204", "204");
  r = await call(qr, { body: { code: "CODE204" }, user: "Ubob" });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error.code, "MOVE_CONFIRM_REQUIRED");
  assert.strictEqual(r.body.error.current, "203", "the page is told the room they would leave");
  assert.strictEqual(data.get("user-room:Ubob"), "203", "nothing moved yet");
  assert.strictEqual(data.get("room-user:204") ?? null, null);

  // Once confirmed, moving rooms clears the old room's link.
  r = await call(qr, { body: { code: "CODE204", confirmMove: true }, user: "Ubob" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(data.get("room-user:203"), null, "203 stops sending bills to someone who moved to 204");
  assert.strictEqual(data.get("room-user:204"), "Ubob");
  assert.ok(JSON.stringify(pushed.filter((p) => p.to === "Uowner").pop()).includes("204"),
    "the owner is told when a tenant moves rooms");

  const noticesBefore = pushed.length;
  r = await call(qr, { body: { code: "CODE204" }, user: "Ubob" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(pushed.length, noticesBefore, "scanning your own room again sends no notice");

  // ---------------------------------------------------------------- rate limit on guessing
  for (let i = 0; i < MAX_FAILURES; i++) {
    r = await call(qr, { body: { code: `WRONG${i}` }, user: "Uguesser" });
    assert.strictEqual(r.status, 404);
  }
  r = await call(qr, { body: { code: "CODE204" }, user: "Uguesser" });
  assert.strictEqual(r.status, 429, "too many wrong codes in an hour");

  // An occupied room is a conflict, not a wrong code: it must not eat the tenant's allowance.
  data.set("qr-code:TAKEN211", "211");
  data.set("user-room:Uother", "211");
  data.set("room-user:211", "Uother");
  for (let i = 0; i < MAX_FAILURES; i++) {
    r = await call(qr, { body: { code: "TAKEN211" }, user: "Ustale" });
    assert.strictEqual(r.status, 409);
  }
  data.set("qr-code:FREE212", "212");
  r = await call(qr, { body: { code: "FREE212" }, user: "Ustale" });
  assert.strictEqual(r.status, 200, "scanning an occupied room does not lock you out of a free one");

  // ---------------------------------------------------------------- confirming a payment
  const nov = { room: "205", period: "2026-11", rent: 3500, water: 0, elec: 0, total: 3500, status: "pending" };
  const dec = { room: "205", period: "2026-12", rent: 3500, water: 0, elec: 0, total: 3500, status: "unpaid" };
  data.set("bill:2026-11:205", nov);
  data.set("bill:2026-12:205", dec);
  data.set("bill:205", dec);

  const tap = (user, postback) => webhook(hook, [{ type: "postback", replyToken: "r", source: { userId: user }, postback: { data: postback } }]);

  await tap("Ubob", "action=confirm&room=205&period=2026-11");
  assert.strictEqual(data.get("bill:2026-11:205").status, "pending", "a tenant cannot confirm");

  await tap("Uowner", "action=confirm&room=205&period=2026-11");
  assert.strictEqual(data.get("bill:2026-11:205").status, "paid", "the card closes the bill it was sent for");
  assert.strictEqual(data.get("bill:205").status, "unpaid", "and never the newer December bill");

  await tap("Uowner", "action=confirm&room=205");
  assert.strictEqual(data.get("bill:205").status, "unpaid", "an old card without a period cannot pay a bill with no slip");

  // Even when the newest bill IS waiting for a slip: a period-less card cannot say which month it
  // was sent for, so it must never close the newest one.
  data.set("bill:2026-12:205", { ...dec, status: "pending" });
  data.set("bill:205", { ...dec, status: "pending" });
  await tap("Uowner", "action=confirm&room=205");
  assert.strictEqual(data.get("bill:205").status, "pending", "a period-less card never closes the newest bill");

  data.set("bill:2026-12:205", { ...dec, status: "pending" });
  data.set("bill:205", { ...dec, status: "pending" });
  await tap("Uowner", "action=confirm&room=205&period=2026-12");
  assert.strictEqual(data.get("bill:205").status, "paid", "newest copy updated");
  assert.strictEqual(data.get("bill:2026-12:205").status, "paid", "history copy updated too");

  const bad = await webhook((req, res) => { req.headers["x-line-signature"] = "forged"; return hook(req, res); }, []);
  assert.strictEqual(bad.status, 401, "a forged webhook is refused");

  // ---------------------------------------------------------------- issuing bills
  data.set("bill:2026-11:206", { room: "206", period: "2026-11", total: 4000, status: "paid" });
  data.set("bill:2026-11:207", { room: "207", period: "2026-11", total: 4000, status: "unpaid" });
  r = await call(run, {
    user: "Uowner",
    body: {
      period: "2026-11",
      due: "2026-11-16",
      readings: [
        { room: "206", water: 5, elec: 30 },
        { room: "207", water: 6, elec: 31 },
        { room: "208", water: -5, elec: 30 },
        { room: "208", water: 1.5, elec: 30 },
        { room: "999", water: 1, elec: 1 },
      ],
    },
  });
  assert.strictEqual(r.status, 200);
  const [paid, reissued, negative, fraction, unknown] = r.body.rooms;
  assert.ok(paid.error, "a paid bill is never reset to unpaid");
  assert.strictEqual(data.get("bill:2026-11:206").status, "paid");
  assert.strictEqual(reissued.reissued, true, "an unpaid bill may be re-issued to fix a typo");
  assert.strictEqual(data.get("bill:2026-11:207").total, 3500 + 6 * 25 + 31 * 7);
  assert.ok(negative.error && fraction.error, "units must be whole numbers ≥ 0");
  assert.ok(unknown.error, "a room outside ROOMS is refused");
  assert.strictEqual(data.get("bill:2026-11:208") ?? null, null, "no bill was written for the bad readings");

  // A bill written before the per-period key exists only as `bill:<room>`; the guard must see it.
  data.set("bill:210", { room: "210", period: "2026-11", total: 4200, status: "paid" });
  r = await call(run, { user: "Uowner", body: { period: "2026-11", readings: [{ room: "210", water: 1, elec: 1 }] } });
  assert.ok(r.body.rooms[0].error, "a legacy paid bill is not reopened");
  assert.strictEqual(data.get("bill:210").status, "paid");
  assert.strictEqual(data.get("bill:2026-11:210") ?? null, null, "and is not rewritten under the per-period key");

  r = await call(run, { user: "Ubob", body: { period: "2026-11", readings: [{ room: "209", water: 1, elec: 1 }] } });
  assert.strictEqual(r.status, 403, "only the owner issues bills");

  r = await call(run, { user: "Uowner", body: { period: "2026-13", readings: [{ room: "209", water: 1, elec: 1 }] } });
  assert.strictEqual(r.status, 400, "a period that is not YYYY-MM is refused");

  // ---------------------------------------------------------------- idToken checks are remembered
  verifyCalls = 0;
  r = await call(me, { method: "GET", user: "Ucache" });
  assert.strictEqual(r.status, 200);
  await call(me, { method: "GET", user: "Ucache" });
  assert.strictEqual(verifyCalls, 1, "the same idToken is verified with LINE once");
  await call(me, { method: "GET", user: "bad-token" });
  r = await call(me, { method: "GET", user: "bad-token" });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(verifyCalls, 3, "a refused token is not remembered");

  // ---------------------------------------------------------------- roles, invites, removing access
  data.set("owner:Uco", { role: "owner", addedBy: "Uowner" });
  data.set("owner:Uhelper", { role: "viewer", addedBy: "Uowner" });

  r = await call(me, { method: "GET", user: "Uowner" });
  assert.deepStrictEqual([r.body.role, r.body.owner, r.body.root], ["owner", true, true]);
  r = await call(me, { method: "GET", user: "Uco" });
  assert.deepStrictEqual([r.body.role, r.body.owner, r.body.root], ["owner", true, false]);
  r = await call(me, { method: "GET", user: "Uhelper" });
  assert.deepStrictEqual([r.body.role, r.body.owner], ["viewer", false], "/api/me tells the page a helper is a viewer");

  r = await call(owner, { body: { role: "owner" }, user: "Uco" });
  assert.strictEqual(r.status, 403, "an invited owner cannot mint more owners");
  r = await call(owner, { body: { role: "viewer" }, user: "Uco" });
  assert.strictEqual(r.status, 200, "but can invite a read-only helper");
  const coHelperCode = r.body.code;
  r = await call(owner, { body: { role: "viewer" }, user: "Uhelper" });
  assert.strictEqual(r.status, 403, "a helper cannot invite anyone");
  r = await call(owner, { body: { role: "owner" }, user: "Uowner" });
  assert.strictEqual(r.status, 200, "root can invite an owner");

  r = await call(owner, { body: { code: r.body.code }, user: "Unewowner" });
  assert.deepStrictEqual([r.status, r.body.role], [200, "owner"]);
  assert.strictEqual(data.get("owner:Unewowner").role, "owner");

  // An owner code minted by a non-root owner before this rule existed is not honoured.
  data.set("owner-invite:OLDCODE1", { createdBy: "Uco", role: "owner", expiresAt: new Date(Date.now() + 60000).toISOString() });
  r = await call(owner, { body: { code: "OLDCODE1" }, user: "Usneaky" });
  assert.strictEqual(r.status, 410);
  assert.strictEqual(data.get("owner:Usneaky") ?? null, null);

  // The real store maps "owner-invite:OLDCODE1" and "owner:invite-OLDCODE1" to the same file, so a
  // listing by the "owner:" prefix can see an invite as a member. Model what get() would return.
  data.set("owner:invite-OLDCODE1", { role: "owner" });

  r = await call(owner, { method: "GET", user: "Uhelper" });
  assert.strictEqual(r.status, 403, "helpers do not see the access list");
  r = await call(owner, { method: "GET", user: "Uco" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.root, false);
  assert.ok(r.body.members.every((m) => !("userId" in m)), "only root sees LINE userIds");
  r = await call(owner, { method: "GET", user: "Uowner" });
  assert.strictEqual(r.body.root, true);
  const listed = Object.fromEntries(r.body.members.map((m) => [m.userId, m]));
  assert.ok(r.body.members.every((m) => !String(m.userId).startsWith("invite-")),
    "an unused invite code is not a person (keysWith's prefix also matches owner-invite:)");
  assert.ok(listed.Uowner.root && listed.Uowner.you, "root is listed first-class");
  assert.strictEqual(listed.Uhelper.role, "viewer");
  assert.strictEqual(listed.Uco.name, "name-Uco", "names come from the LINE profile");

  r = await call(owner, { method: "DELETE", body: { userId: "Uhelper" }, user: "Uco" });
  assert.strictEqual(r.status, 403, "only root removes access");
  r = await call(owner, { method: "DELETE", body: { userId: "Uowner" }, user: "Uowner" });
  assert.strictEqual(r.status, 409, "root cannot be removed");
  r = await call(owner, { method: "DELETE", body: { userId: "Unobody" }, user: "Uowner" });
  assert.strictEqual(r.status, 404);
  r = await call(owner, { method: "DELETE", body: { userId: "../owner:Uowner" }, user: "Uowner" });
  assert.strictEqual(r.status, 400, "a userId is checked before it becomes a key");

  r = await call(owner, { method: "DELETE", body: { userId: "Uco" }, user: "Uowner" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(data.get("owner:Uco"), null);
  assert.ok(unlinked.includes("Uco"), "the removed owner is put back on the default menu");
  r = await call(me, { method: "GET", user: "Uco" });
  assert.strictEqual(r.body.role, null, "access is gone on the very next request");
  r = await call(owner, { body: { code: coHelperCode }, user: "Ulate" });
  assert.strictEqual(r.status, 410, "codes minted by a removed owner stop working");
  r = await call(owner, { method: "GET", user: "Uowner" });
  assert.ok(!r.body.members.some((m) => m.userId === "Uco"), "removed people leave the list");

  // ---------------------------------------------------------------- slip limits
  const slipBill = { room: "209", period: "2026-11", rent: 3500, water: 0, elec: 0, total: 3500, status: "unpaid" };
  data.set("bill:209", slipBill);
  data.set("bill:2026-11:209", slipBill);
  data.set("user-room:Ucarol", "209");
  data.set("room-user:209", "Ucarol");
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const backdate = () => data.set("bill:209", { ...data.get("bill:209"), slipAt: new Date(Date.now() - 60000).toISOString() });

  r = await call(slip, { body: { note: "x".repeat(501) }, user: "Ucarol" });
  assert.strictEqual(r.status, 400, "a note over 500 characters is refused");
  r = await call(slip, { body: { note: 42 }, user: "Ucarol" });
  assert.strictEqual(r.status, 400, "a note must be text");

  r = await call(slip, { body: { image: png }, user: "Ucarol" });
  assert.strictEqual(r.status, 200);
  const firstPhoto = data.get("bill:209").slipPath;
  assert.ok(files.has(firstPhoto));
  r = await call(slip, { body: {}, user: "Ucarol" });
  assert.deepStrictEqual([r.status, r.body.error.code], [429, "SLIP_TOO_SOON"], "one slip per 30 seconds");

  backdate();
  await new Promise((resolve) => setTimeout(resolve, 2)); // a new photo gets a new millisecond name
  r = await call(slip, { body: { image: png }, user: "Ucarol" });
  assert.strictEqual(r.status, 200);
  assert.ok(!files.has(firstPhoto), "the photo it replaced is deleted");
  assert.ok(files.has(data.get("bill:209").slipPath));
  assert.strictEqual(data.get("bill:2026-11:209").slipCount, 2, "the history copy counts too");

  for (let i = 0; i < 3; i++) {
    backdate();
    assert.strictEqual((await call(slip, { body: {}, user: "Ucarol" })).status, 200);
  }
  backdate();
  const pushesBefore = pushed.length;
  r = await call(slip, { body: {}, user: "Ucarol" });
  assert.deepStrictEqual([r.status, r.body.error.code], [429, "SLIP_LIMIT"], "five slips per bill");
  assert.strictEqual(pushed.length, pushesBefore, "a refused slip costs the dorm no LINE message");

  r = await call(slip, { body: { room: "209" }, user: "Uowner" });
  assert.strictEqual(r.status, 200, "the owner is not limited (e.g. recording a cash payment)");

  // ---------------------------------------------------------------- issuing bills, one room twice
  r = await call(run, {
    user: "Uowner",
    body: { period: "2026-11", readings: [{ room: "211", water: 1, elec: 1 }, { room: "211", water: 9, elec: 9 }] },
  });
  assert.strictEqual(r.status, 200);
  assert.ok(!r.body.rooms[0].error && r.body.rooms[1].error, "the second copy of a room is refused");
  assert.strictEqual(data.get("bill:2026-11:211").total, 3500 + 25 + 7, "and the first one is what was billed");

  // ---------------------------------------------------------------- old periods never win
  await saveBill({ room: "212", period: "2026-12", total: 4000, status: "unpaid" });
  await saveBill({ room: "212", period: "2026-11", total: 3000, status: "unpaid" });
  assert.strictEqual(data.get("bill:212").period, "2026-12", "the newer bill stays the current one");
  assert.strictEqual(data.get("bill:2026-11:212").total, 3000, "the older period is still readable as history");

  // ---------------------------------------------------------------- slip images are private
  r = await call(slipImage, { method: "GET", query: { room: "211" }, user: "Ualice" });
  assert.deepStrictEqual([r.status, r.body.error.code], [403, "FORBIDDEN"], "another room's slip is not readable");
  r = await call(slipImage, { method: "GET", query: { room: "211" }, user: "Uowner" });
  assert.deepStrictEqual([r.status, r.body.error.code], [404, "NOT_FOUND"], "the owner sees 404 when there is no slip");

  // ---------------------------------------------------------------- transfer before the bill
  // 201: last month's bill is paid. 202: no bill at all. Neither room is used by the tests above.
  const bill = require("./api/bill");
  const rooms = require("./api/rooms");
  const oct = { room: "201", period: "2026-10", rent: 3500, water: 0, elec: 0, total: 3500, status: "paid" };
  await saveBill(oct);
  data.set("user-room:Udave", "201");
  data.set("room-user:201", "Udave");
  data.set("user-room:Ueve", "202");
  data.set("room-user:202", "Ueve");
  const ownerTexts = () => pushed.filter((p) => p.to === "Uowner" && p.messages[0].type === "text").map((p) => p.messages[0].text);

  r = await call(slip, { body: { image: png, note: "โอนแล้ว" }, user: "Udave" });
  assert.deepStrictEqual([r.status, r.body.status, r.body.hasSlip], [200, "advance", true], "a slip after a paid bill is an advance slip");
  let pre = data.get("prepay:201");
  assert.deepStrictEqual([pre.room, pre.slipCount, pre.by, pre.slipNote], ["201", 1, "Udave", "โอนแล้ว"]);
  assert.ok(/^slips\/201-advance-\d+\.png$/.test(pre.slipPath) && files.has(pre.slipPath));
  assert.strictEqual(data.get("bill:201").status, "paid", "the paid bill is not reopened");
  assert.strictEqual(data.get("bill:2026-10:201").slipPath ?? null, null, "and gets no slip");
  assert.strictEqual(ownerTexts().pop(), "ห้อง 201 แจ้งโอนก่อนบิลออก — โอนแล้ว · ระบบจะผูกสลิปนี้กับบิลรอบถัดไปให้เอง");

  r = await call(slip, { body: { image: png }, user: "Udave" });
  assert.deepStrictEqual([r.status, r.body.error.code], [429, "SLIP_TOO_SOON"], "advance slips are limited like bill slips");
  const firstAdvance = pre.slipPath;
  data.set("prepay:201", { ...pre, slipAt: new Date(Date.now() - 60000).toISOString() });
  await new Promise((resolve) => setTimeout(resolve, 2));
  r = await call(slip, { body: { image: png }, user: "Udave" });
  assert.strictEqual(r.status, 200);
  // Kept on purpose: the slip that replaces it may already be copied onto a bill that is being
  // written right now, and deleting the file would make that bill's slip 404.
  assert.ok(files.has(firstAdvance), "the replaced advance photo is kept, not deleted");
  assert.strictEqual(data.get("prepay:201").slipCount, 2);
  assert.strictEqual(ownerTexts().pop(), "ห้อง 201 แจ้งโอนก่อนบิลออก · ระบบจะผูกสลิปนี้กับบิลรอบถัดไปให้เอง", "no note, no dash");

  data.set("prepay:201", { ...data.get("prepay:201"), slipCount: 5, slipAt: new Date(Date.now() - 60000).toISOString() });
  r = await call(slip, { body: {}, user: "Udave" });
  assert.deepStrictEqual([r.status, r.body.error.code], [429, "SLIP_LIMIT"], "five advance slips per room");
  data.set("prepay:201", { ...data.get("prepay:201"), slipCount: 2 });

  r = await call(slip, { body: { room: "201" }, user: "Ueve" });
  assert.strictEqual(r.status, 403, "an advance slip still needs the room binding");

  r = await call(bill, { method: "GET", query: {}, user: "Udave" });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([r.body.status, r.body.advance.hasSlip, r.body.advance.note], ["paid", true, null], "the latest bill reports the advance slip");
  r = await call(bill, { method: "GET", query: { period: "2026-10" }, user: "Udave" });
  assert.ok(!("advance" in r.body), "a period call is unchanged");
  r = await call(slipImage, { method: "GET", query: { room: "201", advance: "1" }, user: "Udave" });
  assert.strictEqual(r.status, 200, "the tenant reads their advance slip");
  r = await call(slipImage, { method: "GET", query: { room: "201" }, user: "Udave" });
  assert.strictEqual(r.status, 404, "without advance the bill's own slip is meant");
  r = await call(slipImage, { method: "GET", query: { room: "201", advance: "1" }, user: "Ueve" });
  assert.strictEqual(r.status, 403);
  r = await call(rooms, { method: "GET", user: "Uowner" });
  assert.strictEqual(r.body.rooms.find((x) => x.room === "201").advance.hasSlip, true, "the owner's room list shows it");
  assert.strictEqual(r.body.rooms.find((x) => x.room === "202").advance, null);

  // A prepay belongs to the NEXT bill: issuing an older period must not consume it.
  const prepay211 = { room: "211", slipPath: "slips/211-advance-1.png", slipAt: new Date().toISOString(), slipCount: 1, by: "Ufrank" };
  data.set("bill:2026-12:211", { room: "211", period: "2026-12", total: 4000, status: "paid" });
  data.set("bill:211", { room: "211", period: "2026-12", total: 4000, status: "paid" });
  data.set("room-user:211", "Ufrank");
  data.set("prepay:211", prepay211);
  r = await call(run, { user: "Uowner", body: { period: "2026-11", readings: [{ room: "211", water: 1, elec: 1 }] } });
  assert.strictEqual(r.body.rooms[0].prepaid, undefined, "a back-dated bill takes no advance slip");
  assert.strictEqual(data.get("bill:2026-11:211").status, "unpaid");
  assert.strictEqual(data.get("prepay:211").slipAt, prepay211.slipAt, "the advance slip is still waiting for the next bill");

  // A stale prepay from someone who is no longer the tenant is not handed to the new one.
  data.set("prepay:211", { ...prepay211, by: "Ugone" });
  r = await call(run, { user: "Uowner", body: { period: "2027-01", readings: [{ room: "211", water: 1, elec: 1 }] } });
  assert.strictEqual(r.body.rooms[0].prepaid, undefined, "a prepay from a former tenant is ignored");
  assert.strictEqual(data.get("bill:2027-01:211").status, "unpaid");
  assert.ok(data.get("prepay:211"), "and it is left for the owner to deal with");

  // The same prepay from the current tenant is attached, and then cleared.
  data.set("prepay:211", prepay211);
  r = await call(run, { user: "Uowner", body: { period: "2027-02", readings: [{ room: "211", water: 1, elec: 1 }] } });
  assert.strictEqual(r.body.rooms[0].prepaid, true, "the current tenant's prepay is attached");
  assert.strictEqual(data.get("bill:2027-02:211").status, "pending");
  assert.strictEqual(data.get("prepay:211"), null, "and consumed");

  // 202 has no bill at all: advance too, and the 404 still carries the advance.
  r = await call(bill, { method: "GET", query: {}, user: "Ueve" });
  assert.deepStrictEqual([r.status, r.body.error.advance], [404, null]);
  r = await call(slip, { body: { note: "ค่าห้อง" }, user: "Ueve" });
  assert.deepStrictEqual([r.status, r.body.status, r.body.hasSlip], [200, "advance", false], "no bill yet: advance as well");
  assert.strictEqual(data.get("bill:202") ?? null, null, "and no bill is invented");
  r = await call(bill, { method: "GET", query: {}, user: "Ueve" });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.body.error.code, "NOT_FOUND");
  assert.strictEqual(r.body.error.advance.note, "ค่าห้อง", "the 404 body carries error.advance");

  // Owner-sent advance slips are not rate limited.
  r = await call(slip, { body: { room: "202" }, user: "Uowner" });
  assert.strictEqual(r.status, 200, "owner may send right after the tenant");
  r = await call(slip, { body: { room: "202" }, user: "Uowner" });
  assert.deepStrictEqual([r.status, data.get("prepay:202").by], [200, "Uowner"], "and again at once");

  // Issuing the bill attaches the slip and asks the owner to confirm.
  const sentBefore = pushed.length;
  r = await call(run, { user: "Uowner", body: { period: "2026-11", readings: [{ room: "201", water: 2, elec: 10 }] } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.rooms[0].prepaid, true);
  const nov201 = data.get("bill:2026-11:201");
  assert.deepStrictEqual([nov201.status, nov201.prepaid, nov201.slipCount, nov201.slipNote], ["pending", true, 2, null]);
  assert.ok(files.has(nov201.slipPath), "the slip photo now belongs to the bill");
  assert.strictEqual(data.get("bill:201").slipPath, nov201.slipPath, "the newest copy agrees");
  assert.strictEqual(data.get("prepay:201"), null, "the prepay is consumed");
  const issued = pushed.slice(sentBefore);
  assert.ok(issued.some((p) => p.to === "Udave" && p.messages[0].altText.includes("201")), "the tenant gets the bill card");
  assert.ok(issued.some((p) => p.to === "Uowner" && p.messages[0].type === "flex" && p.messages[0].altText.startsWith("แจ้งชำระ ห้อง 201")),
    "the owner gets a confirm card");
  r = await call(bill, { method: "GET", query: {}, user: "Udave" });
  assert.strictEqual(r.body.advance, null, "nothing is waiting any more");

  // A room without a prepay is issued as before.
  r = await call(run, { user: "Uowner", body: { period: "2026-11", readings: [{ room: "203", water: 1, elec: 1 }] } });
  assert.strictEqual(data.get("bill:2026-11:203").status, "unpaid");
  assert.ok(!("prepaid" in r.body.rooms[0]));

  // The guard still wins: a pending bill is refused and the prepay left alone.
  data.set("prepay:201", { room: "201", slipPath: null, slipNote: null, slipAt: new Date().toISOString(), slipCount: 1, by: "Udave" });
  r = await call(run, { user: "Uowner", body: { period: "2026-11", readings: [{ room: "201", water: 3, elec: 3 }] } });
  assert.ok(r.body.rooms[0].error);
  assert.ok(data.get("prepay:201"), "a refused issue keeps the prepay");
  data.set("prepay:201", null);

  await tap("Uowner", "action=confirm&room=201&period=2026-11");
  assert.strictEqual(data.get("bill:2026-11:201").status, "paid", "the owner's confirm closes the prepaid bill");
  assert.strictEqual(data.get("bill:201").status, "paid");

  // ---------------------------------------------------------------- a new tenant does not see the previous tenant's bills
  // 210: the tenant change. 212 (Ustale is bound there above, so it is reset): a room with no
  // tenancy record, then a tenant moving out of it. 204 is the room they move to.
  {
    const billApi = require("./api/bill");
    const roomsApi = require("./api/rooms");
    const { tenancyOf, visibleToTenant } = require("./api/_bills");
    const mk = (room, period, status, extra = {}) => ({ room, period, rent: 3500, water: 0, elec: 0, total: 3500, status, ...extra });
    const png1 = "data:image/png;base64,iVBORw0KGgo=";

    assert.strictEqual(visibleToTenant({ issuedAt: "2020-01-01T00:00:00.000Z" }, null), true, "no tenancy: everything shows");
    assert.strictEqual(visibleToTenant({}, { since: "2026-01-01T00:00:00.000Z" }), false, "no issuedAt predates any tenancy");
    assert.strictEqual(visibleToTenant({ issuedAt: "2026-01-01T00:00:00.000Z" }, { since: "2026-01-01T00:00:00.000Z" }), true);

    // The old tenant of 210: a paid October, an unpaid November with a slip photo and a prepay.
    data.set("user-room:Uold", "210");
    data.set("room-user:210", "Uold");
    await saveBill(mk("210", "2026-10", "paid", { issuedAt: "2026-10-01T00:00:00.000Z" }));
    files.set("slips/210-old.png", Buffer.from("x"));
    await saveBill(mk("210", "2026-11", "pending", { issuedAt: "2026-11-01T00:00:00.000Z", slipPath: "slips/210-old.png", slipAt: "2026-11-02T00:00:00.000Z", slipCount: 1 }));
    const oldPrepay = { room: "210", slipPath: "slips/210-advance-1.png", slipNote: "ล่วงหน้า", slipAt: "2026-11-03T04:05:06.000Z", slipCount: 1, by: "Uold" };
    files.set(oldPrepay.slipPath, Buffer.from("y"));
    data.set("prepay:210", oldPrepay);

    r = await call(billApi, { method: "GET", query: {}, user: "Uold" });
    assert.strictEqual(r.status, 200, "no tenancy record yet: the tenant sees everything as before");
    assert.strictEqual(r.body.advance.hasSlip, true);

    // The owner changes tenant.
    const noticeCount = pushed.length;
    r = await call(qr, { method: "POST", query: { room: "210" }, user: "Uowner" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.prepayArchived, true, "the response says an advance slip was archived");
    const newCode210 = r.body.code;
    const since = (await tenancyOf("210")).since;
    assert.ok(since && !Number.isNaN(Date.parse(since)), "tenancy:210 is written");
    assert.deepStrictEqual(data.get("prepay-old:210:2026-11-03T04:05:06.000Z"), oldPrepay, "the old prepay is archived under its slipAt");
    assert.strictEqual(data.get("prepay:210"), null, "and cleared");
    assert.ok(files.has(oldPrepay.slipPath), "its photo is kept");
    // The owner is told to check it, so it has to be readable; the new tenant must not see it.
    r = await call(slipImage, { method: "GET", query: { room: "210", archived: "1" }, user: "Uowner" });
    assert.strictEqual(r.status, 200, "the owner can open the archived slip");
    r = await call(slipImage, { method: "GET", query: { room: "210", archived: "1" }, user: "Unew210" });
    assert.strictEqual(r.status, 403, "the room's tenant cannot");
    const notice = pushed.slice(noticeCount).find((p) => p.to === "Uowner" && p.messages[0].type === "text");
    assert.strictEqual(notice.messages[0].text, "ห้อง 210: ผู้เช่าเดิมมีสลิปโอนล่วงหน้าค้างอยู่ — ไม่ถูกผูกกับผู้เช่าใหม่ ตรวจสอบ/คืนเงินเอง");

    // The new tenant binds.
    r = await call(qr, { body: { code: newCode210 }, user: "Unew" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(data.get("room-user:210"), "Unew");

    r = await call(billApi, { method: "GET", query: {}, user: "Unew" });
    assert.deepStrictEqual([r.status, r.body.error.code], [404, "NOT_FOUND"], "the previous tenant's latest bill is hidden");
    assert.strictEqual(r.body.error.advance, null, "and so is their advance slip");
    r = await call(billApi, { method: "GET", query: { period: "2026-10" }, user: "Unew" });
    assert.strictEqual(r.status, 404, "an old period is hidden too");
    r = await call(billApi, { method: "GET", query: { period: "2026-11" }, user: "Unew" });
    assert.strictEqual(r.status, 404);
    r = await call(billApi, { method: "GET", query: { history: "1" }, user: "Unew" });
    assert.deepStrictEqual([r.status, r.body.items], [200, []], "history is empty for the new tenant");
    r = await call(slipImage, { method: "GET", query: { room: "210" }, user: "Unew" });
    assert.deepStrictEqual([r.status, r.body.error.message], [404, "ยังไม่มีสลิป"], "the old slip photo is hidden");

    const replies = [];
    const realFetch = global.fetch;
    global.fetch = async (url, opts = {}) => {
      if (String(url).includes("/message/reply")) replies.push(JSON.parse(opts.body));
      return realFetch(url, opts);
    };
    await webhook(hook, [{ type: "message", replyToken: "r", source: { userId: "Unew" }, message: { type: "text", text: "บิล" } }]);
    assert.strictEqual(replies.pop().messages[0].text, "ห้อง 210 ยังไม่มีบิลรอบนี้ครับ", "chat 'บิล' says there is no bill");

    // A slip from the new tenant goes the advance way and leaves the old bill alone.
    const oldBill = JSON.stringify(data.get("bill:210"));
    r = await call(slip, { body: { image: png1, note: "ใหม่" }, user: "Unew" });
    assert.deepStrictEqual([r.status, r.body.status], [200, "advance"], "the new tenant's slip is an advance slip");
    assert.strictEqual(JSON.stringify(data.get("bill:210")), oldBill, "the old bill is untouched");
    assert.strictEqual(data.get("bill:2026-11:210").slipPath, "slips/210-old.png");
    assert.strictEqual(data.get("prepay:210").by, "Unew");
    r = await call(slipImage, { method: "GET", query: { room: "210", advance: "1" }, user: "Unew" });
    assert.strictEqual(r.status, 200, "their own advance slip is visible to them");
    data.set("prepay:210", null);

    // The owner still sees everything.
    r = await call(billApi, { method: "GET", query: { room: "210" }, user: "Uowner" });
    assert.deepStrictEqual([r.status, r.body.period], [200, "2026-11"], "the owner sees the old latest bill");
    r = await call(billApi, { method: "GET", query: { room: "210", history: "1" }, user: "Uowner" });
    assert.strictEqual(r.body.items.length, 2);
    r = await call(slipImage, { method: "GET", query: { room: "210" }, user: "Uowner" });
    assert.strictEqual(r.status, 200, "and the old slip photo");
    r = await call(roomsApi, { method: "GET", user: "Uowner" });
    assert.strictEqual(r.body.rooms.find((x) => x.room === "210").bill.period, "2026-11", "/api/rooms still lists it");

    // Confirming the old tenant's pending bill does not message the new tenant.
    const beforeConfirm = pushed.length;
    await tap("Uowner", "action=confirm&room=210&period=2026-11");
    assert.strictEqual(data.get("bill:2026-11:210").status, "paid", "the owner can still close it");
    assert.ok(!pushed.slice(beforeConfirm).some((p) => p.to === "Unew"), "the new tenant is not told");

    // The owner issues a new bill: it carries issuedAt and the new tenant sees it.
    const t0 = new Date().toISOString();
    r = await call(run, { user: "Uowner", body: { period: "2026-12", readings: [{ room: "210", water: 1, elec: 2 }] } });
    assert.strictEqual(r.body.rooms[0].pushed, true);
    const fresh = data.get("bill:210");
    assert.ok(fresh.issuedAt >= t0 && fresh.issuedAt >= since, "run.js stamps issuedAt");
    assert.strictEqual(data.get("bill:2026-12:210").issuedAt, fresh.issuedAt);
    r = await call(billApi, { method: "GET", query: {}, user: "Unew" });
    assert.deepStrictEqual([r.status, r.body.period], [200, "2026-12"], "the new tenant sees the new bill");
    r = await call(billApi, { method: "GET", query: { history: "1" }, user: "Unew" });
    assert.deepStrictEqual(r.body.items.map((i) => i.period), ["2026-12"], "history shows only the new tenancy");
    r = await call(billApi, { method: "GET", query: { period: "2026-10" }, user: "Unew" });
    assert.strictEqual(r.status, 404);
    // ...and they can send a slip for it.
    r = await call(slip, { body: { image: png1 }, user: "Unew" });
    assert.deepStrictEqual([r.status, r.body.status], [200, "pending"]);

    // A tenant change with nobody bound and no prepay still starts a fresh tenancy.
    r = await call(qr, { method: "POST", query: { room: "210" }, user: "Uowner" });
    assert.ok(!("prepayArchived" in r.body), "no prepay: no flag");
    assert.ok((await tenancyOf("210")).since >= fresh.issuedAt);
    r = await call(billApi, { method: "GET", query: {}, user: "Unew" });
    assert.strictEqual(r.status, 400, "the unbound tenant reads nothing");

    // 212: never reset, so its tenant keeps their history. Then they move out with confirmMove.
    data.set("room-user:212", "Ulong");
    data.set("user-room:Ulong", "212");
    data.set("user-room:Ustale", null);
    for (const k of ["bill:212", "bills:212"]) data.delete(k); // earlier sections may have used 212
    await saveBill(mk("212", "2026-10", "paid"));
    await saveBill(mk("212", "2026-11", "unpaid"));
    assert.strictEqual(await tenancyOf("212") ?? null, null);
    r = await call(billApi, { method: "GET", query: {}, user: "Ulong" });
    assert.deepStrictEqual([r.status, r.body.period], [200, "2026-11"], "no tenancy record: old bills (no issuedAt) still show");
    r = await call(billApi, { method: "GET", query: { history: "1" }, user: "Ulong" });
    assert.strictEqual(r.body.items.length, 2);
    r = await call(billApi, { method: "GET", query: { period: "2026-10" }, user: "Ulong" });
    assert.strictEqual(r.status, 200);

    data.set("room-user:204", null);
    data.set("user-room:Ubob", null);
    data.set("qr-code:MOVE204", "204");
    r = await call(qr, { body: { code: "MOVE204", confirmMove: true }, user: "Ulong" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(data.get("room-user:212"), null);
    assert.ok((await tenancyOf("212")).since, "moving out writes tenancy for the room left");
    assert.strictEqual(await tenancyOf("204") ?? null, null, "and not for the room joined");
    data.set("user-room:Unext", "212");
    data.set("room-user:212", "Unext");
    r = await call(billApi, { method: "GET", query: {}, user: "Unext" });
    assert.strictEqual(r.status, 404, "the next tenant of 212 does not see Ulong's bills");
    global.fetch = realFetch;
  }

  // ---------------------------------------------------------------- receipts, void, one slip for several periods
  // 208: receipts, void and re-issue. 206: several periods on one slip. Both are cleared first, so
  // nothing the sections above left behind can leak in.
  {
    const billApi = require("./api/bill");
    const { receiptNoOf } = require("./api/_bills");
    const resetRoom = (room) => { for (const k of [...data.keys()]) if (k.endsWith(`:${room}`)) data.delete(k); };
    const mk = (room, period, status, extra = {}) =>
      ({ room, period, rent: 3500, water: 125, elec: 70, waterUnits: 5, elecUnits: 10, total: 3695, due: `${period}-16`, status, ...extra });
    const replies = [];
    const realFetch = global.fetch;
    global.fetch = async (url, opts = {}) => {
      if (String(url).includes("/message/reply")) replies.push(JSON.parse(opts.body));
      return realFetch(url, opts);
    };
    const lastReply = () => replies[replies.length - 1].messages[0].text;
    const to = (user, since) => pushed.slice(since).filter((p) => p.to === user);
    const longAgo = new Date(Date.now() - 60000).toISOString();

    // ---- receipts
    assert.strictEqual(receiptNoOf({ period: "2026-11", room: "203" }), "R202611-203", "no rev: no suffix");
    assert.strictEqual(receiptNoOf({ period: "2026-11", room: "203", rev: 1 }), "R202611-203", "rev 1: no suffix");
    assert.strictEqual(receiptNoOf({ period: "2026-11", room: "203", rev: 2 }), "R202611-203-2", "rev 2 adds -2");

    resetRoom("208");
    data.set("room-user:208", "Ugina");
    data.set("user-room:Ugina", "208");
    await saveBill(mk("208", "2026-10", "unpaid", { issuedAt: "2026-10-01T00:00:00.000Z" }));
    await saveBill(mk("208", "2026-11", "pending", { issuedAt: "2026-11-01T00:00:00.000Z", slipCount: 1 }));
    let mark = pushed.length;
    await tap("Uowner", "action=confirm&room=208&period=2026-11");
    let paid208 = data.get("bill:2026-11:208");
    assert.deepStrictEqual([paid208.status, paid208.receiptNo], ["paid", "R202611-208"], "confirming stores the receipt number");
    assert.strictEqual(data.get("bill:208").receiptNo, "R202611-208", "the newest copy agrees");
    const receiptPush = to("Ugina", mark);
    assert.strictEqual(receiptPush.length, 1, "the tenant gets one push");
    const rm = receiptPush[0].messages;
    assert.deepStrictEqual([rm.length, rm[0].type], [1, "flex"], "and it is a receipt card, not a text");
    const rj = JSON.stringify(rm[0]);
    assert.ok(rj.includes("ใบเสร็จรับเงิน") && rj.includes("R202611-208") && rj.includes("208") && rj.includes("2026-11"), "the card names the receipt, room and period");
    assert.ok(rj.includes("3,695") && rj.includes("3,500") && rj.includes("125") && rj.includes("70"), "rent, water, electricity and the total");
    assert.ok(rj.includes("room=208") && rj.includes("#receipt/2026-11") && rj.includes("liff.line.me/2000000000-testliff"), "its button opens the LIFF receipt");

    r = await call(billApi, { method: "GET", query: { history: "1" }, user: "Ugina" });
    assert.deepStrictEqual(r.body.items.map((i) => [i.period, i.status, i.receiptNo]),
      [["2026-11", "paid", "R202611-208"], ["2026-10", "unpaid", null]], "history shows receiptNo for paid bills only");
    r = await call(billApi, { method: "GET", query: { period: "2026-11" }, user: "Ugina" });
    assert.strictEqual(r.body.receiptNo, "R202611-208");
    data.set("bill:2026-09:208", mk("208", "2026-09", "paid"));
    data.set("bills:208", ["2026-11", "2026-10", "2026-09"]);
    r = await call(billApi, { method: "GET", query: { history: "1" }, user: "Ugina" });
    assert.strictEqual(r.body.items[2].receiptNo, "R202609-208", "a bill paid before receipts existed gets the same derived number");
    data.delete("bill:2026-09:208");
    data.set("bills:208", ["2026-11", "2026-10"]);

    // ---- void: who, what, which bill
    const voidIt = (user, body) => call(billApi, { method: "POST", user, body: { action: "void", room: "208", period: "2026-11", reason: "กรอกยอดผิด", ...body } });
    r = await voidIt("Ugina", {});
    assert.deepStrictEqual([r.status, r.body.error.code], [403, "FORBIDDEN"], "a tenant cannot void");
    r = await voidIt("Uhelper", {});
    assert.strictEqual(r.status, 403, "a read-only helper cannot void");
    assert.strictEqual(data.get("bill:2026-11:208").status, "paid", "and nothing changed");
    for (const reason of [undefined, "", "   ", 42, "x".repeat(201)]) {
      r = await voidIt("Uowner", { reason });
      assert.deepStrictEqual([r.status, r.body.error.code], [400, "VALIDATION"], `reason ${JSON.stringify(reason)} is refused`);
    }
    r = await voidIt("Uowner", { period: "2026-1" });
    assert.strictEqual(r.status, 400, "period must be YYYY-MM");
    r = await voidIt("Uowner", { action: "delete" });
    assert.strictEqual(r.status, 400, "only the void action exists");
    r = await voidIt("Uowner", { period: "2026-09" });
    assert.deepStrictEqual([r.status, r.body.error.code], [404, "NOT_FOUND"], "no such bill");
    assert.strictEqual(data.get("bill:2026-11:208").status, "paid", "refusals change nothing");

    mark = pushed.length;
    r = await voidIt("Uowner", { reason: "  กรอกยอดผิด  " });
    assert.deepStrictEqual([r.status, r.body.room, r.body.period, r.body.status], [200, "208", "2026-11", "void"]);
    let v = data.get("bill:2026-11:208");
    assert.strictEqual(r.body.refund, v.total, "voiding a paid bill reports the refund owed");
    assert.strictEqual(v.refundDue, v.total, "and keeps it on the record");
    assert.deepStrictEqual([v.status, v.voidedBy, v.voidReason, v.statusBefore, v.receiptNo], ["void", "Uowner", "กรอกยอดผิด", "paid", "R202611-208"],
      "void records who, why and what it was, and keeps the receipt number");
    assert.ok(!Number.isNaN(Date.parse(v.voidedAt)));
    assert.strictEqual(data.get("bill:208").status, "void", "the newest copy follows");
    assert.strictEqual(to("Ugina", mark)[0].messages[0].text, "บิลห้อง 208 รอบ 2026-11 ถูกยกเลิก — กรอกยอดผิด", "the tenant is told");
    r = await voidIt("Uowner", {});
    assert.deepStrictEqual([r.status, r.body.error.code], [409, "INVALID_STATE"], "a void bill cannot be voided twice");

    // An older bill: the newest copy must stay as it is, and a tenant who moved in later hears nothing.
    data.set("tenancy:208", { since: "2999-01-01T00:00:00.000Z" });
    mark = pushed.length;
    r = await voidIt("Uowner", { period: "2026-10", reason: "ผู้เช่าเดิม" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(data.get("bill:2026-10:208").status, "void");
    assert.strictEqual(data.get("bill:208").period, "2026-11", "an older period does not replace the newest copy");
    assert.strictEqual(to("Ugina", mark).length, 0, "the previous tenancy's bill is not announced to the current tenant");
    data.delete("tenancy:208");

    // ---- void: effects elsewhere
    await tap("Uowner", "action=confirm&room=208&period=2026-11");
    assert.strictEqual(lastReply(), "บิลนี้ถูกยกเลิกแล้ว", "confirming a void bill is refused");
    assert.strictEqual(data.get("bill:2026-11:208").status, "void", "and changes nothing");
    r = await call(billApi, { method: "GET", query: {}, user: "Ugina" });
    assert.deepStrictEqual([r.body.status, r.body.voidReason], ["void", "กรอกยอดผิด"], "the tenant's page can show why");
    await webhook(hook, [{ type: "message", replyToken: "r", source: { userId: "Ugina" }, message: { type: "text", text: "บิล" } }]);
    assert.strictEqual(lastReply(), "บิลห้อง 208 รอบ 2026-11 ถูกยกเลิก — กรอกยอดผิด", "chat 'บิล' does not offer a void bill for payment");

    r = await call(slip, { body: { image: png, note: "โอนก่อน" }, user: "Ugina" });
    assert.deepStrictEqual([r.status, r.body.status], [200, "advance"], "a void latest bill is 'no open bill': the slip waits for the next one");
    assert.strictEqual(data.get("bill:2026-11:208").status, "void", "the void bill gets no slip");
    assert.ok(data.get("prepay:208").slipPath, "it is kept as an advance slip");

    // Re-issue: the advance slip rides along, the revision grows, the receipt number follows.
    mark = pushed.length;
    r = await call(run, { user: "Uowner", body: { period: "2026-11", readings: [{ room: "208", water: 4, elec: 8 }] } });
    assert.deepStrictEqual([r.status, r.body.rooms[0].reissued, r.body.rooms[0].prepaid, !!r.body.rooms[0].error], [200, true, true, false], "a void bill may be issued again");
    const re = data.get("bill:2026-11:208");
    assert.deepStrictEqual([re.rev, re.status, re.total], [2, "pending", 3500 + 100 + 56]);
    assert.ok(!("voidedAt" in re) && !("receiptNo" in re), "the new bill starts clean");
    assert.strictEqual(data.get("bill:208").rev, 2, "newest copy agrees");
    assert.ok(to("Uowner", mark).some((p) => p.messages[0].type === "flex"), "the owner gets the confirm card");
    await tap("Uowner", "action=confirm&room=208&period=2026-11");
    paid208 = data.get("bill:2026-11:208");
    assert.deepStrictEqual([paid208.status, paid208.receiptNo], ["paid", "R202611-208-2"], "the re-issued bill gets its own receipt number");
    assert.ok(JSON.stringify(to("Ugina", mark).pop()).includes("R202611-208-2"));
    r = await call(run, { user: "Uowner", body: { period: "2026-11", readings: [{ room: "208", water: 1, elec: 1 }] } });
    assert.ok(r.body.rooms[0].error, "a paid bill still cannot be edited: void it first");

    // An unpaid re-issue is the same bill: rev stays.
    resetRoom("206");
    data.set("room-user:206", "Uhank");
    data.set("user-room:Uhank", "206");
    await saveBill(mk("206", "2026-09", "unpaid"));
    r = await call(run, { user: "Uowner", body: { period: "2026-09", readings: [{ room: "206", water: 2, elec: 5 }] } });
    assert.strictEqual(r.body.rooms[0].reissued, true);
    assert.strictEqual(data.get("bill:2026-09:206").rev, 1, "an unpaid re-issue keeps rev");

    // ---- one slip for several periods (206: Sep unpaid, Oct pending with its own photo, Nov unpaid, Dec paid)
    files.set("slips/206-old.png", Buffer.from("o"));
    await saveBill(mk("206", "2026-10", "pending", { issuedAt: longAgo, slipPath: "slips/206-old.png", slipCount: 1, slipAt: longAgo }));
    await saveBill(mk("206", "2026-11", "unpaid", { issuedAt: longAgo }));
    await saveBill(mk("206", "2026-12", "paid", { issuedAt: longAgo }));
    await saveBill(mk("206", "2026-07", "unpaid", { issuedAt: longAgo }));
    await saveBill(mk("206", "2026-06", "unpaid", { issuedAt: longAgo }));
    await saveBill(mk("206", "2026-05", "void", { issuedAt: longAgo }));
    const sep = data.get("bill:2026-09:206");
    const nov = data.get("bill:2026-11:206");
    const sendPeriods = (periods, extra = {}, user = "Uhank") => call(slip, { user, body: { periods, ...extra } });
    const snapshot = () => JSON.stringify([...data.entries()].filter(([k]) => k.endsWith(":206")));
    const before = snapshot();

    for (const bad of ["2026-11", [], ["2026-11", "2026-11"], ["2026-13"], [5], ["2026-9"],
      Array.from({ length: 13 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`)]) {
      r = await sendPeriods(bad);
      assert.deepStrictEqual([r.status, r.body.error.code], [400, "VALIDATION"], `periods ${JSON.stringify(bad).slice(0, 30)} is refused`);
    }
    r = await sendPeriods(["2026-08", "2026-11"]);
    assert.deepStrictEqual([r.status, r.body.error.code], [409, "INVALID_STATE"], "a period without a bill");
    assert.ok(r.body.error.message.includes("2026-08"), "names the period");
    r = await sendPeriods(["2026-11", "2026-12"]);
    assert.deepStrictEqual([r.status, r.body.error.code], [409, "INVALID_STATE"], "a paid period");
    assert.ok(r.body.error.message.includes("2026-12"));
    r = await sendPeriods(["2026-05"]);
    assert.ok(r.status === 409 && r.body.error.message.includes("2026-05"), "a void period");
    r = await sendPeriods(["2026-11"], { image: "data:text/plain;base64,eHg=" });
    assert.strictEqual(r.status, 400, "the image checks still apply");
    r = await sendPeriods(["2026-11"], { note: "x".repeat(501) });
    assert.strictEqual(r.status, 400, "and so does the note limit");
    r = await call(slip, { user: "Ucarol", body: { room: "206", periods: ["2026-11"] } });
    assert.strictEqual(r.status, 403, "another room's tenant cannot send for this room");
    assert.strictEqual(snapshot(), before, "no refusal wrote anything");

    // One slip, two bills.
    mark = pushed.length;
    r = await sendPeriods(["2026-11", "2026-09"], { image: png, note: "สองงวด" });
    const sum = sep.total + nov.total;
    assert.deepStrictEqual([r.status, r.body], [200, { ok: true, status: "pending", periods: ["2026-09", "2026-11"], total: sum, hasSlip: true, verify: { provider: "slipok", ok: null, reason: "not_configured" } }]);
    const s1 = data.get("bill:2026-09:206");
    const n1 = data.get("bill:2026-11:206");
    assert.deepStrictEqual([s1.status, n1.status], ["pending", "pending"]);
    assert.ok(s1.slipPath && s1.slipPath === n1.slipPath && files.has(s1.slipPath), "both point to the same photo");
    assert.deepStrictEqual([s1.slipNote, s1.slipCount, n1.slipCount, s1.slipAt === n1.slipAt], ["สองงวด", 1, 1, true]);
    assert.deepStrictEqual(s1.slipGroup, { periods: ["2026-09", "2026-11"], total: sum });
    assert.deepStrictEqual(n1.slipGroup, s1.slipGroup);
    assert.strictEqual(data.get("bill:2026-12:206").status, "paid", "the newest copy is the paid December bill and stays so");
    assert.strictEqual(data.get("bill:2026-10:206").slipPath, "slips/206-old.png", "other periods are untouched");
    const ownerCards = to("Uowner", mark);
    assert.strictEqual(ownerCards.length, 1, "the owner gets ONE card");
    assert.strictEqual(ownerCards[0].messages[0].type, "flex");
    const cardJson = JSON.stringify(ownerCards[0].messages[0]);
    assert.ok(cardJson.includes(sum.toLocaleString("th-TH")) && cardJson.includes("2026-09") && cardJson.includes("2026-11"), "showing the periods and the summed total");
    const cardData = new URLSearchParams(/"data":"(action=confirm[^"]*)"/.exec(cardJson)[1]);
    assert.deepStrictEqual([cardData.get("room"), cardData.get("periods"), cardData.has("period")], ["206", "2026-09,2026-11", false]);
    r = await sendPeriods(["2026-09", "2026-11"]);
    assert.deepStrictEqual([r.status, r.body.error.code], [429, "SLIP_TOO_SOON"], "limits are counted on the newest bill");

    // A second slip overlapping the first: the old photo of Oct goes, the one Sep still shows stays.
    const photoX = s1.slipPath;
    for (const p of ["2026-09", "2026-11"]) data.set(`bill:${p}:206`, { ...data.get(`bill:${p}:206`), slipAt: longAgo });
    await new Promise((resolve) => setTimeout(resolve, 2));
    r = await sendPeriods(["2026-10", "2026-11"], { image: png });
    assert.strictEqual(r.status, 200);
    const o2 = data.get("bill:2026-10:206");
    const n2 = data.get("bill:2026-11:206");
    assert.ok(o2.slipPath === n2.slipPath && o2.slipPath !== photoX, "a new photo for the new group");
    assert.deepStrictEqual([o2.slipCount, n2.slipCount], [2, 2], "each bill counts its own slips");
    assert.ok(!files.has("slips/206-old.png"), "a photo no bill shows any more is deleted");
    assert.ok(files.has(photoX), "a photo another bill still shows is kept");
    assert.strictEqual(data.get("bill:2026-09:206").slipPath, photoX);

    // The first card now only fits September: November moved on to the second slip.
    mark = pushed.length;
    await tap("Uowner", "action=confirm&room=206&periods=2026-09,2026-11");
    assert.strictEqual(data.get("bill:2026-09:206").status, "paid");
    assert.strictEqual(data.get("bill:2026-09:206").receiptNo, "R202609-206");
    assert.strictEqual(data.get("bill:2026-11:206").status, "pending", "a bill with a newer slip is left for that slip's card");
    assert.ok(lastReply().includes("2026-09") && lastReply().includes("ข้าม 2026-11"), "and the answer says so");
    assert.strictEqual(to("Uhank", mark).length, 1);

    await tap("Uhank", "action=confirm&room=206&periods=2026-10,2026-11");
    assert.strictEqual(data.get("bill:2026-10:206").status, "pending", "a tenant cannot confirm a group");
    mark = pushed.length;
    await tap("Uowner", "action=confirm&room=206&periods=2026-11,2026-10");
    const [o3, n3] = [data.get("bill:2026-10:206"), data.get("bill:2026-11:206")];
    assert.deepStrictEqual([o3.status, n3.status, o3.receiptNo, n3.receiptNo], ["paid", "paid", "R202610-206", "R202611-206"], "each bill gets its own receipt number");
    assert.ok(o3.paidAt && n3.paidAt && o3.confirmedBy === "Uowner");
    const tenantPush = to("Uhank", mark);
    assert.deepStrictEqual([tenantPush.length, tenantPush[0].messages.map((m) => m.type)], [1, ["flex", "flex"]], "the tenant gets one push with both receipts");
    assert.ok(JSON.stringify(tenantPush[0]).includes("R202610-206") && JSON.stringify(tenantPush[0]).includes("R202611-206"));
    await tap("Uowner", "action=confirm&room=206&periods=2026-10,2026-11");
    assert.ok(lastReply().includes("ไม่มีบิลที่รอยืนยัน"), "the same card again finds nothing waiting");
    await tap("Uowner", "action=confirm&room=206&periods=2026-13");
    assert.ok(lastReply().includes("ไม่ถูกต้อง"), "a malformed periods list is refused");

    // A single period sent through `periods` gives the ordinary single card, and it still works.
    mark = pushed.length;
    r = await sendPeriods(["2026-07"], { note: "งวดเดียว" });
    assert.deepStrictEqual([r.status, r.body.periods, r.body.total], [200, ["2026-07"], 3695]);
    const single = new URLSearchParams(/"data":"(action=confirm[^"]*)"/.exec(JSON.stringify(to("Uowner", mark)[0]))[1]);
    assert.deepStrictEqual([single.get("period"), single.has("periods")], ["2026-07", false], "one period: the plain card");
    await tap("Uowner", "action=confirm&room=206&period=2026-07");
    assert.deepStrictEqual([data.get("bill:2026-07:206").status, data.get("bill:2026-07:206").receiptNo], ["paid", "R202607-206"]);

    // Visibility: a tenant cannot pay a bill from before their tenancy; the owner can.
    data.set("tenancy:206", { since: "2999-01-01T00:00:00.000Z" });
    r = await sendPeriods(["2026-06"]);
    assert.ok(r.status === 409 && r.body.error.message.includes("2026-06"), "the previous tenant's bill is not payable by the new one");
    r = await call(slip, { user: "Uowner", body: { room: "206", periods: ["2026-06"] } });
    assert.deepStrictEqual([r.status, data.get("bill:2026-06:206").status], [200, "pending"], "the owner skips that check");
    data.delete("tenancy:206");

    global.fetch = realFetch;
  }

  // ---------------------------------------------------------------- optimization + bug-fix pass
  // 209: void -> re-issue archive, receipts. 207: a bill without a due date. 201..: missing units.
  {
    const billApi = require("./api/bill");
    const { billBubble, receiptBubble } = require("./api/_line");
    const resetRoom = (room) => { for (const k of [...data.keys()]) if (k.endsWith(`:${room}`) || k.endsWith(`:${room}:1`) || k.endsWith(`:${room}:2`)) data.delete(k); };
    const mk = (room, period, status, extra = {}) =>
      ({ room, period, rent: 3500, water: 125, elec: 70, waterUnits: 5, elecUnits: 10, total: 3695, due: `${period}-16`, status, ...extra });
    const replies = [];
    const realFetch = global.fetch;
    global.fetch = async (url, opts = {}) => {
      if (String(url).includes("/message/reply")) replies.push(JSON.parse(opts.body));
      return realFetch(url, opts);
    };
    const lastReply = () => replies[replies.length - 1].messages[0].text;
    const longAgo = new Date(Date.now() - 60000).toISOString();

    // ---- 1. a void bill is archived before it is re-issued
    for (const k of [...data.keys()]) if (/^bills?(-voids?)?:(\d{4}-\d{2}:)?209(:\d+)?$/.test(k)) data.delete(k);
    data.set("room-user:209", "Ufern");
    data.set("user-room:Ufern", "209");
    data.set("owner:Uviewer", { role: "viewer", addedBy: "Uowner" });
    await saveBill(mk("209", "2026-11", "pending", { issuedAt: longAgo, slipCount: 1, slipPath: "slips/209-a.png", slipAt: longAgo }));
    await tap("Uowner", "action=confirm&room=209&period=2026-11");
    const voidIt = (reason) => call(billApi, { method: "POST", user: "Uowner", body: { action: "void", room: "209", period: "2026-11", reason } });
    const reissue = () => call(run, { user: "Uowner", body: { period: "2026-11", due: "2026-11-16", readings: [{ room: "209", water: 4, elec: 8 }] } });
    const voided = (user, query = {}) => call(billApi, { method: "GET", user, query: { room: "209", voided: "1", ...query } });

    r = await voidIt("กรอกยอดผิด");
    assert.strictEqual(r.status, 200);
    const voidedOnce = JSON.parse(JSON.stringify(data.get("bill:2026-11:209")));
    assert.deepStrictEqual([voidedOnce.status, voidedOnce.receiptNo], ["void", "R202611-209"]);
    // Archived the moment it is voided, so a bill cancelled and never re-issued is still readable.
    assert.deepStrictEqual(data.get("bill-voids:209"), ["2026-11:1"], "the void is archived at once");
    r = await reissue();
    assert.deepStrictEqual([r.status, r.body.rooms[0].reissued, !!r.body.rooms[0].error], [200, true, false]);
    assert.deepStrictEqual(data.get("bill-void:2026-11:209:1"), voidedOnce, "the void bill is kept exactly as it was");
    assert.deepStrictEqual(data.get("bill-voids:209"), ["2026-11:1"], "and listed in the room's index");
    assert.strictEqual(data.get("bill:2026-11:209").rev, 2, "the live bill moved on to rev 2");

    r = await voided("Uowner");
    assert.deepStrictEqual([r.status, r.body.items.length, r.body.items[0].voidReason, r.body.items[0].receiptNo], [200, 1, "กรอกยอดผิด", "R202611-209"], "the owner reads it back");
    r = await voided("Uviewer");
    assert.deepStrictEqual([r.status, r.body.items.length], [200, 1], "a read-only helper may too");
    r = await voided("Ufern");
    assert.deepStrictEqual([r.status, r.body.error.code], [403, "FORBIDDEN"], "the room's own tenant may not");
    r = await voided("Uother", { room: "211" });
    assert.strictEqual(r.status, 403, "nor may a tenant of another room");
    r = await call(billApi, { method: "GET", user: "Ufern", query: { voided: "1" } });
    assert.strictEqual(r.status, 403, "not even without naming the room (it defaults to theirs)");
    r = await voided("Uowner", { period: "2026-10" });
    assert.deepStrictEqual([r.status, r.body.items], [200, []], "period narrows the list");
    r = await voided("Uowner", { period: "2026-1" });
    assert.strictEqual(r.status, 400, "a malformed period is refused");

    // Void and re-issue again: rev 2 is archived next to rev 1, newest first.
    r = await voidIt("ซ้ำ");
    assert.strictEqual(r.status, 200);
    r = await reissue();
    assert.strictEqual(r.body.rooms[0].error, undefined);
    assert.deepStrictEqual(data.get("bill-voids:209"), ["2026-11:1", "2026-11:2"]);
    r = await voided("Uowner");
    assert.deepStrictEqual(r.body.items.map((b) => [b.rev || 1, b.voidReason]), [[2, "ซ้ำ"], [1, "กรอกยอดผิด"]], "newest revision first");
    assert.strictEqual(data.get("bill:2026-11:209").rev, 3);
    r = await reissue();
    assert.strictEqual(data.get("bill:2026-11:209").rev, 3, "an unpaid re-issue is the same bill");
    assert.strictEqual(data.get("bill-voids:209").length, 2, "and archives nothing new");

    // A tenant's own bill never carries the staff userIds.
    r = await call(billApi, { method: "GET", user: "Ufern", query: { period: "2026-11" } });
    assert.ok(!("confirmedBy" in r.body) && !("voidedBy" in r.body), "tenants do not get the owner's LINE userId");
    r = await call(billApi, { method: "GET", user: "Uowner", query: { room: "209", period: "2026-11" } });
    assert.ok(r.body.status === "unpaid" || r.body.status === "pending");
    // void: only real rooms
    r = await call(billApi, { method: "POST", user: "Uowner", body: { action: "void", room: "999", period: "2026-11", reason: "x" } });
    assert.strictEqual(r.status, 404, "an unknown room is not looked up");

    // ---- 2. no due date -> no due line, and no "null"/"undefined" anywhere
    const noDue = { room: "207", period: "2026-11", rent: 3500, water: 100, elec: 50, total: 3650, due: null, status: "unpaid" };
    const cardJson = JSON.stringify(billBubble(noDue, "https://x"));
    assert.ok(!cardJson.includes("ครบกำหนด") && !/null|undefined|NaN/.test(cardJson), "the card has no due line");
    assert.ok(JSON.stringify(billBubble({ ...noDue, due: "2026-11-16" }, "https://x")).includes("ครบกำหนด 2026-11-16"), "and still has one with a due date");
    const rj = JSON.stringify(receiptBubble({ ...noDue, status: "paid" }, "https://x"));
    assert.ok(!/null|undefined|NaN/.test(rj), "a receipt with no number or paidAt prints neither null nor undefined");
    data.set("room-user:207", "Uivy");
    data.set("user-room:Uivy", "207");
    const mark = pushed.length;
    r = await call(run, { user: "Uowner", body: { period: "2026-12", readings: [{ room: "207", water: 1, elec: 1 }] } });
    assert.strictEqual(r.body.due, null);
    const sentCard = JSON.stringify(pushed.slice(mark).find((p) => p.to === "Uivy"));
    assert.ok(sentCard && !sentCard.includes("ครบกำหนด") && !/null|undefined/.test(sentCard), "a bill issued without a due date goes out without a due line");

    // ---- 3. missing meter units are refused, an explicit 0 is not
    const meters = (rooms) => JSON.stringify(rooms.map((x) => data.get(`meter:${x}`) ?? null));
    const refused = ["201", "202", "203", "204", "205", "206", "208", "210"];
    const meterBefore = meters(refused);
    r = await call(run, { user: "Uowner", body: { period: "2027-03", readings: [
      { room: "201" },
      { room: "202", water: 5 },
      { room: "203", elec: 5 },
      { room: "204", water: "", elec: 5 },
      { room: "205", water: 5, elec: "  " },
      { room: "206", water: null, elec: null },
      { room: "208", water: true, elec: 1 },
      { room: "210", water: [5], elec: 1 },
      { room: "212", water: 0, elec: "0" },
    ] } });
    assert.strictEqual(r.status, 200);
    const errs = Object.fromEntries(r.body.rooms.map((x) => [x.room, x.error]));
    for (const room of ["201", "202", "203", "204", "205", "206"]) assert.strictEqual(errs[room], "ต้องกรอกหน่วยน้ำและไฟ", `room ${room} with a missing reading`);
    assert.ok(errs["208"] && errs["208"] !== "ต้องกรอกหน่วยน้ำและไฟ", "true is not a reading");
    assert.ok(errs["210"], "an array is not a reading");
    assert.strictEqual(errs["212"], undefined, "an explicit 0 is a valid reading");
    assert.deepStrictEqual([data.get("bill:2027-03:212").waterUnits, data.get("bill:2027-03:212").elecUnits], [0, 0]);
    for (const room of refused) assert.ok(!data.has(`bill:2027-03:${room}`), `no bill for ${room}`);
    assert.strictEqual(meters(refused), meterBefore, "and no meter record was touched");
    r = await call(run, { user: "Uowner", body: { period: "2027-03", readings: [{ room: "999" }] } });
    assert.strictEqual(r.body.rooms[0].error, "ไม่มีห้องนี้ในหอ", "an unknown room is named before its readings");

    // ---- 4. a redundant invite code is spent as well
    data.set("owner:Uhelper2", { role: "viewer", addedBy: "Uowner" });
    r = await call(owner, { body: { role: "viewer" }, user: "Uowner" });
    const viewerCode = r.body.code;
    r = await call(owner, { body: { code: viewerCode }, user: "Uhelper2" });
    assert.deepStrictEqual([r.status, r.body.already], [200, true], "someone who already has the role redeems it: nothing to grant");
    assert.ok(data.get(`owner-invite:${viewerCode}`).usedAt, "but the code is spent");
    assert.strictEqual(data.get(`owner-invite:${viewerCode}`).usedBy, "Uhelper2");
    r = await call(owner, { body: { code: viewerCode }, user: "Ustranger" });
    assert.deepStrictEqual([r.status, r.body.error.code], [410, "INVITE_EXPIRED"], "so it cannot be passed on");
    assert.strictEqual(data.get("owner:Ustranger") ?? null, null);
    r = await call(owner, { body: { role: "owner" }, user: "Uowner" });
    const ownerCode = r.body.code;
    r = await call(owner, { body: { code: ownerCode }, user: "Uowner" });
    assert.strictEqual(r.body.already, true, "the first owner redeeming an owner code");
    assert.ok(data.get(`owner-invite:${ownerCode}`).usedAt, "spends it too");
    // A helper redeeming an owner code is still an upgrade, and spends it.
    r = await call(owner, { body: { role: "owner" }, user: "Uowner" });
    const upCode = r.body.code;
    r = await call(owner, { body: { code: upCode }, user: "Uhelper2" });
    assert.deepStrictEqual([r.status, r.body.role, r.body.already], [200, "owner", undefined], "a helper redeeming an owner code is upgraded");
    assert.ok(data.get(`owner-invite:${upCode}`).usedAt);
    data.set("owner:Uhelper2", null);

    // ---- 5. owner slip for a room that does not exist
    r = await call(slip, { user: "Uowner", body: { room: "999", note: "x" } });
    assert.deepStrictEqual([r.status, r.body.error.code], [404, "NOT_FOUND"], "no prepay record for a made-up room");
    assert.ok(!data.has("prepay:999"));

    // ---- 6. confirm: bad period, and a failing lookup after the bill is saved
    await tap("Uowner", "action=confirm&room=209&period=2026-1x");
    assert.ok(lastReply().includes("ไม่ระบุรอบบิล"), "a malformed period on a card is refused like a missing one");
    resetRoom("207");
    data.set("room-user:207", "Uivy");
    await saveBill(mk("207", "2026-11", "pending", { issuedAt: longAgo, slipCount: 1 }));
    const realGet = store.get;
    store.get = async (k) => { if (k === "tenancy:207") throw new Error("blob down"); return realGet(k); };
    const errors = []; const realErr = console.error; console.error = (...a) => errors.push(a.join(" "));
    try {
      await tap("Uowner", "action=confirm&room=207&period=2026-11");
    } finally { store.get = realGet; console.error = realErr; }
    assert.strictEqual(data.get("bill:2026-11:207").status, "paid", "the bill is paid");
    assert.strictEqual(lastReply(), "ยืนยันห้อง 207 แล้ว ✅", "and the owner still gets his answer when the receipt lookup fails");
    assert.ok(errors.some((e) => e.includes("receipt send failed")), "the failure is logged");

    // ---- 7. a group slip never replaces a newer latest bill; a plain replaced photo costs no extra reads
    resetRoom("210");
    data.set("room-user:210", "Ujo"); data.set("user-room:Ujo", "210"); data.delete("tenancy:210");
    await saveBill(mk("210", "2026-09", "unpaid", { issuedAt: longAgo }));
    await saveBill(mk("210", "2026-10", "unpaid", { issuedAt: longAgo }));
    await saveBill(mk("210", "2026-12", "unpaid", { issuedAt: longAgo }));
    r = await call(slip, { user: "Ujo", body: { periods: ["2026-09", "2026-10"], image: png } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(data.get("bill:210").period, "2026-12", "the newest bill stays the newest");
    assert.deepStrictEqual(data.get("bills:210"), ["2026-12", "2026-10", "2026-09"]);
    assert.ok(data.get("bill:2026-09:210").slipGroup.periods.length === 2);
    const slow = () => new Promise((ok) => setTimeout(ok, 5)); // photo names carry Date.now(): never reuse one
    const reopen = (...periods) => { for (const p of periods) { const b = data.get(`bill:${p}:210`); b.slipAt = longAgo; b.slipCount = 1; } data.set("bill:210", data.get("bill:2026-12:210")); };
    // A second group (Oct + Dec) replaces Oct's photo, but Sep still shows the first one: it stays.
    const first = data.get("bill:2026-09:210").slipPath;
    await slow(); reopen("2026-09", "2026-10");
    r = await call(slip, { user: "Ujo", body: { periods: ["2026-10", "2026-12"], image: png } });
    assert.strictEqual(r.status, 200);
    assert.ok(files.has(first), "the first group's photo stays while Sep still shows it");
    // Dec alone now: Oct still shares the second group's photo, so that stays as well.
    const second = data.get("bill:2026-12:210").slipPath;
    await slow(); reopen("2026-10", "2026-12");
    r = await call(slip, { user: "Ujo", body: { image: png } });
    assert.strictEqual(r.status, 200);
    assert.ok(files.has(second), "a photo another period still shows is kept");
    assert.ok(!("slipGroup" in data.get("bill:2026-12:210")), "Dec left the group");
    // A plain bill: the photo it replaces is deleted, and the clean-up reads nothing from the store.
    const own = data.get("bill:2026-12:210").slipPath;
    data.get("bill:2026-12:210").slipAt = longAgo; data.set("bill:210", data.get("bill:2026-12:210"));
    await slow();
    let reads = 0; const g2 = store.get; store.get = async (k) => { reads++; return g2(k); };
    try { r = await call(slip, { user: "Ujo", body: { image: png } }); } finally { store.get = g2; }
    assert.strictEqual(r.status, 200);
    assert.ok(!files.has(own), "the replaced photo is deleted");
    assert.ok(reads <= 5, `a replaced photo needs no scan of the room's bills (${reads} reads)`);

    global.fetch = realFetch;
  }

  // ---------------------------------------------------------------- the seed token itself
  process.env.VERCEL_ENV = "development";
  delete require.cache[require.resolve("./api/_auth")];
  const devAuth = require("./api/_auth");
  const reqWith = (headers, query = {}) => ({ headers, query });
  assert.strictEqual(devAuth.seedTokenOk(reqWith({ "x-seed-token": process.env.SEED_TOKEN })), true, "header token works on vercel dev");
  assert.strictEqual(devAuth.seedTokenOk(reqWith({}, { token: process.env.SEED_TOKEN })), false, "a token in the URL is never read");
  assert.strictEqual(devAuth.seedTokenOk(reqWith({ "x-seed-token": "a-long-enough-seed-tokeX" })), false, "a wrong token fails");
  process.env.SEED_TOKEN = "short";
  assert.strictEqual(devAuth.seedTokenOk(reqWith({ "x-seed-token": "short" })), false, "a short SEED_TOKEN does not count as set");
  delete process.env.VERCEL_ENV;

  // ---------------------------------------------------------------- slip verification (SlipOK)
  // Room 210, one unpaid bill of 3,500. Each case sets what SlipOK should answer.
  const vBill = { room: "210", period: "2026-11", rent: 3500, water: 0, elec: 0, total: 3500, status: "unpaid" };
  const resetV = () => {
    data.set("bill:210", { ...vBill });
    data.set("bill:2026-11:210", { ...vBill });
    data.set("user-room:Udave", "210");
    data.set("room-user:210", "Udave");
    data.delete("slip-ref:REF-OK");
    slipokCalls.length = 0;
  };
  const verifyOf = () => data.get("bill:2026-11:210").slipVerify;
  const okSlip = { status: 200, body: { success: true, data: { success: true, message: "ok", amount: 3500, transRef: "REF-OK", transDate: "20261110", transTime: "10:15:07", transTimestamp: "2026-11-10T03:15:07.000Z", receivingBank: "006" } } };
  const failSlip = (code) => ({ status: 200, body: { success: false, code, message: `error ${code}` } });

  delete process.env.SLIPOK_API_KEY;
  delete process.env.SLIPOK_BRANCH_ID;
  resetV();
  r = await call(slip, { body: { image: png }, user: "Udave" });
  assert.strictEqual(r.status, 200, "a slip is still accepted before SlipOK is configured");
  assert.deepStrictEqual([verifyOf().ok, verifyOf().reason], [null, "not_configured"], "no keys = not verified, not fake");
  assert.strictEqual(slipokCalls.length, 0, "nothing is sent without keys");

  process.env.SLIPOK_API_KEY = "test-key";
  process.env.SLIPOK_BRANCH_ID = "1234";

  resetV();
  slipok = okSlip;
  r = await call(slip, { body: { image: png }, user: "Udave" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(slipokCalls.length, 1, "the photo is sent to SlipOK once");
  assert.ok(String(slipokCalls[0].url).endsWith("/1234"), "the branch id is in the path");
  assert.strictEqual(slipokCalls[0].init.headers["x-authorization"], "test-key");
  assert.strictEqual(slipokCalls[0].init.body.get("log"), "true", "log:true is what makes SlipOK check the account and duplicates");
  assert.strictEqual(slipokCalls[0].init.body.get("amount"), "3500", "the bill total is what the slip must match");
  assert.deepStrictEqual(
    [verifyOf().ok, verifyOf().amount, verifyOf().transRef, verifyOf().provider],
    [true, 3500, "REF-OK", "slipok"],
  );
  assert.strictEqual(data.get("bill:210").status, "pending", "verification never pays the bill on its own");
  assert.ok(data.get("slip-ref:REF-OK"), "the transaction reference is remembered for the next slip");

  // The same slip, second bill: our own key catches it even if SlipOK says it is fine.
  data.set("bill:211", { ...vBill, room: "211" });
  data.set("bill:2026-11:211", { ...vBill, room: "211" });
  data.set("user-room:Udave", "211");
  data.set("room-user:211", "Udave");
  r = await call(slip, { body: { image: png }, user: "Udave" });
  const reused = data.get("bill:2026-11:211").slipVerify;
  assert.deepStrictEqual([r.status, reused.ok], [200, false], "a reused transaction reference is not verified");
  assert.match(reused.reason, /ใช้ไปแล้ว/);

  resetV();
  slipok = failSlip(1013);
  await call(slip, { body: { image: png }, user: "Udave" });
  assert.deepStrictEqual([verifyOf().ok, /ยอด/.test(verifyOf().reason)], [false, true], "1013 = amount mismatch");

  resetV();
  slipok = failSlip(1014);
  await call(slip, { body: { image: png }, user: "Udave" });
  assert.deepStrictEqual([verifyOf().ok, /บัญชี/.test(verifyOf().reason)], [false, true], "1014 = not the dorm's account");

  resetV();
  slipok = failSlip(1012);
  await call(slip, { body: { image: png }, user: "Udave" });
  assert.deepStrictEqual([verifyOf().ok, /ซ้ำ/.test(verifyOf().reason)], [false, true], "1012 = duplicate slip");

  // 1009/1011 are "cannot check right now" — that must not be reported as a fake slip.
  resetV();
  slipok = failSlip(1009);
  await call(slip, { body: { image: png }, user: "Udave" });
  assert.strictEqual(verifyOf().ok, null, "a bank outage is 'unverified', not 'invalid'");

  // An unreadable photo is the same class: the tenant gets "ตรวจไม่ได้", never "สลิปปลอม".
  resetV();
  slipok = failSlip(1006);
  await call(slip, { body: { image: png }, user: "Udave" });
  assert.deepStrictEqual([verifyOf().ok, /อ่าน/.test(verifyOf().reason)], [null, true], "1006 = unreadable, not fake");

  // A dead provider must not lose the slip the tenant already sent.
  resetV();
  slipok = null; // the stub answers 500
  r = await call(slip, { body: { image: png }, user: "Udave" });
  assert.deepStrictEqual([r.status, verifyOf().ok], [200, null], "a provider 500 leaves the slip unverified, not rejected");

  // One slip for two periods: verified against the sum, carried by both bills.
  resetV();
  data.set("bill:210", { ...vBill, status: "unpaid" });
  data.set("bill:2026-11:210", { ...vBill, status: "unpaid" });
  data.set("bill:2026-10:210", { ...vBill, period: "2026-10", status: "unpaid" });
  data.set("bills:210", ["2026-10", "2026-11"]);
  slipok = { status: 200, body: { success: true, data: { success: true, message: "ok", amount: 7000, transRef: "REF-GROUP", transDate: "20261110", transTime: "10:15:07", transTimestamp: "2026-11-10T03:15:07.000Z", receivingBank: "006" } } };
  r = await call(slip, { body: { image: png, periods: ["2026-10", "2026-11"] }, user: "Udave" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(slipokCalls[0].init.body.get("amount"), "7000", "a group slip is checked against the sum");
  assert.deepStrictEqual(
    [data.get("bill:2026-10:210").slipVerify.ok, data.get("bill:2026-11:210").slipVerify.ok],
    [true, true],
    "every period of the group carries the result",
  );
  assert.strictEqual(data.get("bill:2026-11:210").status, "pending", "a verified group still waits for the owner");

  // The real SlipOK error body has no `success: false` — it is { code, message, data }. Treating
  // that as a success would mark an unreadable slip as verified. (Shape taken from a live call.)
  resetV();
  slipok = { status: 200, body: { code: 1007, message: "รูปภาพไม่มี QR Code", data: { message: "รูปภาพไม่มี QR Code" } } };
  await call(slip, { body: { image: png }, user: "Udave" });
  assert.deepStrictEqual([verifyOf().ok, /QR/.test(verifyOf().reason)], [null, true], `real error shape: ${JSON.stringify(verifyOf())}`);

  slipok = null;
  delete process.env.SLIPOK_API_KEY;
  delete process.env.SLIPOK_BRANCH_ID;

  // ---------------------------------------------------------------- room pricing (owner edits rent/rates)
  data.set("owner:Uhelper", { role: "viewer", addedBy: "Uowner" });
  const setRoom = (body, user = "Uowner") => call(rooms, { body, user });

  r = await setRoom({ room: "211", rent: 1, waterRate: 0, elecRate: 0 });
  assert.strictEqual(r.status, 200, "the owner can set a room's price");
  assert.deepStrictEqual([r.body.room, r.body.config.rent, r.body.config.waterRate], ["211", 1, 0]);

  r = await call(rooms, { method: "GET", user: "Uowner" });
  const room211 = r.body.rooms.find((x) => x.room === "211");
  const room201 = r.body.rooms.find((x) => x.room === "201");
  assert.strictEqual(room211.config.rent, 1, "the new rent shows in the room list");
  assert.strictEqual(room201.config.rent, 3500, "another room keeps the default");
  assert.strictEqual(room211.config.elecRate, 0);

  // A partial edit keeps the fields it did not mention.
  r = await setRoom({ room: "211", waterRate: 9 });
  assert.deepStrictEqual([r.body.config.rent, r.body.config.waterRate, r.body.config.elecRate], [1, 9, 0]);

  assert.strictEqual((await setRoom({ room: "211", rent: 1 }, "Uhelper")).status, 403, "a viewer cannot change prices");
  assert.strictEqual((await setRoom({ room: "211", rent: 1 }, "Ucarol")).status, 403, "a tenant cannot change prices");
  assert.strictEqual((await setRoom({ room: "999", rent: 1 })).status, 404, "unknown room");
  assert.strictEqual((await setRoom({ room: "211" })).status, 400, "nothing to change");
  assert.strictEqual((await setRoom({ room: "211", rent: -1 })).status, 400, "negative rent");
  assert.strictEqual((await setRoom({ room: "211", rent: 1.5 })).status, 400, "baht with satang");
  assert.strictEqual((await setRoom({ room: "211", waterRate: "abc" })).status, 400, "not a number");

  // The bill really is 1 baht: rent 1, no units.
  data.delete("bill:211"); data.delete("bill:2026-11:211"); data.delete("bills:211");
  data.set("meter:211", { water: 0, elec: 0, at: new Date().toISOString() });
  r = await call(run, { body: { period: "2026-11", readings: [{ room: "211", water: 0, elec: 0 }] }, user: "Uowner" });
  assert.strictEqual(r.status, 200);
  const cheap = data.get("bill:2026-11:211");
  assert.deepStrictEqual([cheap?.total, cheap?.rent, cheap?.status], [1, 1, "unpaid"], "a 1-baht bill for the demo");

  // Put it back so later cases see the prototype prices again.
  await setRoom({ room: "211", rent: 3500, waterRate: 25, elecRate: 7 });
  data.delete("bill:211"); data.delete("bill:2026-11:211"); data.delete("bills:211"); data.delete("meter:211");

  console.log("handlers OK — dev gate, QR binding + move confirm, rate limit, payment confirm, bill issuing, idToken cache, roles + revoke, slip limits, transfer before the bill, a new tenant does not see the previous tenant's bills, receipts, void + re-issue, one slip for several periods, void archive, no-due card, missing units, spent invite codes, seed token, slip verification (SlipOK), room pricing");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
