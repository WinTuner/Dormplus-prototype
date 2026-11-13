<!-- generated-by: gsd-doc-writer -->

# การพัฒนาต่อ (DEVELOPMENT)

เอกสารนี้เขียนจากโค้ดจริงในเรพ: **ไม่มี framework, ไม่มี bundler, ไม่มีขั้นตอน build** เทสต์เป็นสคริปต์ Node ธรรมดา (`node smoke.js`, `node smoke-handlers.js`) ไม่ต้อง `npm install` ทุกอย่างที่ deploy คือไฟล์ CommonJS ใต้ `api/` กับหน้า static ไฟล์เดียว `liff/bill.html` การอ่าน [`ARCHITECTURE.md`](./ARCHITECTURE.md) ควบคู่ไปด้วยจะเห็นภาพว่า request วิ่งผ่านไฟล์ไหน

## 1. Local setup

```bash
git clone <repo-url>
cd line-app
npm install
node -v      # ต้อง >= 20 ตาม engines ใน package.json
```

<!-- VERIFY: ไม่มี git remote/.git ในเวิร์กสเปซนี้ (`git rev-parse` ตอบ "not a git repository") จึงยืนยัน URL ของเรพต้นทางไม่ได้ -->

หลัง `npm install` จะได้ dependency ตัวเดียวคือ `@vercel/blob@2.9.0` (ตาม `package-lock.json`) **ไม่มีขั้นตอน build และไม่มี dev server**

- `package.json` ไม่มี `scripts` เลย → ไม่มี `npm run dev`, `npm start`, `npm test`
- ไม่มี `.env`, `.env.example` และไม่มี `dotenv` → ใส่ค่าในไฟล์ `.env` ไม่มีผล (ดู [`CONFIGURATION.md`](./CONFIGURATION.md) ข้อ 4)
- `liff/bill.html` เรียก `/api/*` เป็น path สัมพัทธ์ จึงต้องถูกเสิร์ฟจาก origin เดียวกับ API

สิ่งที่ตรวจได้ในเครื่องมีอย่างเดียวคือ smoke test:

```bash
node smoke.js
# smoke OK — signature + flex card + confirm card
```

`smoke.js` ตั้ง `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` ปลอมเองที่บรรทัด 2–3 **ก่อน** `require("./api/_line")` — ลำดับนี้สำคัญเพราะโมดูลอ่าน env ตอน module load (ข้อ 6)

ทางที่ใช้ทดสอบ endpoint จริงคือ deployment บน Vercel (ใช้ `x-seed-token` ตาม `HANDOFF.md` ข้อ 4) หรือ `vercel dev` ซึ่งยังไม่มีใครยืนยันว่าใช้กับ Blob ในเครื่องได้

<!-- VERIFY: `vercel dev` ใช้ได้กับโปรเจกต์นี้แค่ไหน (โดยเฉพาะ Blob OIDC) — ไม่มีไฟล์ใดในเรพยืนยัน -->

## 2. รูปแบบของ handler (Vercel function)

ทุก endpoint เป็นไฟล์เดียวจบ หน้าตาเดียวกันหมด:

```js
// POST /api/example — one line saying what this route does.
const store = require("./_store");
const { requireUser, isOwner } = require("./_auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const userId = await requireUser(req, res);
  if (!userId) return;                        // requireUser ตอบ 401/403 ให้แล้ว
  if (!isOwner(userId)) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "เฉพาะเจ้าของหอ" } });
  }

  const { readings } = req.body || {};        // Vercel เตรียม body ให้แล้ว ไม่ต้อง parse เอง
  // ...ทำงาน...
  return res.status(200).json({ ok: true });
};
```

สิ่งที่โค้ดใช้จริงและควรยึดตาม:

| เรื่อง | พฤติกรรมที่โค้ดพึ่งอยู่ | ตัวอย่าง |
|---|---|---|
| ชื่อไฟล์ = route | `api/bill.js` → `/api/bill` | ไม่มี router, ไม่มี `vercel.json` routes |
| signature | `module.exports = async (req, res)` | ทุกไฟล์ใน `api/` — ยกเว้น `api/config.js` ที่เป็น sync (ไม่ต้อง await อะไร) |
| `req.method` | เช็กเองทุก endpoint ที่ไม่ใช่ GET | `run.js`, `slip.js`, `seed.js`, `sendbill.js`, `webhook.js` |
| `req.query` | อ่าน query ตรง ๆ | `req.query.room`, `req.query.token` |
| `req.body` | **parse มาแล้ว** ไม่มีการ parse ในโค้ด | `run.js` บรรทัด 14, `slip.js` บรรทัด 14 |
| `req.headers` | lowercase key | `req.headers["x-line-signature"]`, `req.headers.authorization` |
| `req` เป็น stream | ใช้เฉพาะ webhook | `readRaw()` ใน `webhook.js` บรรทัด 5–9 |
| `res.status().json()` | helper ของ runtime | ทั้งโปรเจกต์ |

**webhook เป็นข้อยกเว้นเดียว** — ต้องอ่าน byte ดิบจาก stream เอง เพราะ `_line.verify()` คำนวณ `HMAC-SHA256(rawBody)` แล้วเทียบกับ `x-line-signature` ถ้าเอา body ที่ถูก parse แล้วไปคำนวณซ้ำ signature จะไม่ตรง

```js
async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}
```

<!-- VERIFY: การที่ runtime แปลง JSON body เป็น `req.body` ให้อัตโนมัติ และการอ่าน stream ดิบใน webhook ทำงานร่วมกันได้อย่างไร เป็นพฤติกรรมของ Vercel Node runtime ไม่ได้ประกาศในเรพ — โค้ดปัจจุบันพึ่งทั้งสองอย่าง -->

## 3. Shared modules และ contract

ไฟล์ที่ขึ้นต้นด้วย `_` คือ helper ที่ `require()` กันตรง ๆ **ไม่ใช่ endpoint** (Vercel ไม่สร้าง route ให้ — ดู [`ARCHITECTURE.md`](./ARCHITECTURE.md) ข้อ 9)

| Module | export | contract ที่ผู้เรียกต้องรู้ |
|---|---|---|
| `api/_store.js` | `get(key)`, `set(key, value)` | JSON เท่านั้น · `get` คืน `null` เมื่อไม่มี · เขียนทับทั้งไฟล์เสมอ (`allowOverwrite: true`) · `useCache: false` ทุกครั้ง — **ลบไม่ได้** ไม่งั้นอ่านค่าเก่า |
| `api/_auth.js` | `requireUser(req, res)`, `isOwner(userId)`, `CHANNEL_ID` | `requireUser` **ตอบ 401/403 เองแล้วคืน `null`** ผู้เรียกจึงเขียนแค่ `if (!userId) return;` · `isOwner` คืน `false` เสมอถ้าไม่ได้ตั้ง `OWNER_USER_ID` |
| `api/_line.js` | `verify(rawBody, signature)`, `reply()`, `push()`, `billBubble()`, `confirmBubble()`, `LIFF_ID` | `verify` รับ `Buffer` ดิบ · `reply`/`push` **throw** เมื่อ LINE ตอบไม่ 200 · `*Bubble` เป็นฟังก์ชันบริสุทธิ์ ไม่มี side effect (จึงเทสต์ offline ได้) |
| `api/_rooms.js` | `ROOMS`, `DEFAULTS`, `configFor(room)` | `ROOMS`/`DEFAULTS` ถูกอ่านจาก env **ตอน module load** · `configFor` merge `DEFAULTS` กับ `room:<room>` จาก Blob |

กติกาที่ทีมตั้งไว้แล้ว (`HANDOFF.md` ข้อ 8) และโค้ดทำจริง:

1. แตะ Blob ผ่าน `_store.js` เท่านั้น — ยกเว้นไฟล์ไบนารีที่ `slip.js` (`put`) และ `slip-image.js` (`get`) เรียก `@vercel/blob` ตรง
2. endpoint ที่อ่านข้อมูลผู้ใช้ต้องเรียก `requireUser()` ก่อน
3. helper ใหม่ที่ใช้ร่วมกันให้ตั้งชื่อ `_*.js` ไม่งั้นมันจะกลายเป็น route สาธารณะ

`webhook.js` มี `module.exports.push = push;` ต่อท้ายไฟล์ — ไม่มีโค้ดใดเรียกใช้ (`grep` แล้ว) เป็นของค้าง ไม่ต้องเลียนแบบ

## 4. เพิ่ม endpoint ใหม่ให้ปลอดภัย

ลำดับที่ทุก endpoint ที่มีอยู่ทำตาม (อ่าน `bill.js` / `run.js` / `slip.js` เทียบกันได้):

1. **ตั้งชื่อไฟล์** `api/<ชื่อroute>.js` — ถ้าเป็น helper ให้ขึ้นต้นด้วย `_`
2. **ถ้าไม่ใช่ GET** → เช็ก `req.method` ก่อนทุกอย่าง
3. **ถ้าแตะข้อมูลผู้ใช้** → `const userId = await requireUser(req, res); if (!userId) return;`
4. **ถ้าเป็นของเจ้าของ** → `if (!isOwner(userId)) return res.status(403).json({ error: { code: "FORBIDDEN", message: "เฉพาะเจ้าของหอ" } })`
5. **ถ้าเป็นข้อมูลรายห้อง** → เทียบ `user-room:<userId>` กับห้องที่ขอ: `if (!isOwner(userId) && bound !== room) → 403` (แบบเดียวกับ `bill.js` และ `slip.js`)
6. **validate ก่อนเขียน** → คืน `400 VALIDATION` พร้อมบอกว่าต้องส่งอะไร (ข้อความภาษาไทย)
7. **ทำงาน** → อ่าน/เขียนผ่าน `_store`
8. **side effect ที่ล้มได้** (push LINE) → ครอบ `try/catch` + `console.error` แล้วคืนผลปกติ (แบบ `run.js` และ `slip.js`) อย่าให้ผู้ใช้ล้มเพราะการแจ้งเตือนล้ม
9. **ตอบ JSON** — GET ที่คืนสถานะที่เปลี่ยนได้ต้อง `res.setHeader("Cache-Control", "no-store")` **ก่อน** `requireUser` (แบบ `bill.js`, `me.js`, `rooms.js`, `config.js`)

import อะไรจากที่ไหน:

| ต้องการ | import |
|---|---|
| อ่าน/เขียน state | `require("./_store")` |
| ยืนยันตัวตน / สิทธิ์เจ้าของ | `require("./_auth")` |
| ส่งข้อความ/การ์ด Flex | `require("./_line")` |
| รายชื่อห้อง + ค่าเช่า/เรต | `require("./_rooms")` |
| ไฟล์ไบนารี (ไม่ใช่ JSON) | `require("@vercel/blob")` ตรง ๆ — กรณีเดียวที่อนุญาต |

## 5. รูปแบบ error และ header ที่มีจริง

มีสองรูปแบบปนกันอยู่ ต้องรู้ก่อนเขียนใหม่:

```js
// 405 ที่ทุกไฟล์ใช้ (error เป็น string)
res.status(405).json({ error: "POST only" });

// ที่เหลือทั้งหมด (error เป็น object)
res.status(400).json({ error: { code: "VALIDATION", message: "ต้องระบุ room" } });
```

หน้า LIFF อ่าน `data?.error?.message` (ใน `liff/bill.html` ฟังก์ชัน `api()`) ดังนั้น **error แบบ string จะโชว์เป็น `HTTP 405`** — โค้ดใหม่ควรใช้รูปแบบ object

| code | HTTP | ใช้เมื่อ | ตัวอย่างไฟล์ |
|---|---|---|---|
| `UNAUTHORIZED` | 401 | ไม่มี token / ไม่มี `CHANNEL_ID` | `_auth.js` |
| `FORBIDDEN` | 403 | idToken ไม่ผ่าน, ไม่ใช่เจ้าของ, ไม่ได้ผูกห้อง, `x-seed-token` ผิด/สั้นกว่า 16 ตัว | `_auth.js`, `bill.js`, `dev.js` |
| `VALIDATION` | 400 | input ไม่ครบ/ผิดรูป | `run.js`, `slip.js` |
| `NOT_FOUND` | 404 | ไม่พบบิล/สลิป/ไฟล์ | `bill.js`, `slip-image.js` |
| `INVALID_STATE` | 409 | แนบสลิปบนบิลที่ `paid` แล้ว | `slip.js` |
| `TOO_LARGE` | 413 | รูปเกิน 3MB | `slip.js` |
| — | 401 | `bad signature` (webhook) | `webhook.js` |

`message` เป็นภาษาไทยเสมอ (ผู้ใช้เห็น) ส่วน `code` เป็น `SCREAMING_SNAKE_CASE` ภาษาอังกฤษ

Cache header ที่มีจริง:

| ไฟล์ | header |
|---|---|
| `bill.js`, `me.js`, `rooms.js`, `config.js` | `Cache-Control: no-store` |
| `slip-image.js` | `Cache-Control: private, no-store` + `Content-Type` จาก blob |
| POST ทั้งหมด | ไม่ได้ตั้ง — ไม่ถูก cache อยู่แล้ว |

## 6. State key → Blob pathname

`_store.js` แปลง key เป็น pathname เองทั้งหมด:

```js
const pathOf = (key) => `kv/${String(key).replace(/[^a-zA-Z0-9._-]/g, "-")}.json`;
```

ผลที่ตามมา — **อ่านก่อนตั้ง key ใหม่ทุกครั้ง**:

| key | pathname |
|---|---|
| `user:<userId>` | `kv/user-<userId>.json` |
| `user-room:<userId>` | `kv/user-room-<userId>.json` |
| `room-user:<room>` | `kv/room-user-<room>.json` |
| `bill:<room>` | `kv/bill-<room>.json` |
| `meter:<room>` | `kv/meter-<room>.json` |
| `room:<room>` | `kv/room-<room>.json` |
| `slips/<room>-<ts>.jpg` | pathname เดียวกัน (เขียนตรงด้วย `put()` ไม่ผ่าน `_store`) |

ข้อควรระวัง:

- `:` กลายเป็น `-` → key ที่ต่างกันเฉพาะอักขระพิเศษจะ **ชนกัน** เช่น `bill:203` กับ `bill-203` ชี้ไฟล์เดียวกัน
- ค่าที่เก็บเป็น JSON ก้อนเดียวทั้งไฟล์ ไม่มี partial update / ไม่มี transaction — ทุกรูปแบบ "อ่าน–แก้–เขียน" เป็น race ได้ (ARCHITECTURE ข้อ 10.1)
- `slipPath` เก็บ pathname จริง (`slips/...`) ไม่ใช่ key ของ `_store` จึงอ่านด้วย `get()` จาก `@vercel/blob` ตรง ๆ

## 7. Deploy loop

```bash
# ครั้งแรกครั้งเดียว
npm i -g vercel
vercel                     # ล็อกอิน + link โปรเจกต์ (ครั้งแรก)

# ทุกรอบที่แก้โค้ด
node smoke.js              # ต้องผ่านก่อน deploy (กติกา HANDOFF ข้อ 8)
vercel --prod
```

ในเวิร์กสเปซนี้มี `.vercel/project.json` อยู่แล้ว (`projectName: "line-app"`) จึงข้ามขั้น link ได้ แต่ `.vercel` ถูก gitignore ไว้ — เครื่องอื่นต้อง link ใหม่

หลัง deploy (preview) ทดสอบ path ที่แตะ 1 ครั้งด้วย dev bypass แล้วทดสอบใน LINE จริงอีก 1 ครั้ง — production ไม่มี bypass:

```bash
curl.exe -s -H "x-seed-token: <SEED_TOKEN>" https://<preview-url>/api/me   # production จะได้ 401
```

**แก้ env แล้วต้อง Redeploy เสมอ** — `_line.js` (`TOKEN`, `SECRET`, `LIFF_ID`), `_auth.js` (`CHANNEL_ID`), `_rooms.js` (`ROOMS`, `DEFAULTS`) จับค่าใส่ `const` ระดับ module ตอนโหลดไฟล์ อินสแตนซ์ที่ warm อยู่จะยังใช้ค่าเก่าไปจนกว่าจะมี deployment ใหม่ (README ข้อ 4 ระบุ "Redeploy" ไว้ตรง ๆ)

Blob store สร้าง/เชื่อมครั้งเดียวต่อโปรเจกต์:

```bash
vercel storage create domplus-bills --type blob --access private --region sin1
vercel storage connect domplus-bills --yes
```

<!-- VERIFY: คำสั่ง `vercel storage ...` และการที่ `connect` ใส่ `BLOB_STORE_ID` ให้อัตโนมัติ มาจาก README ข้อ 3 ไม่ได้ยืนยันกับ Vercel CLI จริง -->
<!-- VERIFY: ขั้นตอน rollback (Deployments → เลือก deployment เก่า → Promote/Redeploy) เป็นพฤติกรรมของ Vercel dashboard ไม่มีในเรพ — ดู DEPLOYMENT.md -->

## 8. คำสั่งที่ใช้จริง (ไม่มี build)

`package.json` มีแค่ `name`, `private`, `version`, `description`, `engines`, `dependencies` — **ไม่มี `scripts`** จึงไม่มี `npm run build` / `dev` / `lint` / `test` ตารางนี้คือคำสั่งทั้งหมดที่มีอยู่ในเอกสารของทีม:

| คำสั่ง | ทำอะไร | ที่มา |
|---|---|---|
| `npm install` | ติดตั้ง `@vercel/blob` (ไม่มี postinstall/build) | `package-lock.json` |
| `node smoke.js` | smoke test offline: signature + การ์ด Flex + postback data | `smoke.js` |
| `npm i -g vercel` | ติดตั้ง Vercel CLI (ครั้งแรก) | README ข้อ 3 |
| `vercel --prod` | deploy ขึ้น production | README ข้อ 3 |
| `curl.exe -s -H "x-seed-token: ..." https://<โดเมน>/api/...` | ยิง API บน deployment ด้วย dev bypass | `HANDOFF.md` ข้อ 4 |

## 9. Code style และ convention ที่โค้ดทำอยู่

**ไม่มี** ESLint, Prettier, Biome, `.editorconfig`, TypeScript หรือ CI config ในเรพ (ตรวจแล้ว) สิ่งที่มีคือสไตล์ที่โค้ดทั้ง 15 ไฟล์ทำเหมือนกัน:

- **CommonJS เท่านั้น** — `require()` / `module.exports` ไม่มี `import`/`export` เพราะ helper ถูก require ด้วย path ตรง ๆ
- 2 spaces, double quotes, semicolons, `const` (ไม่มี `var`)
- ไฟล์ละ 1 บรรทัดคอมเมนต์บนสุดบอก route + หน้าที่ เช่น `// GET /api/bill?room=203 — a tenant sees only their own room; the owner sees all.`
- คอมเมนต์เป็นภาษาอังกฤษ เฉพาะ "ทำไม" ที่โค้ดบอกไม่ได้ (เช่น `// bill status changes after a slip is attached`, `// Tell the owner, but never fail the tenant's slip because of a push error.`)
- ความรู้ที่ยังจำกัดอยู่ใช้คอมเมนต์นำหน้า `shortcut:` (มีที่เดียว: bypass `x-seed-token` ใน `_auth.js` บรรทัด 16) — ตามเมื่อมีทางที่ถูกกว่า
- ข้อความที่ผู้ใช้เห็นเป็น **ภาษาไทยทั้งหมด** (ข้อความในแชท, `message` ของ error, ข้อความในหน้า LIFF) — โค้ด/ชื่อตัวแปร/`code` เป็นอังกฤษ
- ตัวเลขเงินปัดด้วย `Math.round()` และแสดงด้วย `toLocaleString("th-TH")`
- input จากภายนอกถูกแปลงก่อนใช้เสมอ: `String(x || "").trim()`, `Number(...)` แล้วเช็ก `Number.isFinite`
- ไม่มี JSDoc, ไม่มี type, ไม่มี abstraction เกินจำเป็น — ฟังก์ชันสั้นและอยู่ใกล้ผู้เรียก

## 10. Branch และ PR

เรพนี้ในเวิร์กสเปซปัจจุบัน **ไม่ใช่ git repository** (`git rev-parse` ตอบ "not a git repository") ไม่มี `CONTRIBUTING.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/workflows/` หรือ `CODE_OF_CONDUCT.md` จึงไม่มี convention ที่เขียนไว้ให้ตาม

`.gitignore` มีบรรทัดเดียวคือ `.vercel` — ถ้าเริ่มใช้ git ให้คงบรรทัดนี้ไว้ (มี project id/org id ของ Vercel อยู่ข้างใน)

ข้อตกลงที่ไม่เป็นลายลักษณ์อักษรแต่ทีมใช้อยู่ (`HANDOFF.md` ข้อ 8): รัน `node smoke.js` ให้ผ่านก่อนทุกครั้งที่แตะ `api/_line.js` หรือ `api/_rooms.js` และทดสอบบน deployment จริง 1 รอบหลัง deploy

## 11. Code review checklist

ดึงมาจากข้อจำกัดจริงใน [`ARCHITECTURE.md`](./ARCHITECTURE.md) ข้อ 10 — ใช้ตอนรีวิว diff ที่แตะ `api/`

**สิทธิ์และข้อมูล**
- [ ] endpoint ที่คืนข้อมูลผู้ใช้เรียก `requireUser()` เป็นอย่างแรก และคืนทันทีถ้าได้ `null`
- [ ] มี ownership check ระดับห้อง (`isOwner(userId) || bound === room`) ไม่ใช่แค่ "ล็อกอินแล้ว"
- [ ] ไม่มี secret/token ใน query string หรือ URL ที่ผู้ใช้เห็น (token ส่งทาง header `x-seed-token` เท่านั้น)
- [ ] ไม่ได้เพิ่มทาง bypass ใหม่นอกเหนือจาก `x-seed-token` ที่มีอยู่

**State / Blob**
- [ ] key ใหม่ไม่ชนกับ key เดิมหลัง `pathOf` sanitize (จำไว้ว่า `:` → `-`)
- [ ] ไม่เรียก `@vercel/blob` ตรง ๆ ยกเว้นไฟล์ไบนารี
- [ ] ยังใช้ `useCache: false` ในทุก `_store.get()`
- [ ] ถ้าเป็น read-modify-write บน key เดียวกัน — เข้าใจว่า race ได้ และยอมรับได้ในบริบทนี้
- [ ] ไม่ได้คาดหวังประวัติ/transaction ที่ระบบไม่มี

**Response**
- [ ] error เป็น `{ error: { code, message } }`, `message` ภาษาไทย, `code` อังกฤษ
- [ ] GET ที่คืนสถานะที่เปลี่ยนได้มี `Cache-Control: no-store`
- [ ] push LINE ที่ล้มได้ถูกครอบ `try/catch` ไม่ทำให้ request หลักล้ม
- [ ] input ที่รับมีขอบเขต (ขนาด/ชนิด) แบบเดียวกับ `slip.js` (3MB, JPEG/PNG/WEBP)

**Runtime / env**
- [ ] env ใหม่ที่อ่านตอน module load ถูกบันทึกใน [`CONFIGURATION.md`](./CONFIGURATION.md) และรู้ว่าต้อง Redeploy
- [ ] ไม่ได้เพิ่ม dependency โดยไม่จำเป็น (ตอนนี้มีตัวเดียว)
- [ ] ไฟล์ helper ขึ้นต้นด้วย `_` ไม่ให้กลายเป็น route

**Webhook (ถ้าแตะ)**
- [ ] ยังอ่าน raw body และ verify signature ก่อนทุกอย่าง
- [ ] event ใหม่มี `try/catch` ต่อ event และไม่เพิ่มงานหนักจนตอบ 200 ช้า (LINE จะ retry → ทำงานซ้ำ เพราะไม่มี idempotency)
- [ ] ตอบ `200` เร็วที่สุด และไม่ throw ออกจาก handler

**ก่อน merge**
- [ ] `node smoke.js` ผ่าน
- [ ] ถ้าเปลี่ยน `_line.js` / `_rooms.js` มี assert เพิ่มใน `smoke.js` (เป็น harness เดียวที่มี — offline, ไม่มี dependency, ใช้ `assert`)
- [ ] ทดสอบบน deployment 1 ครั้งด้วย `x-seed-token` + ใน LINE 1 ครั้งสำหรับ path ที่แตะ

## เอกสารที่เกี่ยวข้อง

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — data flow, key map, ข้อจำกัดทั้งหมด (แหล่งของ checklist ข้อ 11)
- [`CONFIGURATION.md`](./CONFIGURATION.md) — env 13 ตัว, default, required
- [`GETTING-STARTED.md`](./GETTING-STARTED.md) — จาก clone ถึงคำขอแรกที่สำเร็จ
- [`API.md`](./API.md) — endpoint, auth, error
- [`../HANDOFF.md`](../HANDOFF.md) — กับดักที่เจอมาแล้ว, งานที่ยังเหลือ
