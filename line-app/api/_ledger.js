// Money-over-time helpers: what is overdue, and what was received in a month. Everything here is
// computed on the server with the dorm's wall clock (Asia/Bangkok), never the viewer's device.
const store = require("./_store");
const { mapLimit } = require("./_async");

const DAY_MS = 86400000;
// The index keeps 60 periods; the daily reminders and the overdue list look at the latest bill plus
// this many older ones. A bill unpaid for more than a year needs the owner, not another list row.
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

// The latest bill plus the newest `OLDER_PERIODS` other periods of the index, latest first. This is
// the one window the reminders and the overdue list share. `bill:<room>` and the index are
// independent keys, so they are read together; legacy rooms may have only the first.
async function recentBills(room) {
  const [latest, index] = await Promise.all([store.get(`bill:${room}`), store.get(`bills:${room}`)]);
  const periods = (index || []).filter((p) => !latest || p !== latest.period).slice(0, OLDER_PERIODS);
  const older = await mapLimit(periods, READ_CONCURRENCY, (p) => store.get(`bill:${p}:${room}`));
  return [latest, ...older].filter(Boolean);
}

// Bills whose period is `from` or later (and `to` or earlier when given), newest first. Without
// `to` it reads every indexed period from `from` upward, later periods included.
const billsInPeriods = (room, from, to = null) => readBills(room, (p) => p >= from && (!to || p <= to), 60);

// `bill-state:<room>` is a compact copy of each bill — the fields the reminder, overdue and income
// paths actually use — so those paths cost ONE read per room instead of one per period. saveBills()
// keeps it current; a room written before the key existed is rebuilt once by stateBills().
const STATE_MAX = 24;
const stateOf = (b) => ({
  room: b.room || null, period: b.period, status: b.status, total: b.total,
  due: b.due || null, rev: b.rev || 1, issuedAt: b.issuedAt || null,
  paidAt: b.paidAt || null, receiptNo: b.receiptNo || null,
  refundDue: b.refundDue || null, refundedAt: b.refundedAt || null,
});

// A room that already has bills but no `bill-state:` yet (written before the key existed) would
// otherwise start the index with just the new bill, and the older unpaid/paid periods would vanish
// from reminders, `?overdue=1` and `?income=`. That is why the first save of such a room rebuilds it.
async function seedState(room) {
  return (await recentBills(room)).map(stateOf);
}

async function indexState(bills) {
  if (!bills.length) return;
  const key = `bill-state:${bills[0].room}`;
  const current = (await store.get(key)) || (await seedState(bills[0].room));
  const byPeriod = new Map(current.map((s) => [s.period, s]));
  for (const b of bills) byPeriod.set(b.period, stateOf(b));
  const next = [...byPeriod.values()].sort((a, b) => (a.period < b.period ? 1 : -1)).slice(0, STATE_MAX);
  await store.set(key, next);
}

// The compact state, or the bills themselves for a room written before the key existed. Nothing is
// written here on purpose: only saveBills() may create state, so a read cannot freeze a stale list
// in place (a bill written around it would disappear from the answer).
async function stateBills(room) {
  const state = await store.get(`bill-state:${room}`);
  if (state) return state;
  return (await recentBills(room)).map(stateOf);
}

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

module.exports = { OLDER_PERIODS, bangkokToday, bangkokMonth, dayNumber, daysBetween, shiftMonth, recentBills, billsInPeriods, overdueOf, stateOf, indexState, stateBills };
