#!/usr/bin/env node
// Copy the Vercel Blob store into Cloudflare R2, keeping the exact paths (`kv/…json`, `slips/…jpg`)
// so nothing has to be rewritten. Safe to re-run: it overwrites with the same bytes.
//
//   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_… \
//   R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=… \
//   node scripts/migrate-blob-to-r2.js [--dry] [--only=kv|slips]
//
// Run it BEFORE setting R2_BUCKET on the deployment, so the switch is one env change with the data
// already in place. Afterwards the Blob store can stay read-only until you delete it.
const { list, get } = require("@vercel/blob");
const { createStore } = require("../api/_store-r2");

const PREFIXES = ["kv/", "slips/"];
const dry = process.argv.includes("--dry");
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];
const prefixes = only ? PREFIXES.filter((p) => p.startsWith(only)) : PREFIXES;

const r2 = dry ? null : createStore();

async function paths(prefix) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const blob of page.blobs) out.push(blob);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

(async () => {
  let copied = 0;
  let bytes = 0;
  for (const prefix of prefixes) {
    const blobs = await paths(prefix);
    console.log(`${prefix} ${blobs.length} ไฟล์`);
    for (const blob of blobs) {
      const res = await get(blob.url, { access: "private" });
      if (!res) {
        console.warn(`  ข้าม (อ่านไม่ได้): ${blob.pathname}`);
        continue;
      }
      const body = Buffer.from(await new Response(res.stream).arrayBuffer());
      if (!dry) await r2.putFile(blob.pathname, body, blob.contentType || "application/octet-stream");
      copied += 1;
      bytes += body.length;
      if (copied % 25 === 0) console.log(`  … ${copied}`);
    }
  }
  const mb = (bytes / 1024 / 1024).toFixed(1);
  console.log(`${dry ? "จะคัดลอก" : "คัดลอกแล้ว"} ${copied} ไฟล์ · ${mb} MB`);
  if (dry) console.log("โหมด --dry: ไม่ได้เขียนอะไรลง R2");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
