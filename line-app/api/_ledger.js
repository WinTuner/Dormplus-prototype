// Money-over-time helpers: what is overdue, and what was received in a month. Everything here is
// computed on the server with the dorm's wall clock (Asia/Bangkok), never the viewer's device.
const store = require("./_store");
const { mapLimit } = require("./_async");

const DAY_MS = 86400000;
// Same bound as the daily reminders: the index keeps 60 periods, but a bill unpaid for more than a
// year needs the owner, not another list row.
const OLDER_PERIODS = 12;
const READ_CONCURRENCY = 6;
const TZ = "Asia/Bangkok";

// YYYY-MM-DD on the dorm's wall clock, not the server's UTC one.
const bangkokToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);

// YYYY-MM of an ISO timestamp in Bangkok time: 2026-10-31T17:30:00Z is already 1 November there.
// null for anything that is not a date, so a bad `paidAt` never counts in a month.
function bangkokMonth(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : bangkokToday(new Date(t)).slice(0, 7);
}

const dayNumber = (ymd) => {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};

// Whole days from one calendar date to another. UTC day numbers, so no DST or timezone drift.
const daysBetween = (fromYmd, toYmd) => dayNumber(toYmd) - dayNumber(fromYmd);

// "2026-11" shifted by `delta` months, e.g. (-12) -> "2025-11".
function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const n = y * 12 + (m - 1) + delta;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
}

// Reads the bills of ONE room whose period passes `keep`, newest first. `bill:<room>` and the index
// are independent keys, so they are read together; legacy rooms may have only the first.
async function readBills(room, keep, limit) {
  const [latest, index] = await Promise.all([store.get(`bill:${room}`), store.get(`bills:${room}`)]);
  const periods = new Set((index || []).filter(keep));
  if (latest && latest.period && keep(latest.period)) periods.add(latest.period);
  const wanted = [...periods].sort().reverse().slice(0, limit);
  const bills = await mapLimit(wanted, READ_CONCURRENCY, async (p) => {
    const stored = await store.get(`bill:${p}:${room}`);
    return stored || (latest && latest.period === p ? latest : null);
  });
  return bills.filter(Boolean);
}

// The latest bill plus up to 12 older periods, newest first (the window the reminders use).
const recentBills = (room) => readBills(room, () => true, OLDER_PERIODS + 1);

// Bills whose period falls in [from, to], newest first.
const billsInPeriods = (room, from, to) => readBills(room, (p) => p >= from && p <= to, 60);

// Unpaid bills that are past their due date. A bill due today is not overdue yet; `pending` is
// waiting for the owner, `void` is cancelled, and a bill with no due date cannot be late.
function overdueOf(bills, today) {
  const items = bills
    .filter((b) => b && b.status === "unpaid" && b.due && b.due < today)
    .map((b) => ({ period: b.period, total: b.total, due: b.due, daysOverdue: daysBetween(b.due, today) }))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.period < b.period ? -1 : 1));
  return {
    count: items.length,
    total: items.reduce((s, i) => s + (Number(i.total) || 0), 0),
    maxDaysOverdue: items.reduce((m, i) => Math.max(m, i.daysOverdue), 0),
    items,
  };
}

module.exports = { bangkokToday, bangkokMonth, daysBetween, shiftMonth, recentBills, billsInPeriods, overdueOf };
