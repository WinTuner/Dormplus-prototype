// Bills live under two keys: `bill:<room>` (the newest, what chat and slips use) and
// `bill:<period>:<room>` (history). `bills:<room>` indexes the periods so history is one read.
// Every write goes through saveBill() so the two copies can never disagree.
const store = require("./_store");

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

async function indexBill(room, period) {
  const key = `bills:${room}`;
  const periods = (await store.get(key)) || [];
  if (periods.includes(period)) return;
  periods.push(period);
  periods.sort().reverse();
  await store.set(key, periods.slice(0, 60));
}

async function saveBill(bill) {
  // The three steps touch different keys, so they run together instead of one after another.
  const [latest] = await Promise.all([
    store.get(`bill:${bill.room}`),
    store.set(`bill:${bill.period}:${bill.room}`, bill),
    indexBill(bill.room, bill.period),
  ]);
  // Never let an older period replace the newest bill.
  if (!latest || !latest.period || bill.period >= latest.period) {
    await store.set(`bill:${bill.room}`, bill);
  }
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

module.exports = { indexBill, saveBill, tenancyOf, visibleToTenant, PERIOD };
