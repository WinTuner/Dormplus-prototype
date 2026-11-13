// Failed-attempt limiter for the code-redeem endpoints (room QR, owner invite).
// Counts failures per LINE user per hour in the Blob store; successes are never counted.
const store = require("./_store");

const WINDOW_MS = 60 * 60 * 1000;
const MAX_FAILURES = 10;

const keyOf = (scope, userId) => `limit:${scope}:${userId}`;

async function blocked(scope, userId) {
  const rec = await store.get(keyOf(scope, userId));
  return !!rec && rec.until > Date.now() && rec.count >= MAX_FAILURES;
}

async function recordFailure(scope, userId) {
  const key = keyOf(scope, userId);
  const rec = await store.get(key);
  const now = Date.now();
  const fresh = !rec || rec.until <= now;
  await store.set(key, fresh ? { count: 1, until: now + WINDOW_MS } : { ...rec, count: rec.count + 1 });
}

function tooMany(res) {
  return res
    .status(429)
    .json({ error: { code: "TOO_MANY_ATTEMPTS", message: "ลองรหัสผิดหลายครั้งเกินไป — รอ 1 ชั่วโมงแล้วลองใหม่" } });
}

module.exports = { blocked, recordFailure, tooMany, MAX_FAILURES };
