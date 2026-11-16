// GET /api/bill?room=203[&period=2026-10][&history=1]
// A tenant sees only their own room; the owner sees all. Without `period` the newest bill is used,
// with `history=1` the caller gets the list of periods that still have a stored bill.
// `voided=1` (owner and helper only) lists the cancelled bills (`bill-void:` archive): { items: [...] },
// newest first; add `period=` to narrow.
//
// POST /api/bill { action: "void", room, period, reason } — the owner cancels a bill (ยกเลิกบิล).
// A paid bill is never edited in place: void it, then re-issue it from /api/run (which bumps `rev`).
const store = require("./_store");
const { requireUser, canView, isOwner } = require("./_auth");
const { ROOMS } = require("./_rooms");
const { mapLimit } = require("./_async");
const { push } = require("./_line");
const { payloadFor } = require("./_promptpay");
const { qrSvg } = require("./_qr");
const { saveBill, archiveVoid, tenancyOf, visibleToTenant, receiptNoOf, PERIOD: STRICT_PERIOD } = require("./_bills");

const PERIOD = /^\d{4}-\d{2}$/;
const HISTORY_READ_CONCURRENCY = 6;
const MAX_REASON_LENGTH = 200;

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

// Bills paid before receipts existed have no stored number; it is derived from the bill, so show
// the same one the owner's confirm would have written.
const withReceipt = (bill) => ({ ...bill, receiptNo: bill.receiptNo || (bill.status === "paid" ? receiptNoOf(bill) : null) });

// A tenant gets the bill without the LINE userIds of the staff who confirmed or voided it.
const forCaller = (bill, staff) => {
  if (staff) return bill;
  const { confirmedBy, voidedBy, ...rest } = bill;
  return rest;
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store"); // bill status changes after a slip is attached
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (req.method === "POST") return voidBill(req, res, userId);

  const [bound, staff] = await Promise.all([store.get(`user-room:${userId}`), canView(userId)]);
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
  const advance = prepay ? { slipAt: prepay.slipAt, hasSlip: !!prepay.slipPath, note: prepay.slipNote || null } : null;
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
  if (action !== "void") return fail(res, 400, "VALIDATION", "action ต้องเป็น void หรือ reject");
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
  const voided = {
    ...bill,
    status: "void",
    voidedAt: new Date().toISOString(),
    voidedBy: userId,
    voidReason: reason,
    statusBefore: bill.status,
    // Money the dorm is holding for a cancelled payment. The system does not move money; this is the
    // number the owner has to refund, kept on the record so it is not lost.
    ...(bill.status === "paid" && bill.total ? { refundDue: bill.total } : {}),
  };
  const [, tenant, tenancy] = await Promise.all([
    // Archive at once, not only when run.js re-issues it: a bill cancelled and never re-issued must
    // still show up in `?voided=1`. archiveVoid is idempotent, so run.js archiving again is harmless.
    saveBill(voided, { latest }).then(() => archiveVoid(voided)),
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
  await saveBill(next, { latest });

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

// The cancelled bills of a room that were re-issued, newest first. `bill-voids:<room>` lists them as
// "<period>:<rev>"; the index is capped, so this reads a bounded number of keys.
async function voided(res, room, period) {
  const tags = ((await store.get(`bill-voids:${room}`)) || [])
    .filter((t) => typeof t === "string" && /^\d{4}-\d{2}:\d+$/.test(t) && (!period || t.startsWith(`${period}:`)))
    .map((t) => t.split(":"))
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : Number(b[1]) - Number(a[1]))); // period, then rev, newest first
  const records = await mapLimit(tags, HISTORY_READ_CONCURRENCY, ([p, rev]) => store.get(`bill-void:${p}:${room}:${rev}`));
  return res.status(200).json({ room, items: records.filter(Boolean) });
}
