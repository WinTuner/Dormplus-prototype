// Keeps `bills:<room>` — the list of periods with a stored bill — so history is one read, not a scan.
const store = require("./_store");

async function indexBill(room, period) {
  const key = `bills:${room}`;
  const periods = (await store.get(key)) || [];
  if (periods.includes(period)) return;
  periods.push(period);
  periods.sort().reverse();
  await store.set(key, periods.slice(0, 60));
}

module.exports = { indexBill };
