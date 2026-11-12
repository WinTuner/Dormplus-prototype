// POST /api/owner-accept — the person who scanned the owner QR redeems the code and becomes an owner.
const store = require("./_store");
const { requireUser, isOwner } = require("./_auth");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const userId = await requireUser(req, res);
  if (!userId) return;

  // Without a hand-set first owner there is nobody who could have minted a legitimate code.
  if (!process.env.OWNER_USER_ID) {
    return res.status(409).json({ error: { code: "INVALID_STATE", message: "ยังไม่ได้ตั้ง OWNER_USER_ID ของหอ" } });
  }

  const code = String((req.body && req.body.code) || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องระบุ code" } });

  const key = `owner-invite:${code}`;
  const invite = await store.get(key);
  if (!invite) return res.status(404).json({ error: { code: "NOT_FOUND", message: "รหัสไม่ถูกต้อง" } });
  if (invite.usedAt || new Date(invite.expiresAt).getTime() < Date.now()) {
    return res.status(410).json({ error: { code: "INVITE_EXPIRED", message: "รหัสหมดอายุหรือถูกใช้แล้ว — ขอใหม่จากเจ้าของหอ" } });
  }
  if (await isOwner(userId)) {
    // Already an owner: burn nothing, just say so.
    return res.status(200).json({ owner: true, already: true });
  }

  await store.set(`owner:${userId}`, { addedAt: new Date().toISOString(), addedBy: invite.createdBy });
  await store.set(key, { ...invite, usedAt: new Date().toISOString(), usedBy: userId });

  return res.status(200).json({ owner: true });
};
