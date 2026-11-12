// LINE Messaging API helpers.
const crypto = require("crypto");

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const SECRET = process.env.LINE_CHANNEL_SECRET;
const LIFF_ID = process.env.LIFF_ID;

function verify(rawBody, signature) {
  if (!SECRET) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(rawBody).digest("base64");
  return expected === signature;
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

// The bill as a Flex card: amount, due date, and a button that opens the LIFF page.
function billBubble(bill, baseUrl) {
  const money = (n) => n.toLocaleString("th-TH");
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
          { type: "text", text: `ครบกำหนด ${bill.due}`, size: "xs", color: "#F59E0B" },
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
function confirmBubble(bill) {
  const money = (n) => n.toLocaleString("th-TH");
  return {
    type: "flex",
    altText: `แจ้งชำระ ห้อง ${bill.room} · ${money(bill.total)} บาท`,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: `ห้อง ${bill.room} แจ้งชำระ`, weight: "bold", size: "md" },
          { type: "text", text: `${money(bill.total)} บาท`, weight: "bold", size: "xxl", color: "#4FD8D2" },
          { type: "text", text: `รอบ ${bill.period}`, size: "xs", color: "#8B9AAB" },
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
              data: `action=confirm&room=${bill.room}`,
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

module.exports = { verify, reply, push, linkRichMenu, billBubble, confirmBubble, LIFF_ID };
