// Local server for the Playwright UI tests: the real LIFF page + the real api/*.js handlers, with
// the outside world faked exactly like smoke-usecases.js does (in-memory store, stubbed LINE and
// SlipOK, qrcode-svg stand-in). No network, no Vercel CLI.
//
//   node e2e/server.js            (PORT=4173 by default)
//
// Test-only controls live under /__test/ (never reachable in production: this file is not deployed,
// see line-app/.vercelignore).
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

process.env.LINE_CHANNEL_SECRET = "test-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
process.env.LIFF_ID = "2000000000-testliff";
process.env.OWNER_USER_ID = "Uowner";
process.env.RICHMENU_OWNER_ID = "richmenu-owner";
process.env.RICHMENU_TENANT_ID = "richmenu-tenant";
for (const k of ["VERCEL_ENV", "ALLOW_SEED_BYPASS", "ROOMS", "DEFAULT_RENT", "WATER_RATE", "ELEC_RATE", "BILL_PERIOD", "BILL_DUE", "SLIPOK_API_KEY", "SLIPOK_BRANCH_ID", "SLIP_AUTO_CONFIRM"]) {
  delete process.env[k];
}

const ROOT = path.join(__dirname, "..");
const apiPath = (name) => path.join(ROOT, "api", name);

// ---------------------------------------------------------------- fakes (installed BEFORE any handler loads)
const data = new Map();
const files = new Map();
const pathOf = (k) => `kv/${String(k).replace(/[^a-zA-Z0-9._-]/g, "-")}.json`;
const store = {
  get: async (k) => (data.has(k) ? data.get(k) : null),
  set: async (k, v) => { data.set(k, v); },
  keysWith: async (prefix) => {
    const pathPrefix = pathOf(prefix).replace(/\.json$/, "");
    return [...data.keys()]
      .filter((k) => pathOf(k).startsWith(pathPrefix))
      .map((k) => prefix + pathOf(k).slice(pathPrefix.length).replace(/\.json$/, ""));
  },
  // Unlike the smoke harness this one serves the bytes back, so /api/slip-image shows a real picture.
  getFile: async (p) => {
    if (!files.has(p)) return null;
    const f = files.get(p);
    return { blob: { contentType: f.mime }, stream: new Blob([f.bytes]).stream() };
  },
  putFile: async (p, bytes, mime) => files.set(p, { bytes, mime: mime || "image/png" }),
  delFile: async (p) => files.delete(p),
};
require.cache[require.resolve(apiPath("_store"))] = { id: apiPath("_store.js"), filename: apiPath("_store.js"), loaded: true, exports: store };

const Module = require("module");
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "qrcode-svg") return class { svg() { return "<svg/>"; } };
  return realLoad.call(this, request, ...rest);
};

const pushed = []; // { to, messages }
const replies = [];
const retryKeys = new Set();
let slipok = null; // what SlipOK answers: { status, body } | null (= provider down)
global.fetch = async (url, opts = {}) => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const u = String(url);
  if (u.includes("/oauth2/v2.1/verify")) {
    // an id_token starting with "U" verifies as that LINE userId
    const token = new URLSearchParams(opts.body).get("id_token");
    return token && token.startsWith("U")
      ? ok({ sub: token, exp: Math.floor(Date.now() / 1000) + 3600 })
      : { ok: false, status: 400, json: async () => ({}) };
  }
  if (u.includes("api.slipok.com")) {
    if (!slipok) return { ok: false, status: 500, json: async () => ({}), text: async () => "{}" };
    return { ok: slipok.status === 200, status: slipok.status, json: async () => slipok.body, text: async () => JSON.stringify(slipok.body) };
  }
  if (u.includes("/message/push")) {
    const body = JSON.parse(opts.body);
    const key = opts.headers && opts.headers["X-Line-Retry-Key"];
    if (key) {
      if (retryKeys.has(key)) return { ok: false, status: 409, text: async () => "conflict", json: async () => ({}) };
      retryKeys.add(key);
    }
    pushed.push(body);
  }
  if (u.includes("/message/reply")) replies.push(JSON.parse(opts.body));
  const profile = /\/v2\/bot\/profile\/([^/]+)$/.exec(u);
  if (profile) return ok({ displayName: `name-${profile[1]}` });
  return ok({});
};

// Handlers are required lazily, after the fakes above are in place.
const handlers = {};
const handler = (name) => (handlers[name] ||= require(apiPath(name)));
const { saveBill, archiveVoid, tagOverpaid } = require(apiPath("_bills"));

// ---------------------------------------------------------------- seeding
const TZ = "Asia/Bangkok";
const ymd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const DAY = 86400000;
// "+10d" / "-20d" -> that Bangkok calendar date relative to now; anything else is used as given.
const when = (v) => (typeof v === "string" && /^[+-]\d+d$/.test(v) ? ymd(new Date(Date.now() + parseInt(v, 10) * DAY)) : v);
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function mkBill(b) {
  const status = b.status || "unpaid";
  const bill = {
    room: b.room,
    period: b.period || ymd(new Date()).slice(0, 7),
    rent: 3500, water: 250, elec: 700, waterUnits: 10, elecUnits: 100, total: 4450,
    due: when(b.due || "+10d"),
    status,
    rev: 1,
    issuedAt: new Date().toISOString(),
    ...b,
  };
  bill.due = when(bill.due);
  if (status === "pending") {
    bill.slipPath = bill.slipPath || `slips/${bill.room}-seed.png`;
    bill.slipAt = bill.slipAt || new Date().toISOString();
    bill.slipCount = bill.slipCount || 1;
    files.set(bill.slipPath, { bytes: PNG_1PX, mime: "image/png" });
  }
  if (status === "paid") {
    bill.paidAt = bill.paidAt || new Date().toISOString();
    bill.receiptNo = bill.receiptNo || `R${bill.period.replace("-", "")}-${bill.room}`;
  }
  return bill;
}

// Seed shape (everything optional):
//   { owners:[{userId, role}], bind:{ "Utenant201":"201" }, bills:[{room, period?, status?, due?, ...fields}],
//     voided:[bill with status "void"], overpaid:[paid bill with refundDue + refundReason "overpaid"], store:{key:value} }
// Bills go through the real saveBill, so every copy and index the handlers read exists.
async function seed(s) {
  for (const o of s.owners || []) data.set(`owner:${o.userId}`, { addedAt: "2026-01-01T00:00:00.000Z", role: o.role });
  for (const [user, room] of Object.entries(s.bind || {})) {
    data.set(`user-room:${user}`, room);
    data.set(`room-user:${room}`, user);
  }
  for (const b of s.bills || []) await saveBill(mkBill(b));
  for (const b of s.voided || []) {
    const bill = mkBill({ ...b, status: "void" });
    await archiveVoid(bill);
    await saveBill(bill);
  }
  for (const b of s.overpaid || []) {
    const bill = mkBill({ ...b, status: "paid", refundReason: "overpaid" });
    await saveBill(bill);
    await tagOverpaid(bill.room, [bill]);
  }
  for (const [k, v] of Object.entries(s.store || {})) data.set(k, v);
}

const SCENARIOS = {
  // tenant of room 201 with a current unpaid bill
  "tenant-unpaid": () => ({ bind: { Utenant201: "201" }, bills: [{ room: "201", due: "+10d" }] }),
  // a dorm with one room in each state
  "owner-dorm": () => ({
    bind: { Utenant201: "201", Utenant202: "202" },
    bills: [
      { room: "201", status: "unpaid", due: "+10d" },
      { room: "202", status: "pending" },
      { room: "203", status: "paid" },
    ],
  }),
};

function reset() {
  data.clear();
  files.clear();
  pushed.length = replies.length = 0;
  retryKeys.clear();
  slipok = null;
  delete process.env.SLIPOK_API_KEY;
  delete process.env.SLIPOK_BRANCH_ID;
  delete process.env.SLIP_AUTO_CONFIRM;
}

// The owner's "ยืนยันการชำระ" button is on the LINE card, not in the LIFF page: drive it the way LINE
// does, with a signed postback to the real webhook handler.
async function confirmViaWebhook({ room, period, user = "Uowner" }) {
  const raw = Buffer.from(JSON.stringify({
    events: [{ type: "postback", replyToken: "r", source: { userId: user }, postback: { data: `action=confirm&room=${room}&period=${period}` } }],
  }));
  const sig = crypto.createHmac("sha256", "test-secret").update(raw).digest("base64");
  const req = {
    method: "POST",
    headers: { "x-line-signature": sig, host: "localhost" },
    async *[Symbol.asyncIterator]() { yield raw; },
  };
  return new Promise((resolve, reject) => {
    const res = {
      status(c) { this.code = c; return this; },
      json(o) { resolve({ status: this.code, body: o }); return this; },
      end() { resolve({ status: this.code || 200, body: null }); return this; },
    };
    Promise.resolve(handler("webhook")(req, res)).catch(reject);
  });
}

// ---------------------------------------------------------------- http plumbing
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function adapt(req, res, url) {
  req.query = Object.fromEntries(url.searchParams);
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
    return res;
  };
}

const send = (res, code, obj) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
};

async function testRoute(req, res, url) {
  const name = url.pathname.slice("/__test/".length);
  const body = req.method === "POST" ? JSON.parse((await readBody(req)).toString("utf8") || "{}") : {};
  if (name === "reset" && req.method === "POST") { reset(); return send(res, 200, { ok: true }); }
  if (name === "seed" && req.method === "POST") {
    const s = body.scenario ? SCENARIOS[body.scenario]?.() : body;
    if (!s) return send(res, 400, { error: `unknown scenario ${body.scenario}` });
    await seed(s);
    return send(res, 200, { ok: true });
  }
  if (name === "slipok" && req.method === "POST") {
    // { amount, transRef } -> a good slip; { status, body } -> raw answer; null -> provider down
    if (body && body.amount != null) {
      slipok = { status: 200, body: { success: true, data: { success: true, message: "ok", amount: body.amount, transRef: body.transRef || "REF1", transTimestamp: new Date().toISOString(), receivingBank: "006" } } };
    } else slipok = body && body.status ? body : null;
    if (slipok) { process.env.SLIPOK_API_KEY = "test-key"; process.env.SLIPOK_BRANCH_ID = "1234"; }
    else { delete process.env.SLIPOK_API_KEY; delete process.env.SLIPOK_BRANCH_ID; }
    return send(res, 200, { ok: true });
  }
  if (name === "confirm" && req.method === "POST") return send(res, 200, await confirmViaWebhook(body));
  if (name === "state" && req.method === "GET") {
    const keys = url.searchParams.getAll("key");
    return send(res, 200, { pushed, replies, store: Object.fromEntries(keys.map((k) => [k, data.has(k) ? data.get(k) : null])) });
  }
  return send(res, 404, { error: "no such test route" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/__test/")) return await testRoute(req, res, url);
    if (url.pathname === "/" || url.pathname === "/liff/bill.html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(fs.readFileSync(path.join(ROOT, "liff", "bill.html")));
    }
    if (url.pathname === "/favicon.ico") { res.statusCode = 204; return res.end(); }
    const m = /^\/api\/([a-z0-9_-]+)$/i.exec(url.pathname);
    if (m && !m[1].startsWith("_") && fs.existsSync(apiPath(`${m[1]}.js`))) {
      adapt(req, res, url);
      // /api/webhook verifies the signature over the raw bytes and reads the stream itself;
      // every other handler gets the parsed JSON body like on Vercel.
      if (m[1] !== "webhook" && req.method !== "GET" && req.method !== "HEAD") {
        const raw = await readBody(req);
        const type = String(req.headers["content-type"] || "");
        req.body = type.includes("application/json") ? (raw.length ? JSON.parse(raw.toString("utf8")) : {}) : raw;
      }
      return await handler(m[1])(req, res);
    }
    res.statusCode = 404;
    res.end("not found");
  } catch (err) {
    console.error("[e2e server]", req.method, req.url, err);
    if (!res.headersSent) send(res, 500, { error: { code: "SERVER", message: String(err.message) } });
    else res.end();
  }
});

const port = Number(process.env.PORT || 4173);
server.listen(port, "127.0.0.1", () => console.log(`e2e server on http://127.0.0.1:${port}`));
