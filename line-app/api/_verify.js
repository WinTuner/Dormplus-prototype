// Slip verification through SlipOK — one branch per dorm (docs: slipok.com/api-documentation).
//
// `log: true` is not optional. Without it SlipOK only reads the slip: it does not check the
// receiving account bound to the branch, and it does not remember the slip for duplicate
// detection. Sending it is the difference between "the slip says 3,500" and "3,500 reached your
// account and this slip was never used before".
//
// The result is evidence for the owner, never a payment: the caller keeps the bill `pending`.
const TIMEOUT_MS = 10_000;

// "Cannot tell" is not "fake". A bank outage, a slip too new to query, an unreadable photo or a
// slip older than the bank keeps would all be libellous to show as a fake slip.
const UNVERIFIABLE = {
  1006: "อ่านรูปสลิปไม่ได้",
  1007: "ไม่พบ QR บนสลิป",
  1009: "ธนาคารขัดข้องชั่วคราว — ลองอีกครั้งใน 15 นาที",
  1010: "สลิปใหม่เกินไป — รอสักครู่แล้วตรวจอีกครั้ง",
  1011: "QR หมดอายุหรือไม่มีรายการนี้อยู่จริง",
};

const BASE = { provider: "slipok" };

function endpoint(branch) {
  return `https://api.slipok.com/api/line/apikey/${encodeURIComponent(branch)}`;
}

async function askSlipok({ bytes, mime, amount }) {
  const key = process.env.SLIPOK_API_KEY;
  const branch = process.env.SLIPOK_BRANCH_ID;
  if (!key || !branch) return null;

  const form = new FormData();
  form.append("files", new Blob([bytes], { type: mime }), "slip");
  form.append("log", "true");
  if (Number.isFinite(Number(amount))) form.append("amount", String(amount));

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(branch), {
      method: "POST",
      headers: { "x-authorization": key },
      body: form,
      signal: abort.signal,
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

// -> { ok: true|false|null, reason?, amount?, transRef?, paidAt?, bank?, provider }
async function verifySlip({ bytes, mime, amount }) {
  let answer;
  try {
    answer = await askSlipok({ bytes, mime, amount });
  } catch (err) {
    // A dead provider must never cost the tenant the slip they already sent.
    console.error("slip verify failed", err.message);
    return { ...BASE, ok: null, reason: "ตรวจไม่ได้ (ผู้ให้บริการไม่ตอบ)" };
  }
  if (!answer) return { ...BASE, ok: null, reason: "not_configured" };

  const { status, body } = answer;
  const data = body && body.data;
  if (status !== 200 || !data || data.success === false) {
    const code = Number((body && (body.code || (body.error && body.error.code))) || 0);
    if (UNVERIFIABLE[code]) return { ...BASE, ok: null, reason: UNVERIFIABLE[code], code };
    if (code === 1012) return { ...BASE, ok: false, reason: "สลิปนี้ถูกใช้ไปแล้ว (สลิปซ้ำ)", code };
    if (code === 1013) return { ...BASE, ok: false, reason: "ยอดในสลิปไม่ตรงกับบิล", code };
    if (code === 1014) return { ...BASE, ok: false, reason: "บัญชีผู้รับไม่ใช่บัญชีของหอ", code };
    return { ...BASE, ok: null, reason: `ตรวจไม่ได้ (${code || `HTTP ${status}`})`, code: code || null };
  }

  const paid = Number(data.amount);
  // We already send `amount`, so a mismatch normally comes back as 1013; check anyway, because a
  // wrong total is the one failure that must never pass as verified.
  if (Number.isFinite(paid) && Number.isFinite(Number(amount)) && paid !== Number(amount)) {
    return { ...BASE, ok: false, reason: "ยอดในสลิปไม่ตรงกับบิล", amount: paid };
  }
  return {
    ...BASE,
    ok: true,
    amount: Number.isFinite(paid) ? paid : null,
    transRef: data.transRef || null,
    paidAt: data.transTimestamp || null,
    bank: data.receivingBank || null,
  };
}

module.exports = { verifySlip };
