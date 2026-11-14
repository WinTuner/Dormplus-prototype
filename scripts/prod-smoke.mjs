// ตรวจ deployment จริงหลัง merge — ไม่มี dependency, ใช้ fetch ของ Node 20+
//
//   node scripts/prod-smoke.mjs
//   LINE_APP=https://... BACKEND=https://... node scripts/prod-smoke.mjs
//
// ตรวจเฉพาะสิ่งที่ไม่ต้องล็อกอิน: หน้า LIFF โหลดได้, endpoint ที่ต้อง auth ตอบ 401,
// endpoint dev ปิดบน production, และ security header อยู่ถูกที่
const LINE_APP = (process.env.LINE_APP || "https://line-app-iota.vercel.app").replace(/\/$/, "");
const BACKEND = (process.env.BACKEND || "https://line-backend-ten.vercel.app").replace(/\/$/, "");

let failed = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

async function get(url, init) {
  try {
    const res = await fetch(url, { redirect: "manual", ...init });
    return res;
  } catch (err) {
    return { status: 0, headers: new Headers(), text: async () => String(err), json: async () => ({}) };
  }
}

async function main() {
  const liff = await get(`${LINE_APP}/`);
  const html = liff.status === 200 ? await liff.text() : "";
  check("LIFF page answers 200", liff.status === 200, `HTTP ${liff.status}`);
  check("LIFF page is the current build", html.includes("qr-ph"), "expected .qr-ph in the page");

  const cfg = await get(`${LINE_APP}/api/config`);
  check("GET /api/config answers 200", cfg.status === 200, `HTTP ${cfg.status}`);
  check("API carries nosniff", cfg.headers.get("x-content-type-options") === "nosniff");
  check("API carries X-Frame-Options: DENY", cfg.headers.get("x-frame-options") === "DENY");
  check("LIFF page is NOT frame-denied", !liff.headers.get("x-frame-options"), "LINE may embed it");

  const me = await get(`${LINE_APP}/api/me`);
  check("GET /api/me without a token is 401", me.status === 401, `HTTP ${me.status}`);

  const dev = await get(`${LINE_APP}/api/dev?do=seed`, { method: "POST" });
  check("POST /api/dev is gone on production", dev.status === 404, `HTTP ${dev.status}`);

  const health = await get(`${BACKEND}/healthz`);
  const healthBody = health.status === 200 ? await health.json().catch(() => ({})) : {};
  check("backend /healthz answers ok", health.status === 200 && healthBody.status === "ok", `HTTP ${health.status}`);

  const docs = await get(`${BACKEND}/docs`);
  check("backend /docs is closed on production", docs.status === 404, `HTTP ${docs.status}`);

  const openapi = await get(`${BACKEND}/openapi.json`);
  check("backend /openapi.json is closed on production", openapi.status === 404, `HTTP ${openapi.status}`);

  const rooms = await get(`${BACKEND}/v1/rooms`);
  check("GET /v1/rooms without a session is 401", rooms.status === 401, `HTTP ${rooms.status}`);

  const dunning = await get(`${BACKEND}/v1/dunning/run?token=guess`, { method: "POST" });
  check("dunning rejects a query-string token", dunning.status === 401, `HTTP ${dunning.status}`);

  const cron = await get(`${BACKEND}/v1/cron/daily`);
  check("daily cron exists and needs its secret", cron.status === 401, `HTTP ${cron.status}`);

  if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

main();
