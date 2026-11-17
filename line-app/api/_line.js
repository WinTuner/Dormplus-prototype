// LINE Messaging API helpers.
const crypto = require("crypto");

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const SECRET = process.env.LINE_CHANNEL_SECRET;
const LIFF_ID = process.env.LIFF_ID;

function verify(rawBody, signature) {
  if (!SECRET || typeof signature !== "string") return false;
  const expected = Buffer.from(crypto.createHmac("sha256", SECRET).update(rawBody).digest("base64"));
  const given = Buffer.from(signature);
  // Constant-time compare, so the response time says nothing about how much of a forgery matched.
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// LINE wants the retry key to be a UUID. A fixed string such as "receipt:201:Uabc:2026-11:1" is
// hashed into one, so the same event always maps to the same key and two racing requests collide.
function retryKeyOf(text) {
  const h = Buffer.from(crypto.createHash("sha256").update(String(text)).digest()).subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x40; // version 4
  h[8] = (h[8] & 0x3f) | 0x80; // RFC 4122 variant
  const x = h.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

async function call(path, body, { retryKey } = {}) {
  const res = await fetch(`https://api.line.me/v2/bot/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(retryKey ? { "X-Line-Retry-Key": retryKeyOf(retryKey) } : {}),
    },
    body: JSON.stringify(body),
  });
  // With a retry key, 409 means LINE already accepted this exact push in the last 24h: the tenant
  // has the message, so a racing second request must count as done, not as a failure to retry.
  if (retryKey && res.status === 409) return { duplicate: true };
  if (!res.ok) throw new Error(`line ${path} ${res.status}: ${await res.text()}`);
  return res.status === 200 ? res.json().catch(() => ({})) : {};
}

const reply = (replyToken, messages) => call("message/reply", { replyToken, messages });

// `retryKey` makes the push idempotent: Blob has no compare-and-set, so two concurrent requests can
// both decide to send the same card, and LINE drops the second one.
const push = (to, messages, { retryKey } = {}) => call("message/push", { to, messages }, { retryKey });

// Per-user rich menu: the owner sees the meter menu, tenants see the bill menu.
async function linkRichMenu(userId, richMenuId) {
  const res = await fetch(`https://api.line.me/v2/bot/user/${userId}/richmenu/${richMenuId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`richmenu link ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Back to the OA's default menu (the tenant one), e.g. after an owner's access is removed.
async function unlinkRichMenu(userId) {
  const res = await fetch(`https://api.line.me/v2/bot/user/${userId}/richmenu`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`richmenu unlink ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// A friend's LINE display name, or null when LINE will not say (blocked the OA, never added it).
async function displayName(userId) {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) return null;
    return (await res.json()).displayName || null;
  } catch {
    return null;
  }
}

// Card palette, shared by every bubble below: ink for text and for the primary button, teal only as
// a small accent, a hairline for structure. Teal text on white was ~1.7:1 — unreadable on a phone.
const CARD = {
  ink: "#111827",
  muted: "#6B7280",
  hair: "#E5E7EB",
  teal: "#4FD8D2",
  onTeal: "#062B29",
  warnBg: "#FFFBEB",
  warn: "#B45309",
  badBg: "#FEF2F2",
  bad: "#B91C1C",
};

// A small period / count chip. Teal carries the brand without ever being the text colour.
const chip = (text) => ({
  type: "box",
  layout: "vertical",
  backgroundColor: CARD.teal,
  cornerRadius: "md",
  paddingStart: "8px",
  paddingEnd: "8px",
  paddingTop: "2px",
  paddingBottom: "2px",
  flex: 0,
  contents: [{ type: "text", text, size: "xxs", weight: "bold", color: CARD.onTeal }],
});

const rule = () => ({ type: "box", layout: "vertical", height: "1px", backgroundColor: CARD.hair, margin: "sm", contents: [] });

// One fee line: label left, number right, so the three numbers line up in a column.
const feeRow = (label, value) => ({
  type: "box",
  layout: "horizontal",
  contents: [
    { type: "text", text: label, size: "sm", color: CARD.muted, flex: 1 },
    { type: "text", text: value, size: "sm", color: CARD.ink, align: "end", flex: 0 },
  ],
});

// The number the reader looks for first: ink, large, with a quiet unit beside it.
const bigAmount = (value) => ({
  type: "box",
  layout: "baseline",
  spacing: "sm",
  contents: [
    { type: "text", text: value, size: "3xl", weight: "bold", color: CARD.ink, flex: 0 },
    { type: "text", text: "บาท", size: "sm", color: CARD.muted, flex: 0 },
  ],
});

// A warning the owner must act on. A tinted block with a label reads as a finding; red text alone
// reads as noise.
const noteBox = (title, text, tone) => {
  const warn = tone !== "bad";
  return {
    type: "box",
    layout: "vertical",
    margin: "md",
    cornerRadius: "md",
    paddingAll: "10px",
    spacing: "xs",
    backgroundColor: warn ? CARD.warnBg : CARD.badBg,
    contents: [
      { type: "text", text: title, size: "xxs", weight: "bold", color: warn ? CARD.warn : CARD.bad },
      { type: "text", text, size: "xs", color: warn ? CARD.warn : CARD.bad, wrap: true },
    ],
  };
};

// The bill as a Flex card: amount, due date, and a button that opens the LIFF page.
function billBubble(bill, baseUrl) {
  const money = (n) => Number(n || 0).toLocaleString("th-TH");
  const liff = LIFF_ID
    ? `https://liff.line.me/${LIFF_ID}?room=${bill.room}`
    : `${baseUrl}/liff/bill.html?room=${bill.room}`;

  return {
    type: "flex",
    altText: `ใบแจ้งหนี้ ห้อง ${bill.room} · ${money(bill.total)} บาท`,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: `ห้อง ${bill.room}`, weight: "bold", size: "md", color: CARD.ink, flex: 1 },
              chip(bill.period),
            ],
          },
          bigAmount(money(bill.total)),
          rule(),
          feeRow("ค่าเช่า", money(bill.rent)),
          feeRow("ค่าน้ำ", money(bill.water)),
          feeRow("ค่าไฟ", money(bill.elec)),
          // A bill issued without a due date has no due line (it used to print "ครบกำหนด null").
          ...(bill.due
            ? [{
                type: "box",
                layout: "horizontal",
                margin: "md",
                cornerRadius: "md",
                paddingStart: "10px",
                paddingEnd: "10px",
                paddingTop: "8px",
                paddingBottom: "8px",
                backgroundColor: CARD.warnBg,
                contents: [
                  { type: "text", text: `ครบกำหนด ${bill.due}`, size: "xs", weight: "bold", color: CARD.warn },
                ],
              }]
            : []),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: CARD.ink,
            action: { type: "uri", label: "ดูบิล / แนบสลิป", uri: liff },
          },
        ],
      },
    },
  };
}

// Owner's card: asks to confirm the slip the tenant attached.
// A bill that carries a multi-period `slipGroup` (one slip paying several months) gets one card for
// the whole group: the periods and the summed total, and a postback that names all of them.
function confirmBubble(bill) {
  const money = (n) => Number(n || 0).toLocaleString("th-TH");
  // What the owner must still do about the AMOUNT on the slip. Over/short is known from the bill's
  // amount fields; with no amount read (SlipOK off, unverifiable) nothing was compared, and the
  // card must say so instead of looking like a clean check.
  const amountNote = (() => {
    if (bill.overpaid > 0) return { title: "ยอดเกินบิล", text: `ยอดในสลิปเกินบิล ${money(bill.overpaid)} บาท — ต้องคืนผู้เช่า`, tone: "warn" };
    if (bill.shortBy > 0) return { title: "ยอดขาด", text: `ยอดในสลิปขาด ${money(bill.shortBy)} บาท`, tone: "bad" };
    if (!bill.slipPath || bill.slipVerify?.ok === true || bill.slipAmount != null) return null;
    if (bill.slipVerify?.ok === false && bill.slipVerify.reason) return { title: "สลิปไม่ผ่านการตรวจ", text: bill.slipVerify.reason, tone: "bad" };
    return { title: "ยังไม่ได้ตรวจ", text: "ยังไม่ได้ตรวจยอดในสลิป — เทียบยอดเงินเข้าเอง", tone: "warn" };
  })();
  const group = bill.slipGroup?.periods?.length > 1 ? bill.slipGroup : null;
  const total = group ? group.total : bill.total;
  const postback = group
    ? { action: "confirm", room: bill.room, periods: group.periods.join(",") }
    // The period pins the card to this bill: an old card cannot close a newer one.
    : { action: "confirm", room: bill.room, period: bill.period };
  return {
    type: "flex",
    altText: `แจ้งชำระ ห้อง ${bill.room} · ${money(total)} บาท${group ? ` (${group.periods.length} งวด)` : ""}`,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: `ห้อง ${bill.room} แจ้งชำระ`, weight: "bold", size: "md", color: CARD.ink, flex: 1, wrap: true },
              ...(group ? [chip(`${group.periods.length} งวด`)] : []),
            ],
          },
          bigAmount(money(total)),
          { type: "text", text: group ? `รอบ ${group.periods.join(", ")}` : `รอบ ${bill.period}`, size: "xs", color: CARD.muted, wrap: true },
          // No photo means nothing to look at: the owner must check the bank account before confirming.
          ...(bill.slipPath ? [] : [noteBox("ไม่มีรูปสลิป", "ตรวจยอดเงินเข้าเองก่อนยืนยัน", "warn")]),
          ...(amountNote ? [noteBox(amountNote.title, amountNote.text, amountNote.tone)] : []),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: CARD.ink,
            action: {
              type: "postback",
              label: "ยืนยันการชำระ",
              data: new URLSearchParams(postback).toString(),
              displayText: "ยืนยันการชำระ",
            },
          },
          ...(LIFF_ID && bill.slipPath
            ? [
                {
                  type: "button",
                  style: "link",
                  color: CARD.muted,
                  action: { type: "uri", label: "ดูสลิป", uri: `https://liff.line.me/${LIFF_ID}` },
                },
              ]
            : []),
        ],
      },
    },
  };
}

// The short notice the owner gets when the slip check closed the bill by itself: nothing to decide,
// so no confirm or reject button. "ดูสลิป" opens the slip in the LIFF like the confirm card does.
// `bills` is every bill the one slip closed (several for a multi-month slip).
function autoPaidBubble(bills) {
  const money = (n) => Number(n || 0).toLocaleString("th-TH");
  const first = bills[0];
  const total = bills.reduce((n, b) => n + Number(b.total || 0), 0);
  const periods = bills.map((b) => b.period).join(", ");
  const text = `ห้อง ${first.room} ชำระแล้ว ${money(total)} บาท (ตรวจสลิปอัตโนมัติ)`;
  return {
    type: "flex",
    altText: text,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text, weight: "bold", size: "md", wrap: true },
          { type: "text", text: `รอบ ${periods}`, size: "xs", color: "#8B9AAB", wrap: true },
          { type: "text", text: "ถ้าไม่ใช่ ให้ยกเลิกบิล", size: "xs", color: "#8B9AAB", wrap: true },
        ],
      },
      ...(LIFF_ID && first.slipPath
        ? {
            footer: {
              type: "box",
              layout: "vertical",
              contents: [
                { type: "button", style: "secondary", action: { type: "uri", label: "ดูสลิป", uri: `https://liff.line.me/${LIFF_ID}` } },
              ],
            },
          }
        : {}),
    },
  };
}

// The receipt the tenant gets when the owner confirms a payment. Its button opens the LIFF receipt
// screen: the page routes by hash, but LIFF can drop a fragment on login, so the period also rides
// in the query (`receipt=`) and the page rebuilds the route from it.
function receiptBubble(bill, baseUrl) {
  const money = (n) => Number(n || 0).toLocaleString("th-TH");
  const tail = `room=${bill.room}&receipt=${bill.period}#receipt/${bill.period}`;
  const uri = LIFF_ID ? `https://liff.line.me/${LIFF_ID}?${tail}` : `${baseUrl}/liff/bill.html?${tail}`;
  const paidOn = bill.paidAt
    ? new Date(bill.paidAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" })
    : "-";
  const line = (label, value, bold) => ({
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: label, size: "sm", color: bold ? "#111111" : "#555555", weight: bold ? "bold" : "regular", flex: 3 },
      { type: "text", text: value, size: "sm", align: "end", weight: bold ? "bold" : "regular", flex: 2 },
    ],
  });

  return {
    type: "flex",
    altText: `ใบเสร็จรับเงิน ห้อง ${bill.room} · ${money(bill.total)} บาท`,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "ใบเสร็จรับเงิน", weight: "bold", size: "md" },
          ...(bill.receiptNo ? [{ type: "text", text: `เลขที่ ${bill.receiptNo}`, size: "xs", color: "#8B9AAB" }] : []),
          { type: "text", text: `ห้อง ${bill.room} · รอบ ${bill.period}`, size: "sm" },
          { type: "separator" },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
              line("ค่าเช่า", money(bill.rent)),
              line("ค่าน้ำ", money(bill.water)),
              line("ค่าไฟ", money(bill.elec)),
              line("รวม (บาท)", money(bill.total), true),
            ],
          },
          { type: "text", text: `ชำระเมื่อ ${paidOn}`, size: "xs", color: "#8B9AAB" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "button", style: "primary", color: "#4FD8D2", action: { type: "uri", label: "ดูใบเสร็จ", uri } },
        ],
      },
    },
  };
}

module.exports = { verify, reply, push, retryKeyOf, linkRichMenu, unlinkRichMenu, displayName, billBubble, confirmBubble, autoPaidBubble, receiptBubble, LIFF_ID };
