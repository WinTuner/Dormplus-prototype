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

// 4) the seed-token bypass must be denied by default and on every production deploy
function bypassAllowed(env) {
  const keys = ["VERCEL_ENV", "ALLOW_SEED_BYPASS"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[require.resolve("./api/_auth")];
  const allowed = require("./api/_auth").BYPASS_ALLOWED;
  for (const k of keys) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  delete require.cache[require.resolve("./api/_auth")];
  return allowed;
}

assert.strictEqual(bypassAllowed({}), false, "no env at all -> denied");
assert.strictEqual(bypassAllowed({ VERCEL_ENV: "production" }), false, "production -> denied");
assert.strictEqual(bypassAllowed({ VERCEL_ENV: "production", ALLOW_SEED_BYPASS: "true" }), true, "production + explicit opt-in -> allowed");
assert.strictEqual(bypassAllowed({ VERCEL_ENV: "preview" }), true, "preview -> allowed");
assert.strictEqual(bypassAllowed({ VERCEL_ENV: "development" }), true, "development -> allowed");

// 5) only the configured owner counts as owner
process.env.OWNER_USER_ID = "Uowner";
delete require.cache[require.resolve("./api/_auth")];
const auth = require("./api/_auth");
assert.strictEqual(auth.isOwner("Uowner"), true);
assert.strictEqual(auth.isOwner("Usomeone-else"), false, "a tenant is never the owner");
delete process.env.OWNER_USER_ID;
delete require.cache[require.resolve("./api/_auth")];
assert.strictEqual(require("./api/_auth").isOwner("Uowner"), false, "no OWNER_USER_ID -> nobody is owner");

console.log("smoke OK — signature + flex card + confirm card + auth guards");
