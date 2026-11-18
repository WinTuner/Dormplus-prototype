// GET /api/slip-image?room=203[&period=YYYY-MM][&advance=1][&archived=1] — streams a private slip photo.
// period: that round's bill instead of the room's newest one.
// advance=1: the slip sent before the bill existed (`prepay:<room>`).
// archived=1: the previous tenant's advance slip, kept as `prepay-old:<room>:<ISO>` (staff only).
const store = require("./_store");
const { requireUser, canView } = require("./_auth");
const { tenancyOf, visibleToTenant } = require("./_bills");

// endTenancy keeps the archived record under two keys: `prepay-old:<room>:<slipAt>` for history and
// `prepay-old:<room>` as the latest one, which is what this reads (the ISO form cannot be rebuilt
// from a Blob listing, because pathOf turns its colons into dashes).
async function archivedSlip(room) {
  return store.get(`prepay-old:${room}`);
}

module.exports = async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const room = String(req.query.room || "").trim();
  const bound = await store.get(`user-room:${userId}`);
  const staff = await canView(userId);
  if (!staff && bound !== room) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "เข้าถึงสลิปห้องนี้ไม่ได้" } });
  }
  // An archived slip belonged to the previous tenant: the room's current tenant must not read it.
  if (req.query.archived && !staff) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "เฉพาะเจ้าของหอ" } });
  }

  // `period` picks one bill of an older round: the review screen lists every pending bill, and each
  // card has to open its own slip rather than the room's newest one.
  const period = String(req.query.period || "").trim();
  const bill = req.query.archived
    ? await archivedSlip(room)
    : period && !req.query.advance
      ? await store.get(`bill:${period}:${room}`)
      : await store.get(req.query.advance ? `prepay:${room}` : `bill:${room}`);
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
