// POST /api/slip — tenant attaches a slip photo (optional) and asks the owner to confirm.
const { put } = require("@vercel/blob");
const store = require("./_store");
const { push, confirmBubble } = require("./_line");
const { requireUser, isOwner } = require("./_auth");
const { verifySlip } = require("./_slipcheck");

const MAX_BYTES = 3 * 1024 * 1024;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const userId = await requireUser(req, res);
  if (!userId) return;

  const { room: asked, note, image } = req.body || {};
  const room = String(asked || (await store.get(`user-room:${userId}`)) || "").trim();
  if (!room) return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องระบุ room" } });

  const bound = await store.get(`user-room:${userId}`);
  if (!await isOwner(userId) && bound !== room) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: `บัญชีนี้ยังไม่ได้ผูกกับห้อง ${room}` } });
  }

  const bill = await store.get(`bill:${room}`);
  if (!bill) return res.status(404).json({ error: { code: "NOT_FOUND", message: "ไม่พบบิล" } });
  if (bill.status === "paid") {
    return res.status(409).json({ error: { code: "INVALID_STATE", message: "บิลนี้ชำระแล้ว" } });
  }

  let slipPath = bill.slipPath || null;
  let slipCheck = null;
  if (image) {
    const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(image);
    if (!m) return res.status(400).json({ error: { code: "VALIDATION", message: "รูปต้องเป็น JPEG/PNG/WEBP" } });
    const bytes = Buffer.from(m[3], "base64");
    if (bytes.length > MAX_BYTES) {
      return res.status(413).json({ error: { code: "TOO_LARGE", message: "รูปใหญ่เกิน 3MB" } });
    }
    const ext = m[2] === "jpeg" ? "jpg" : m[2];
    slipPath = `slips/${room}-${Date.now()}.${ext}`;
    await put(slipPath, bytes, { access: "private", contentType: m[1], allowOverwrite: true });

    // Best effort: the owner still confirms. `ok: null` means "could not check".
    const check = await verifySlip({ image: m[3], mime: m[1], amount: bill.total });
    slipCheck = {
      ok: check.ok,
      reason: check.reason || null,
      amount: check.amount ?? null,
      amountMatches: check.amount == null ? null : check.amount === Number(bill.total),
      ref: check.ref || null,
      provider: check.provider || "slipverify",
      checkedAt: check.checkedAt || new Date().toISOString(),
    };
  }

  const next = {
    ...bill,
    status: "pending",
    slipPath,
    slipNote: note || null,
    slipAt: new Date().toISOString(),
    ...(slipCheck ? { slipCheck } : {}),
  };

  // Keep the per-period copy in step so history shows the same state.
  await store.set(`bill:${room}`, next);
  await store.set(`bill:${bill.period}:${room}`, next);

  // Tell the owner, but never fail the tenant's slip because of a push error.
  const owner = process.env.OWNER_USER_ID;
  if (owner) {
    try {
      await push(owner, [confirmBubble(next)]);
    } catch (err) {
      console.error("owner push failed", err.message);
    }
  }

  return res.status(200).json({
    ok: true,
    status: next.status,
    total: next.total,
    hasSlip: !!slipPath,
    slipCheck: slipCheck ? { ok: slipCheck.ok, amountMatches: slipCheck.amountMatches, reason: slipCheck.reason } : null,
  });
};
