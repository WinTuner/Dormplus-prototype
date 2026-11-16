// Bills live under two keys: `bill:<room>` (the newest, what chat and slips use) and
// `bill:<period>:<room>` (history). `bills:<room>` indexes the periods so history is one read.
// Every write goes through saveBill()/saveBills() so the two copies can never disagree.
const store = require("./_store");
const { checkAmount, amountFields } = require("./_verify");
const ledger = require("./_ledger");

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

// Adds periods to `bills:<room>` with one read and at most one write.
async function indexBills(room, newPeriods) {
  const key = `bills:${room}`;
  const periods = (await store.get(key)) || [];
  const fresh = newPeriods.filter((p) => !periods.includes(p));
  if (!fresh.length) return;
  periods.push(...fresh);
  periods.sort().reverse();
  await store.set(key, periods.slice(0, 60));
}

const indexBill = (room, period) => indexBills(room, [period]);

// Saves bills of ONE room together: the per-period copies and the index are written side by side,
// and `bill:<room>` is touched once, with the newest of them. A caller that has just read
// `bill:<room>` passes it as `latest` (null when there is none) so it is not fetched again; that
// saves one round trip on every slip, confirmation and void.
async function saveBills(bills, { latest } = {}) {
  if (!bills.length) return;
  const room = bills[0].room;
  const newest = bills.reduce((a, b) => (b.period > a.period ? b : a));
  const [seen] = await Promise.all([
    latest === undefined ? store.get(`bill:${room}`) : latest,
    ...bills.map((b) => store.set(`bill:${b.period}:${room}`, b)),
    indexBills(room, bills.map((b) => b.period)),
    // The compact state other paths read instead of one key per period (see `_ledger.stateBills`).
    ledger.indexState(bills),
  ]);
  // Never let an older period replace the newest bill.
  if (!seen || !seen.period || newest.period >= seen.period) {
    await store.set(`bill:${room}`, newest);
  }
}

const saveBill = (bill, opts) => saveBills([bill], opts);

// A void bill that is about to be re-issued is archived first: `bill-void:<period>:<room>:<rev>`
// keeps the record exactly as it was (reason, receipt number, slip) and `bill-voids:<room>` lists
// the `<period>:<rev>` pairs so the owner can read them back (GET /api/bill?voided=1).
const VOID_INDEX_MAX = 200;
async function archiveVoid(bill) {
  const rev = bill.rev || 1;
  const tag = `${bill.period}:${rev}`;
  const indexKey = `bill-voids:${bill.room}`;
  await Promise.all([
    store.set(`bill-void:${bill.period}:${bill.room}:${rev}`, bill),
    (async () => {
      const tags = (await store.get(indexKey)) || [];
      if (!tags.includes(tag)) await store.set(indexKey, [...tags, tag].slice(-VOID_INDEX_MAX));
    })(),
  ]);
}

// A new tenant must not read the previous tenant's bills. `tenancy:<room>` = { since: ISO } is
// written when a tenant leaves the room (see api/qr.js); a bill is the current tenant's only if it
// was issued at or after that moment. No record = the room was never reset since this was added:
// show everything as before, so existing tenants keep their history. Every tenant change from
// now on writes the record, so the gap only exists for rooms nobody has changed yet.
const tenancyOf = (room) => store.get(`tenancy:${room}`);

// A bill without `issuedAt` was written before this field existed, so it is older than any tenancy.
function visibleToTenant(bill, tenancy) {
  if (!tenancy || !tenancy.since) return true;
  return !!bill && !!bill.issuedAt && bill.issuedAt >= tenancy.since;
}

// Receipt number: R<yyyymm>-<room>, plus -<rev> from the second issue of a period on. It is derived
// from the bill on purpose: Blob has no transactions, so a shared counter could hand the same
// number to two receipts. One bill per room per period makes this unique, and `rev` only grows
// when a voided bill is re-issued (api/run.js), which is why the re-issued receipt differs.
function receiptNoOf(bill) {
  const rev = Number(bill.rev) > 1 ? `-${bill.rev}` : "";
  return `R${String(bill.period).replace("-", "")}-${bill.room}${rev}`;
}

// The bill with an advance slip (`prepay:<room>`) attached: it starts `pending`. Both /api/run and
// /api/slip can attach the same slip when they race (see saveAdvance), so this must give the same
// content whoever builds it; the owner's card is deduped by its retry key.
// The advance slip had no bill to be compared with when it was sent, so its amount is checked
// against the bill's total here (the transfer-before-issue rule is NOT applied: an advance slip is
// meant to be older than the bill).
// The bill with the amount facts of a check (`checkAmount`) on it; facts from an earlier slip go.
function withAmounts(bill, check) {
  const { slipAmount, overpaid, shortBy, ...rest } = bill;
  return { ...rest, ...amountFields(check) };
}

function prepaidCopy(bill, prepay) {
  const check = checkAmount(prepay.slipVerify || null, bill.total);
  return withAmounts({
    ...bill,
    status: "pending",
    slipPath: prepay.slipPath || null,
    slipNote: prepay.slipNote || null,
    slipAt: prepay.slipAt,
    slipCount: prepay.slipCount || 1,
    slipVerify: check.verify,
    prepaid: true,
  }, check);
}

// One owner card per attached slip, however many requests attach it. The key holds what makes the
// message different (the total can change when a bill is re-issued while the slip waits), so a
// genuinely different card is never dropped by LINE as a duplicate.
const confirmKey = (bill) => `confirm:${bill.room}:${bill.period}:${bill.total}:${bill.slipAt}`;

// Money the tenant paid over the bill is owed back (policy: no credit to the next bill). The paid
// bill carries `refundDue`; `overpaid:<room>` lists the `<period>:<rev>` tags so the owner can read
// them back (GET /api/bill?overpaid=1), like `bill-voids:<room>` does for void bills.
const OVERPAID_INDEX_MAX = 200;
async function tagOverpaid(room, bills) {
  const fresh = bills.map((b) => `${b.period}:${b.rev || 1}`);
  if (!fresh.length) return;
  const key = `overpaid:${room}`;
  const tags = (await store.get(key)) || [];
  const add = fresh.filter((t) => !tags.includes(t));
  if (add.length) await store.set(key, [...tags, ...add].slice(-OVERPAID_INDEX_MAX));
}

// The overpayment this bill must carry once it is paid. A group slip is one transfer, so its extra
// goes on the group's NEWEST period only (and only when that bill is the one being closed).
function overpaidOf(bill) {
  const group = bill.slipGroup;
  if (group && group.periods?.length) {
    return bill.period === group.periods[group.periods.length - 1] && group.overpaid > 0 ? group.overpaid : 0;
  }
  return bill.overpaid > 0 ? bill.overpaid : 0;
}

module.exports = { prepaidCopy, withAmounts, confirmKey, tagOverpaid, overpaidOf, indexBill, indexBills, saveBill, saveBills, archiveVoid, tenancyOf, visibleToTenant, receiptNoOf, PERIOD };
