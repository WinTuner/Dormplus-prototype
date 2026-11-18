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

// 3b) A field the component type does not have (a button has no cornerRadius) makes LINE reject the
// whole message, so the chat shows nothing at all — the bill looks unsent. Walk every node once.
const badField = [];
const walk = (node) => {
  if (!node || typeof node !== "object") return;
  if (node.type === "button" && "cornerRadius" in node) badField.push(node.action?.label);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(walk);
    else walk(value);
  }
};
[card, confirm].forEach(walk);
assert.deepStrictEqual(badField, [], "no button carries a field LINE does not allow");

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
assert.strictEqual(bypassAllowed({ VERCEL_ENV: "production", ALLOW_SEED_BYPASS: "true" }), false, "production -> denied even with the opt-in");
assert.strictEqual(bypassAllowed({ VERCEL_ENV: "preview" }), false, "preview shares production data -> denied by default");
assert.strictEqual(bypassAllowed({ VERCEL_ENV: "preview", ALLOW_SEED_BYPASS: "true" }), true, "preview + explicit opt-in -> allowed");
assert.strictEqual(bypassAllowed({ VERCEL_ENV: "development" }), true, "vercel dev on a laptop -> allowed");

// 5) owner = OWNER_USER_ID, plus anyone admitted later with an owner invite
const owners = new Map([
  ["owner:U_coowner", { addedAt: "2026-11-12T00:00:00Z" }],
  ["owner:U_viewer", { addedAt: "2026-11-12T00:00:00Z", role: "viewer" }],
]);
const storeStub = {
  get: async (k) => (owners.has(k) ? owners.get(k) : null),
  set: async (k, v) => owners.set(k, v),
  update: async (k, apply) => { const next = await apply(owners.has(k) ? owners.get(k) : null); if (next !== undefined) owners.set(k, next); },
  remove: async (k) => { owners.delete(k); },
  create: async (k, v) => { if (owners.has(k)) return false; owners.set(k, v); return true; },
};
const storePath = require.resolve("./api/_store");
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: storeStub };

process.env.OWNER_USER_ID = "Uowner";
delete require.cache[require.resolve("./api/_auth")];
const auth = require("./api/_auth");

(async () => {
  assert.strictEqual(await auth.isOwner("Uowner"), true, "the configured owner");
  assert.strictEqual(await auth.isOwner("U_coowner"), true, "an owner admitted by invite");
  assert.strictEqual(await auth.isOwner("Usomeone-else"), false, "a tenant is never the owner");
  assert.strictEqual(await auth.isOwner("U_viewer"), false, "a viewer is not an owner");
  assert.strictEqual(await auth.canView("U_viewer"), true, "a viewer may look at owner screens");
  assert.strictEqual(await auth.canView("Usomeone-else"), false, "a tenant may not");
  assert.strictEqual(await auth.isOwner(null), false, "no user is not the owner");

  delete process.env.OWNER_USER_ID;
  delete require.cache[require.resolve("./api/_auth")];
  const noRoot = require("./api/_auth");
  assert.strictEqual(await noRoot.isOwner("Uowner"), false, "without OWNER_USER_ID that account is not an owner");
  assert.strictEqual(await noRoot.isOwner("U_coowner"), true, "but an invited owner still is");

  console.log("smoke OK — signature + flex card + confirm card + auth guards");
})();

// 6) QR helper actually renders (needs node_modules; skipped when running dependency-free)
try {
  require.resolve("qrcode-svg");
  const { qrSvg } = require("./api/_qr");
  const svg = qrSvg("https://liff.line.me/test?bind=ABCDEFGHJK");
  assert.ok(svg.startsWith("<svg"), "QR renders as inline SVG (no XML declaration)");
  // Without a viewBox, CSS shrinking the SVG crops it instead of scaling it: phones cannot scan it.
  assert.ok(/viewBox="0 0 \d+ \d+"/.test(svg), "QR SVG carries a viewBox so it scales");
  assert.ok(!/<svg[^>]*\swidth="/.test(svg), "QR SVG has no fixed width that would fight the page CSS");
  console.log("smoke OK — QR renders and scales");
} catch (err) {
  if (err.code === "MODULE_NOT_FOUND") console.log("smoke: qrcode-svg not installed, QR check skipped");
  else throw err;
}

// 7) R2 adapter: the six calls _store.js needs, against a fake S3 endpoint (no network, no bucket).
(async () => {
  const { createStore } = require("./api/_store-r2");
  const calls = [];
  const replies = [];
  const fakeFetch = async (req) => {
    // aws4fetch hands over a signed Request, so body and method come from it, not from init.
    const body = req.method === "GET" ? undefined : await req.text();
    calls.push({
      url: req.url, method: req.method, body,
      ifMatch: req.headers.get("if-match"), ifNoneMatch: req.headers.get("if-none-match"),
    });
    const next = replies.shift() || {};
    return new Response(next.body ?? "", { status: next.status || 200, headers: next.headers || {} });
  };
  const store = createStore(
    { R2_ACCOUNT_ID: "acc", R2_BUCKET: "dorm", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s" },
    fakeFetch
  );

  replies.push({ body: '{"a":1}' });
  assert.strictEqual(await store.getText("kv/dorm.json"), '{"a":1}');
  assert.ok(calls[0].url.endsWith("/dorm/kv/dorm.json"), "object URL is /<bucket>/<path>");

  replies.push({ status: 404 });
  assert.strictEqual(await store.getText("kv/none.json"), null, "a missing key is null, not a throw");

  replies.push({});
  await store.putText("kv/x.json", '{"b":2}');
  assert.deepStrictEqual([calls[2].method, calls[2].body], ["PUT", '{"b":2}']);

  replies.push({ status: 404 });
  await store.delFile("slips/gone.jpg"); // 404 on delete is fine

  replies.push({ body: "<IsTruncated>true</IsTruncated><NextContinuationToken>t1</NextContinuationToken><Key>kv/a.json</Key>" });
  replies.push({ body: "<IsTruncated>false</IsTruncated><Key>kv/b.json</Key>" });
  assert.deepStrictEqual(await store.listPaths("kv/"), ["kv/a.json", "kv/b.json"], "list follows the continuation token");

  // Conditional writes: an ETag read plus If-Match / If-None-Match on the PUT is what stops two
  // requests from overwriting each other's merge of bills:<room> / bill-state:<room> / slip-ref:.
  replies.push({ body: '{"c":3}', headers: { etag: '"v1"' } });
  assert.deepStrictEqual(await store.getVersioned("kv/c.json"), { text: '{"c":3}', etag: '"v1"' });
  replies.push({ status: 412 });
  assert.strictEqual(await store.putVersioned("kv/c.json", '{"c":4}', { ifMatch: '"v1"' }), null,
    "the loser of a race gets null instead of overwriting");
  assert.strictEqual(calls.at(-1).ifMatch, '"v1"', "and it really sent If-Match");
  replies.push({ headers: { etag: '"v2"' } });
  assert.deepStrictEqual(await store.putVersioned("kv/c.json", '{"c":5}', { ifMatch: '"v1"' }), { etag: '"v2"' });
  replies.push({ status: 409 });
  assert.strictEqual(await store.putVersioned("kv/new.json", "{}", { ifNoneMatch: true }), null,
    "create-only also treats 409 as taken");
  assert.strictEqual(calls.at(-1).ifNoneMatch, "*", "and it really sent If-None-Match: *");
  console.log("smoke OK — R2 adapter: get/404, put, delete, list pagination, conditional put");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
