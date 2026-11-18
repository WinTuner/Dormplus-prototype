// Copies every object in the R2 bucket to a local folder. R2 is the only storage now: Vercel Blob
// hit its free-tier cap and stays paused, so this is the backup.
//
//   node scripts/backup-r2.js D:\path\to\folder        (folder must be empty or missing)
//
// Reads R2_* from line-app/.env or the environment. Writes the same paths the app uses (kv/*.json,
// slips/*), so a restore is a plain upload of that folder.
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const file = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const target = process.argv[2];
if (!target) {
  console.log("usage: node scripts/backup-r2.js <folder>");
  process.exit(2);
}
const need = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.log("ขาด env:", missing.join(", "));
  process.exit(2);
}
if (fs.existsSync(target) && fs.readdirSync(target).length) {
  console.log("โฟลเดอร์ปลายทางไม่ว่าง:", target, "— ใช้ที่อื่นหรือลบของเก่าก่อน");
  process.exit(2);
}

const { createStore } = require("../api/_store-r2");
const store = createStore();

(async () => {
  let files = 0;
  let bytes = 0;
  for (const prefix of ["kv/", "slips/"]) {
    const paths = await store.listPaths(prefix);
    for (const p of paths) {
      const got = await store.getFile(p);
      if (!got) {
        console.log("หายไประหว่าง copy:", p);
        continue;
      }
      const out = path.join(target, ...p.split("/"));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const body = Buffer.from(await new Response(got.stream).arrayBuffer());
      fs.writeFileSync(out, body);
      files += 1;
      bytes += body.length;
    }
    console.log(prefix, "→", paths.length, "ไฟล์");
  }
  console.log("สำรองแล้ว:", files, "ไฟล์ ·", (bytes / 1024 / 1024).toFixed(2), "MB ·", target);
})().catch((err) => {
  console.log("ERROR", err.message);
  process.exit(1);
});
