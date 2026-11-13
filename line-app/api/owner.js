// /api/owner — both halves of "add another owner" live here, because Vercel's Hobby plan
// allows only 12 serverless functions per deployment.
//
//   POST            (owner)   -> mint a one-time code + QR      (was /api/owner-invite)
//   POST { code }   (any user)-> redeem that code               (was /api/owner-accept)
const crypto = require("crypto");
const store = require("./_store");
const { requireUser, isOwner } = require("./_auth");
const { linkRichMenu, push } = require("./_line");
const limit = require("./_limit");

// Lazy: keeps `node smoke.js` runnable without node_modules.
const qrSvg = (url) => {
  const QR = require("qrcode-svg");
  return new QR({ content: url, width: 320, height: 320, padding: 8 }).svg();
};

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const TTL_MS = 10 * 60 * 1000;

const newCode = (length) =>
  Array.from({ length }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");

const liffUrl = (code) => (process.env.LIFF_ID ? `https://liff.line.me/${process.env.LIFF_ID}?owner=${code}` : null);

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });
  }

  const userId = await requireUser(req, res);
  if (!userId) return;

  const code = String((req.body && req.body.code) || "").trim().toUpperCase();
  return code ? accept(req, res, userId, code) : invite(req, res, userId);
};

// Owner mints a code for a co-owner / caretaker.
async function invite(req, res, userId) {
  if (!(await isOwner(userId))) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "เฉพาะเจ้าของหอ" } });
  }

  const role = (req.body && req.body.role) === "viewer" ? "viewer" : "owner";
  const code = newCode(8);
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  await store.set(`owner-invite:${code}`, { createdBy: userId, role, createdAt: new Date().toISOString(), expiresAt });

  const url = liffUrl(code);
  const qr = url ? qrSvg(url) : null;
  return res.status(200).json({ code, url, qr, role, expiresAt });
}

// Someone opened the QR and redeemed the code.
async function accept(req, res, userId, code) {
  // Without a hand-set first owner there is nobody who could have minted a legitimate code.
  if (!process.env.OWNER_USER_ID) {
    return res.status(409).json({ error: { code: "INVALID_STATE", message: "ยังไม่ได้ตั้ง OWNER_USER_ID ของหอ" } });
  }

  if (await limit.blocked("owner", userId)) return limit.tooMany(res);

  const key = `owner-invite:${code}`;
  const found = await store.get(key);
  if (!found) {
    await limit.recordFailure("owner", userId);
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "รหัสไม่ถูกต้อง" } });
  }
  if (found.usedAt || new Date(found.expiresAt).getTime() < Date.now()) {
    await limit.recordFailure("owner", userId);
    return res.status(410).json({ error: { code: "INVITE_EXPIRED", message: "รหัสหมดอายุหรือถูกใช้แล้ว — ขอใหม่จากเจ้าของหอ" } });
  }
  if (await isOwner(userId)) return res.status(200).json({ owner: true, already: true });

  const role = found.role === "viewer" ? "viewer" : "owner";
  await store.set(`owner:${userId}`, { addedAt: new Date().toISOString(), addedBy: found.createdBy, role });
  await store.set(key, { ...found, usedAt: new Date().toISOString(), usedBy: userId });

  if (process.env.RICHMENU_OWNER_ID) {
    await linkRichMenu(userId, process.env.RICHMENU_OWNER_ID).catch((err) =>
      console.error("richmenu link failed", err.message)
    );
  }
  // The first owner always hears that someone new got owner screens.
  await push(process.env.OWNER_USER_ID, [
    { type: "text", text: `มี${role === "viewer" ? "ผู้ช่วย (ดูอย่างเดียว)" : "เจ้าของหอ"}คนใหม่เข้าระบบด้วยรหัสเชิญแล้ว` },
  ]).catch((err) => console.error("owner notice failed", err.message));
  return res.status(200).json({ owner: role === "owner", role });
}
