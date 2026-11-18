// GET /api/bill?room=203[&period=2026-10][&history=1]
// A tenant sees only their own room; the owner sees all. Without `period` the newest bill is used,
// with `history=1` the caller gets the list of periods that still have a stored bill.
// `voided=1` (owner and helper only) lists the cancelled bills (`bill-void:` archive): { items: [...] },
// newest first; add `period=` to narrow.
//
// `voided=1&refunds=1` (owner and helper) lists the refunds still owed, across all rooms unless
// `room=` narrows. Two kinds, each item carries `kind`: "void" (a cancelled paid bill) and "overpaid"
// (a paid bill whose confirmed slip was larger than the bill; `refundDue` is the extra).
// `pending=1` (owner and helper): every bill with a slip waiting for an answer, from every period of
// each room (read via `bill-state:<room>`), not only the newest bill.
// `overdue=1`: unpaid bills past their due date, counted on the server (Bangkok date). A tenant gets
// their own room; the owner and helpers get every room that has any (`room=` narrows).
// `income=YYYY-MM` (owner and helper): money received in that Bangkok month by `paidAt`, whatever the
// bill's period (an early December bill paid in November counts in November).
//
// POST /api/bill { action: "void", room, period, reason } — the owner cancels a bill (ยกเลิกบิล).
// A paid bill is never edited in place: void it, then re-issue it from /api/run (which bumps `rev`).
// POST /api/bill { action: "refunded", kind?, room, period, rev, note? } — the owner marks money as
// given back. `kind` is "void" (default: a cancelled paid bill) or "overpaid" (the extra of a paid bill).
const store = require("./_store");
const { requireUser, canView, isOwner } = require("./_auth");
const { ROOMS } = require("./_rooms");
const { mapLimit } = require("./_async");
const ledger = require("./_ledger"); // used through the module object so tests can set "today"
const { push } = require("./_line");
const { payloadFor } = require("./_promptpay");
const { qrSvg } = require("./_qr");
const { saveBill, archiveVoid, tenancyOf, visibleToTenant, receiptNoOf, PERIOD: STRICT_PERIOD } = require("./_bills");
const { usableIn } = require("./_prepay");

const PERIOD = /^\d{4}-\d{2}$/;
const HISTORY_READ_CONCURRENCY = 6;
const MAX_REASON_LENGTH = 200;
const ROOMS_AT_ONCE = 4;
const INCOME_LOOKBACK_MONTHS = 12; // a bill is paid at most about a year after its period
const REFUND_KINDS = ["void", "overpaid"];

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

// Bills paid before receipts existed have no stored number; it is derived from the bill, so show
// the same one the owner's confirm would have written.
const withReceipt = (bill) => ({ ...bill, receiptNo: bill.receiptNo || (bill.status === "paid" ? receiptNoOf(bill) : null) });

// A tenant gets the bill without the LINE userIds of the staff who confirmed or voided it.
const forCaller = (bill, staff) => {
  if (staff) return bill;
  const { confirmedBy, voidedBy, refundedBy, ...rest } = bill;
  return rest;
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store"); // bill status changes after a slip is attached
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (req.method === "POST") return voidBill(req, res, userId);

  const [bound, staff] = await Promise.all([store.get(`user-room:${userId}`), canView(userId)]);

  // Cross-room reads for the owner come before the single-room checks: they need no `room`.
  if (req.query.income) {
    if (!staff) return fail(res, 403, "FORBIDDEN", "เฉพาะเจ้าของหอ");
    return income(res, String(req.query.income).trim());
  }
  if (req.query.overdue) return overdue(res, { staff, bound, asked: String(req.query.room || "").trim() });
  if (req.query.pending) {
    if (!staff) return fail(res, 403, "FORBIDDEN", "เฉพาะเจ้าของหอ");
    return pendingList(res);
  }
  if (req.query.voided && req.query.refunds) {
    if (!staff) return fail(res, 403, "FORBIDDEN", "เฉพาะเจ้าของหอ");
    return outstandingRefunds(res, String(req.query.room || "").trim());
  }

  const room = String(req.query.room || bound || "").trim();
  if (!room) return res.status(400).json({ error: { code: "VALIDATION", message: "ต้องระบุ room หรือผูกห้องก่อน" } });

  if (!staff && bound !== room) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: `บัญชีนี้ยังไม่ได้ผูกกับห้อง ${room}` } });
  }

  const period = String(req.query.period || "").trim();
  if (period && !PERIOD.test(period)) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "period ต้องเป็น YYYY-MM" } });
  }

  if (req.query.voided) {
    if (!staff) return fail(res, 403, "FORBIDDEN", "เฉพาะเจ้าของหอ");
    return voided(res, room, period);
  }

  // A tenant sees only bills issued during their own tenancy; the owner and viewers see all. The
  // tenancy record is fetched together with the bill (it used to be a read of its own first).
  const tenancyP = staff ? null : tenancyOf(room);
  const visibleIn = (tenancy) => (b) => staff || visibleToTenant(b, tenancy);

  if (req.query.history) return history(res, room, staff, tenancyP);

  if (period) {
    const [bill, tenancy] = await Promise.all([store.get(`bill:${period}:${room}`), tenancyP]);
    if (!bill || !visibleIn(tenancy)(bill)) return res.status(404).json({ error: { code: "NOT_FOUND", message: `ไม่พบบิลของห้อง ${room}` } });
    return res.status(200).json({ ...forCaller(withReceipt(bill), staff), hasSlip: !!bill.slipPath, pay: await payQr(bill) });
  }

  // The latest bill also reports a slip sent before it existed, so the tenant sees "รอบิลออก".
  const [latest, prepay, tenancy] = await Promise.all([store.get(`bill:${room}`), store.get(`prepay:${room}`), tenancyP]);
  const bill = visibleIn(tenancy)(latest) ? latest : null; // the previous tenant's bill answers like "no bill"
  // Shown only while some path will really attach it: a leftover from a previous tenant must not
  // look like "the system will handle this" (usableIn checks that the sender is still of this room).
  const advance = prepay && await usableIn(prepay, room, null)
    ? { slipAt: prepay.slipAt, hasSlip: !!prepay.slipPath, note: prepay.slipNote || null }
    : null;
  if (!bill) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: `ไม่พบบิลของห้อง ${room}`, advance } });
  }

  return res.status(200).json({ ...forCaller(withReceipt(bill), staff), hasSlip: !!bill.slipPath, advance, pay: await payQr(bill) });
};

// A scannable PromptPay QR for this bill: only when the dorm configured an id and the bill is still
// payable. The payload is a normal EMVCo string, so any Thai banking app can read it; the SVG is
// rendered here because the page has no QR library.
async function payQr(bill) {
  if (!bill || (bill.status !== "unpaid" && bill.status !== "pending")) return null;
  const dorm = await store.get("dorm");
  const payload = dorm && payloadFor(dorm.promptpay, bill.total);
  if (!payload) return null;
  return { payload, qr: qrSvg(payload) };
}

async function voidBill(req, res, userId) {
  if (!await isOwner(userId)) return fail(res, 403, "FORBIDDEN", "เฉพาะเจ้าของหอ");

  const { action, room: askedRoom, period: askedPeriod, reason: askedReason } = req.body || {};
  // Both actions are the owner's answer to a bill: cancel it, or send the slip back for another try.
  if (action === "reject") return rejectSlip(req, res, userId);
  if (action === "refunded") return markRefunded(req, res, userId);
  if (action !== "void") return fail(res, 400, "VALIDATION", "action ต้องเป็น void, reject หรือ refunded");
  const room = String(askedRoom || "").trim();
  const period = String(askedPeriod || "").trim();
  const reason = typeof askedReason === "string" ? askedReason.trim() : "";
  if (!room) return fail(res, 400, "VALIDATION", "ต้องระบุ room");
  if (!ROOMS.includes(room)) return fail(res, 404, "NOT_FOUND", `ไม่พบห้อง ${room}`);
  if (!STRICT_PERIOD.test(period)) return fail(res, 400, "VALIDATION", "period ต้องเป็น YYYY-MM");
  if (!reason || reason.length > MAX_REASON_LENGTH) {
    return fail(res, 400, "VALIDATION", `ต้องระบุเหตุผลที่ยกเลิก (1-${MAX_REASON_LENGTH} ตัวอักษร)`);
  }

  // A bill written before the per-period key existed lives only as `bill:<room>`.
  const [stored, latest] = await Promise.all([store.get(`bill:${period}:${room}`), store.get(`bill:${room}`)]);
  const bill = stored || (latest && latest.period === period ? latest : null);
  if (!bill) return fail(res, 404, "NOT_FOUND", `ไม่พบบิลห้อง ${room} รอบ ${period}`);
  if (bill.status === "void") return fail(res, 409, "INVALID_STATE", `บิลห้อง ${room} รอบ ${period} ถูกยกเลิกไปแล้ว`);

  // The receipt number and the slip stay on the record: a void bill is evidence, not a deletion.
  // `latest` was read above, so saveBill does not read it again; the tenant lookup runs alongside.
  // A paid bill may already carry an overpaid refund. The void copy must not inherit it: spreading
  // would overwrite the extra still owed with the total (the extra would vanish from the list) and
  // would copy refundedAt, hiding the full-total refund as "already refunded".
  const { refundDue: oldRefund, refundReason, refundedAt: oldRefundedAt, refundedBy: _rb, refundNote: _rn, ...rest } = bill;
  const overpaidExtra = refundReason === "overpaid" && oldRefund > 0 ? oldRefund : 0;
  const extraOwed = oldRefundedAt ? 0 : overpaidExtra;
  const voided = {
    ...rest,
    status: "void",
    voidedAt: new Date().toISOString(),
    voidedBy: userId,
    voidReason: reason,
    statusBefore: bill.status,
    // Money the dorm is holding for a cancelled payment: a paid bill, or a pending one whose slip the
    // provider verified (the transfer is real; only the owner's tap was missing). The system does not
    // move money; this is the number the owner has to refund, kept on the record so it is not lost.
    // The refund is what the slip actually moved (`slipAmount`), not the bill: a short slip left the
    // dorm holding less than the total, and an over-paid one more (that extra is a separate refund).
    ...(bill.status === "paid"
      ? { refundDue: bill.total + extraOwed }
      : bill.status === "pending" && bill.slipAmount != null
        ? { refundDue: bill.slipAmount }
        : bill.status === "pending" && bill.slipVerify?.ok === true && bill.total
          ? { refundDue: bill.total }
          : {}),
    // The extra was already paid back before the void: keep it for the history only.
    ...(overpaidExtra && oldRefundedAt ? { priorRefund: { reason: "overpaid", amount: overpaidExtra, refundedAt: oldRefundedAt } } : {}),
  };
  // Written against the status that was read: the owner may confirm the slip (paid) in the chat at
  // the same moment, and a blind void write would erase paidAt/receiptNo and the refund that money owes.
  let applied = false;
  await store.update(`bill:${period}:${room}`, (current) => {
    const seen = current || (latest && latest.period === period ? latest : null);
    if (!seen || seen.status !== bill.status) return undefined;
    applied = true;
    return voided;
  });
  if (!applied) {
    return fail(res, 409, "INVALID_STATE", `บิลห้อง ${room} รอบ ${period} เพิ่งเปลี่ยนสถานะ — เปิดบิลใหม่แล้วลองอีกครั้ง`);
  }

  const [, tenant, tenancy] = await Promise.all([
    // Archive at once, not only when run.js re-issues it: a bill cancelled and never re-issued must
    // still show up in `?voided=1`. archiveVoid is idempotent, so run.js archiving again is harmless.
    saveBill(voided, { latest: voided }).then(() => archiveVoid(voided)),
    store.get(`room-user:${room}`),
    tenancyOf(room),
  ]);

  // Tell the tenant, unless the bill belongs to someone who has since moved out.
  if (tenant && visibleToTenant(bill, tenancy)) {
    try {
      await push(tenant, [{ type: "text", text: `บิลห้อง ${room} รอบ ${period} ถูกยกเลิก — ${reason}` }]);
    } catch (err) {
      console.error("void notice failed", room, err.message);
    }
  }

  return res.status(200).json({ ok: true, room, period, status: "void", ...(voided.refundDue ? { refund: voided.refundDue } : {}) });
}

// The owner says the slip is wrong: the bill goes back to `unpaid` so the tenant can send another
// one. The rejected slip stays on the record (path, verify result, reason) — it is evidence, and the
// 5-slip limit still counts it.
async function rejectSlip(req, res, userId) {
  const { room: askedRoom, period: askedPeriod, reason: askedReason } = req.body || {};
  const room = String(askedRoom || "").trim();
  const period = String(askedPeriod || "").trim();
  const reason = typeof askedReason === "string" ? askedReason.trim() : "";
  if (!room) return fail(res, 400, "VALIDATION", "ต้องระบุ room");
  if (!ROOMS.includes(room)) return fail(res, 404, "NOT_FOUND", `ไม่พบห้อง ${room}`);
  if (!STRICT_PERIOD.test(period)) return fail(res, 400, "VALIDATION", "period ต้องเป็น YYYY-MM");
  if (!reason || reason.length > MAX_REASON_LENGTH) {
    return fail(res, 400, "VALIDATION", `ต้องระบุเหตุผลที่ตีกลับ (1-${MAX_REASON_LENGTH} ตัวอักษร)`);
  }

  const [stored, latest, tenancy] = await Promise.all([
    store.get(`bill:${period}:${room}`),
    store.get(`bill:${room}`),
    tenancyOf(room),
  ]);
  const bill = stored || (latest && latest.period === period ? latest : null);
  if (!bill) return fail(res, 404, "NOT_FOUND", `ไม่พบบิลห้อง ${room} รอบ ${period}`);
  if (bill.status !== "pending") {
    return fail(res, 409, "INVALID_STATE", `บิลนี้อยู่ในสถานะ ${bill.status} จึงตีกลับไม่ได้`);
  }

  const next = { ...bill, status: "unpaid", slipRejected: { at: new Date().toISOString(), by: userId, reason } };
  // Rejected only while it is still the bill that was read: a void or a confirm may have landed in
  // between, and a blind write would bring a cancelled bill back as `unpaid` (its receipt number
  // then gets reused by the next issue).
  let applied = false;
  await store.update(`bill:${period}:${room}`, (current) => {
    const seen = current || (latest && latest.period === period ? latest : null);
    if (!seen || seen.status !== "pending") return undefined;
    applied = true;
    return next;
  });
  if (!applied) {
    return fail(res, 409, "INVALID_STATE", `บิลห้อง ${room} รอบ ${period} เพิ่งเปลี่ยนสถานะ — เปิดใหม่แล้วลองอีกครั้ง`);
  }
  await saveBill(next);

  const tenant = await store.get(`room-user:${room}`);
  if (tenant && visibleToTenant(bill, tenancy)) {
    try {
      await push(tenant, [{ type: "text", text: `สลิปห้อง ${room} รอบ ${period} ไม่ผ่าน — ${reason}\nกรุณาแนบสลิปใหม่` }]);
    } catch (err) {
      console.error("reject notice failed", room, err.message);
    }
  }
  return res.status(200).json({ ok: true, room, period, status: "unpaid", rejected: reason });
}

// Bills written before this change only have `bill:<room>` (the latest). Include it so history is
// never empty on an old deployment.
async function history(res, room, staff, tenancyP) {
  const [latest, rawIndex, tenancy] = await Promise.all([
    store.get(`bill:${room}`),
    store.get(`bills:${room}`),
    tenancyP,
  ]);
  const visible = (b) => staff || visibleToTenant(b, tenancy);
  // `bills:<room>` is the index of periods written since history existed.
  const index = rawIndex || [];
  const periods = new Set(index);
  if (latest?.period) periods.add(latest.period);

  const sortedPeriods = [...periods].sort().reverse();
  const records = await mapLimit(sortedPeriods, HISTORY_READ_CONCURRENCY, async (p) => {
    const bill = await store.get(`bill:${p}:${room}`) || (latest?.period === p ? latest : null);
    if (!bill || !visible(bill)) return null;
    return {
      period: p,
      total: bill.total,
      status: bill.status,
      receiptNo: withReceipt(bill).receiptNo,
      due: bill.due || null,
      hasSlip: !!bill.slipPath,
    };
  });
  const items = records.filter(Boolean);
  return res.status(200).json({ room, items });
}

// The archived void records of a room, newest first. `bill-voids:<room>` lists them as
// "<period>:<rev>"; the index is capped, so this reads a bounded number of keys.
async function readVoids(room, period) {
  const tags = ((await store.get(`bill-voids:${room}`)) || [])
    .filter((t) => typeof t === "string" && /^\d{4}-\d{2}:\d+$/.test(t) && (!period || t.startsWith(`${period}:`)))
    .map((t) => t.split(":"))
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : Number(b[1]) - Number(a[1]))); // period, then rev, newest first
  const records = await mapLimit(tags, HISTORY_READ_CONCURRENCY, ([p, rev]) => store.get(`bill-void:${p}:${room}:${rev}`));
  return records.filter(Boolean);
}

async function voided(res, room, period) {
  return res.status(200).json({ room, items: await readVoids(room, period) });
}

// Paid bills that took more money than the bill asked for: `refundDue` is the extra and the confirm
// step tagged them "<period>:<rev>" in `overpaid:<room>`. The bill is the source of truth; a tag whose
// bill has since been re-issued (another rev), refunded or voided is skipped.
async function readOverpaid(room) {
  const tags = [...new Set((await store.get(`overpaid:${room}`)) || [])]
    .filter((t) => typeof t === "string" && /^\d{4}-\d{2}:\d+$/.test(t))
    .map((t) => t.split(":"));
  if (!tags.length) return [];
  const latest = await store.get(`bill:${room}`);
  const bills = await mapLimit(tags, HISTORY_READ_CONCURRENCY, async ([p, rev]) => {
    const b = (await store.get(`bill:${p}:${room}`)) || (latest && latest.period === p ? latest : null);
    return b && b.status === "paid" && (b.rev || 1) === Number(rev) && b.refundDue && !b.refundedAt ? b : null;
  });
  return bills.filter(Boolean).sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0));
}

// Refunds the owner still owes: cancelled paid bills (`kind: "void"`) and overpaid paid bills
// (`kind: "overpaid"`). This is the owner's to-do list, so it spans all rooms unless one is asked for.
async function outstandingRefunds(res, room) {
  if (room && !ROOMS.includes(room)) return fail(res, 404, "NOT_FOUND", `ไม่พบห้อง ${room}`);
  const perRoom = await mapLimit(room ? [room] : ROOMS, ROOMS_AT_ONCE, async (r) => {
    const [voids, overpaid] = await Promise.all([readVoids(r), readOverpaid(r)]);
    return [
      ...voids.filter((v) => v.refundDue && !v.refundedAt).map((v) => ({ ...v, kind: "void" })),
      ...overpaid.map((b) => ({ ...b, kind: "overpaid" })),
    ];
  });
  const items = perRoom.flat();
  return res.status(200).json({
    ...(room ? { room } : {}),
    count: items.length,
    total: items.reduce((sum, v) => sum + v.refundDue, 0),
    items,
  });
}

// The owner records that refund money went back to the tenant (`kind` "void" by default, or "overpaid"). The system never moves
// money; this only closes the to-do that `refundDue` opened. The archive record is the source of
// truth, and the bill itself is updated too while it is still that same void revision (a re-issue
// has replaced it otherwise, and the new bill must not inherit a refund).
async function markRefunded(req, res, userId) {
  const { kind: askedKind, room: askedRoom, period: askedPeriod, rev: askedRev, note: askedNote } = req.body || {};
  const kind = askedKind === undefined || askedKind === null || askedKind === "" ? "void" : askedKind;
  if (!REFUND_KINDS.includes(kind)) return fail(res, 400, "VALIDATION", `kind ต้องเป็น ${REFUND_KINDS.join(" หรือ ")}`);
  const room = String(askedRoom || "").trim();
  const period = String(askedPeriod || "").trim();
  const rev = Number(askedRev);
  const note = typeof askedNote === "string" ? askedNote.trim() : "";
  if (!room) return fail(res, 400, "VALIDATION", "ต้องระบุ room");
  if (!ROOMS.includes(room)) return fail(res, 404, "NOT_FOUND", `ไม่พบห้อง ${room}`);
  if (!STRICT_PERIOD.test(period)) return fail(res, 400, "VALIDATION", "period ต้องเป็น YYYY-MM");
  if (!Number.isInteger(rev) || rev < 1) return fail(res, 400, "VALIDATION", "rev ต้องเป็นจำนวนเต็ม ≥ 1");
  if (note.length > MAX_REASON_LENGTH) return fail(res, 400, "VALIDATION", `หมายเหตุยาวเกิน ${MAX_REASON_LENGTH} ตัวอักษร`);

  if (kind === "overpaid") return markOverpaidRefunded(res, userId, { room, period, rev, note });

  const archiveKey = `bill-void:${period}:${room}:${rev}`;
  const [record, stored, latest] = await Promise.all([
    store.get(archiveKey),
    store.get(`bill:${period}:${room}`),
    store.get(`bill:${room}`),
  ]);
  if (!record) return fail(res, 404, "NOT_FOUND", `ไม่พบบิลที่ยกเลิกห้อง ${room} รอบ ${period} ครั้งที่ ${rev}`);
  if (!record.refundDue) return fail(res, 409, "INVALID_STATE", "บิลนี้ไม่มียอดที่ต้องคืนเงิน");
  if (record.refundedAt) return fail(res, 409, "INVALID_STATE", "บันทึกว่าคืนเงินแล้วก่อนหน้านี้");

  const mark = { refundedAt: new Date().toISOString(), refundedBy: userId, refundNote: note };
  const current = stored || (latest && latest.period === period ? latest : null);
  const writes = [store.set(archiveKey, { ...record, ...mark })];
  if (current && current.status === "void" && (current.rev || 1) === rev) {
    writes.push(saveBill({ ...current, ...mark }, { latest }));
  }
  await Promise.all(writes);
  return res.status(200).json({ ok: true, room, period, rev, refundedAt: mark.refundedAt, refundDue: record.refundDue });
}

// The extra money of a paid bill went back. The paid bill itself carries `refundDue`, so this only
// stamps it; a re-issued bill (another rev) is a different bill and answers 409.
async function markOverpaidRefunded(res, userId, { room, period, rev, note }) {
  const [stored, latest] = await Promise.all([store.get(`bill:${period}:${room}`), store.get(`bill:${room}`)]);
  const bill = stored || (latest && latest.period === period ? latest : null);
  if (!bill) return fail(res, 404, "NOT_FOUND", `ไม่พบบิลห้อง ${room} รอบ ${period}`);
  if (bill.status !== "paid" || (bill.rev || 1) !== rev) {
    return fail(res, 409, "INVALID_STATE", `บิลห้อง ${room} รอบ ${period} ครั้งที่ ${rev} ไม่ใช่บิลที่ชำระแล้วที่มียอดโอนเกิน`);
  }
  if (!bill.refundDue) return fail(res, 409, "INVALID_STATE", "บิลนี้ไม่มียอดที่ต้องคืนเงิน");
  if (bill.refundedAt) return fail(res, 409, "INVALID_STATE", "บันทึกว่าคืนเงินแล้วก่อนหน้านี้");
  const mark = { refundedAt: new Date().toISOString(), refundedBy: userId, refundNote: note };
  await saveBill({ ...bill, ...mark }, { latest });
  return res.status(200).json({ ok: true, kind: "overpaid", room, period, rev, refundedAt: mark.refundedAt, refundDue: bill.refundDue });
}

// Bills waiting for the owner's answer — from every period, not only each room's newest bill. A
// tenant can pay an older period (POST /api/slip takes `periods`), and the card pushes to chat; if
// the review screen only looked at the newest bill, that slip would have no place to be confirmed.
// One index read per room, then the real bill only for the rooms that actually have one pending.
async function pendingList(res) {
  const perRoom = await mapLimit(ROOMS, ROOMS_AT_ONCE, async (room) => {
    const pending = (await ledger.stateBills(room)).filter((b) => b.status === "pending");
    if (!pending.length) return [];
    // A bill written before the per-period key existed lives only as `bill:<room>`; without the
    // fallback its slip would be invisible here and its photo a 404.
    const latest = await store.get(`bill:${room}`);
    const bills = await Promise.all(
      pending.map(async (b) => (await store.get(`bill:${b.period}:${room}`)) || (latest && latest.period === b.period ? latest : null))
    );
    return bills
      .filter((b) => b && b.status === "pending")
      .map((b) => ({
        room,
        period: b.period,
        total: b.total,
        due: b.due,
        slipAt: b.slipAt || null,
        slipCount: b.slipCount || 0,
        slipPath: b.slipPath || null,
        slipVerify: b.slipVerify || null,
      }));
  });
  const items = perRoom
    .flat()
    .sort((a, b) => String(a.period).localeCompare(String(b.period)) || a.room.localeCompare(b.room));
  return res.status(200).json({ count: items.length, total: items.reduce((s, i) => s + Number(i.total || 0), 0), items });
}

// Unpaid bills past their due date, from the server's Bangkok date. A tenant sees only their own
// room and only bills of their own tenancy; the owner and helpers see every room that has any,
// longest overdue first.
async function overdue(res, { staff, bound, asked }) {
  const today = ledger.bangkokToday();
  if (!staff) {
    if (!bound) return fail(res, 400, "VALIDATION", "ต้องผูกห้องก่อน");
    if (asked && asked !== bound) return fail(res, 403, "FORBIDDEN", `บัญชีนี้ยังไม่ได้ผูกกับห้อง ${asked}`);
    const [bills, tenancy] = await Promise.all([ledger.stateBills(bound), tenancyOf(bound)]);
    const { count, total, maxDaysOverdue, items } = ledger.overdueOf(bills.filter((b) => visibleToTenant(b, tenancy)), today);
    return res.status(200).json({ today, room: bound, count, total, maxDaysOverdue, items });
  }
  if (asked && !ROOMS.includes(asked)) return fail(res, 404, "NOT_FOUND", `ไม่พบห้อง ${asked}`);
  const perRoom = await mapLimit(asked ? [asked] : ROOMS, ROOMS_AT_ONCE, async (room) => ({
    room,
    ...ledger.overdueOf(await ledger.stateBills(room), today),
  }));
  const rooms = perRoom
    .filter((r) => r.count > 0)
    .sort((a, b) => b.maxDaysOverdue - a.maxDaysOverdue || a.room.localeCompare(b.room));
  return res.status(200).json({
    today,
    count: rooms.reduce((s, r) => s + r.count, 0),
    total: rooms.reduce((s, r) => s + r.total, 0),
    rooms,
  });
}

// Money received in a Bangkok month, by the day it was paid (`paidAt`), not by the bill's period:
// an October bill paid on 2 November is November income, and so is a December bill issued early and
// paid on 20 November. A void bill is money owed back, so only `paid` counts.
// Reads are bounded: one compact state key per room (`_ledger.stateBills`), which keeps the latest 24
// periods — more than the 12-month window below, so the only bill not counted is one paid more than
// 12 months after its period.
async function income(res, month) {
  if (!STRICT_PERIOD.test(month)) return fail(res, 400, "VALIDATION", "income ต้องเป็น YYYY-MM");
  const from = ledger.shiftMonth(month, -INCOME_LOOKBACK_MONTHS);
  const perRoom = await mapLimit(ROOMS, ROOMS_AT_ONCE, async (room) =>
    (await ledger.stateBills(room)).filter((b) => b.period >= from).map((b) => ({ ...b, room })));
  const items = perRoom
    .flat()
    .filter((b) => b.status === "paid" && ledger.bangkokMonth(b.paidAt) === month)
    .map((b) => ({ room: b.room, period: b.period, total: b.total, paidAt: b.paidAt, receiptNo: withReceipt(b).receiptNo }))
    .sort((a, b) => (a.paidAt < b.paidAt ? -1 : a.paidAt > b.paidAt ? 1 : a.room.localeCompare(b.room)));
  return res.status(200).json({ month, total: items.reduce((s, i) => s + (Number(i.total) || 0), 0), count: items.length, items });
}
