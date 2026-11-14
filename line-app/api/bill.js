// GET /api/bill?room=203[&period=2026-10][&history=1]
// A tenant sees only their own room; the owner sees all. Without `period` the newest bill is used,
// with `history=1` the caller gets the list of periods that still have a stored bill.
const store = require("./_store");
const { requireUser, canView } = require("./_auth");
const { mapLimit } = require("./_async");
const { tenancyOf, visibleToTenant } = require("./_bills");

const PERIOD = /^\d{4}-\d{2}$/;
const HISTORY_READ_CONCURRENCY = 6;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store"); // bill status changes after a slip is attached
  const userId = await requireUser(req, res);
  if (!userId) return;

  const [bound, staff] = await Promise.all([store.get(`user-room:${userId}`), canView(userId)]);
  const room = String(req.query.room || bound || "").trim();
  if (!room) return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องระบุ room หรือผูกห้องก่อน" } });

  if (!staff && bound !== room) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: `บัญชีนี้ยังไม่ได้ผูกกับห้อง ${room}` } });
  }

  // A tenant sees only bills issued during their own tenancy; the owner and viewers see all.
  const tenancy = staff ? null : await tenancyOf(room);
  const visible = (b) => staff || visibleToTenant(b, tenancy);

  if (req.query.history) return history(res, room, visible);

  const period = String(req.query.period || "").trim();
  if (period && !PERIOD.test(period)) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "period ต้องเป็น YYYY-MM" } });
  }

  if (period) {
    const bill = await store.get(`bill:${period}:${room}`);
    if (!bill || !visible(bill)) return res.status(404).json({ error: { code: "NOT_FOUND", message: `ไม่พบบิลของห้อง ${room}` } });
    return res.status(200).json({ ...bill, hasSlip: !!bill.slipPath });
  }

  // The latest bill also reports a slip sent before it existed, so the tenant sees "รอบิลออก".
  const [latest, prepay] = await Promise.all([store.get(`bill:${room}`), store.get(`prepay:${room}`)]);
  const bill = visible(latest) ? latest : null; // the previous tenant's bill answers like "no bill"
  const advance = prepay ? { slipAt: prepay.slipAt, hasSlip: !!prepay.slipPath, note: prepay.slipNote || null } : null;
  if (!bill) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: `ไม่พบบิลของห้อง ${room}`, advance } });
  }

  return res.status(200).json({ ...bill, hasSlip: !!bill.slipPath, advance });
};

// Bills written before this change only have `bill:<room>` (the latest). Include it so history is
// never empty on an old deployment.
async function history(res, room, visible) {
  const [latest, rawIndex] = await Promise.all([
    store.get(`bill:${room}`),
    store.get(`bills:${room}`),
  ]);
  // `bills:<room>` is the index of periods written since history existed.
  const index = rawIndex || [];
  const periods = new Set(index);
  if (latest?.period) periods.add(latest.period);

  const sortedPeriods = [...periods].sort().reverse();
  const records = await mapLimit(sortedPeriods, HISTORY_READ_CONCURRENCY, async (p) => {
    const bill = await store.get(`bill:${p}:${room}`) || (latest?.period === p ? latest : null);
    if (!bill || !visible(bill)) return null;
    return {
      period: p,
      total: bill.total,
      status: bill.status,
      due: bill.due || null,
      hasSlip: !!bill.slipPath,
    };
  });
  const items = records.filter(Boolean);
  return res.status(200).json({ room, items });
}
