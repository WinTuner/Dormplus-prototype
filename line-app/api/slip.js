// POST /api/slip — tenant attaches a slip photo (optional) and asks the owner to confirm.
//
// Every slip pushes a card to the owner, and a LINE OA has a monthly message quota, so a tenant
// may send at most MAX_SLIPS_PER_BILL slips for one bill and not more often than every
// MIN_GAP_MS. Without that, one bound account could burn the dorm's quota and fill the store.
//
// A tenant often transfers BEFORE the owner issues the month's bill. With no bill yet (or the
// latest one already paid) the slip is kept as `prepay:<room>` and /api/run attaches it to the
// next bill, so an early transfer is never lost or turned away.
const store = require("./_store");
const { saveBill, tenancyOf, visibleToTenant } = require("./_bills");
const { push, confirmBubble } = require("./_line");
const { requireUser, isOwner } = require("./_auth");

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_NOTE_LENGTH = 500;
const MAX_SLIPS_PER_BILL = 5;
const MIN_GAP_MS = 30 * 1000;

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "METHOD_NOT_ALLOWED", "POST only");
  const userId = await requireUser(req, res);
  if (!userId) return;

  const { room: asked, note, image } = req.body || {};
  if (note != null && (typeof note !== "string" || note.length > MAX_NOTE_LENGTH)) {
    return fail(res, 400, "VALIDATION", `หมายเหตุยาวได้ไม่เกิน ${MAX_NOTE_LENGTH} ตัวอักษร`);
  }

  const [bound, owner] = await Promise.all([store.get(`user-room:${userId}`), isOwner(userId)]);
  const room = String(asked || bound || "").trim();
  if (!room) return fail(res, 400, "VALIDATION", "ต้องระบุ room");
  if (!owner && bound !== room) return fail(res, 403, "FORBIDDEN", `บัญชีนี้ยังไม่ได้ผูกกับห้อง ${room}`);

  let bill = await store.get(`bill:${room}`);
  // The previous tenant's unpaid bill is not open for this tenant: it must not get their slip.
  if (bill && !owner && !visibleToTenant(bill, await tenancyOf(room))) bill = null;
  // Nothing open to pay: this slip is for the bill that has not been issued yet.
  const advance = !bill || bill.status === "paid";
  const prev = advance ? await store.get(`prepay:${room}`) : bill;

  const sent = prev?.slipCount || 0;
  if (!owner) {
    if (sent >= MAX_SLIPS_PER_BILL) {
      return fail(res, 429, "SLIP_LIMIT", `ส่งสลิปของบิลนี้ครบ ${MAX_SLIPS_PER_BILL} ครั้งแล้ว — ติดต่อเจ้าของหอ`);
    }
    if (prev?.slipAt && Date.now() - new Date(prev.slipAt).getTime() < MIN_GAP_MS) {
      return fail(res, 429, "SLIP_TOO_SOON", "เพิ่งส่งสลิปไปเมื่อสักครู่ — รอ 30 วินาทีแล้วลองใหม่");
    }
  }

  const oldSlip = prev?.slipPath || null;
  let slipPath = oldSlip;
  if (image) {
    const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(image);
    if (!m) return fail(res, 400, "VALIDATION", "รูปต้องเป็น JPEG/PNG/WEBP");
    const bytes = Buffer.from(m[3], "base64");
    if (bytes.length > MAX_BYTES) return fail(res, 413, "TOO_LARGE", "รูปใหญ่เกิน 3MB");
    const ext = m[2] === "jpeg" ? "jpg" : m[2];
    slipPath = `slips/${room}-${advance ? "advance-" : ""}${Date.now()}.${ext}`;
    await store.putFile(slipPath, bytes, m[1]);
  }

  if (advance) return saveAdvance({ res, room, userId, note, slipPath, sent });

  const next = {
    ...bill,
    status: "pending",
    slipPath,
    slipNote: note || null,
    slipAt: new Date().toISOString(),
    slipCount: sent + 1,
  };
  await saveBill(next); // both the newest copy and the per-period copy, so history agrees

  // The photo this one replaces is no longer reachable from any bill: do not keep it around.
  if (oldSlip && oldSlip !== slipPath) {
    await store.delFile(oldSlip).catch((err) => console.error("old slip delete failed", err.message));
  }

  // Tell the owner, but never fail the tenant's slip because of a push error.
  const ownerId = process.env.OWNER_USER_ID;
  if (ownerId) {
    try {
      await push(ownerId, [confirmBubble(next)]);
    } catch (err) {
      console.error("owner push failed", err.message);
    }
  }

  return res.status(200).json({ ok: true, status: next.status, total: next.total, hasSlip: !!slipPath });
};

// The advance path: one `prepay:<room>` record per room, replaced by each new slip.
async function saveAdvance({ res, room, userId, note, slipPath, sent }) {
  const prepay = { room, slipPath, slipNote: note || null, slipAt: new Date().toISOString(), slipCount: sent + 1, by: userId };
  await store.set(`prepay:${room}`, prepay);

  // A replaced photo is deliberately NOT deleted: /api/run may have just copied that path onto a
  // bill (the slip arrived while the bill was being written) and Blob cannot tell us whether a file
  // is still referenced. An orphaned private file is cheaper than a bill whose slip 404s.

  // No bill exists to hang a confirm card on, so the owner gets a plain note instead.
  const ownerId = process.env.OWNER_USER_ID;
  if (ownerId) {
    const text = `ห้อง ${room} แจ้งโอนก่อนบิลออก${note ? ` — ${note}` : ""} · ระบบจะผูกสลิปนี้กับบิลรอบถัดไปให้เอง`;
    try {
      await push(ownerId, [{ type: "text", text }]);
    } catch (err) {
      console.error("owner push failed", err.message);
    }
  }

  return res.status(200).json({ ok: true, status: "advance", hasSlip: !!slipPath });
}
