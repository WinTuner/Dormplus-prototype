// POST /api/webhook — LINE Messaging API webhook.
const { verify, reply, push, billBubble, receiptBubble } = require("./_line");
const store = require("./_store");
const { isOwner } = require("./_auth");
const { saveBills, tenancyOf, visibleToTenant, receiptNoOf, PERIOD } = require("./_bills");

const PUSH_MAX_MESSAGES = 5; // LINE accepts at most 5 messages in one push

// The paid copy of a bill. Receipt numbers are derived (see receiptNoOf), never counted. A paid bill
// is final: the only way to change it is to void it and re-issue (POST /api/bill, then /api/run).
const paidCopy = (bill, userId) => ({
  ...bill,
  status: "paid",
  paidAt: new Date().toISOString(),
  confirmedBy: userId,
  receiptNo: receiptNoOf(bill),
});

// Hand the tenant their receipt(s). An old tenant's bill closing must not message whoever lives
// there now. A push error is logged: the bill is already paid and the owner still gets an answer.
async function sendReceipts(room, paidBills, userId, baseUrl) {
  try {
    // The two reads do not depend on each other.
    const [tenant, tenancy] = await Promise.all([store.get(`room-user:${room}`), tenancyOf(room)]);
    if (!tenant || tenant === userId) return;
    const messages = paidBills.filter((b) => visibleToTenant(b, tenancy)).map((b) => receiptBubble(b, baseUrl));
    for (let i = 0; i < messages.length; i += PUSH_MAX_MESSAGES) {
      try {
        await push(tenant, messages.slice(i, i + PUSH_MAX_MESSAGES));
      } catch (err) {
        console.error("receipt push failed", room, err.message);
      }
    }
  } catch (err) {
    // A failed lookup must not turn a payment that is already saved into an error for the owner.
    console.error("receipt send failed", room, err.message);
  }
}

// One slip paid several periods (POST /api/slip with `periods`): close every bill that is still
// waiting on that same slip. Bills that moved on (paid, void, or a newer slip of their own) are
// left alone and named in the answer.
async function confirmGroup(event, room, rawPeriods, userId, baseUrl) {
  const periods = [...new Set(rawPeriods.split(",").map((p) => p.trim()))].sort();
  if (!periods.length || periods.length > 12 || !periods.every((p) => PERIOD.test(p))) {
    return reply(event.replyToken, [{ type: "text", text: "การ์ดนี้ระบุรอบบิลไม่ถูกต้อง ยืนยันไม่ได้ครับ" }]);
  }
  const key = periods.join(",");
  const [latest, ...bills] = await Promise.all([store.get(`bill:${room}`), ...periods.map((p) => store.get(`bill:${p}:${room}`))]);
  const open = bills.filter((b) => b && b.status === "pending" && b.slipGroup?.periods?.join(",") === key);
  const skipped = periods.filter((p) => !open.some((b) => b.period === p));
  if (!open.length) {
    return reply(event.replyToken, [
      { type: "text", text: `ห้อง ${room} รอบ ${periods.join(", ")} ไม่มีบิลที่รอยืนยันตามการ์ดนี้ (ยืนยันแล้ว ยกเลิก หรือผู้เช่าส่งสลิปใหม่) ครับ` },
    ]);
  }

  const paid = open.map((b) => paidCopy(b, userId));
  await saveBills(paid, { latest }); // one write per key, not one saveBill (and index rewrite) per period
  // The receipts and the owner's answer go to different people; the reply must not wait for them.
  await Promise.all([
    sendReceipts(room, paid, userId, baseUrl),
    reply(event.replyToken, [
      {
        type: "text",
        text: `ยืนยันห้อง ${room} รอบ ${paid.map((b) => b.period).join(", ")} แล้ว ✅` +
          (skipped.length ? ` · ข้าม ${skipped.join(", ")} (ไม่ได้รอยืนยันตามการ์ดนี้)` : ""),
      },
    ]),
  ]);
}

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
      const [latest, tenancy] = await Promise.all([store.get(`bill:${room}`), tenancyOf(room)]);
      const bill = visibleToTenant(latest, tenancy) ? latest : null; // not the previous tenant's
      if (!bill) {
        return reply(event.replyToken, [{ type: "text", text: `ห้อง ${room} ยังไม่มีบิลรอบนี้ครับ` }]);
      }
      // A void bill has nothing to pay: say so instead of offering its pay button.
      if (bill.status === "void") {
        return reply(event.replyToken, [
          { type: "text", text: `บิลห้อง ${room} รอบ ${bill.period} ถูกยกเลิก — ${bill.voidReason || "-"}` },
        ]);
      }
      return reply(event.replyToken, [billBubble(bill, baseUrl)]);
    }
  }

  // postback from the "ยืนยันการชำระ" button in the owner card
  if (event.type === "postback") {
    const data = new URLSearchParams(event.postback.data);
    if (data.get("action") === "confirm") {
      // Only the owner may close a bill: anyone holding the card (or forging the postback) is refused.
      // The bill is fetched while that is checked (nothing is used from it for a non-owner), so the
      // owner check is not a read in front of the read.
      const room = data.get("room") || "";
      const period = data.get("period");
      const [owner, bill, latest] = await Promise.all(
        data.get("periods") || !PERIOD.test(period || "")
          ? [isOwner(userId)]
          : [isOwner(userId), store.get(`bill:${period}:${room}`), store.get(`bill:${room}`)]
      );
      if (!owner) {
        return reply(event.replyToken, [{ type: "text", text: "เฉพาะเจ้าของหอกดยืนยันได้ครับ" }]);
      }
      if (data.get("periods")) return confirmGroup(event, room, data.get("periods"), userId, baseUrl);
      // Cards carry the period, so they close exactly the bill they were sent for. A card minted
      // before that change cannot name its bill: refusing it is the only safe answer, because the
      // newest bill may be another month's (and may be waiting for a slip of its own).
      if (!period || !PERIOD.test(period)) {
        return reply(event.replyToken, [
          {
            type: "text",
            text: `การ์ดนี้ไม่ระบุรอบบิล จึงยืนยันไม่ได้ครับ — ให้ผู้เช่ากด “ส่งสลิปใหม่” เพื่อรับการ์ดใบใหม่`,
          },
        ]);
      }
      if (!bill) return reply(event.replyToken, [{ type: "text", text: `ไม่พบบิลห้อง ${room} ครับ` }]);
      if (bill.status === "paid") {
        return reply(event.replyToken, [{ type: "text", text: `ห้อง ${room} รอบ ${bill.period} ยืนยันไปแล้วครับ` }]);
      }
      if (bill.status === "void") return reply(event.replyToken, [{ type: "text", text: "บิลนี้ถูกยกเลิกแล้ว" }]);
      // Only a bill with a slip waiting can be confirmed; an unpaid one has nothing to confirm.
      if (bill.status !== "pending") {
        return reply(event.replyToken, [
          { type: "text", text: `ห้อง ${room} รอบ ${bill.period} ยังไม่ได้แจ้งชำระ ยืนยันไม่ได้ครับ` },
        ]);
      }

      const paid = paidCopy(bill, userId);
      await saveBills([paid], { latest });
      await Promise.all([
        sendReceipts(room, [paid], userId, baseUrl),
        reply(event.replyToken, [{ type: "text", text: `ยืนยันห้อง ${room} แล้ว ✅` }]),
      ]);
      return;
    }
  }
}

module.exports.push = push;
