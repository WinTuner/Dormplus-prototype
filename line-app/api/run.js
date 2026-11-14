// POST /api/run — owner records this month's meter units and pushes the bills.
// body: { period?, due?, readings: [{ room, water, elec }] }  (units, not baht)
//
// Money rules:
// - a room whose bill for this period already has a slip (pending) or is paid is skipped, never
//   reset to unpaid; an unpaid bill may be re-issued to correct a typo
// - a slip the tenant sent before the bill existed (`prepay:<room>`) is attached to the new bill,
//   which then starts as `pending`, and the owner is pushed a confirm card right away
// - units must be whole numbers ≥ 0 and the room must be one of ROOMS
const store = require("./_store");
const { saveBill, PERIOD } = require("./_bills");
const { push, billBubble, confirmBubble } = require("./_line");
const { requireUser, isOwner } = require("./_auth");
const { ROOMS, configFor } = require("./_rooms");
const { mapLimit } = require("./_async");

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_UNITS = 100000;
const ROOM_CONCURRENCY = 6;

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

  // Each room touches only its own keys, so rooms run side by side (a few at a time). One room
  // after another took ~11 store/LINE round trips per room in a row: 12 rooms could outlast the
  // function's time limit and leave the dorm half billed.
  const seen = new Set();
  const jobs = readings.map((r) => {
    const room = String((r && r.room) || "").trim();
    const repeated = seen.has(room);
    seen.add(room);
    return { r: r || {}, room, repeated };
  });
  const out = await mapLimit(jobs, ROOM_CONCURRENCY, (job) =>
    job.repeated
      ? { room: job.room, error: "ห้องนี้ซ้ำในคำขอเดียวกัน" } // two writers on one room's keys would race
      : issueBill(job.r, job.room, billPeriod, billDue, baseUrl)
  );

  return res.status(200).json({ ok: true, period: billPeriod, due: billDue || null, rooms: out });
};

// One room: validate, refuse to touch a bill that has a slip or is paid, write, push the card.
async function issueBill(r, room, billPeriod, billDue, baseUrl) {
  const waterUnits = parseUnits(r.water);
  const elecUnits = parseUnits(r.elec);
  if (!ROOMS.includes(room)) return { room, error: "ไม่มีห้องนี้ในหอ" };
  if (waterUnits === null || elecUnits === null) {
    return { room, error: "หน่วยมิเตอร์ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป" };
  }

  const [latest, periodBill, cfg, tenant, prepay] = await Promise.all([
    store.get(`bill:${room}`),
    store.get(`bill:${billPeriod}:${room}`),
    configFor(room),
    store.get(`room-user:${room}`),
    store.get(`prepay:${room}`),
  ]);

  // A bill written before the per-period key existed lives only as `bill:<room>`. When that copy
  // is this period it is the same bill, so a paid one must still block the re-issue.
  const existing = periodBill || (latest && latest.period === billPeriod ? latest : null);
  if (existing && existing.status !== "unpaid") {
    return { room, error: `บิลรอบนี้${existing.status === "paid" ? "ชำระแล้ว" : "แจ้งชำระแล้ว"} แก้ไม่ได้` };
  }

  // An advance slip belongs to the NEXT bill: ignore it when this request back-dates an older
  // period, or when it was sent by someone who is no longer the room's tenant (a stale record the
  // tenant change failed to archive).
  const isNextBill = !latest || billPeriod >= latest.period;
  const usable = prepay && isNextBill && (!prepay.by || prepay.by === tenant) ? prepay : null;

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
    issuedAt: new Date().toISOString(), // lets a new tenant be told apart from the previous tenant's bills
    status: usable ? "pending" : "unpaid",
    ...(usable && {
      slipPath: usable.slipPath || null,
      slipNote: usable.slipNote || null,
      slipAt: usable.slipAt,
      slipCount: usable.slipCount || 1,
      prepaid: true,
    }),
  };

  await Promise.all([
    store.set(`meter:${room}`, { water: waterUnits, elec: elecUnits, at: new Date().toISOString() }),
    saveBill(bill),
  ]);
  // Clear only the record this bill consumed. A slip that arrived while the bill was being written
  // has a different slipAt and must survive for the next bill (Blob has no compare-and-set).
  if (usable) {
    const still = await store.get(`prepay:${room}`);
    if (still && still.slipAt === usable.slipAt) await store.set(`prepay:${room}`, null);
  }

  // The card goes out only after the bill is stored, so its button never opens a missing bill.
  let pushed = false;
  if (tenant) {
    try {
      await push(tenant, [billBubble(bill, baseUrl)]);
      pushed = true;
    } catch (err) {
      console.error("bill push failed", room, err.message);
    }
  }
  // The slip is already on the bill, so the owner can confirm without waiting for the tenant.
  const ownerId = process.env.OWNER_USER_ID;
  if (usable && ownerId) {
    try {
      await push(ownerId, [confirmBubble(bill)]);
    } catch (err) {
      console.error("owner push failed", room, err.message);
    }
  }
  return { room, total: bill.total, pushed, reissued: !!existing, ...(usable && { prepaid: true }) };
}
