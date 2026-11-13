// POST /api/run — owner records this month's meter units and pushes the bills.
// body: { period?, due?, readings: [{ room, water, elec }] }  (units, not baht)
//
// Money rules:
// - a room whose bill for this period already has a slip (pending) or is paid is skipped, never
//   reset to unpaid; an unpaid bill may be re-issued to correct a typo
// - units must be whole numbers ≥ 0 and the room must be one of ROOMS
const store = require("./_store");
const { saveBill, PERIOD } = require("./_bills");
const { push, billBubble } = require("./_line");
const { requireUser, isOwner } = require("./_auth");
const { ROOMS, configFor } = require("./_rooms");

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_UNITS = 100000;

// Returns the units as numbers, or null when the reading is not usable.
function parseUnits(value) {
  const n = Number(value ?? 0);
  return Number.isInteger(n) && n >= 0 && n <= MAX_UNITS ? n : null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });
  }
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!await isOwner(userId)) return res.status(403).json({ error: { code: "FORBIDDEN", message: "เฉพาะเจ้าของหอ" } });

  const { period, due, readings } = req.body || {};
  if (!Array.isArray(readings) || !readings.length) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องส่ง readings" } });
  }

  const billPeriod = String(period || process.env.BILL_PERIOD || "").trim();
  const billDue = String(due || process.env.BILL_DUE || "").trim();
  if (!PERIOD.test(billPeriod)) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "period ต้องเป็น YYYY-MM (เช่น 2026-11)" } });
  }
  if (billDue && !DATE.test(billDue)) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "due ต้องเป็น YYYY-MM-DD" } });
  }

  const baseUrl = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
  const out = [];

  for (const r of readings) {
    const room = String(r.room || "").trim();
    const waterUnits = parseUnits(r.water);
    const elecUnits = parseUnits(r.elec);
    if (!ROOMS.includes(room)) {
      out.push({ room, error: "ไม่มีห้องนี้ในหอ" });
      continue;
    }
    if (waterUnits === null || elecUnits === null) {
      out.push({ room, error: "หน่วยมิเตอร์ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป" });
      continue;
    }

    // A bill written before the per-period key existed lives only as `bill:<room>`. When that copy
    // is this period it is the same bill, so a paid one must still block the re-issue.
    const latest = await store.get(`bill:${room}`);
    const existing =
      (await store.get(`bill:${billPeriod}:${room}`)) ||
      (latest && latest.period === billPeriod ? latest : null);
    if (existing && existing.status !== "unpaid") {
      out.push({ room, error: `บิลรอบนี้${existing.status === "paid" ? "ชำระแล้ว" : "แจ้งชำระแล้ว"} แก้ไม่ได้` });
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
    await saveBill(bill);

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
    out.push({ room, total: bill.total, pushed, reissued: !!existing });
  }

  return res.status(200).json({ ok: true, period: billPeriod, due: billDue || null, rooms: out });
};
