// GET /api/cron — run once a day by Vercel Cron (see vercel.json). Vercel sends
// `Authorization: Bearer <CRON_SECRET>` itself when the variable is set on the project.
const { sameSecret } = require("./_auth");
const { runReminders } = require("./_remind");

const MIN_SECRET_LENGTH = 16;
const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

// YYYY-MM-DD on the dorm's wall clock, not the server's UTC one.
const bangkokToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

module.exports = async (req, res) => {
  if (req.method !== "GET") return fail(res, 405, "METHOD_NOT_ALLOWED", "GET only");

  const secret = process.env.CRON_SECRET || "";
  if (secret.length < MIN_SECRET_LENGTH) {
    return fail(res, 503, "NOT_CONFIGURED", "ยังไม่ได้ตั้ง CRON_SECRET (อย่างน้อย 16 ตัวอักษร)");
  }
  const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!sameSecret(given, secret)) return fail(res, 401, "UNAUTHORIZED", "bad cron secret");

  const today = bangkokToday();
  const baseUrl = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
  const { sent, failed } = await runReminders({ today, baseUrl });
  return res.status(200).json({ ok: true, today, sent, failed });
};
