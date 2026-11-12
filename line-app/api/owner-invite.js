// POST /api/owner-invite — an existing owner mints a one-time code so a second person
// (a co-owner, a caretaker) can become an owner by scanning a QR / opening a link.
const qrcode = require("qrcode-svg");
const store = require("./_store");
const { requireUser, isOwner } = require("./_auth");

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const CODE_LENGTH = 8;
const TTL_MS = 10 * 60 * 1000; // 10 minutes: enough to walk over and scan, short enough to leak safely

const newCode = () =>
  Array.from({ length: CODE_LENGTH }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

const liffUrl = (code) => {
  const id = process.env.LIFF_ID;
  if (!id) return null;
  return `https://liff.line.me/${id}?owner=${code}`;
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!(await isOwner(userId))) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "เฉพาะเจ้าของหอ" } });
  }

  const code = newCode();
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  await store.set(`owner-invite:${code}`, { createdBy: userId, createdAt: new Date().toISOString(), expiresAt });

  const url = liffUrl(code);
  const qr = url ? new qrcode({ content: url, width: 320, height: 320, padding: 8 }).svg() : null;

  return res.status(200).json({ code, url, qr, expiresAt });
};
