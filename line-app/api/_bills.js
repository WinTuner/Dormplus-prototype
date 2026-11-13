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
  await store.set(`bill:${bill.period}:${bill.room}`, bill);
  // Never let an older period replace the newest bill.
  const latest = await store.get(`bill:${bill.room}`);
  if (!latest || !latest.period || bill.period >= latest.period) {
    await store.set(`bill:${bill.room}`, bill);
  }
  await indexBill(bill.room, bill.period);
}

module.exports = { indexBill, saveBill, PERIOD };
