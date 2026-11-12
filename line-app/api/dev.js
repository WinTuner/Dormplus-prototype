// /api/dev?do=seed|sendbill&token=<SEED_TOKEN> — test helpers, kept out of the product surface.
// One function instead of two: Vercel's Hobby plan caps a deployment at 12 functions.
const store = require("./_store");
const { indexBill } = require("./_bills");
const { push, billBubble } = require("./_line");
const { ROOMS, configFor, DEFAULTS } = require("./_rooms");

const tokenOk = (req) => !!process.env.SEED_TOKEN && req.query.token === process.env.SEED_TOKEN;

async function seed(res) {
  const period = process.env.BILL_PERIOD || "2026-11";
  const due = process.env.BILL_DUE || "2026-11-16";
  const created = [];

  for (const [i, room] of ROOMS.entries()) {
    if (!(await store.get(`room:${room}`))) {
      await store.set(`room:${room}`, { ...DEFAULTS, rent: i % 3 === 0 ? 3220 : DEFAULTS.rent });
    }
    const cfg = await configFor(room);
    const waterUnits = 4 + (i % 4);
    const elecUnits = 28 + (i % 6) * 7;
    const water = waterUnits * cfg.waterRate;
    const elec = elecUnits * cfg.elecRate;
    const bill = {
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
    };

    await store.set(`bill:${room}`, bill);
    await store.set(`bill:${period}:${room}`, bill); // history stays readable afterwards
    await indexBill(room, period);
    created.push(room);
  }

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
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!tokenOk(req)) return res.status(403).json({ error: { code: "FORBIDDEN", message: "ต้องมี token" } });

  switch (String(req.query.do || "")) {
    case "seed":
      return seed(res);
    case "sendbill":
      return sendbill(req, res);
    default:
      return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องระบุ do=seed หรือ do=sendbill" } });
  }
};
