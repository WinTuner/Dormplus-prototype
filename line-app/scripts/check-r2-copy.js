#!/usr/bin/env node
// Compare the Vercel Blob store with the R2 bucket before switching anything over: every key and
// every slip photo must exist in both, or a tenant will open a bill whose slip photo is missing.
//
//   node --env-file=.env scripts/check-r2-copy.js
//
// Exit 0 = the two stores hold the same paths (and R2 reported no empty file).
const { list } = require("@vercel/blob");
const { createStore } = require("../api/_store-r2");

const PREFIXES = ["kv/", "slips/"];
const SHOW = 20;

const missing = ["BLOB_READ_WRITE_TOKEN", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]
  .filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`ขาด env: ${missing.join(", ")}`);
  console.error("วางค่าใน line-app/.env แล้วรันด้วย: node --env-file=.env scripts/check-r2-copy.js");
  process.exit(1);
}

const r2 = createStore();

async function blobPaths(prefix) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const b of page.blobs) out.push(b.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

(async () => {
  let problems = 0;
  for (const prefix of PREFIXES) {
    const [inBlob, inR2] = await Promise.all([blobPaths(prefix), r2.listPaths(prefix)]);
    const r2Set = new Set(inR2);
    const blobSet = new Set(inBlob);
    const gone = inBlob.filter((p) => !r2Set.has(p));
    const extra = inR2.filter((p) => !blobSet.has(p));
    console.log(`${prefix} blob=${inBlob.length} r2=${inR2.length}${gone.length ? ` ขาด ${gone.length}` : ""}${extra.length ? ` เกิน ${extra.length}` : ""}`);
    for (const p of gone.slice(0, SHOW)) console.log(`  ขาด: ${p}`);
    if (gone.length > SHOW) console.log(`  … และอีก ${gone.length - SHOW}`);
    for (const p of extra.slice(0, SHOW)) console.log(`  เกิน (เขียนหลังคัดลอก): ${p}`);
    problems += gone.length;
  }

  // A zero-length object means the copy was interrupted mid-write; a slip photo of 0 bytes is a 404
  // in the owner's slip viewer even though the path exists.
  const sample = (await r2.listPaths("slips/")).slice(0, 5);
  for (const path of sample) {
    const file = await r2.getFile(path);
    if (!file) {
      console.log(`  อ่านไม่ได้: ${path}`);
      problems += 1;
      continue;
    }
    const bytes = Buffer.from(await new Response(file.stream).arrayBuffer()).length;
    if (!bytes) {
      console.log(`  ไฟล์ว่าง: ${path}`);
      problems += 1;
    }
  }
  console.log(sample.length ? `สุ่มอ่านรูป ${sample.length} ไฟล์จาก R2` : "ยังไม่มีรูปให้สุ่มอ่าน");

  if (problems) {
    console.error(`\nยังไม่พร้อม: ${problems} ปัญหา — รัน migrate-blob-to-r2.js อีกครั้งก่อนสลับ`);
    process.exit(1);
  }
  console.log("\nพร้อม: สองที่เก็บมี path ชุดเดียวกัน");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
