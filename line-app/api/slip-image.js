// GET /api/slip-image?room=203 — streams the private slip photo to the owner or that room's tenant.
const { get } = require("@vercel/blob");
const store = require("./_store");
const { requireUser, isOwner } = require("./_auth");

module.exports = async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const room = String(req.query.room || "").trim();
  const bound = await store.get(`user-room:${userId}`);
  if (!isOwner(userId) && bound !== room) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "เข้าถึงสลิปห้องนี้ไม่ได้" } });
  }

  const bill = await store.get(`bill:${room}`);
  if (!bill?.slipPath) return res.status(404).json({ error: { code: "NOT_FOUND", message: "ยังไม่มีสลิป" } });

  const blob = await get(bill.slipPath, { access: "private", useCache: false });
  if (!blob) return res.status(404).json({ error: { code: "NOT_FOUND", message: "ไม่พบไฟล์สลิป" } });

  res.setHeader("Content-Type", blob.blob.contentType || "image/jpeg");
  res.setHeader("Cache-Control", "private, no-store");
  res.end(Buffer.from(await new Response(blob.stream).arrayBuffer()));
};
