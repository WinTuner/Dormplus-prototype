// Daily reminders for unpaid bills. Called by api/cron.js; takes `today` so tests can pick any date.
const store = require("./_store");
const { push } = require("./_line");
const { ROOMS } = require("./_rooms");
const { mapLimit } = require("./_async");
const { tenancyOf, visibleToTenant } = require("./_bills");

const ROOMS_AT_ONCE = 4;
const PUSH_MAX_MESSAGES = 5; // LINE accepts at most 5 messages in one push
// The index keeps 60 periods; reading all of them for every room each day is wasteful, and a bill
// unpaid for more than a year needs the owner, not a bot.
const OLDER_PERIODS_TO_CHECK = 12;
const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const DAY_MS = 86400000;

const dayNumber = (ymd) => {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};

const markKey = (room, bill, kind) => `reminded:${room}:${bill.period}:${kind}:${bill.rev || 1}`;
const legacyMarkKey = (room, bill, kind) => `reminded:${room}:${bill.period}:${kind}`;

// A window per kind (not the exact day) so a missed cron run still sends it once the next one runs.
function kindFor(daysLeft) {
  if (daysLeft >= 1 && daysLeft <= 3) return "before_3";
  if (daysLeft === 0) return "due_0";
  const late = -daysLeft;
  if (late >= 10) return "after_10";
  if (late >= 5) return "after_5";
  if (late >= 1) return "after_1";
  return null; // more than 3 days away
}

const money = (n) => Number(n).toLocaleString("th-TH");
const periodText = (period) => {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y + 543}`;
};
const dueText = (due) => {
  const [, m, d] = due.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};

function whenText(daysLeft) {
  if (daysLeft > 0) return `อีก ${daysLeft} วัน`;
  return `เลยกำหนดมา ${-daysLeft} วันแล้ว`;
}

function messageFor(bill, daysLeft, baseUrl) {
  const head = `แจ้งเตือน: บิลห้อง ${bill.room} รอบ ${periodText(bill.period)} ยอด ${money(bill.total)} บาท`;
  const text =
    daysLeft === 0
      ? `${head} ครบกำหนดวันนี้ (${dueText(bill.due)})`
      : `${head} ครบกำหนด ${dueText(bill.due)} (${whenText(daysLeft)})`;
  const liffId = process.env.LIFF_ID;
  const link = liffId
    ? `https://liff.line.me/${liffId}?room=${bill.room}`
    : baseUrl
      ? `${baseUrl}/liff/bill.html?room=${bill.room}`
      : null;
  if (!link) return { type: "text", text };
  return {
    type: "flex",
    altText: text,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [{ type: "text", text, wrap: true, size: "sm" }],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#4FD8D2",
            action: { type: "uri", label: "ดูบิล / แนบสลิป", uri: link },
          },
        ],
      },
    },
  };
}

// The latest bill plus older periods that are still unpaid.
async function candidateBills(room) {
  // Independent keys: one round trip, not two.
  const [latest, index] = await Promise.all([store.get(`bill:${room}`), store.get(`bills:${room}`)]);
  const periods = (index || []).filter((p) => !latest || p !== latest.period).slice(0, OLDER_PERIODS_TO_CHECK);
  const older = await mapLimit(periods, 6, (p) => store.get(`bill:${p}:${room}`));
  return [latest, ...older].filter((b) => b && b.status === "unpaid" && b.due && b.period);
}

async function remindRoom(room, today, baseUrl, out) {
  const bills = await candidateBills(room);
  if (!bills.length) return;
  const todayNo = dayNumber(today);

  const windows = bills
    .map((bill) => {
      const daysLeft = dayNumber(bill.due) - todayNo;
      return { bill, daysLeft, kind: kindFor(daysLeft) };
    })
    .filter((w) => w.kind);
  // One read per window, side by side (a loop of awaits made them wait for each other).
  // A mark is per bill revision: a voided bill that is re-issued (rev+1, possibly a new due date)
  // must be reminded again. The revision-less key is still read, so marks written before this
  // deploy keep counting and the first run after it does not repeat everything.
  const sentBefore = await Promise.all(
    windows.map(async (w) => (await store.get(markKey(room, w.bill, w.kind))) || (await store.get(legacyMarkKey(room, w.bill, w.kind))))
  );
  const due = windows.filter((_, i) => !sentBefore[i]);
  if (!due.length) return;

  // Nobody to tell, or the current tenant must not see this bill (it belongs to a previous one).
  const [userId, tenancy] = await Promise.all([store.get(`room-user:${room}`), tenancyOf(room)]);
  if (!userId) return;
  const mine = due.filter(({ bill }) => visibleToTenant(bill, tenancy));

  // One push per room with up to 5 cards instead of one push per card. A failed push marks nothing,
  // so the next run tries those again.
  for (let i = 0; i < mine.length; i += PUSH_MAX_MESSAGES) {
    const batch = mine.slice(i, i + PUSH_MAX_MESSAGES);
    try {
      await push(userId, batch.map(({ bill, daysLeft }) => messageFor(bill, daysLeft, baseUrl)));
    } catch (err) {
      console.error("reminder push failed", room, batch.map((w) => `${w.bill.period}/${w.kind}`).join(","), err.message);
      out.failed += batch.length;
      continue;
    }
    const at = new Date().toISOString();
    await Promise.all(
      batch.map(async ({ bill, kind }) => {
        out.sent.push({ room, period: bill.period, kind });
        // The tenant already has the message. If the mark is lost we only risk a repeat tomorrow,
        // so it must not abort the rest of the room's reminders.
        await store.set(markKey(room, bill, kind), at).catch((err) =>
          console.error("reminder mark failed", room, bill.period, kind, err.message)
        );
      })
    );
  }
}

async function runReminders({ today, baseUrl } = {}) {
  const out = { sent: [], failed: 0 };
  await mapLimit(ROOMS, ROOMS_AT_ONCE, async (room) => {
    try {
      await remindRoom(room, today, baseUrl, out);
    } catch (err) {
      console.error("reminder room failed", room, err.message);
      out.failed++;
    }
  });
  // mapLimit finishes in any order; keep the report stable.
  out.sent.sort((a, b) => a.room.localeCompare(b.room) || a.period.localeCompare(b.period));

  const late = out.sent.filter((s) => s.kind.startsWith("after_"));
  const owner = process.env.OWNER_USER_ID;
  if (late.length && owner) {
    const rooms = [...new Set(late.map((s) => s.room))];
    const text = `สรุปทวงวันนี้: เลยกำหนด ${rooms.length} ห้อง (${rooms.join(", ")}) · ส่งเตือนแล้ว ${late.length} ข้อความ`;
    try {
      await push(owner, [{ type: "text", text }]);
    } catch (err) {
      console.error("reminder summary push failed", err.message);
    }
  }
  return out;
}

module.exports = { runReminders, kindFor };
