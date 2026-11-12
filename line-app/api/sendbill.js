// POST /api/sendbill — push a bill card to one LINE user (testing/owner tool).
const { push, billBubble } = require("./_line");
const store = require("./_store");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.SEED_TOKEN || req.query.token !== process.env.SEED_TOKEN) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "ต้องมี token" } });
  }

  const { to, room } = req.body || {};
  if (!to || !room) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องระบุ to และ room" } });
  }

  const bill = await store.get(`bill:${room}`);
  if (!bill) return res.status(404).json({ error: { code: "NOT_FOUND", message: `ไม่พบบิลห้อง ${room}` } });

  const baseUrl = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
  await push(to, [billBubble(bill, baseUrl)]);

  return res.status(200).json({ ok: true, sent: room, total: bill.total });
};
