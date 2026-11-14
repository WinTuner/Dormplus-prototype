// GET /api/slip-image?room=203[&advance=1] — streams the private slip photo to the owner or that room's tenant.
// With advance=1 it is the slip sent before the bill existed (`prepay:<room>`).
const store = require("./_store");
const { requireUser, canView } = require("./_auth");
const { tenancyOf, visibleToTenant } = require("./_bills");

module.exports = async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const room = String(req.query.room || "").trim();
  const bound = await store.get(`user-room:${userId}`);
  const staff = await canView(userId);
  if (!staff && bound !== room) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "เข้าถึงสลิปห้องนี้ไม่ได้" } });
  }

  const bill = await store.get(req.query.advance ? `prepay:${room}` : `bill:${room}`);
  // The previous tenant's bill (and its slip) is not the new tenant's to see. An advance slip needs
  // no check: the previous tenant's one is archived when they leave.
  const hidden = !staff && !req.query.advance && !visibleToTenant(bill, await tenancyOf(room));
  if (hidden || !bill?.slipPath) return res.status(404).json({ error: { code: "NOT_FOUND", message: "ยังไม่มีสลิป" } });

  const blob = await store.getFile(bill.slipPath);
  if (!blob) return res.status(404).json({ error: { code: "NOT_FOUND", message: "ไม่พบไฟล์สลิป" } });

  const type = blob.blob.contentType || "image/jpeg";
  res.setHeader("Content-Type", ["image/jpeg", "image/png", "image/webp"].includes(type) ? type : "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.end(Buffer.from(await new Response(blob.stream).arrayBuffer()));
};
