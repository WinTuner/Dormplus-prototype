// GET /api/rooms — owner's view: every room, last meter reading, current bill.
// POST /api/rooms — the owner edits one room's rent and water/electric rates.
const store = require("./_store");
const { requireUser, canView, isOwner } = require("./_auth");
const { ROOMS, configFor } = require("./_rooms");
const { mapLimit } = require("./_async");

const READ_CONCURRENCY = 12;
const MAX_RENT = 100000;   // baht per month
const MAX_RATE = 10000;    // baht per unit

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

// A price is whole baht, never negative. `undefined` means "leave it alone"; null means "bad input".
function price(value, max) {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (req.method === "POST") return setPrice(req, res, userId);
  if (!(await canView(userId))) return fail(res, 403, "FORBIDDEN", "เฉพาะเจ้าของหอ");

  const rooms = await mapLimit(ROOMS, READ_CONCURRENCY, async (room) => {
    const [config, meter, bill, tenant, prepay] = await Promise.all([
      configFor(room),
      store.get(`meter:${room}`),
      store.get(`bill:${room}`),
      store.get(`room-user:${room}`),
      store.get(`prepay:${room}`),
    ]);
    // Only whether a tenant is bound: the screens never needed the tenant's LINE userId, and a
    // read-only helper should not collect them. `tenant` stays (as a boolean) for older pages.
    // A slip sent before this month's bill; the owner sees it waiting before issuing the bill.
    const advance = prepay ? { slipAt: prepay.slipAt, hasSlip: !!prepay.slipPath } : null;
    return { room, config, meter, bill, linked: !!tenant, tenant: !!tenant, advance };
  });

  return res.status(200).json({ period: process.env.BILL_PERIOD || null, rooms });
};

// A new price only reaches the bills issued after it: an existing bill keeps the total it was
// signed with, which is why correcting a printed bill means void + re-issue (POST /api/run).
async function setPrice(req, res, userId) {
  if (!(await isOwner(userId))) return fail(res, 403, "FORBIDDEN", "เฉพาะเจ้าของหอ (ผู้ช่วยดูอย่างเดียว)");

  const body = req.body || {};
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

  const current = await configFor(room);
  const config = { ...current, ...Object.fromEntries(given) };
  await store.set(`room:${room}`, config);
  return res.status(200).json({ room, config });
}
