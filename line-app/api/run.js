// POST /api/run — owner records this month's meter units and pushes the bills.
// body: { period?, due?, readings: [{ room, water, elec }] }  (units, not baht)
//
// Money rules:
// - a room whose bill for this period already has a slip (pending) or is paid is skipped, never
//   reset to unpaid; an unpaid bill may be re-issued to correct a typo
// - a paid bill is never edited: the only way to change it is to void it (POST /api/bill) and
//   re-issue here. A void bill is re-issued like an unpaid one but with `rev + 1`, so the new
//   receipt gets a number of its own (R202611-203-2) and the old one stays on record
// - a slip the tenant sent before the bill existed (`prepay:<room>`) is attached to the new bill,
//   which then starts as `pending`, and the owner is pushed a confirm card right away
// - re-issuing over a void bill first archives it (`bill-void:<period>:<room>:<rev>`, listed in
//   `bill-voids:<room>`), so the cancelled bill and its reason stay readable
// - units must be whole numbers ≥ 0 and the room must be one of ROOMS; a missing water or elec
//   reading is refused (an explicit 0 is fine), never billed as 0 units
const store = require("./_store");
const { saveBill, archiveVoid, prepaidCopy, PERIOD } = require("./_bills");
const { push, billBubble } = require("./_line");
const { usable: canUse, clearPrepay, notifyOwner, attachPrepay } = require("./_prepay");
const { requireUser, isOwner } = require("./_auth");
const { ROOMS, configFor, baseDefaults } = require("./_rooms");
const { mapLimit } = require("./_async");

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_UNITS = 100000;
const ROOM_CONCURRENCY = 6;

// A reading that was left out (or blank) is not "0 units": billing it as 0 would hide a forgotten meter.
const isMissing = (value) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");

// Returns the units as numbers, or null when the reading is not usable.
function parseUnits(value) {
  if (typeof value !== "number" && typeof value !== "string") return null; // true, [5], {} are not readings
  const n = Number(value);
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
  if (!PERIOD.test(billPeriod)) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "period ต้องเป็น YYYY-MM (เช่น 2026-11)" } });
  }
  // Due date: what the request says, else the env, else the dorm's due day (5 → the 5th of the
  // billed month). One read of the settings also gives every room its rent without 12 extra reads.
  const dorm = await store.get("dorm");
  const base = await baseDefaults(dorm);
  const dueDay = dorm && Number.isInteger(dorm.dueDay) ? dorm.dueDay : 0;
  const billDue = String(
    due || process.env.BILL_DUE || (dueDay ? `${billPeriod}-${String(dueDay).padStart(2, "0")}` : "")
  ).trim();
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
      : issueBill(job.r, job.room, billPeriod, billDue, baseUrl, base)
  );

  return res.status(200).json({ ok: true, period: billPeriod, due: billDue || null, rooms: out });
};

// One room: validate, refuse to touch a bill that has a slip or is paid, write, push the card.
async function issueBill(r, room, billPeriod, billDue, baseUrl, base) {
  if (!ROOMS.includes(room)) return { room, error: "ไม่มีห้องนี้ในหอ" };
  if (isMissing(r.water) || isMissing(r.elec)) return { room, error: "ต้องกรอกหน่วยน้ำและไฟ" };
  const waterUnits = parseUnits(r.water);
  const elecUnits = parseUnits(r.elec);
  if (waterUnits === null || elecUnits === null) {
    return { room, error: "หน่วยมิเตอร์ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป" };
  }

  const [latest, periodBill, cfg, tenant, prepay] = await Promise.all([
    store.get(`bill:${room}`),
    store.get(`bill:${billPeriod}:${room}`),
    configFor(room, base),
    store.get(`room-user:${room}`),
    store.get(`prepay:${room}`),
  ]);

  // A bill written before the per-period key existed lives only as `bill:<room>`. When that copy
  // is this period it is the same bill, so a paid one must still block the re-issue.
  const existing = periodBill || (latest && latest.period === billPeriod ? latest : null);
  if (existing && existing.status !== "unpaid" && existing.status !== "void") {
    return { room, error: `บิลรอบนี้${existing.status === "paid" ? "ชำระแล้ว" : "แจ้งชำระแล้ว"} แก้ไม่ได้` };
  }

  // An advance slip belongs to the NEXT bill: ignore it when this request back-dates an older
  // period, or when it was sent by someone who is no longer the room's tenant (a stale record the
  // tenant change failed to archive). A slip the owner recorded is about the room: always usable.
  const isNextBill = !latest || billPeriod >= latest.period;
  const usable = isNextBill && canUse(prepay, tenant) ? prepay : null;

  // The cancelled bill goes to the archive before anything overwrites its key.
  if (existing && existing.status === "void") await archiveVoid(existing);

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
    // An unpaid re-issue is the same bill (same rev); only a void one starts a new revision.
    rev: existing ? (existing.status === "void" ? (existing.rev || 1) + 1 : existing.rev || 1) : 1,
    issuedAt: new Date().toISOString(), // lets a new tenant be told apart from the previous tenant's bills
    status: "unpaid",
  };
  const first = usable ? prepaidCopy(bill, usable) : bill;

  await Promise.all([
    store.set(`meter:${room}`, { water: waterUnits, elec: elecUnits, at: new Date().toISOString() }),
    saveBill(first, { latest }), // `latest` was read above: no second read inside
  ]);

  // A slip may have landed between the first read and this write (the tenant paid in that
  // instant): look once more. /api/slip does the mirror-image check after it writes `prepay:`, so
  // whichever side is later sees the other and the slip is never left waiting for next month.
  let final = first;
  let used = usable;
  if (!usable) {
    const late = await store.get(`prepay:${room}`);
    if (isNextBill && canUse(late, tenant)) {
      const cur = await store.get(`bill:${billPeriod}:${room}`);
      if (cur && cur.status === "unpaid" && cur.issuedAt === bill.issuedAt) {
        // The same attach /api/slip does (copy, save, clear); the card goes out with the bill push below.
        final = await attachPrepay({ bill: cur, prepay: late, latest, notify: false });
        used = late;
      }
    }
  } else {
    await clearPrepay(room, usable); // the first attach was saved with the bill above
  }

  // The card goes out only after the bill is stored, so its button never opens a missing bill.
  // The slip is already on the bill, so the owner can confirm without waiting for the tenant: the
  // two pushes go to different people and run together.
  let pushed = false;
  await Promise.all([
    tenant
      ? push(tenant, [billBubble(bill, baseUrl)]).then(
          () => { pushed = true; },
          (err) => console.error("bill push failed", room, err.message)
        )
      : null,
    used ? notifyOwner(final) : null,
  ]);
  return { room, total: bill.total, pushed, reissued: !!existing, ...(used && { prepaid: true }) };
}
