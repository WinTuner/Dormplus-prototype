// GET /api/rooms — owner's view: every room, last meter reading, current bill.
const store = require("./_store");
const { requireUser, isOwner } = require("./_auth");
const { ROOMS, configFor } = require("./_rooms");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!isOwner(userId)) return res.status(403).json({ error: { code: "FORBIDDEN", message: "เฉพาะเจ้าของหอ" } });

  const rooms = await Promise.all(
    ROOMS.map(async (room) => ({
      room,
      config: await configFor(room),
      meter: await store.get(`meter:${room}`),
      bill: await store.get(`bill:${room}`),
      tenant: (await store.get(`room-user:${room}`)) || null,
    }))
  );

  return res.status(200).json({ period: process.env.BILL_PERIOD || null, rooms });
};
