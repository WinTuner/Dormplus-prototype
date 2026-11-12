// GET /api/bill?room=203 — a tenant sees only their own room; the owner sees all.
const store = require("./_store");
const { requireUser, isOwner } = require("./_auth");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store"); // bill status changes after a slip is attached
  const userId = await requireUser(req, res);
  if (!userId) return;

  const room = String(req.query.room || (await store.get(`user-room:${userId}`)) || "").trim();
  if (!room) return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องระบุ room หรือผูกห้องก่อน" } });

  const bound = await store.get(`user-room:${userId}`);
  if (!await isOwner(userId) && bound !== room) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: `บัญชีนี้ยังไม่ได้ผูกกับห้อง ${room}` } });
  }

  const bill = await store.get(`bill:${room}`);
  if (!bill) return res.status(404).json({ error: { code: "NOT_FOUND", message: `ไม่พบบิลของห้อง ${room}` } });

  return res.status(200).json({ ...bill, hasSlip: !!bill.slipPath });
};
