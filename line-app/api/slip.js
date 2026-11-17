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
const { saveBills, tenancyOf, visibleToTenant, withAmounts, PERIOD } = require("./_bills");
const { ROOMS } = require("./_rooms");
const { mapLimit } = require("./_async");
const { push, confirmBubble } = require("./_line");
const { requireUser, isOwner } = require("./_auth");
const { verifySlip, markStale, markEarly, checkAmount, amountFields } = require("./_verify");
const { usable, attachPrepay } = require("./_prepay");
const { closeBills, sendReceipts, notifyAutoPaid, autoConfirmOn } = require("./_pay");

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

  // A tenant's claim is only worth something with the photo: it is all the owner has to check
  // against the bank. The owner may still record a payment without one (cash, a transfer seen in
  // the bank app). A multi-period slip is always a new slip, so it always needs the photo; the
  // single-bill path below allows one exception (editing the note of a slip already sent).
  const NEEDS_PHOTO = "ต้องแนบรูปสลิป";
  if (periods != null && !owner && !image) return fail(res, 400, "VALIDATION", NEEDS_PHOTO);

  if (periods != null) {
    const ok = Array.isArray(periods) && periods.length >= 1 && periods.length <= MAX_PERIODS &&
      periods.every((p) => typeof p === "string" && PERIOD.test(p)) && new Set(periods).size === periods.length;
    if (!ok) return fail(res, 400, "VALIDATION", `periods ต้องเป็นรายการ YYYY-MM ไม่ซ้ำกัน 1-${MAX_PERIODS} รอบ`);
    return saveGroup({ res, req, room, owner, userId, note, image, periods: [...periods].sort() });
  }

  // The tenancy record is read together with the bill, not after it.
  const [latest, tenancy] = await Promise.all([store.get(`bill:${room}`), owner ? null : tenancyOf(room)]);
  let bill = latest;
  // The previous tenant's unpaid bill is not open for this tenant: it must not get their slip.
  if (bill && !owner && !visibleToTenant(bill, tenancy)) bill = null;
  // Nothing open to pay: this slip is for the bill that has not been issued yet.
  const advance = !bill || bill.status === "paid" || bill.status === "void";
  const prev = advance ? await store.get(`prepay:${room}`) : bill;

  // A NEW slip needs its photo. A tenant may send note-only only to update a slip they already
  // sent: a pending bill that has its photo, or an existing prepay with one. That keeps the photo
  // and its check. A bill that is part of a multi-period slip is excluded: a note-only update here
  // would split it from the group while the check still describes the group's total.
  if (!owner && !image) {
    const hasSlip = advance ? !!prev?.slipPath : bill.status === "pending" && !!bill.slipPath && !bill.slipGroup;
    if (!hasSlip) return fail(res, 400, "VALIDATION", NEEDS_PHOTO);
  }

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
    // The provider call and the upload do not depend on each other; running them together saves the
    // tenant about a second on every slip (the verify round trip).
    shot = { pending: verifySlip({ bytes, mime: m[1], amount: bill?.total ?? prev?.total }) };
    await store.putFile(slipPath, bytes, m[1]);
  }

  // A new photo is checked; a note-only update keeps whatever the last photo was checked as (and
  // the amount facts already on the bill). markStale/markEarly run after rememberRef so an old or
  // early slip still records its reference against reuse. An advance slip has no bill to be compared
  // with yet: its amount is checked when /api/run (or the second look below) attaches it, and it is
  // meant to be older than the bill, so markEarly does not apply to it.
  let verify = prev?.slipVerify || null;
  let amounts = null;
  if (shot) {
    amounts = advance ? { verify: await shot.pending } : checkAmount(await shot.pending, bill.total);
    verify = markStale(await rememberRef(amounts.verify, room));
    if (!advance) verify = markEarly(verify, bill.issuedAt);
  }

  if (advance) return saveAdvance({ res, room, userId, owner, latest, note, slipPath, sent, verify });

  let next = {
    ...bill,
    status: "pending",
    slipPath,
    slipNote: note || null,
    slipAt: new Date().toISOString(),
    slipCount: sent + 1,
    slipVerify: verify,
  };
  if (amounts) next = withAmounts(next, amounts);
  delete next.slipGroup; // a slip of its own: this bill no longer belongs to a multi-period slip

  // Auto-confirm, see autoConfirms(). The bill is written once, already paid, so there is no
  // moment where it is `pending` with no owner card.
  if (autoConfirms({ fresh: !!shot, verify })) {
    const paid = await closeBills(room, [next], { latest, auto: true });
    await Promise.all([
      dropIfUnused(room, oldSlip, slipPath, [bill]),
      notifyAutoPaid(paid),
      sendReceipts(room, paid, null, baseUrlOf(req)),
    ]);
    return res.status(200).json({
      ok: true, status: "paid", autoConfirmed: true, receiptNo: paid[0].receiptNo, total: next.total, hasSlip: !!slipPath, verify,
    });
  }

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

// When a slip closes the bill by itself, without the owner's tap. All of these must hold:
// - it is a slip for a monthly bill (the single-bill path and the multi-month group path call this;
//   the advance and prepay paths never do),
// - the photo was verified in THIS request (`fresh`): a note-only update reuses an old result and
//   must not close a bill the owner has not seen,
// - the final verify result is exactly `ok === true`: the dorm's account, the exact amount, not
//   reused, not older than 30 days, not transferred before the bill was issued. null (could not
//   check), false, over, short, stale, early and reused all stay `pending` for the owner,
// - the owner has not switched it off with SLIP_AUTO_CONFIRM=0|off|false (unset = on).
//
// Advance slips (saveAdvance) are left out on purpose: when they were sent no bill amount existed,
// so there was nothing to check the transfer against, and the owner decided they stay manual. For
// the same reason a prepay that /api/run or the second look attaches to a bill still goes to the
// owner's confirm card, even when its check says ok.
const autoConfirms = ({ fresh, verify }) => fresh === true && verify?.ok === true && autoConfirmOn();

const baseUrlOf = (req) => process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;

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
async function saveAdvance({ res, room, userId, owner, latest, note, slipPath, sent, verify }) {
  // `byStaff`: the owner recorded it, so it is about the room, not about one tenant (see _prepay.usable).
  const prepay = {
    room, slipPath, slipNote: note || null, slipAt: new Date().toISOString(), slipCount: sent + 1, by: userId,
    ...(owner && { byStaff: true }),
    slipVerify: verify || null,
  };
  await store.set(`prepay:${room}`, prepay);

  // The owner may have issued the bill while this request was running: /api/run read `prepay:`
  // before it was written, so nobody would attach the slip until next month. Look at the room's
  // latest bill once more (Blob has no compare-and-set, so a second look is the only guard) and, if
  // a bill this tenant can pay has appeared, attach the slip to it exactly as /api/run does. /api/run
  // makes the mirror-image check after writing its bill; if both attach, the content is identical
  // and the owner's card is deduped by its retry key.
  const attached = await attachToNewBill({ room, owner, latest, prepay });
  if (attached) {
    return res.status(200).json({
      ok: true, status: "pending", attached: true, total: attached.total, hasSlip: !!slipPath, verify: verify || null,
    });
  }

  // "advance" is right at the time of this answer: the second look above found no bill. If /api/run
  // attaches the slip a moment later, the LIFF reloads the bill after sending and shows it pending.

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

// -> the bill the advance slip was attached to, or null when none appeared since the first read.
async function attachToNewBill({ room, owner, latest, prepay }) {
  const fresh = await store.get(`bill:${room}`);
  // /api/run was quicker and already attached this very slip: nothing to do, and no second card.
  if (fresh && fresh.status === "pending" && fresh.prepaid && fresh.slipAt === prepay.slipAt) return fresh;
  // Only an unpaid bill is waiting for a slip; the first read saw none, so this one is new.
  if (!fresh || fresh.status !== "unpaid" || (latest && fresh.period < latest.period)) return null;
  // Same rules as /api/run: a tenant's slip is the current tenant's (an owner-recorded one is the
  // room's), and the previous tenant's bill is not open for it.
  const [tenant, tenancy] = await Promise.all([store.get(`room-user:${room}`), owner ? null : tenancyOf(room)]);
  if (!usable(prepay, tenant) || (!owner && !visibleToTenant(fresh, tenancy))) return null;

  return attachPrepay({ bill: fresh, prepay, latest: fresh });
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
async function saveGroup({ res, req, room, owner, userId, note, image, periods }) {
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
  const total = found.reduce((sum, b) => sum + Number(b.total || 0), 0);
  let shot = null;
  if (image) {
    const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(image);
    if (!m) return fail(res, 400, "VALIDATION", "รูปต้องเป็น JPEG/PNG/WEBP");
    const bytes = Buffer.from(m[3], "base64");
    if (bytes.length > MAX_BYTES) return fail(res, 413, "TOO_LARGE", "รูปใหญ่เกิน 3MB");
    const ext = m[2] === "jpeg" ? "jpg" : m[2];
    slipPath = `slips/${room}-${Date.now()}.${ext}`;
    // Upload and provider check in flight together; one round trip less for the tenant.
    shot = { pending: verifySlip({ bytes, mime: m[1], amount: total }) };
    await store.putFile(slipPath, bytes, m[1]);
  }

  // One transfer for several months: the slip must be for the sum, not for one month. The amount
  // facts live in `slipGroup` (the confirm finds them there) and are copied onto every bill. The
  // transfer-before-issue rule uses the NEWEST bill: a slip older than it cannot have paid it.
  const checked = checkAmount(shot ? await shot.pending : found.map((b) => b.slipVerify).find(Boolean) || null, total);
  let verify = checked.verify;
  if (shot) verify = markEarly(markStale(await rememberRef(verify, room)), newest.issuedAt);
  const slipAt = new Date().toISOString();
  const next = found.map((b) => withAmounts({
    ...b,
    status: "pending",
    slipPath,
    slipNote: note || null,
    slipAt,
    slipCount: (b.slipCount || 0) + 1,
    slipGroup: { periods, total, ...amountFields(checked) },
    slipVerify: verify,
  }, checked));
  // A verified slip for the exact sum closes every period at once (see autoConfirms): one write,
  // one notice for the owner, one receipt per period for the tenant.
  if (autoConfirms({ fresh: !!shot, verify })) {
    const paid = await closeBills(room, next, { latest, auto: true });
    await Promise.all([
      ...oldSlips.map((old) => dropIfUnused(room, old, slipPath, found.filter((b) => b.slipPath === old))),
      notifyAutoPaid(paid),
      sendReceipts(room, paid, null, baseUrlOf(req)),
    ]);
    return res.status(200).json({
      ok: true, status: "paid", autoConfirmed: true, periods, total, receiptNos: paid.map((b) => b.receiptNo),
      hasSlip: !!slipPath, verify,
    });
  }

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
