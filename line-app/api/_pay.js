// Closing a bill as paid. Shared by the owner's confirm tap (api/webhook.js) and by the automatic
// confirm of a verified slip (api/slip.js), so the receipt is the same whoever closed the bill.
const store = require("./_store");
const { push, receiptBubble, autoPaidBubble } = require("./_line");
const { saveBills, tenancyOf, visibleToTenant, receiptNoOf, tagOverpaid, overpaidOf } = require("./_bills");

const PUSH_MAX_MESSAGES = 5; // LINE accepts at most 5 messages in one push

// The paid copy of a bill. Receipt numbers are derived (see receiptNoOf), never counted. A paid bill
// is final: the only way to change it is to void it and re-issue (POST /api/bill, then /api/run).
// Money paid over the bill is owed back, so the paid bill carries `refundDue` (the owner marks it
// refunded in POST /api/bill; see overpaidOf for which bill of a group slip carries it).
// `userId` is the owner who tapped confirm. `auto` marks a bill the slip check closed by itself:
// nobody tapped, so `confirmedBy` is null and `confirmedVia` says who decided.
const paidCopy = (bill, userId, { auto = false } = {}) => {
  const over = overpaidOf(bill);
  return {
    ...bill,
    status: "paid",
    paidAt: new Date().toISOString(),
    confirmedBy: auto ? null : userId,
    ...(auto && { autoConfirmed: true, confirmedVia: "slipok" }),
    receiptNo: receiptNoOf(bill),
    ...(over > 0 && { refundDue: over, refundReason: "overpaid" }),
  };
};

// Save the paid bills (one write per key) and tag any overpayment so the owner can find the refund.
async function closeBills(room, bills, { latest, userId, auto } = {}) {
  const paid = bills.map((b) => paidCopy(b, userId, { auto }));
  await saveBills(paid, { latest });
  await tagOverpaid(room, paid.filter((b) => b.refundReason === "overpaid"));
  return paid;
}

// Hand the tenant their receipt(s). An old tenant's bill closing must not message whoever lives
// there now. A push error is logged: the bill is already paid and the caller still gets an answer.
// `userId` is whoever confirmed: the owner is not sent a receipt of their own tap when they are
// also the room's tenant. An automatic confirm passes null, so the tenant always gets theirs.
async function sendReceipts(room, paidBills, userId, baseUrl) {
  try {
    // The two reads do not depend on each other.
    const [tenant, tenancy] = await Promise.all([store.get(`room-user:${room}`), tenancyOf(room)]);
    if (!tenant || tenant === userId) return;
    const mine = paidBills.filter((b) => visibleToTenant(b, tenancy));
    for (let i = 0; i < mine.length; i += PUSH_MAX_MESSAGES) {
      const chunk = mine.slice(i, i + PUSH_MAX_MESSAGES);
      // Two owner taps can both read the bill as pending before either writes it (Blob has no
      // compare-and-set), and both would send the receipt. The key names this exact receipt, so LINE
      // drops the second push instead of the tenant getting two.
      // It holds what makes a receipt different (total, number, the slip it closed), so a genuinely
      // different receipt is never dropped as a duplicate. Not `paidAt`: two racing confirms each
      // stamp their own, and the key must be the same for both.
      const retryKey = `receipt:${room}:${tenant}:${chunk
        .map((b) => [b.period, b.rev || 1, b.total, b.receiptNo, b.slipAt].join(":"))
        .join(",")}`;
      try {
        await push(tenant, chunk.map((b) => receiptBubble(b, baseUrl)), { retryKey });
      } catch (err) {
        console.error("receipt push failed", room, err.message);
      }
    }
  } catch (err) {
    // A failed lookup must not turn a payment that is already saved into an error for the caller.
    console.error("receipt send failed", room, err.message);
  }
}

// "ยอดเกิน X บาท — ต้องคืนผู้เช่า" for the owner's answer, one per refund the paid bills carry.
const refundNote = (paidBills) => {
  const owed = paidBills.reduce((n, b) => n + (b.refundReason === "overpaid" ? Number(b.refundDue || 0) : 0), 0);
  return owed > 0 ? ` · ยอดเกิน ${owed.toLocaleString("th-TH")} บาท — ต้องคืนผู้เช่า` : "";
};

// The notice the owner gets instead of the confirm card when the slip check closed the bill.
// A push failure is logged and never reaches the tenant's request. The retry key is built from
// room, periods and slip time, so two requests that race to close the same slip send one notice.
async function notifyAutoPaid(paidBills) {
  const ownerId = process.env.OWNER_USER_ID;
  if (!ownerId || !paidBills.length) return;
  const first = paidBills[0];
  const retryKey = `auto-paid:${first.room}:${paidBills.map((b) => b.period).join(",")}:${first.slipAt}`;
  try {
    await push(ownerId, [autoPaidBubble(paidBills)], { retryKey });
  } catch (err) {
    console.error("owner push failed", first.room, err.message);
  }
}

// Auto-confirm is on unless the dorm switched it off with SLIP_AUTO_CONFIRM=0|off|false.
const autoConfirmOn = () => !["0", "off", "false"].includes(String(process.env.SLIP_AUTO_CONFIRM ?? "").trim().toLowerCase());

module.exports = { paidCopy, closeBills, sendReceipts, refundNote, notifyAutoPaid, autoConfirmOn };
