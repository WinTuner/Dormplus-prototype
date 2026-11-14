// GET /api/rooms — owner's view: every room, last meter reading, current bill.
const store = require("./_store");
const { requireUser, canView } = require("./_auth");
const { ROOMS, configFor } = require("./_rooms");
const { mapLimit } = require("./_async");

const READ_CONCURRENCY = 12;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!(await canView(userId))) return res.status(403).json({ error: { code: "FORBIDDEN", message: "เฉพาะเจ้าของหอ" } });

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
