// POST /api/tenant-bind — a tenant scanned the room's printed QR and is binding to that room.
// body: { code }
const store = require("./_store");
const { requireUser } = require("./_auth");
const { linkRichMenu } = require("./_line");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const userId = await requireUser(req, res);
  if (!userId) return;

  const code = String((req.body && req.body.code) || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องระบุ code" } });

  const room = await store.get(`qr-code:${code}`);
  if (!room) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "QR นี้ใช้ไม่ได้แล้ว — ขอใหม่จากเจ้าของหอ" } });
  }

  const previous = await store.get(`user-room:${userId}`);

  await store.set(`user-room:${userId}`, room);
  await store.set(`room-user:${room}`, userId);

  if (process.env.RICHMENU_TENANT_ID) {
    await linkRichMenu(userId, process.env.RICHMENU_TENANT_ID).catch((err) =>
      console.error("richmenu link failed", err.message)
    );
  }

  return res.status(200).json({ ok: true, room, previous: previous || null });
};
