// POST /api/run — owner records this month's meter units and pushes the bills.
// body: { period?, due?, readings: [{ room, water, elec }] }  (units, not baht)
const store = require("./_store");
const { push, billBubble } = require("./_line");
const { requireUser, isOwner } = require("./_auth");
const { configFor } = require("./_rooms");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!await isOwner(userId)) return res.status(403).json({ error: { code: "FORBIDDEN", message: "เฉพาะเจ้าของหอ" } });

  const { period, due, readings } = req.body || {};
  if (!Array.isArray(readings) || !readings.length) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องส่ง readings" } });
  }

  const billPeriod = String(period || process.env.BILL_PERIOD || "").trim();
  const billDue = String(due || process.env.BILL_DUE || "").trim();
  if (!billPeriod) return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องระบุ period (เช่น 2026-11)" } });

  const baseUrl = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
  const out = [];

  for (const r of readings) {
    const room = String(r.room || "").trim();
    const waterUnits = Number(r.water || 0);
    const elecUnits = Number(r.elec || 0);
    if (!room || !Number.isFinite(waterUnits) || !Number.isFinite(elecUnits)) {
      out.push({ room, error: "ค่ามิเตอร์ไม่ถูกต้อง" });
      continue;
    }

    const cfg = await configFor(room);
    const water = Math.round(waterUnits * cfg.waterRate);
    const elec = Math.round(elecUnits * cfg.elecRate);
    const bill = {
      room,
      period: billPeriod,
      rent: cfg.rent,
      water,
      elec,
      waterUnits,
      elecUnits,
      total: cfg.rent + water + elec,
      due: billDue || null,
      status: "unpaid",
    };

    await store.set(`meter:${room}`, { water: waterUnits, elec: elecUnits, at: new Date().toISOString() });
    await store.set(`bill:${room}`, bill);

    const tenant = await store.get(`room-user:${room}`);
    let pushed = false;
    if (tenant) {
      try {
        await push(tenant, [billBubble(bill, baseUrl)]);
        pushed = true;
      } catch (err) {
        console.error("bill push failed", room, err.message);
      }
    }
    out.push({ room, total: bill.total, pushed });
  }

  return res.status(200).json({ ok: true, period: billPeriod, due: billDue || null, rooms: out });
};
