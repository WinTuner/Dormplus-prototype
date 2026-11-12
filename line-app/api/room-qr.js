// GET /api/room-qr?room=203  — owner: the permanent QR code printed for that room's door.
// POST /api/room-qr?room=203  — owner: rotate it (old printed slip stops working).
const qrcode = require("qrcode-svg");
const store = require("./_store");
const { requireUser, isOwner } = require("./_auth");

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const CODE_LENGTH = 10;

const newCode = () =>
  Array.from({ length: CODE_LENGTH }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

const bindUrl = (code) => (process.env.LIFF_ID ? `https://liff.line.me/${process.env.LIFF_ID}?bind=${code}` : null);

async function ensureCode(room, rotate) {
  const key = `room-qr:${room}`;
  const existing = await store.get(key);
  if (existing && !rotate) return existing;

  if (existing?.code) await store.set(`qr-code:${existing.code}`, null); // old code stops working
  const code = newCode();
  const entry = { code, createdAt: new Date().toISOString() };
  await store.set(key, entry);
  await store.set(`qr-code:${code}`, room);
  return entry;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!(await isOwner(userId))) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "เฉพาะเจ้าของหอ" } });
  }

  const room = String(req.query.room || "").trim();
  if (!room) return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องระบุ room" } });
  if (!(await store.get(`user-room:${room}`)) && !(await store.get(`bill:${room}`))) {
    // A room that never had a bill or a tenant is almost certainly a typo.
    return res.status(404).json({ error: { code: "NOT_FOUND", message: `ไม่พบห้อง ${room}` } });
  }

  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

  const entry = await ensureCode(room, req.method === "POST");
  const url = bindUrl(entry.code);
  const qr = url ? new qrcode({ content: url, width: 360, height: 360, padding: 8 }).svg() : null;

  return res.status(200).json({ room, code: entry.code, url, qr, rotated: req.method === "POST" });
};
