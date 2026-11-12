// POST /api/webhook — LINE Messaging API webhook.
const { verify, reply, push, billBubble } = require("./_line");
const store = require("./_store");

async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const raw = await readRaw(req);
  const signature = req.headers["x-line-signature"];
  if (!verify(raw, signature)) return res.status(401).json({ error: "bad signature" });

  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "invalid json" });
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
        text: "สวัสดีครับ 👋\nระบบบิลของหอพัก\n\nพิมพ์ “บิล” เพื่อดูใบแจ้งหนี้ของห้องคุณ",
      },
    ]);
  }

  if (event.type === "message" && event.message.type === "text") {
    const text = event.message.text.trim();

    if (text === "บิล" || text.toLowerCase() === "bill") {
      const room = await store.get(`user-room:${userId}`);
      if (!room) {
        return reply(event.replyToken, [
          { type: "text", text: "ยังไม่ได้ผูกห้องครับ — สแกน QR หน้าห้องหรือพิมพ์ “ผูก 203”" },
        ]);
      }
      const bill = await store.get(`bill:${room}`);
      if (!bill) {
        return reply(event.replyToken, [{ type: "text", text: `ห้อง ${room} ยังไม่มีบิลรอบนี้ครับ` }]);
      }
      return reply(event.replyToken, [billBubble(bill, baseUrl)]);
    }

    const link = text.match(/^ผูก\s*(\d{2,4})$/);
    if (link) {
      const room = link[1];
      const bill = await store.get(`bill:${room}`);
      if (!bill) {
        return reply(event.replyToken, [{ type: "text", text: `ไม่พบห้อง ${room} ในระบบครับ` }]);
      }
      await store.set(`user-room:${userId}`, room);
      await store.set(`room-user:${room}`, userId);
      return reply(event.replyToken, [{ type: "text", text: `ผูกกับห้อง ${room} แล้วครับ` }]);
    }
  }

  // postback from the "ยืนยันการชำระ" button in the owner card
  if (event.type === "postback") {
    const data = new URLSearchParams(event.postback.data);
    if (data.get("action") === "confirm") {
      const room = data.get("room");
      const bill = await store.get(`bill:${room}`);
      if (!bill) return reply(event.replyToken, [{ type: "text", text: `ไม่พบบิลห้อง ${room} ครับ` }]);
      if (bill.status === "paid") {
        return reply(event.replyToken, [{ type: "text", text: `ห้อง ${room} ยืนยันไปแล้วครับ` }]);
      }

      await store.set(`bill:${room}`, { ...bill, status: "paid", paidAt: new Date().toISOString() });

      const tenant = await store.get(`room-user:${room}`);
      if (tenant && tenant !== userId) {
        await push(tenant, [{ type: "text", text: `ห้อง ${room} ชำระเงินแล้ว ✅ เจ้าของหอยืนยันเรียบร้อย` }]);
      }
      return reply(event.replyToken, [{ type: "text", text: `ยืนยันห้อง ${room} แล้ว ✅` }]);
    }
  }
}

module.exports.push = push;
