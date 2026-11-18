// GET /api/rooms — owner's view: every room, last meter reading, current bill.
// POST /api/rooms — the owner edits one room's rent and water/electric rates.
const store = require("./_store");
const { requireUser, canView, isOwner } = require("./_auth");
const { ROOMS, configFor, dormOf, baseDefaults } = require("./_rooms");
const { normalizeId } = require("./_promptpay");
const { mapLimit } = require("./_async");

const READ_CONCURRENCY = 12; // 12 rooms → one wave (72 reads in flight); a 42-room dorm takes 4 waves
const MAX_RENT = 100000;   // baht per month
const MAX_RATE = 10000;    // baht per unit
const MAX_NAME = 60;       // dorm name

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

// A price is whole baht, never negative. `undefined` means "leave it alone"; null means "bad input",
// but it has to be caught here: Number(null) is 0, which would quietly make a room free.
function price(value, max) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (req.method === "POST") return saveSettings(req, res, userId);
  if (!(await canView(userId))) return fail(res, 403, "FORBIDDEN", "เฉพาะเจ้าของหอ");

  // The settings screen asks for these two; reading the dorm once keeps the room loop at 6 reads.
  const dorm = await dormOf();
  const base = await baseDefaults(dorm);
  if (req.query.settings) return res.status(200).json({ dorm, defaults: base, rooms: ROOMS.length });

  const rooms = await mapLimit(ROOMS, READ_CONCURRENCY, async (room) => {
    const [config, meter, bill, tenant, prepay, members] = await Promise.all([
      configFor(room, base),
      store.get(`meter:${room}`),
      store.get(`bill:${room}`),
      store.get(`room-user:${room}`),
      store.get(`prepay:${room}`),
      store.get(`room-users:${room}`),
    ]);
    // Only whether a tenant is bound: the screens never needed the tenant's LINE userId, and a
    // read-only helper should not collect them. `tenant` stays (as a boolean) for older pages.
    // A slip sent before this month's bill; the owner sees it waiting before issuing the bill.
    const advance = prepay
      ? { slipAt: prepay.slipAt, hasSlip: !!prepay.slipPath, verify: prepay.slipVerify || null }
      : null;
    // Who lives here: the primary's name plus every account in the room (names come from the bind).
    const list = members || [];
    const idOf = (m) => (typeof m === "string" ? m : m && m.id);
    const primary = list.find((m) => idOf(m) === tenant);
    return {
      room, config, meter, bill, linked: !!tenant, tenant: !!tenant, members: list.length,
      tenantName: (primary && primary.name) || null,
      memberNames: list.map((m) => m && m.name).filter(Boolean),
      advance,
    };
  });

  // `dueDay` rides along so the owner screen can prefill the round's due date from the dorm setting
  // instead of its own hardcoded day (the setting was only ever read by run.js when the body left `due` out).
  return res.status(200).json({
    period: process.env.BILL_PERIOD || null,
    dorm: (dorm && dorm.name) || null,
    dueDay: (dorm && dorm.dueDay) || null,
    rooms,
  });
};

// A new price only reaches the bills issued after it: an existing bill keeps the total it was
// signed with, which is why correcting a printed bill means void + re-issue (POST /api/run).
//
// Two shapes: `{ dorm: {...} }` sets the dorm (name, defaults, due day), `{ room, rent?, ... }` sets
// one room. Both are owner-only; a helper reads the settings but cannot change them.
async function saveSettings(req, res, userId) {
  if (!(await isOwner(userId))) return fail(res, 403, "FORBIDDEN", "เฉพาะเจ้าของหอ (ผู้ช่วยดูอย่างเดียว)");
  const body = req.body || {};
  if (body.dorm) return saveDorm(res, body.dorm);

  const room = String(body.room || "").trim();
  if (!ROOMS.includes(room)) return fail(res, 404, "NOT_FOUND", `ไม่พบห้อง ${room || "(ไม่ได้ระบุ)"}`);

  const fields = {
    rent: price(body.rent, MAX_RENT),
    waterRate: price(body.waterRate, MAX_RATE),
    elecRate: price(body.elecRate, MAX_RATE),
  };
  if (Object.values(fields).some((value) => value === null)) {
    return fail(res, 400, "VALIDATION", "ค่าเช่า/ค่าน้ำ/ค่าไฟ ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
  }
  const given = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (!given.length) return fail(res, 400, "VALIDATION", "ต้องระบุ rent, waterRate หรือ elecRate อย่างน้อยหนึ่งค่า");

  // Only this room's own overrides are stored: writing the resolved numbers would freeze every
  // field at today's dorm defaults, so a later dorm change (water 25 → 22) would never reach it.
  // The merge happens inside the write so two devices editing different fields do not lose one.
  const overrides = Object.fromEntries(given);
  await store.update(`room:${room}`, (current) => ({ ...(current || {}), ...overrides }));
  return res.status(200).json({ room, config: await configFor(room) });
}

// The dorm's own settings. A field that is left out keeps its old value; null clears it.
async function saveDorm(res, input) {
  if (!input || typeof input !== "object") return fail(res, 400, "VALIDATION", "dorm ต้องเป็น object");

  const fields = {};
  if (input.name !== undefined) {
    const name = String(input.name || "").trim();
    if (name.length > MAX_NAME) return fail(res, 400, "VALIDATION", `ชื่อหอยาวได้ไม่เกิน ${MAX_NAME} ตัวอักษร`);
    fields.name = name || null;
  }
  if (input.dueDay !== undefined) {
    if (input.dueDay === null) fields.dueDay = null;
    else if (Number.isInteger(input.dueDay) && input.dueDay >= 1 && input.dueDay <= 28) fields.dueDay = input.dueDay;
    else return fail(res, 400, "VALIDATION", "วันครบกำหนดต้องเป็น 1–28");
  }
  for (const [key, max] of [["rent", MAX_RENT], ["waterRate", MAX_RATE], ["elecRate", MAX_RATE]]) {
    if (input[key] === undefined) continue;
    if (input[key] === null) { fields[key] = null; continue; }
    const value = price(input[key], max);
    if (value === null) return fail(res, 400, "VALIDATION", "ค่าเช่า/ค่าน้ำ/ค่าไฟ ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
    fields[key] = value;
  }
  if (input.promptpay !== undefined) {
    if (input.promptpay === null || String(input.promptpay).trim() === "") fields.promptpay = null;
    else {
      const id = normalizeId(input.promptpay);
      if (!id) return fail(res, 400, "VALIDATION", "พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก, เลขบัตรประชาชน 13 หลัก หรือ e-Wallet 15 หลัก");
      fields.promptpay = String(input.promptpay).replace(/\D/g, "");
    }
  }
  if (input.autoConfirm !== undefined) {
    // Only a real boolean: "false" or 0 turning the switch on by accident would close bills unseen.
    if (typeof input.autoConfirm !== "boolean") return fail(res, 400, "VALIDATION", "autoConfirm ต้องเป็น true หรือ false");
    fields.autoConfirm = input.autoConfirm;
  }
  if (!Object.keys(fields).length) return fail(res, 400, "VALIDATION", "ต้องระบุ name, rent, waterRate, elecRate, dueDay, promptpay หรือ autoConfirm");

  // Merged inside the write: two devices changing different fields (name on one, promptpay on the
  // other) must not lose one of them.
  let next = {};
  await store.update("dorm", (current) => {
    const merged = { ...(current || {}), ...fields };
    // null means "forget this value" so the env default applies again.
    for (const key of Object.keys(merged)) if (merged[key] === null) delete merged[key];
    next = merged;
    return Object.keys(merged).length ? merged : null;
  });
  return res.status(200).json({ dorm: next, defaults: await baseDefaults(next) });
}
