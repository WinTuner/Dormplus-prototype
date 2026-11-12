// LINE Login channel id = the prefix of the LIFF id (e.g. 2012575885-l35sh1N4).
const CHANNEL_ID = process.env.LOGIN_CHANNEL_ID || (process.env.LIFF_ID || "").split("-")[0] || null;

async function verifyIdToken(idToken) {
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: CHANNEL_ID }),
  });
  if (!res.ok) return null;
  const payload = await res.json();
  return payload.sub || null;
}

// The token bypass is denied by default and must be opted into: preview/dev deploys only,
// or a self-hosted box that sets ALLOW_SEED_BYPASS=true. Production never gets it.
const BYPASS_ALLOWED =
  process.env.ALLOW_SEED_BYPASS === "true" || ["development", "preview"].includes(process.env.VERCEL_ENV || "");

// Resolves the caller to a LINE userId, or answers 401/403 and returns null.
async function requireUser(req, res) {
  if (BYPASS_ALLOWED && process.env.SEED_TOKEN && req.headers["x-seed-token"] === process.env.SEED_TOKEN) {
    return process.env.OWNER_USER_ID || "dev";
  }
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token || !CHANNEL_ID) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "ต้องเปิดหน้านี้ผ่าน LINE" } });
    return null;
  }
  const userId = await verifyIdToken(token);
  if (!userId) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "idToken ไม่ถูกต้องหรือหมดอายุ" } });
    return null;
  }
  return userId;
}

const isOwner = (userId) => !!process.env.OWNER_USER_ID && userId === process.env.OWNER_USER_ID;

module.exports = { requireUser, isOwner, CHANNEL_ID, BYPASS_ALLOWED };
