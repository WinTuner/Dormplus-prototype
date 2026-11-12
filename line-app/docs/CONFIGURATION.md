<!-- generated-by: gsd-doc-writer -->

# การตั้งค่า (CONFIGURATION)

เอกสารนี้อธิบายทุกค่าที่ระบบอ่านจาก `process.env` โดยไล่จากโค้ดจริงใน `api/*.js` ไม่มีการเดา รายการนี้คือ **ทั้งหมด** ของตัวแปรที่โค้ดอ่าน (16 ตัว) บวกกับตัวแปรที่ Vercel/`@vercel/blob` อ่านเองอีก 2 ตัว

> หมายเหตุ: `liff/bill.html` **ไม่อ่าน `process.env` เลย** หน้าเว็บได้ LIFF ID มาจาก `GET /api/config` ตอน runtime (`liff/bill.html` บรรทัด 56) ดังนั้นค่าที่หน้าเว็บเห็นคือค่าที่ฝั่ง server ส่งไปเท่านั้น

## 1. ตัวแปรทั้งหมด (สรุป)

| Variable | จำเป็น | Default ในโค้ด | ไฟล์ที่อ่าน | ถ้าไม่มี / ใส่ว่าง |
|---|---|---|---|---|
| `LINE_CHANNEL_SECRET` | ✅ | — | `api/_line.js` | webhook ทุก request ตอบ `401 bad signature` (`verify()` คืน `false`) |
| `LINE_CHANNEL_ACCESS_TOKEN` | ✅ | — | `api/_line.js` | ตอบ/ส่งการ์ดไม่ได้เลย LINE ตอบ 401 — `webhook`/`run`/`slip` ดัก error ไว้จึงยังคืน 200 แต่ `api/dev.js` ไม่มี try/catch จึงคืน **500** |
| `LIFF_ID` | ✅ | `null` | `api/config.js`, `api/_line.js`, `api/_auth.js` | `/api/config` คืน `liffId: null` → หน้าเว็บขึ้น "เปิดหน้านี้จากปุ่มในแชท LINE เท่านั้น"; ปุ่มในการ์ดเปิดเป็น URL ตรงแทน `liff.line.me`; และถ้าไม่มี `LOGIN_CHANNEL_ID` ด้วย ทุก endpoint ที่ต้องล็อกอินจะตอบ 401 |
| `OWNER_USER_ID` | ✅ | — | `api/_auth.js`, `api/slip.js` | ไม่มีใครเป็น owner → `/api/rooms`, `/api/run` ตอบ 403 และไม่มีการส่งการ์ด "ยืนยันการชำระ" ให้ใคร |
| `SEED_TOKEN` | ✅ | — | `api/dev.js`, `api/dev.js`, `api/_auth.js` | `/api/dev?do=seed` และ `/api/dev?do=sendbill` ตอบ 403 ทุกครั้ง · bypass `x-seed-token` ไม่ทำงานบน production อยู่แล้ว |
| `RICHMENU_OWNER_ID` | ไม่บังคับ | — | `api/owner-accept.js` | ไม่มีผล — เจ้าของที่รับสิทธิ์จะไม่ถูกสลับ rich menu |
| `RICHMENU_TENANT_ID` | ไม่บังคับ | — | `api/webhook.js` | ไม่มีผล — ผู้เช่าที่ผูกห้องจะไม่ถูกสลับ rich menu |
| `ALLOW_SEED_BYPASS` | ไม่บังคับ | — (ปิด) | `api/_auth.js` | ไม่มีผลบน production เว้นแต่ตั้งเป็น `true` — ใช้เปิด bypass บนเครื่องที่ไม่ได้รันบน Vercel |
| `PUBLIC_BASE_URL` | ไม่บังคับ | `` `https://${req.headers.host}` `` | `api/run.js`, `api/dev.js`, `api/webhook.js` | ใช้ host ของ request แทน (บน Vercel ปกติใช้ได้) |
| `ROOMS` | ไม่บังคับ | `201,202,203,204,205,206,207,208,209,210,211,212` | `api/_rooms.js` | ใช้ห้อง 201–212 |
| `DEFAULT_RENT` | ไม่บังคับ | `3500` | `api/_rooms.js` | ค่าเช่าเริ่มต้น 3,500 บาท/ห้อง |
| `WATER_RATE` | ไม่บังคับ | `25` | `api/_rooms.js` | ค่าน้ำ 25 บาท/หน่วย |
| `ELEC_RATE` | ไม่บังคับ | `7` | `api/_rooms.js` | ค่าไฟ 7 บาท/หน่วย |
| `BILL_PERIOD` | ไม่บังคับ | `null` (แต่ `seed.js` ใช้ `2026-11`) | `api/run.js`, `api/rooms.js`, `api/dev.js` | `/api/run` บังคับให้ส่ง `period` มาใน body ไม่งั้น `400`; `/api/rooms` คืน `period: null` |
| `BILL_DUE` | ไม่บังคับ | `null` (แต่ `seed.js` ใช้ `2026-11-16`) | `api/run.js`, `api/dev.js` | บิลมี `due: null` (การ์ดจะขึ้น "null") |
| `LOGIN_CHANNEL_ID` | ไม่บังคับ | อนุมานจาก `LIFF_ID` (ส่วนหน้า `-`) | `api/_auth.js` | ใช้ channel id ที่ derive จาก `LIFF_ID` |

ตัวแปรที่ **โค้ดไม่เคยอ่านเอง** แต่จำเป็นต่อการทำงาน (อ่านโดย library / platform):

| Variable | ใครอ่าน | ต้องสร้างเองไหม |
|---|---|---|
| `BLOB_STORE_ID` | `@vercel/blob` (`node_modules/@vercel/blob/dist/chunk-*.js` บรรทัด ~184) | ไม่ต้อง — `vercel storage connect` ใส่ให้อัตโนมัติ |
| `VERCEL_OIDC_TOKEN` | `@vercel/blob` (ใช้คู่กับ `BLOB_STORE_ID`) | ไม่ต้อง — Vercel ฉีดให้ตอน runtime บน deployment |

`BLOB_READ_WRITE_TOKEN` **ไม่ถูกใช้** ในโปรเจกต์นี้ เพราะทุก call ใช้ `access: "private"` + OIDC ไม่มี token ฝังในโค้ด (`api/_store.js`, `api/slip.js`, `api/slip-image.js`)

<!-- VERIFY: การตั้งค่า Blob store (ชื่อ store, region sin1) อยู่ใน README ข้อ 3 แต่ไม่ได้ยืนยันจาก dashboard/CLI — `vercel storage connect` เป็นผู้ใส่ BLOB_STORE_ID จริงหรือไม่ ให้เช็กที่ Project → Settings → Environment Variables -->
<!-- VERIFY: Vercel ฉีด VERCEL_OIDC_TOKEN ให้อัตโนมัติทุก deployment (รวม Preview) หรือไม่ — ไม่มีไฟล์ในเรพที่ยืนยันเรื่องนี้ -->

## 2. รายละเอียดของแต่ละตัว

### 2.1 กลุ่ม LINE

**`LINE_CHANNEL_SECRET`** — Channel secret จาก Messaging API channel ใช้คำนวณ `HMAC-SHA256(rawBody)` เป็น base64 แล้วเทียบกับ header `x-line-signature` ใน `api/_line.js` `verify()` ถ้าไม่มี secret ฟังก์ชันคืน `false` ทันที (ไม่ได้ throw) ทำให้ webhook ตอบ `401` เงียบ ๆ — อาการที่เจอบ่อยคือ "Verify ไม่ผ่าน" ใน LINE Developers Console

**`LINE_CHANNEL_ACCESS_TOKEN`** — long-lived channel access token ใช้เป็น `Authorization: Bearer` ใน `call()` ของ `api/_line.js` ซึ่งเป็นทางเดียวที่ระบบใช้ส่งข้อความ (`reply`, `push`, การ์ดบิล/การ์ดยืนยัน) ถ้า token ผิดหรือหมดอายุ `call()` throw แต่ผู้เรียกส่วนใหญ่ดัก error ไว้ (`api/webhook.js` ต่อ event, `api/run.js` ต่อห้อง, `api/slip.js`) ระบบจึงไม่ล่ม แต่ผู้ใช้จะไม่ได้รับข้อความ

**`LIFF_ID`** — รูปแบบ `1234567890-AbCdEfGh` ใช้สามที่:
1. `api/config.js` → `GET /api/config` คืน `{ liffId }` ให้หน้าเว็บ `liff.init()` (endpoint เดียวที่เปิดสาธารณะ)
2. `api/_line.js` → ถ้าไม่มี ปุ่มในการ์ดบิลจะ fallback ไป `${baseUrl}/liff/bill.html?room=<room>` (เปิดในเบราว์เซอร์ ไม่ใช่ใน LINE) และปุ่ม "ดูสลิป" ใน `confirmBubble()` จะหายไป
3. `api/_auth.js` → ใช้ส่วนหน้าตัว `-` เป็น LINE Login channel id (`client_id`) สำหรับยิง `/oauth2/v2.1/verify`

**`LOGIN_CHANNEL_ID`** — ทางหนีเมื่อ channel id ของ LINE Login ไม่ตรงกับ prefix ของ LIFF ID (เช่น LIFF อยู่คนละ provider) ถ้าตั้ง จะถูกใช้แทนค่า derive ทั้งหมด

**`OWNER_USER_ID`** — LINE userId ของเจ้าของหอ เป็นตัวตัดสินสิทธิ์ทั้งหมด (`isOwner()` เทียบตรงตัว) และเป็นปลายทางของการ์ด "ยืนยันการชำระ" ใน `api/slip.js` **1 deploy = 1 เจ้าของ** ยังไม่รองรับหลายคน

**`SEED_TOKEN`** — รหัสลับสำหรับงาน dev/ทดสอบ มีผลสามที่:
- `POST /api/dev?do=seed&token=<SEED_TOKEN>` — สร้างบิลตัวอย่างทุกห้อง (idempotent)
- `POST /api/dev?do=sendbill&token=<SEED_TOKEN>` — ยิงการ์ดบิลหาหนึ่ง userId
- header `x-seed-token: <SEED_TOKEN>` — bypass การตรวจ idToken ใน `requireUser()` แล้วคืน `OWNER_USER_ID` (หรือ `"dev"` ถ้าไม่ได้ตั้ง) · **ทำงานเฉพาะ preview/dev หรือเมื่อตั้ง `ALLOW_SEED_BYPASS=true`**

> ⚠️ ค่า token ติดไปใน access log เพราะส่งทาง query string · production ปิด bypass ไว้แล้ว (`BYPASS_ALLOWED` = false) เหลือความเสี่ยงเฉพาะ `/api/dev?do=seed` และ `/api/dev?do=sendbill` ที่ยังใช้ `?token=` อยู่ — อย่าแชร์ URL พวกนี้

### 2.2 กลุ่มข้อมูลห้องและบิล

**`ROOMS`** — รายชื่อห้อง คั่นด้วย comma อ่าน **ครั้งเดียวตอน module load** ใน `api/_rooms.js` ใช้กำหนดว่าห้องไหนถูก seed, แสดงในหน้าจดมิเตอร์ (`/api/rooms`), และถูกออกบิล ถ้าเปลี่ยนรายชื่อห้องภายหลัง ข้อมูลใน Blob ของห้องเดิมจะยังอยู่ (key `room:<room>`, `bill:<room>`, `meter:<room>`) และจะไม่ถูกลบให้

**`DEFAULT_RENT` / `WATER_RATE` / `ELEC_RATE`** — ค่าเริ่มต้นต่อห้อง ถูก wrap ด้วย `Number()` ทั้งหมด ถ้าใส่อย่างที่แปลงเป็นตัวเลขไม่ได้จะได้ `NaN` แล้วยอดบิลทั้งหมดกลายเป็น `NaN` (ไม่ error) ค่าเฉพาะห้องเขียนทับได้ด้วย key `room:<room>` ใน Blob ซึ่ง `configFor(room)` จะ merge ให้ (`{...DEFAULTS, ...roomConfig}`)

**`BILL_PERIOD`** — ค่าเริ่มต้นของรอบบิล (`2026-11`) ใช้ใน `api/run.js` (ถ้า body ไม่ส่ง `period` มา), `api/dev.js`, และแสดงใน `GET /api/rooms` ถ้าไม่ตั้งและไม่ส่งมา `/api/run` จะตอบ `400 VALIDATION` — คือ **เป็นตัวเดียวในกลุ่มนี้ที่ทำให้ endpoint หลักใช้ไม่ได้ถ้าไม่ตั้ง**

**`BILL_DUE`** — วันครบกำหนด ใช้ใน `api/run.js` และ `api/dev.js` ไม่บังคับ: ถ้าไม่มี บิลเก็บ `due: null` และการ์ด LINE จะแสดงคำว่า `null`

### 2.3 กลุ่ม URL

**`PUBLIC_BASE_URL`** — โดเมนเต็มของแอป (`https://<โดเมน>`) ใช้สร้างลิงก์ในการ์ดเมื่อไม่มี `LIFF_ID` เท่านั้น fallback คือ `` `https://${req.headers.host}` `` ซึ่งบน Vercel ให้โดเมนที่ถูกต้องอยู่แล้ว จึงเป็นตัว "แนะนำ" ไม่ใช่ "จำเป็น"

## 3. Required vs optional — สรุปสั้น

ตั้งแล้วระบบพังทันที/ใช้ไม่ได้: `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `LIFF_ID`, `OWNER_USER_ID`

ตั้งแล้ว endpoint ป้องกันตัวเองปิด: `SEED_TOKEN` (ถ้าไม่ตั้ง `/api/dev?do=seed` และ `/api/dev?do=sendbill` ใช้ไม่ได้ ซึ่งปลอดภัยกว่า)

ที่เหลือมี default ในโค้ดทั้งหมด: `PUBLIC_BASE_URL`, `ROOMS`, `DEFAULT_RENT`, `WATER_RATE`, `ELEC_RATE`, `LOGIN_CHANNEL_ID` และ `BILL_PERIOD`/`BILL_DUE` ที่ default เป็น `null` (ยกเว้น path ของ `api/dev.js` ที่ hardcode `2026-11` / `2026-11-16`)

## 4. ไม่มีไฟล์ config และไม่มี `.env`

โปรเจกต์นี้ **ไม่มี** `config.json`, `config.yaml`, `.env`, `.env.example` หรือ `.env.*` ใด ๆ และ **ไม่มี dotenv** ใน dependency — dependency ตัวเดียวคือ `@vercel/blob` (`package.json`) `.gitignore` มีบรรทัดเดียวคือ `.vercel`

ผลที่ตามมา: **โค้ดจะไม่อ่านไฟล์ `.env`** การใส่ค่าในไฟล์ `.env` เฉย ๆ ไม่มีผลอะไร เพราะไม่มีอะไรโหลดไฟล์นั้นเข้า `process.env` (Node อ่าน `.env` เองได้เฉพาะเมื่อสั่ง `--env-file` ซึ่งไม่มีในโปรเจกต์นี้เพราะ `package.json` ไม่มี `scripts` เลย)

## 5. ค่า default ทั้งหมดที่อยู่ในโค้ด

| ค่า | Default | ที่มา |
|---|---|---|
| รายชื่อห้อง | `201`–`212` (12 ห้อง) | `api/_rooms.js` บรรทัด 4 |
| ค่าเช่า/ห้อง | `3500` บาท | `api/_rooms.js` บรรทัด 10 |
| ค่าน้ำ | `25` บาท/หน่วย | `api/_rooms.js` บรรทัด 11 |
| ค่าไฟ | `7` บาท/หน่วย | `api/_rooms.js` บรรทัด 12 |
| รอบบิลของ seed | `2026-11` | `api/dev.js` บรรทัด 11 |
| ครบกำหนดของ seed | `2026-11-16` | `api/dev.js` บรรทัด 34 |
| ค่าเช่าห้องที่ index หาร 3 ลงตัวตอน seed | `3220` บาท | `api/dev.js` บรรทัด 15 (สร้างความต่างของข้อมูลตัวอย่าง) |
| หน่วยน้ำ/ไฟของ seed | `4 + (i % 4)` / `28 + (i % 6) * 7` | `api/dev.js` |
| base URL | `https://<host ของ request>` | `api/run.js`, `api/dev.js`, `api/webhook.js` |
| userId ตอนใช้ bypass และไม่ได้ตั้ง `OWNER_USER_ID` | `"dev"` | `api/_auth.js` บรรทัด 19 |

## 6. Runtime และการ deploy

- **Node.js `>=20`** ตาม `engine` ใน `package.json` (ระบุว่า `"node": ">=20"`) — ไม่มี `.nvmrc` หรือ `.node-version` ในเรพ
- **dependency เดียว**: `@vercel/blob` `^2.9.0`
- **ไม่มีขั้นตอน build** — ไม่มี `scripts` ใน `package.json` ทั้งหมด Vercel จึง deploy แบบ static + serverless function ตรง ๆ

`vercel.json` มีแค่ rewrite เดียว:

```json
{
  "rewrites": [
    { "source": "/", "destination": "/liff/bill.html" }
  ]
}
```

คือเปิดโดเมนราก `/` แล้วได้หน้า LIFF ทันที ส่วน `/api/*` ไม่ต้องประกาศ เพราะ Vercel เปิดไฟล์ใน `api/` เป็น route ตามชื่อไฟล์อัตโนมัติ

<!-- VERIFY: Node runtime ที่โปรเจกต์นี้ใช้จริงบน Vercel (20.x หรือ 22.x) ไม่ได้ระบุในเรพ — ดูได้ที่ Project → Settings → General → Node.js Version -->
<!-- VERIFY: production URL https://line-app-iota.vercel.app มาจาก HANDOFF.md ซึ่งเป็นเอกสารของทีม ไม่ได้ยืนยันจาก Vercel -->

## 7. รันในเครื่อง (ไม่มี dependency และไม่มี `.env`)

**สรุป: ไม่มีโหมดรันเซิร์ฟเวอร์ในเครื่องจากเรพนี้** ไม่มี `npm start`, `npm run dev`, `vercel dev` script หรือ dev server ใด ๆ เพราะ `package.json` ไม่มี `scripts` และไม่มี `.env` ให้โหลด

สิ่งเดียวที่รันได้จริงจากเรพคือ smoke test แบบ offline:

```bash
node smoke.js
```

`smoke.js` ทำงานได้เพราะมัน **ตั้ง env เองในโปรเซสก่อน require โมดูล** (บรรทัด 2–3):

```js
process.env.LINE_CHANNEL_SECRET = "test-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
const { verify, billBubble, confirmBubble } = require("./api/_line");
```

ลำดับนี้สำคัญ: `api/_line.js` และ `api/_rooms.js` อ่าน `process.env` **ตอน module load** (ค่าถูกจับใส่ `const` ระดับบนสุด) ถ้าตั้ง env ทีหลัง `require` จะไม่มีผลกับค่าที่ถูกจับไปแล้ว และเช่นเดียวกันบน Vercel — **แก้ env แล้วต้อง Redeploy** ค่าใหม่จึงจะมีผลกับ instance ที่ warm อยู่

ถ้าต้องการยิง API จริงในเครื่อง ต้องตั้ง env ใน shell เอง (ไม่มีไฟล์ให้โหลด) เช่น:

```bash
# PowerShell — ตัวอย่าง ต้องมี Blob credential เองด้วย
$env:LINE_CHANNEL_SECRET="..."; $env:LINE_CHANNEL_ACCESS_TOKEN="..."; $env:LIFF_ID="..."; $env:OWNER_USER_ID="U..."; $env:SEED_TOKEN="dev"
```

แต่ยังไม่มีตัวรัน HTTP server ในเรพ — ทางที่ใช้ได้จริงคือ `vercel dev` (ติดตั้ง Vercel CLI เอง) หรือทดสอบบน deployment จริงด้วย `x-seed-token` ตาม `HANDOFF.md` ข้อ 4

<!-- VERIFY: `vercel dev` ใช้ได้กับโปรเจกต์นี้หรือไม่ และสามารถดึง Blob credential/OIDC มาใช้ในเครื่องได้หรือไม่ — ไม่มี config หรือ script ในเรพที่ยืนยัน -->
<!-- VERIFY: วิธีขอ OIDC token สำหรับเรียก Blob จากเครื่อง (เช่น `vercel env pull` หรือ `vercel blob` CLI) ไม่ปรากฏในเรพ -->

## 8. แยกตาม environment

Vercel อ่าน env จาก Project → Settings → Environment Variables โดย README ระบุให้ใส่ **ทั้ง Production และ Preview** ไม่มีไฟล์ `.env.development` / `.env.production` / `.env.test` ในเรพ และไม่มี condition `NODE_ENV` ในโค้ดเลย — โค้ดทำงานเหมือนกันทุก environment ต่างกันแค่ค่าที่ฉีดเข้าไป

ข้อควรระวังเวลาใช้ Preview: Preview deployment มีโดเมนคนละอันกับ production ถ้าไม่ได้ตั้ง `PUBLIC_BASE_URL` จะใช้ host ของ request (ถูกต้องตาม deployment นั้น) แต่ถ้าตั้งเป็นโดเมน production ไว้ ลิงก์ในการ์ดจาก Preview จะชี้ไป production

<!-- VERIFY: ค่า env ของ Preview deployment จริงใน Vercel project นี้ (ว่าตั้งแยกจาก Production หรือใช้ร่วม) — ไม่มีในเรพ -->
