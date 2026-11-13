// POST /api/webhook — LINE Messaging API webhook.
const { verify, reply, push, billBubble } = require("./_line");
const store = require("./_store");
const { isOwner } = require("./_auth");
const { saveBill } = require("./_bills");

async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });

  const raw = await readRaw(req);
  const signature = req.headers["x-line-signature"];
  if (!verify(raw, signature)) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "bad signature" } });

  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: { code: "VALIDATION", message: "invalid json" } });
  }

  const baseUrl = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;

  // LINE needs a fast 200; handle errors per-event so one failure does not block the rest.
  await Promise.all(
    (body.events || []).map(async (event) => {
      try {
        await handleEvent(event, baseUrl);
      } catch (err) {
        console.error("event failed", event.type, err.message);
      }
    })
  );

  return res.status(200).json({ ok: true });
};

async function handleEvent(event, baseUrl) {
  const userId = event.source?.userId;

  if (event.type === "follow" && userId) {
    await store.set(`user:${userId}`, { followedAt: Date.now() });
    return reply(event.replyToken, [
      {
        type: "text",
        text: "สวัสดีครับ 👋\nระบบบิลของหอพัก\n\nสแกน QR หน้าห้องเพื่อผูกห้อง แล้วพิมพ์ “บิล” เพื่อดูใบแจ้งหนี้",
      },
    ]);
  }

  if (event.type === "message" && event.message.type === "text") {
    const text = event.message.text.trim();

    if (text === "บิล" || text.toLowerCase() === "bill") {
      const room = await store.get(`user-room:${userId}`);
      if (!room) {
        return reply(event.replyToken, [
          { type: "text", text: "ยังไม่ได้ผูกห้องครับ — สแกน QR หน้าห้องที่เจ้าของหอให้มา" },
        ]);
      }
      const bill = await store.get(`bill:${room}`);
      if (!bill) {
        return reply(event.replyToken, [{ type: "text", text: `ห้อง ${room} ยังไม่มีบิลรอบนี้ครับ` }]);
      }
      return reply(event.replyToken, [billBubble(bill, baseUrl)]);
    }
  }

  // postback from the "ยืนยันการชำระ" button in the owner card
  if (event.type === "postback") {
    const data = new URLSearchParams(event.postback.data);
    if (data.get("action") === "confirm") {
      // Only the owner may close a bill: anyone holding the card (or forging the postback) is refused.
      if (!await isOwner(userId)) {
        return reply(event.replyToken, [{ type: "text", text: "เฉพาะเจ้าของหอกดยืนยันได้ครับ" }]);
      }
      const room = data.get("room");
      // Cards carry the period, so they close exactly the bill they were sent for. A card minted
      // before that change cannot name its bill: refusing it is the only safe answer, because the
      // newest bill may be another month's (and may be waiting for a slip of its own).
      const period = data.get("period");
      if (!period) {
        return reply(event.replyToken, [
          {
            type: "text",
            text: `การ์ดนี้ไม่ระบุรอบบิล จึงยืนยันไม่ได้ครับ — ให้ผู้เช่ากด “ส่งสลิปใหม่” เพื่อรับการ์ดใบใหม่`,
          },
        ]);
      }
      const bill = await store.get(`bill:${period}:${room}`);
      if (!bill) return reply(event.replyToken, [{ type: "text", text: `ไม่พบบิลห้อง ${room} ครับ` }]);
      if (bill.status === "paid") {
        return reply(event.replyToken, [{ type: "text", text: `ห้อง ${room} รอบ ${bill.period} ยืนยันไปแล้วครับ` }]);
      }
      // Only a bill with a slip waiting can be confirmed; an unpaid one has nothing to confirm.
      if (bill.status !== "pending") {
        return reply(event.replyToken, [
          { type: "text", text: `ห้อง ${room} รอบ ${bill.period} ยังไม่ได้แจ้งชำระ ยืนยันไม่ได้ครับ` },
        ]);
      }

      await saveBill({ ...bill, status: "paid", paidAt: new Date().toISOString(), confirmedBy: userId });

      const tenant = await store.get(`room-user:${room}`);
      if (tenant && tenant !== userId) {
        await push(tenant, [{ type: "text", text: `ห้อง ${room} ชำระเงินแล้ว ✅ เจ้าของหอยืนยันเรียบร้อย` }]);
      }
      return reply(event.replyToken, [{ type: "text", text: `ยืนยันห้อง ${room} แล้ว ✅` }]);
    }
  }
}

module.exports.push = push;
