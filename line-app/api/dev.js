// POST /api/dev?do=seed|sendbill — test helpers, kept out of the product surface.
// One function instead of two: Vercel's Hobby plan caps a deployment at 12 functions.
//
// Locked down because `seed` overwrites every bill and `sendbill` pushes to any user:
// - answers 404 on production, and on preview unless ALLOW_SEED_BYPASS=true (see _auth.js)
// - the token goes in the `x-seed-token` header, never in the URL, and must be ≥ 16 characters
const { saveBill } = require("./_bills");
const { push, billBubble } = require("./_line");
const { ROOMS, configFor, DEFAULTS } = require("./_rooms");
const { seedTokenOk, BYPASS_ALLOWED } = require("./_auth");
const { mapLimit } = require("./_async");
const store = require("./_store");

const SEED_CONCURRENCY = 6;

async function seed(res) {
  const period = process.env.BILL_PERIOD || "2026-11";
  const due = process.env.BILL_DUE || "2026-11-16";

  // Each room costs three round trips (read config, maybe write it, write the bill), so seeding a
  // full dorm in a row waits on the network 40+ times. Same bounded fan-out as /api/run.
  const created = await mapLimit(ROOMS, SEED_CONCURRENCY, async (room, i) => {
    if (!(await store.get(`room:${room}`))) {
      await store.set(`room:${room}`, { ...DEFAULTS, rent: i % 3 === 0 ? 3220 : DEFAULTS.rent });
    }
    const cfg = await configFor(room);
    const waterUnits = 4 + (i % 4);
    const elecUnits = 28 + (i % 6) * 7;
    const water = waterUnits * cfg.waterRate;
    const elec = elecUnits * cfg.elecRate;
    await saveBill({
      room,
      period,
      rent: cfg.rent,
      water,
      elec,
      waterUnits,
      elecUnits,
      total: cfg.rent + water + elec,
      due,
      status: "unpaid",
    });
    return room;
  });

  return res.status(200).json({ ok: true, period, rooms: created });
}

async function sendbill(req, res) {
  const { to, room } = req.body || {};
  if (!to || !room) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องระบุ to และ room" } });
  }
  const bill = await store.get(`bill:${room}`);
  if (!bill) return res.status(404).json({ error: { code: "NOT_FOUND", message: `ไม่พบบิลห้อง ${room}` } });

  const baseUrl = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
  await push(to, [billBubble(bill, baseUrl)]);
  return res.status(200).json({ ok: true, sent: room, total: bill.total });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  // On production this endpoint does not exist, whatever token is sent.
  if (!BYPASS_ALLOWED) return res.status(404).json({ error: { code: "NOT_FOUND", message: "ไม่พบ" } });
  if (req.method !== "POST") return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });
  if (!seedTokenOk(req)) return res.status(403).json({ error: { code: "FORBIDDEN", message: "ต้องส่ง x-seed-token" } });

  switch (String(req.query.do || "")) {
    case "seed":
      return seed(res);
    case "sendbill":
      return sendbill(req, res);
    default:
      return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องระบุ do=seed หรือ do=sendbill" } });
  }
};
