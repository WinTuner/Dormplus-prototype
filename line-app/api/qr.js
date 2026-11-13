// /api/qr — the room QR that tenants scan, and the redemption of that QR.
// Two halves in one function because Vercel's Hobby plan caps a deployment at 12 functions.
//
//   GET  ?room=203   (owner) -> that room's code + QR (created on first use)   (was /api/room-qr GET)
//   POST ?room=203   (owner) -> rotate the code, invalidating printed slips    (was /api/room-qr POST)
//   POST { code }    (tenant)-> bind this LINE account to the room             (was /api/tenant-bind)
const qrcode = require("qrcode-svg");
const crypto = require("crypto");
const store = require("./_store");
const { requireUser, isOwner } = require("./_auth");
const { linkRichMenu } = require("./_line");

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const bindUrl = (code) => (process.env.LIFF_ID ? `https://liff.line.me/${process.env.LIFF_ID}?bind=${code}` : null);

const newCode = () =>
  Array.from({ length: 10 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");

async function ensureCode(room, rotate) {
  const key = `room-qr:${room}`;
  const existing = await store.get(key);
  if (existing && !rotate) return existing;

  if (existing?.code) await store.set(`qr-code:${existing.code}`, null); // the old slip stops working
  const entry = { code: newCode(), createdAt: new Date().toISOString() };
  await store.set(key, entry);
  await store.set(`qr-code:${entry.code}`, room);
  return entry;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const userId = await requireUser(req, res);
  if (!userId) return;

  const room = String(req.query.room || "").trim();
  const code = String((req.body && req.body.code) || "").trim().toUpperCase();

  if (room) return roomQr(req, res, userId, room);
  if (code) return bind(req, res, userId, code);
  return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องระบุ room หรือ code" } });
};

async function roomQr(req, res, userId, room) {
  if (!(await isOwner(userId))) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "เฉพาะเจ้าของหอ" } });
  }
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

  // A room that never had a bill or a tenant is almost certainly a typo.
  if (!(await store.get(`user-room:${room}`)) && !(await store.get(`bill:${room}`))) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: `ไม่พบห้อง ${room}` } });
  }

  const entry = await ensureCode(room, req.method === "POST");
  const url = bindUrl(entry.code);
  const qr = url ? new qrcode({ content: url, width: 360, height: 360, padding: 8 }).svg() : null;
  return res.status(200).json({ room, code: entry.code, url, qr, rotated: req.method === "POST" });
}

async function bind(req, res, userId, code) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const room = await store.get(`qr-code:${code}`);
  if (!room) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "QR นี้ใช้ไม่ได้แล้ว — ขอใหม่จากเจ้าของหอ" } });
  }

  const previous = await store.get(`user-room:${userId}`);
  await store.set(`user-room:${userId}`, room);
  await store.set(`room-user:${room}`, userId);

  if (process.env.RICHMENU_TENANT_ID) {
    await linkRichMenu(userId, process.env.RICHMENU_TENANT_ID).catch((err) =>
      console.error("richmenu link failed", err.message)
    );
  }
  return res.status(200).json({ ok: true, room, previous: previous || null });
}
