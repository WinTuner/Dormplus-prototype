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

async function call(path, body) {
  const res = await fetch(`https://api.line.me/v2/bot/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`line ${path} ${res.status}: ${await res.text()}`);
  return res.status === 200 ? res.json().catch(() => ({})) : {};
}

const reply = (replyToken, messages) => call("message/reply", { replyToken, messages });

const push = (to, messages) => call("message/push", { to, messages });

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
        spacing: "md",
        contents: [
          { type: "text", text: `ห้อง ${bill.room}`, weight: "bold", size: "md" },
          { type: "text", text: `${bill.period}`, size: "xs", color: "#8B9AAB" },
          { type: "text", text: `${money(bill.total)} บาท`, weight: "bold", size: "xxl", color: "#4FD8D2" },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
              { type: "text", text: `ค่าเช่า ${money(bill.rent)}`, size: "sm", color: "#555555" },
              { type: "text", text: `ค่าน้ำ ${money(bill.water)}`, size: "sm", color: "#555555" },
              { type: "text", text: `ค่าไฟ ${money(bill.elec)}`, size: "sm", color: "#555555" },
            ],
          },
          // A bill issued without a due date has no due line (it used to print "ครบกำหนด null").
          ...(bill.due ? [{ type: "text", text: `ครบกำหนด ${bill.due}`, size: "xs", color: "#F59E0B" }] : []),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#4FD8D2",
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
        spacing: "md",
        contents: [
          { type: "text", text: `ห้อง ${bill.room} แจ้งชำระ${group ? ` ${group.periods.length} งวด` : ""}`, weight: "bold", size: "md" },
          { type: "text", text: `${money(total)} บาท`, weight: "bold", size: "xxl", color: "#4FD8D2" },
          { type: "text", text: group ? `รอบ ${group.periods.join(", ")}` : `รอบ ${bill.period}`, size: "xs", color: "#8B9AAB", wrap: true },
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
            color: "#4FD8D2",
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
                  style: "secondary",
                  action: { type: "uri", label: "ดูสลิป", uri: `https://liff.line.me/${LIFF_ID}` },
                },
              ]
            : []),
        ],
      },
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

module.exports = { verify, reply, push, linkRichMenu, unlinkRichMenu, displayName, billBubble, confirmBubble, receiptBubble, LIFF_ID };
