// POST /api/slip — tenant attaches a slip photo (optional) and asks the owner to confirm.
//
// Every slip pushes a card to the owner, and a LINE OA has a monthly message quota, so a tenant
// may send at most MAX_SLIPS_PER_BILL slips for one bill and not more often than every
// MIN_GAP_MS. Without that, one bound account could burn the dorm's quota and fill the store.
//
// A tenant often transfers BEFORE the owner issues the month's bill. With no bill yet (or the
// latest one already paid) the slip is kept as `prepay:<room>` and /api/run attaches it to the
// next bill, so an early transfer is never lost or turned away. A void latest bill is "nothing open"
// too: it can no longer be paid, so the slip waits for the re-issued one.
//
// One transfer may cover several months: `periods: ["2026-10", "2026-11"]` puts the same slip on
// each of those bills (all become `pending`, each with `slipGroup`) and sends the owner ONE card.
const store = require("./_store");
const { saveBills, tenancyOf, visibleToTenant, PERIOD } = require("./_bills");
const { ROOMS } = require("./_rooms");
const { mapLimit } = require("./_async");
const { push, confirmBubble } = require("./_line");
const { requireUser, isOwner } = require("./_auth");
const { verifySlip } = require("./_verify");

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_NOTE_LENGTH = 500;
const MAX_SLIPS_PER_BILL = 5;
const MIN_GAP_MS = 30 * 1000;
const MAX_PERIODS = 12;

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "METHOD_NOT_ALLOWED", "POST only");
  const userId = await requireUser(req, res);
  if (!userId) return;

  const { room: asked, note, image, periods } = req.body || {};
  if (note != null && (typeof note !== "string" || note.length > MAX_NOTE_LENGTH)) {
    return fail(res, 400, "VALIDATION", `หมายเหตุยาวได้ไม่เกิน ${MAX_NOTE_LENGTH} ตัวอักษร`);
  }

  const [bound, owner] = await Promise.all([store.get(`user-room:${userId}`), isOwner(userId)]);
  const room = String(asked || bound || "").trim();
  if (!room) return fail(res, 400, "VALIDATION", "ต้องระบุ room");
  if (!owner && bound !== room) return fail(res, 403, "FORBIDDEN", `บัญชีนี้ยังไม่ได้ผูกกับห้อง ${room}`);
  // An owner may name any room, so it must be a real one: otherwise `prepay:<anything>` piles up.
  if (owner && !ROOMS.includes(room)) return fail(res, 404, "NOT_FOUND", `ไม่พบห้อง ${room}`);

  if (periods != null) {
    const ok = Array.isArray(periods) && periods.length >= 1 && periods.length <= MAX_PERIODS &&
      periods.every((p) => typeof p === "string" && PERIOD.test(p)) && new Set(periods).size === periods.length;
    if (!ok) return fail(res, 400, "VALIDATION", `periods ต้องเป็นรายการ YYYY-MM ไม่ซ้ำกัน 1-${MAX_PERIODS} รอบ`);
    return saveGroup({ res, room, owner, userId, note, image, periods: [...periods].sort() });
  }

  // The tenancy record is read together with the bill, not after it.
  const [latest, tenancy] = await Promise.all([store.get(`bill:${room}`), owner ? null : tenancyOf(room)]);
  let bill = latest;
  // The previous tenant's unpaid bill is not open for this tenant: it must not get their slip.
  if (bill && !owner && !visibleToTenant(bill, tenancy)) bill = null;
  // Nothing open to pay: this slip is for the bill that has not been issued yet.
  const advance = !bill || bill.status === "paid" || bill.status === "void";
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
  let shot = null;
  if (image) {
    const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(image);
    if (!m) return fail(res, 400, "VALIDATION", "รูปต้องเป็น JPEG/PNG/WEBP");
    const bytes = Buffer.from(m[3], "base64");
    if (bytes.length > MAX_BYTES) return fail(res, 413, "TOO_LARGE", "รูปใหญ่เกิน 3MB");
    const ext = m[2] === "jpeg" ? "jpg" : m[2];
    slipPath = `slips/${room}-${advance ? "advance-" : ""}${Date.now()}.${ext}`;
    await store.putFile(slipPath, bytes, m[1]);
    shot = { bytes, mime: m[1] };
  }

  // A new photo is checked; a note-only update keeps whatever the last photo was checked as.
  const verify = shot
    ? await rememberRef(await verifySlip({ bytes: shot.bytes, mime: shot.mime, amount: bill?.total ?? prev?.total }), room)
    : prev?.slipVerify || null;

  if (advance) return saveAdvance({ res, room, userId, note, slipPath, sent, verify });

  const next = {
    ...bill,
    status: "pending",
    slipPath,
    slipNote: note || null,
    slipAt: new Date().toISOString(),
    slipCount: sent + 1,
    slipVerify: verify,
  };
  delete next.slipGroup; // a slip of its own: this bill no longer belongs to a multi-period slip
  await saveBills([next], { latest }); // both the newest copy and the per-period copy, so history agrees

  // The photo this one replaces is no longer reachable from this bill: do not keep it around,
  // unless another period's bill still shows it (it was one slip for several months). The clean-up
  // and the owner's card do not depend on each other, so they run together.
  // Tell the owner, but never fail the tenant's slip because of a push error.
  const ownerId = process.env.OWNER_USER_ID;
  await Promise.all([
    dropIfUnused(room, oldSlip, slipPath, [bill]),
    ownerId ? push(ownerId, [confirmBubble(next)]).catch((err) => console.error("owner push failed", err.message)) : null,
  ]);

  return res.status(200).json({ ok: true, status: next.status, total: next.total, hasSlip: !!slipPath, verify });
};

// One transaction can only pay for one thing: the first bill to claim a `transRef` keeps it.
// SlipOK detects a reused slip too, but only within what its branch remembers — this key is ours.
async function rememberRef(verify, room) {
  if (!verify || verify.ok !== true || !verify.transRef) return verify;
  const key = `slip-ref:${verify.transRef}`;
  const seen = await store.get(key);
  if (seen) {
    return { ...verify, ok: false, reason: `สลิปนี้ถูกใช้ไปแล้ว (ห้อง ${seen.room || "?"})` };
  }
  await store.set(key, { room, at: new Date().toISOString() });
  return verify;
}

// The advance path: one `prepay:<room>` record per room, replaced by each new slip.
async function saveAdvance({ res, room, userId, note, slipPath, sent, verify }) {
  const prepay = {
    room, slipPath, slipNote: note || null, slipAt: new Date().toISOString(), slipCount: sent + 1, by: userId,
    slipVerify: verify || null,
  };
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

  return res.status(200).json({ ok: true, status: "advance", hasSlip: !!slipPath, verify: verify || null });
}

// Delete a replaced photo only when no bill of the room still points to it. `holders` are the
// bills that carried it before this change. A photo is shared only through a multi-period slip
// (`slipGroup` names every bill that has it) or an advance slip copied onto a bill (`prepaid`), so:
// - plain bills: nothing else can point to it, no store read at all
// - a group: only the other periods of that group are read
// - `prepaid`: scan the whole index like before (rare)
// This used to read the index plus every bill of the room (up to 60) on each replaced photo.
// It only cleans up, so any failure is logged: the slip itself is already saved.
async function dropIfUnused(room, oldSlip, keep, holders) {
  if (!oldSlip || oldSlip === keep) return;
  try {
    const own = new Set(holders.map((b) => b.period));
    let periods = new Set();
    let scanAll = false;
    for (const b of holders) {
      for (const p of b.slipGroup?.periods || []) periods.add(p);
      if (b.prepaid) scanAll = true;
    }
    let others = [];
    if (scanAll) {
      const [index, latest] = await Promise.all([store.get(`bills:${room}`), store.get(`bill:${room}`)]);
      periods = new Set(index || []);
      others = [latest];
    }
    periods = [...periods].filter((p) => !own.has(p));
    others.push(...(await mapLimit(periods, 6, (p) => store.get(`bill:${p}:${room}`))));
    if (others.some((b) => b && b.slipPath === oldSlip)) return;
    await store.delFile(oldSlip);
  } catch (err) {
    console.error("old slip delete failed", err.message);
  }
}

// One slip for several periods. Every bill must exist, be open (unpaid or pending) and, for a
// tenant, belong to their tenancy; the limits are counted on the newest of them.
async function saveGroup({ res, room, owner, userId, note, image, periods }) {
  const [found, tenancy, latest] = await Promise.all([
    Promise.all(periods.map((p) => store.get(`bill:${p}:${room}`))),
    owner ? null : tenancyOf(room),
    store.get(`bill:${room}`), // handed to saveBills so it does not read it again
  ]);
  for (let i = 0; i < periods.length; i++) {
    const b = found[i];
    if (!b || (!owner && !visibleToTenant(b, tenancy)) || (b.status !== "unpaid" && b.status !== "pending")) {
      return fail(res, 409, "INVALID_STATE", `บิลรอบ ${periods[i]} จ่ายรวมไม่ได้ (ไม่มีบิล ชำระแล้ว หรือถูกยกเลิก)`);
    }
  }

  const newest = found[found.length - 1]; // periods are sorted
  if (!owner) {
    if ((newest.slipCount || 0) >= MAX_SLIPS_PER_BILL) {
      return fail(res, 429, "SLIP_LIMIT", `ส่งสลิปของบิลนี้ครบ ${MAX_SLIPS_PER_BILL} ครั้งแล้ว — ติดต่อเจ้าของหอ`);
    }
    if (newest.slipAt && Date.now() - new Date(newest.slipAt).getTime() < MIN_GAP_MS) {
      return fail(res, 429, "SLIP_TOO_SOON", "เพิ่งส่งสลิปไปเมื่อสักครู่ — รอ 30 วินาทีแล้วลองใหม่");
    }
  }

  // Without a new photo the group keeps one the bills already had (newest first).
  const oldSlips = [...new Set(found.map((b) => b.slipPath).filter(Boolean))];
  let slipPath = [...found].reverse().find((b) => b.slipPath)?.slipPath || null;
  let shot = null;
  if (image) {
    const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(image);
    if (!m) return fail(res, 400, "VALIDATION", "รูปต้องเป็น JPEG/PNG/WEBP");
    const bytes = Buffer.from(m[3], "base64");
    if (bytes.length > MAX_BYTES) return fail(res, 413, "TOO_LARGE", "รูปใหญ่เกิน 3MB");
    const ext = m[2] === "jpeg" ? "jpg" : m[2];
    slipPath = `slips/${room}-${Date.now()}.${ext}`;
    await store.putFile(slipPath, bytes, m[1]);
    shot = { bytes, mime: m[1] };
  }

  const total = found.reduce((sum, b) => sum + Number(b.total || 0), 0);
  // One transfer for several months: the slip must be for the sum, not for one month.
  const verify = shot
    ? await rememberRef(await verifySlip({ bytes: shot.bytes, mime: shot.mime, amount: total }), room)
    : found.map((b) => b.slipVerify).find(Boolean) || null;
  const slipAt = new Date().toISOString();
  const next = found.map((b) => ({
    ...b,
    status: "pending",
    slipPath,
    slipNote: note || null,
    slipAt,
    slipCount: (b.slipCount || 0) + 1,
    slipGroup: { periods, total },
    slipVerify: verify,
  }));
  await saveBills(next, { latest }); // one room: the index and `bill:<room>` are written once for all periods

  const ownerId = process.env.OWNER_USER_ID;
  await Promise.all([
    ...oldSlips.map((old) => dropIfUnused(room, old, slipPath, found.filter((b) => b.slipPath === old))),
    ownerId
      ? push(ownerId, [confirmBubble(next[next.length - 1])]).catch((err) => console.error("owner push failed", err.message))
      : null,
  ]);

  return res.status(200).json({ ok: true, status: "pending", periods, total, hasSlip: !!slipPath, verify });
}
