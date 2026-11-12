// Offline smoke test: signature verification + Flex card shape (no network, no Redis).
process.env.LINE_CHANNEL_SECRET = "test-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";

const crypto = require("crypto");
const assert = require("assert");
const { verify, billBubble, confirmBubble } = require("./api/_line");

// 1) signature: same payload, same secret → must verify
const raw = Buffer.from(JSON.stringify({ events: [] }));
const good = crypto.createHmac("sha256", "test-secret").update(raw).digest("base64");
assert.strictEqual(verify(raw, good), true, "valid signature should pass");
assert.strictEqual(verify(raw, "wrong"), false, "invalid signature should fail");
assert.strictEqual(verify(raw, undefined), false, "missing signature should fail");

// 2) Flex card
const bill = { room: "203", period: "2026-11", rent: 3500, water: 125, elec: 217, total: 3842, due: "2026-11-16" };
const card = billBubble(bill, "https://example.test");
assert.strictEqual(card.type, "flex");
assert.ok(card.altText.includes("3,842"), "altText carries the amount");
assert.strictEqual(card.contents.type, "bubble");
const texts = JSON.stringify(card);
assert.ok(texts.includes("ห้อง 203"), "shows room");
assert.ok(texts.includes("#4FD8D2"), "uses the brand colour");
assert.ok(texts.includes("/liff/bill.html?room=203") || texts.includes("liff.line.me"), "button points at the bill page");

// 3) owner confirm card → postback must carry the room the webhook will look up
const confirm = confirmBubble(bill);
const pb = confirm.contents.footer.contents[0].action;
assert.strictEqual(pb.type, "postback");
assert.ok(pb.data.includes("action=confirm"), "postback action");
assert.ok(pb.data.includes("room=203"), "postback carries room");

console.log("smoke OK — signature + flex card + confirm card");
