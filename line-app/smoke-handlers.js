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
global.fetch = async (url, opts = {}) => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
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
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const qr = require("./api/qr");
const run = require("./api/run");
const me = require("./api/me");
const owner = require("./api/owner");
const slip = require("./api/slip");
const dev = require("./api/dev");
const hook = require("./api/webhook");
const { MAX_FAILURES } = require("./api/_limit");

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

  console.log("handlers OK — dev gate, QR binding + move confirm, rate limit, payment confirm, bill issuing, idToken cache, roles + revoke, slip limits, seed token");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
