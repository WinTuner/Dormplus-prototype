// POST /api/seed?token=... — demo bills for the configured rooms (idempotent).
const store = require("./_store");
const { ROOMS, configFor, DEFAULTS } = require("./_rooms");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.SEED_TOKEN || req.query.token !== process.env.SEED_TOKEN) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "ต้องมี token" } });
  }

  const period = process.env.BILL_PERIOD || "2026-11";
  const created = [];

  for (const [i, room] of ROOMS.entries()) {
    // Demo variety: every third room gets a cheaper rent; real rent lives in room:<room>.
    if (!(await store.get(`room:${room}`))) {
      await store.set(`room:${room}`, { ...DEFAULTS, rent: i % 3 === 0 ? 3220 : DEFAULTS.rent });
    }
    const cfg = await configFor(room);
    const waterUnits = 4 + (i % 4);
    const elecUnits = 28 + (i % 6) * 7;
    const water = waterUnits * cfg.waterRate;
    const elec = elecUnits * cfg.elecRate;

    await store.set(`bill:${room}`, {
      room,
      period,
      rent: cfg.rent,
      water,
      elec,
      waterUnits,
      elecUnits,
      total: cfg.rent + water + elec,
      due: process.env.BILL_DUE || "2026-11-16",
      status: "unpaid",
    });
    created.push(room);
  }

  return res.status(200).json({ ok: true, period, rooms: created });
};
