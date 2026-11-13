const crypto = require("crypto");

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

// The seed-token bypass and /api/dev must never reach real data:
// - production: never, whatever the other variables say
// - `vercel dev` on a laptop (VERCEL_ENV=development): yes
// - anything else (preview deploys, which share production's env and Blob store): only with an
//   explicit ALLOW_SEED_BYPASS=true
const IS_PRODUCTION = process.env.VERCEL_ENV === "production";
const BYPASS_ALLOWED =
  !IS_PRODUCTION && (process.env.ALLOW_SEED_BYPASS === "true" || process.env.VERCEL_ENV === "development");

// A short SEED_TOKEN can be guessed, so it does not count as configured.
const MIN_SEED_TOKEN_LENGTH = 16;

function sameSecret(given, expected) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(expected || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// True when the request carries the seed token in its `x-seed-token` header (never the URL,
// which ends up in access logs) and dev tools are allowed on this deployment.
function seedTokenOk(req) {
  const token = process.env.SEED_TOKEN || "";
  if (!BYPASS_ALLOWED || token.length < MIN_SEED_TOKEN_LENGTH) return false;
  return sameSecret(req.headers["x-seed-token"], token);
}

// Resolves the caller to a LINE userId, or answers 401/403 and returns null.
async function requireUser(req, res) {
  if (seedTokenOk(req)) {
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

// Owner = the userId in OWNER_USER_ID (the dorm's first owner, set by hand) or anyone the
// owner later admitted with an owner invite code (store key `owner:<userId>`).
// Who is this? "owner" (full), "viewer" (can look, cannot bill or invite), or null (tenant/unknown).
async function roleOf(userId) {
  if (!userId) return null;
  if (process.env.OWNER_USER_ID && userId === process.env.OWNER_USER_ID) return "owner";
  // Lazy require: keeps `node smoke.js` runnable with no node_modules installed.
  const store = require("./_store");
  const record = await store.get(`owner:${userId}`);
  if (!record) return null;
  return record.role === "viewer" ? "viewer" : "owner"; // records written before roles existed are full owners
}

const isOwner = async (userId) => (await roleOf(userId)) === "owner";
const canView = async (userId) => (await roleOf(userId)) !== null;

module.exports = {
  requireUser,
  isOwner,
  canView,
  roleOf,
  seedTokenOk,
  sameSecret,
  CHANNEL_ID,
  BYPASS_ALLOWED,
  MIN_SEED_TOKEN_LENGTH,
};
