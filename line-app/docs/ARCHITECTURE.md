<!-- generated-by: gsd-doc-writer -->

# สถาปัตยกรรมระบบ DormPlus LINE app

## 1. ภาพรวมระบบ

ระบบนี้เป็นแอปออกบิลหอพักที่ทำงานอยู่ใน LINE ทั้งหมด: **ไม่มี framework, ไม่มีขั้นตอน build, ไม่มีฐานข้อมูล** สิ่งที่ deploy ขึ้น Vercel มีเพียงสองอย่างคือ หน้า static ไฟล์เดียว `liff/bill.html` (โหลด LIFF SDK จาก LINE) และ serverless function ภาษา CommonJS ใต้โฟลเดอร์ `api/` ที่ Vercel เปิดเป็น route ตามชื่อไฟล์ (`api/bill.js` → `/api/bill`)

อินพุตมีสองทาง: (1) LINE Messaging API ยิง webhook เข้า `POST /api/webhook` เมื่อมีข้อความ/postback และ (2) ผู้ใช้เปิดหน้า LIFF แล้วเรียก API ด้วย `Authorization: Bearer <idToken>` เอาต์พุตคือข้อความ/การ์ด Flex ที่ส่งกลับเข้าแชท LINE และ JSON ที่หน้า LIFF เอาไปวาด

สถานะทั้งหมดเก็บใน **Vercel Blob แบบ private** โดยใช้เป็น key-value store: หนึ่ง key = หนึ่งไฟล์ JSON ใต้พาธ `kv/` ส่วนรูปสลิปเก็บแยกที่ `slips/` dependency ตัวเดียวของโปรเจกต์คือ `@vercel/blob` (`package.json`)

รูปแบบสถาปัตยกรรมจึงเป็น *stateless serverless functions + external blob store* ไม่มีเลเยอร์ middleware กลาง ทุก endpoint ประกอบ `_auth` / `_store` / `_line` เองทีละไฟล์

## 2. แผนผังองค์ประกอบ

```mermaid
graph TD
  LINE["LINE Platform<br/>Messaging API"] -->|"POST /api/webhook<br/>x-line-signature"| WH["api/webhook.js"]
  WH --> ST["api/_store.js"]
  WH --> LN["api/_line.js"]
  LN -->|"reply / push"| LINE

  LIFF["liff/bill.html<br/>+ LIFF SDK"] -->|"Bearer idToken"| EP["api/me · bill · slip ·<br/>slip-image · rooms · run"]
  EP --> AU["api/_auth.js"]
  AU -->|"POST /oauth2/v2.1/verify"| LINE
  EP --> ST
  EP --> LN
  EP --> RM["api/_rooms.js"]
  ST --> BLOB[("Vercel Blob (private)<br/>kv/*.json · slips/*")]
```

- `api/config.js` เป็น endpoint เดียวที่เปิดสาธารณะ (คืนแค่ `liffId`) ไม่ผ่าน `_auth`
- `api/dev.js` ไม่ผ่าน `requireUser` แต่ใช้ `seedTokenOk()` ของ `_auth` (header `x-seed-token`) และตอบ 404 บน production
- `_rooms.js` อ่าน `process.env.ROOMS` ตอน module load และอ่าน `room:<room>` จาก Blob ผ่าน `_store.js`

## 3. เส้นทาง request ที่มีจริง

### 3.1 แชท → webhook → reply/push

1. LINE ยิง `POST /api/webhook` พร้อม header `x-line-signature`
2. `webhook.js` อ่าน body ดิบจาก stream (`readRaw`) เพราะ signature ต้องคำนวณจาก byte จริง
3. `_line.verify()` คำนวณ `HMAC-SHA256(rawBody, LINE_CHANNEL_SECRET)` เป็น base64 แล้วเทียบตรงกับ header — ไม่ผ่านคือ `401 bad signature`
4. `JSON.parse` ไม่ผ่านคือ `400 invalid json`
5. วน `body.events` ด้วย `Promise.all` เรียก `handleEvent()` ทีละ event โดยมี `try/catch` ต่อ event (event หนึ่งพังไม่บล็อกตัวอื่น) แล้วตอบ `200 {ok:true}` หลังทุก event ทำงานเสร็จ
6. `handleEvent()` รองรับเฉพาะ:
   - `follow` → เขียน `user:<userId> = {followedAt}` แล้ว `reply()` ข้อความต้อนรับ
   - `message` ชนิด `text` ค่า `บิล`/`bill` → อ่าน `user-room:<userId>` แล้ว `bill:<room>` → `reply()` การ์ด `billBubble()`
   - `message` ชนิด `text` รูปแบบ `ผูก <เลข 2-4 หลัก>` → **ต้องมี `bill:<room>` อยู่ก่อน** ไม่งั้นตอบ "ไม่พบห้อง" แล้วเขียน `user-room:<userId>` และ `room-user:<room>` (ผูกสองทาง)
   - `postback` ที่ `action=confirm` → ดูข้อ 5
   - event ชนิดอื่นถูกเมิน (ยังตอบ 200)
7. การส่งกลับใช้ `reply(replyToken, messages)` ถ้ามี replyToken และใช้ `push(to, messages)` เมื่อต้องส่งหาคนที่ไม่ได้เป็นคนกด (เช่น แจ้งผู้เช่าว่าชำระแล้ว)

### 3.2 LIFF → idToken → API

1. เปิด `/liff/bill.html` (rewrite `/` → หน้านี้ใน `vercel.json`)
2. `boot()` เรียก `GET /api/config` (public) เอา `liffId` แล้ว `liff.init()`
3. ถ้ายังไม่ล็อกอิน → `liff.login()`; ถ้า `getIDToken()` คืนค่าว่าง → หน้าแจ้งว่า LIFF ยังไม่เปิด scope `openid`
4. `api()` ในหน้าเว็บแนบ `Authorization: Bearer <idToken>` ทุกครั้ง (และ `Content-Type: application/json` เมื่อมี body)
5. ฝั่ง server `_auth.requireUser()`:
   - ถ้า `BYPASS_ALLOWED` (`vercel dev` หรือ `ALLOW_SEED_BYPASS=true` นอก production) และ header `x-seed-token` ตรงกับ `SEED_TOKEN` (≥ 16 ตัว) → คืน `OWNER_USER_ID || "dev"` · production ไม่มี bypass
   - ถ้าไม่มี token หรือไม่มี `CHANNEL_ID` → `401 UNAUTHORIZED`
   - ถ้าไม่ตรง → `POST https://api.line.me/oauth2/v2.1/verify` ด้วย `id_token` + `client_id` = `CHANNEL_ID` แล้วเอา `payload.sub` เป็น userId; ผิด/หมดอายุ → `403 FORBIDDEN`
6. `CHANNEL_ID` = `LOGIN_CHANNEL_ID` หรือถ้าไม่ตั้งก็ใช้ prefix ของ `LIFF_ID` (ตัดที่ `-`) — คำนวณตอน module load
7. endpoint ที่ต้อง userId ของผู้ใช้เอง: `isOwner(userId)` (async) = `OWNER_USER_ID` หรือมี key `owner:<userId>` (ได้สิทธิ์จาก QR ของเจ้าของเดิม) · ส่วนผู้เช่าเทียบ `user-room:<userId>` ว่าผูกห้องหรือยัง

### 3.3 ออกรอบบิล (เจ้าของ)

1. หน้า owner view เรียก `GET /api/rooms` → ได้ทุกห้อง + `config` + `meter` + `bill` + `tenant`
2. ผู้ใช้กรอกหน่วยน้ำ/ไฟ; หน้าเว็บคำนวณยอดโชว์สด ๆ ด้วย `rent + water*waterRate + elec*elecRate`
3. กดปุ่ม → `POST /api/run` body `{period, due, readings:[{room, water, elec}]}`
4. `run.js` เช็ก `POST` + owner + `readings` ไม่ว่าง + มี `period` (จาก body, `BILL_PERIOD`)
5. ต่อห้อง: `configFor(room)` → คูณหน่วยเป็นบาท (`Math.round`) → เขียน `meter:<room>` → เขียน `bill:<room>` (สถานะ `unpaid` เสมอ) → ถ้ามี `room-user:<room>` ก็ `push()` การ์ดบิล (ถ้า push พังแค่ log แล้วคืน `pushed:false`)
6. ตอบกลับ `{ok, period, due, rooms:[{room,total,pushed}]}` ให้หน้าเว็บสรุป

### 3.4 แนบสลิป → เจ้าของยืนยัน → ปิดบิล

1. ผู้เช่ากด "แนบสลิป & แจ้งชำระ" → หน้าเว็บย่อรูปในเบราว์เซอร์ (`createImageBitmap` → canvas ด้านยาวสุด 1280px → `toDataURL("image/jpeg", 0.8)`) แล้ว `POST /api/slip` body `{room, image}`
2. `slip.js` ตรวจสิทธิ์ห้องเดียวกับ `bill.js`; ถ้าบิล `paid` แล้ว → `409 INVALID_STATE`
3. ถ้ามี `image`: ต้องตรง regex `data:image/(jpeg|png|webp);base64,...`, ถอด base64, เกิน 3MB → `413 TOO_LARGE`; เขียนไฟล์ด้วย `put()` ตรง ๆ (ไม่ผ่าน `_store`) ที่ `slips/<room>-<timestamp>.<ext>` แบบ private
4. เขียน `bill:<room>` เป็นสถานะ `pending` พร้อม `slipPath`, `slipNote`, `slipAt`
5. `push()` การ์ด `confirmBubble()` หา `OWNER_USER_ID` — push พังไม่ทำให้ request ของผู้เช่าล้ม
6. เจ้าของกดปุ่ม "ยืนยันการชำระ" → postback `action=confirm&room=<room>` → `POST /api/webhook`
7. `webhook.js` (ไม่เช็กว่า userId เป็นเจ้าของ — ดูข้อจำกัดข้อ 6) เขียน `bill:<room>` เป็น `paid` + `paidAt` แล้ว `push()` แจ้งผู้เช่าจาก `room-user:<room>` และ `reply()` ยืนยันกลับ
8. ดูรูปสลิป: `GET /api/slip-image?room=` → ตรวจสิทธิ์ → `get(bill.slipPath, {access:"private", useCache:false})` → stream byte กลับพร้อม `Cache-Control: private, no-store`

## 4. บทบาทผู้ใช้

| บทบาท | นิยามในโค้ด | เห็นอะไร | ทำอะไรได้ |
|---|---|---|---|
| ผู้เช่า (tenant) | ผู้ใช้ที่ผูกห้องแล้ว (`user-room:<userId>` มีค่า) | บิลของห้องตัวเอง, สลิปของห้องตัวเอง | `GET /api/bill`, `POST /api/slip`, `GET /api/slip-image`, ดูบิลในแชท |
| เจ้าของ (owner) | `OWNER_USER_ID` (คนแรก ตั้งด้วยมือ) หรือมี key `owner:<userId>` (ได้สิทธิ์จาก QR ของเจ้าของเดิม) — `_auth.isOwner()` เป็น async | ทุกห้อง ทุกบิล ทุกสลิป | `GET /api/rooms`, `POST /api/run`, ดูบิล/สลิปทุกห้อง, ยืนยันการชำระ, ออก QR เพิ่มเจ้าของ |
| ผู้ใช้ที่ยังไม่ผูกห้อง | ไม่มี `user-room:<userId>` | หน้า LIFF ขึ้น "ยังไม่ได้ผูกห้อง" | `GET /api/me` เท่านั้น · `GET /api/bill` และ `POST /api/slip` → 400 (ไม่มี room) · `GET /api/slip-image` → 403 |
| dev bypass (`vercel dev` เท่านั้น ยกเว้นตั้ง `ALLOW_SEED_BYPASS`) | header `x-seed-token` = `SEED_TOKEN` และ `BYPASS_ALLOWED` | เท่ากับเจ้าของ | ทุก endpoint ที่ใช้ `requireUser` — production ปฏิเสธ |

- `OWNER_USER_ID` มีคนเดียวต่อ deployment → 1 deploy = 1 หอ
- `isOwner()` เป็น **async** (อ่าน Blob) — คืน `true` ถ้า userId ตรงกับ `OWNER_USER_ID` หรือมี key `owner:<userId>` · ถ้าไม่ได้ตั้ง `OWNER_USER_ID` จะไม่มีใครออก QR เพิ่มเจ้าของได้ (`/api/owner` ตอบ 409) แต่เจ้าของที่เคยได้สิทธิ์ยังใช้ได้
- rich menu แยกตามบทบาท: ผู้เช่าได้เมนูบิลเมื่อ `ผูก <room>` สำเร็จ · เจ้าของได้เมนูจดมิเตอร์เมื่อรับสิทธิ์ทาง QR (ผูกผ่าน Messaging API `POST /v2/bot/user/{userId}/richmenu/{id}`; สคริปต์สร้างเมนูอยู่ที่ `scripts/setup-richmenu.js`)
- ตัว bypass ใน `_auth.js` ถูกจำกัดด้วย `BYPASS_ALLOWED` (`vercel dev` หรือ `ALLOW_SEED_BYPASS=true` นอก production) — production ปฏิเสธเสมอ แม้ตั้ง `ALLOW_SEED_BYPASS`

## 5. State machine ของบิล

บิลหนึ่งใบต่อหนึ่งห้อง (`bill:<room>`) สถานะอยู่ในฟิลด์ `status` และถูกเขียนทับทั้งก้อนทุกครั้ง (ไม่มี event log)

```mermaid
stateDiagram-v2
  [*] --> unpaid: POST /api/run (เจ้าของ) หรือ POST /api/dev?do=seed
  unpaid --> pending: POST /api/slip
  pending --> pending: POST /api/slip อีกครั้ง (เปลี่ยนรูป)
  unpaid --> paid: postback action=confirm
  pending --> paid: postback action=confirm (เจ้าของ)
  paid --> unpaid: POST /api/run รอบใหม่ (เขียนทับทั้งใบ)
```

| การเปลี่ยนสถานะ | ใคร/what | ไฟล์ | เงื่อนไข/ผลข้างเคียง |
|---|---|---|---|
| → `unpaid` | `POST /api/run` | `api/run.js` | เขียนทับบิลเดิมทั้งใบเสมอ (ไม่เช็กสถานะเก่า) — ประวัติรอบก่อนหาย |
| → `unpaid` | `POST /api/dev?do=seed&token=` | `api/dev.js` | เขียนทับทุกห้องใน `ROOMS` ด้วยข้อมูลตัวอย่าง |
| `unpaid`/`pending` → `pending` | `POST /api/slip` | `api/slip.js` | ตั้ง `slipAt` ใหม่ทุกครั้ง; `slipPath` เดิมถูกเก็บต่อถ้าไม่ได้แนบรูปใหม่ |
| ไม่เปลี่ยน | `POST /api/slip` ตอน `paid` | `api/slip.js` | ตอบ `409 INVALID_STATE` |
| → `paid` | postback `action=confirm` | `api/webhook.js` | ถ้า `paid` อยู่แล้วตอบ "ยืนยันไปแล้ว" ไม่เขียนซ้ำ |

ข้อสังเกตที่โค้ดทำจริง: postback ยืนยัน **ตรวจว่า event มาจาก `OWNER_USER_ID`** (`isOwner`) ก่อนปิดบิล — ผู้ที่ไม่ใช่เจ้าของถูกปฏิเสธและสถานะไม่เปลี่ยน · แต่ยังยอมให้กระโดดจาก `unpaid` → `paid` ได้โดยตรงถ้าเจ้าของกด

## 6. ข้อมูลที่เก็บ (Blob key map)

`_store.js` แปลง key เป็น pathname ด้วย `kv/${key.replace(/[^a-zA-Z0-9._-]/g,"-")}.json` — เครื่องหมาย `:` จึงกลายเป็น `-`

| key ที่เรียกใช้ในโค้ด | pathname จริง | ค่า | เขียนโดย | อ่านโดย |
|---|---|---|---|---|
| `user:<userId>` | `kv/user-<userId>.json` | `{ followedAt }` | webhook (`follow`) | ไม่มีที่อ่าน |
| `user-room:<userId>` | `kv/user-room-<userId>.json` | `"203"` (string) | webhook (`ผูก`) | webhook, `me`, `bill`, `slip`, `slip-image` |
| `room-user:<room>` | `kv/room-user-<room>.json` | `"U..."` (string) | webhook (`ผูก`) | `run`, `rooms`, `webhook` (แจ้งผู้เช่า) |
| `bill:<room>` | `kv/bill-<room>.json` | bill object | `run`, `seed`, `slip`, `webhook` | `webhook`, `bill`, `slip`, `slip-image`, `rooms` |
| `meter:<room>` | `kv/meter-<room>.json` | `{ water, elec, at }` | `run` | `rooms` |
| `room:<room>` | `kv/room-<room>.json` | `{ rent, waterRate, elecRate }` | `seed` | `_rooms.configFor` |
| `slips/<room>-<ts>.<ext>` | pathname เดียวกัน (ไม่อยู่ใต้ `kv/`) | ไฟล์รูป | `slip.js` (`put`) | `slip-image.js` (`get`) |

bill object ที่ `run.js` สร้าง: `{ room, period, rent, water, elec, waterUnits, elecUnits, total, due, status }` — `slip.js` เพิ่ม `slipPath`, `slipNote`, `slipAt`; `webhook.js` เพิ่ม `paidAt`; `GET /api/bill` ตอบเพิ่ม `hasSlip: !!bill.slipPath` โดยไม่เก็บลง Blob

การตั้งค่า Blob: ทุก call ระบุ `access: "private"` และไม่มีการใส่ token ในโค้ด (ใช้ OIDC ของ Vercel) — โค้ดอ่านค่า store จาก environment ที่ Vercel ตั้งให้ <!-- VERIFY: ชื่อ env `BLOB_STORE_ID` และการผูก store ผ่าน `vercel storage connect` มาจาก README ไม่ใช่จากโค้ด --> ฝั่งอ่านใช้ `useCache: false` ทุกครั้ง ซึ่งเป็นเงื่อนไขจำเป็น ไม่ใช่ตัวเลือก

## 7. ความรับผิดชอบของไฟล์

| ไฟล์ | หน้าที่ | หมายเหตุ |
|---|---|---|
| `api/webhook.js` | รับ event LINE, ตรวจ signature, จัดการ `follow`/ข้อความ/`postback` | อ่าน raw body เอง; ตอบ 200 หลังประมวลผลทุก event |
| `api/_line.js` | `verify()`, `reply()`, `push()`, `billBubble()`, `confirmBubble()`, `LIFF_ID` | อ่าน env 3 ตัวตอน module load; เรียก `https://api.line.me/v2/bot/*` |
| `api/_auth.js` | `requireUser()`, `isOwner()`, `CHANNEL_ID`, `BYPASS_ALLOWED` | ตรวจ idToken กับ LINE; bypass `x-seed-token` เฉพาะ `vercel dev` หรือเมื่อตั้ง `ALLOW_SEED_BYPASS=true` (production ปิดเสมอ) |
| `api/_store.js` | `get(key)` / `set(key, value)` บน Blob | JSON เท่านั้น; หนึ่ง key = หนึ่งไฟล์; เขียนทับได้ |
| `api/_rooms.js` | `ROOMS`, `DEFAULTS`, `configFor(room)` | ค่า default จาก env, ทับด้วย `room:<room>` |
| `api/me.js` | `GET` ข้อมูลตัวเอง: `userId`, `owner`, `room` | ใช้ตัดสินว่า LIFF จะแสดง view ไหน |
| `api/bill.js` | `GET` บิลห้องเดียว | ผู้เช่าเห็นเฉพาะห้องที่ผูก, เจ้าของเห็นทุกห้อง |
| `api/slip.js` | `POST` แนบสลิป → `pending` + push การ์ดหาเจ้าของ | เขียนไฟล์รูปเองด้วย `put()`; จำกัด 3MB |
| `api/slip-image.js` | `GET` stream รูปสลิป private | ตรวจสิทธิ์รายห้องก่อนอ่าน |
| `api/rooms.js` | `GET` ทุกห้อง + config + meter + bill + tenant | เฉพาะเจ้าของ |
| `api/run.js` | `POST` ออกรอบบิลจากหน่วยมิเตอร์ + push การ์ด | เฉพาะเจ้าของ; เขียน `meter` + `bill` ต่อห้อง |
| `api/dev.js` | `POST` ใส่บิลตัวอย่างทุกห้อง (header `x-seed-token`) | เขียนทับของเดิมได้ · production ตอบ 404 |
| `api/dev.js` | `POST` ยิงการ์ดบิลหาคนเดียว (header `x-seed-token`) | เครื่องมือทดสอบ · production ตอบ 404 |
| `api/config.js` | `GET` คืน `{ liffId }` | public โดยตั้งใจ |
| `liff/bill.html` | หน้าเดียว 2 บทบาท + ตัวเรียก API ทั้งหมด | ไม่มี build; inline CSS/JS; ใช้ LIFF SDK จาก CDN |
| `smoke.js` | เทสต์ offline: signature + รูปการ์ด + postback data | ใช้ `assert`, ตั้ง env ปลอมเอง |
| `vercel.json` | rewrite `/` → `/liff/bill.html` | ไม่มี `crons`, ไม่มี build config |

## 8. Abstraction หลัก

| Abstraction | ที่อยู่ | หน้าที่ |
|---|---|---|
| `get` / `set` | `api/_store.js` | ทางเดียวที่โค้ดส่วนใหญ่แตะ Blob (ยกเว้นไฟล์รูปใน `slip.js` / `slip-image.js` ที่เรียก `@vercel/blob` ตรง) |
| `pathOf` (internal) | `api/_store.js` | แปลง key → pathname และ sanitize อักขระที่ Blob ไม่ชอบ |
| `requireUser(req, res)` | `api/_auth.js` | คืน userId หรือตอบ 401/403 เองแล้วคืน `null` (ผู้เรียกแค่ `if (!userId) return;`) |
| `isOwner(userId)` | `api/_auth.js` | เทียบกับ `OWNER_USER_ID` คนเดียว |
| `verify(rawBody, signature)` | `api/_line.js` | HMAC-SHA256/base64 ของ body ดิบ |
| `reply` / `push` | `api/_line.js` | ครอบ `POST /v2/bot/message/{reply,push}` และ throw เมื่อ LINE ตอบไม่ 200 |
| `billBubble` / `confirmBubble` | `api/_line.js` | สร้าง Flex JSON ล้วน ๆ ไม่มี side effect — เทสต์ได้แบบ offline |
| `configFor(room)` | `api/_rooms.js` | รวม `DEFAULTS` (env) กับ override ใน `room:<room>` |
| `api()` (frontend) | `liff/bill.html` | แนบ Bearer token + แปลง error JSON เป็น exception เดียว |
| `boot()` / `billView()` / `ownerView()` | `liff/bill.html` | เลือกหน้าตาม role และ `tab` query param |

## 9. โครงสร้างไดเรกทอรีและเหตุผล

```
line-app/
├─ api/                 # ทุกไฟล์คือ serverless function 1 ตัว (Vercel Node runtime)
│  ├─ _auth.js          # helper ที่ขึ้นต้นด้วย _ (ไม่ได้ออกแบบให้เรียกเป็น endpoint)
│  ├─ _line.js
│  ├─ _rooms.js
│  ├─ _store.js
│  └─ *.js              # public endpoints
├─ liff/bill.html       # หน้า UI เดียว (static, ไม่มี build)
├─ docs/                # เอกสาร
├─ smoke.js             # เทสต์ offline
├─ vercel.json          # rewrite / → /liff/bill.html
└─ package.json         # dep เดียว: @vercel/blob; engines node >= 20
```

เหตุผลที่แบนราบขนาดนี้: ทั้งระบบถูกออกแบบให้ deploy ด้วย `vercel` คำสั่งเดียวโดยไม่ต้องมี bundler, routing layer หรือ ORM — ชื่อไฟล์ใน `api/` คือ route, ไฟล์ `_*.js` คือ shared module ที่ `require()` กันตรง ๆ (จึงต้องเป็น CommonJS ไม่ใช่ ESM)

<!-- VERIFY: Vercel ไม่สร้าง public route สำหรับไฟล์ที่ขึ้นต้นด้วย `_` ใน api/ หรือไม่ — ไม่มีอะไรในเรพยืนยัน พฤติกรรมนี้อาจมาจาก platform ไม่ใช่โค้ด -->

## 10. ข้อจำกัดและ boundary ที่โค้ดมีจริง

1. **ไม่มีฐานข้อมูลและไม่มี transaction** — `_store.set()` เขียนทับทั้งไฟล์ (`allowOverwrite: true`) ทุกรูปแบบ "อ่าน–แก้–เขียน" จึงเป็น race ได้: `slip.js` อ่าน `bill:<room>` แล้วเขียนทั้งก้อน ขณะที่ postback ยืนยันอาจเขียนทับในจังหวะเดียวกัน → ค่าที่เขียนทีหลังชนะ ไม่มี lock, ETag หรือ conditional write ในโค้ด
2. **`useCache: false` เป็นเงื่อนไขความถูกต้อง** — ถ้าลบออก การอ่านอาจได้ค่าเก่า (โค้ด `_store.js` ระบุไว้ชัด) ปัญหานี้เคยเกิดกับบิลรอบเก่า
3. **หนึ่งบิลต่อหนึ่งห้อง ไม่มีประวัติ** — `bill:<room>` ถูกเขียนทับทุกรอบ; การดูยอดย้อนหลังทำไม่ได้จากข้อมูลที่มี
4. **ไม่มี background job / cron / queue** — `vercel.json` มีแค่ `rewrites`; บิลรอบใหม่เกิดเมื่อมีคนกดจากหน้าเจ้าของเท่านั้น การแจ้งเตือน/ทวงหนี้ยังไม่มีกลไก
5. **Function เป็น stateless และ env ถูกอ่านตอน module load** — `_line.js` (`TOKEN`, `SECRET`, `LIFF_ID`), `_auth.js` (`CHANNEL_ID`), `_rooms.js` (`ROOMS`, `DEFAULTS`) เก็บค่าไว้เป็น const ระดับ module → เปลี่ยน env แล้วต้องมี deploy/instance ใหม่ถึงจะมีผล
6. **postback ตรวจเจ้าของแล้ว แต่ไม่มี CSRF token** — `webhook.js` เทียบ `isOwner(event.source.userId)` ก่อนปิดบิล; ที่ยังไม่มีคือ nonce กัน replay (event เดิมที่ดักได้สามารถส่งซ้ำได้จนกว่าบิลจะเป็น `paid`)
7. **ไม่มี idempotency ของ webhook** — event ทั้งชุดถูก `Promise.all` พร้อมกัน (await ครบ แต่**ไม่มีการรับประกันลำดับ**) และไม่เก็บ `webhookEventId`; ถ้า LINE ส่ง event ซ้ำ (retry เพราะ response ช้า/หลุด) การ `push` การ์ดหรือการเขียน Blob จะเกิดซ้ำ
8. **การตอบ webhook ต้องรอทุก event จบ** — รวมถึง call ไป LINE (`reply`/`push`) และ Blob หลายครั้งต่อ event; ถ้าช้า LINE จะ retry (ดูข้อ 7)
9. **Push ที่ล้มเหลวถูกกลืน** — `slip.js` และ `run.js` ครอบ `try/catch` แล้ว `console.error` เท่านั้น สถานะจึงถูก commit ได้โดยที่ผู้ใช้ไม่ได้รับแจ้ง
10. **ขนาด body/ไฟล์** — `slip.js` จำกัดรูปที่ 3MB (`MAX_BYTES`) และรับเฉพาะ JPEG/PNG/WEBP; หน้า LIFF ย่อรูปก่อนส่งโดยอ้างถึงเพดาน body ของ function ในคอมเมนต์ <!-- VERIFY: เพดาน body 4.5MB ของ Vercel function เป็นค่าของแพลตฟอร์ม ไม่ได้ประกาศในเรพ (อ้างจากคอมเมนต์ใน liff/bill.html) -->
11. **rate limit มีเฉพาะการแลกรหัส** (`_limit.js`: ผิดได้ 10 ครั้ง/ชม./บัญชี) · ไม่มี CORS middleware
12. **1 deploy = 1 หอ** — `OWNER_USER_ID` คนเดียว, รายชื่อห้องมาจาก env `ROOMS` (ค่าเริ่มต้น `201`–`212`), ไม่มีแนวคิดหลายหอ/หลายเจ้าของในข้อมูล
13. **`_store.get()` ไม่มี error handling** — คืน `null` เมื่อผลลัพธ์เป็น falsy; ถ้า SDK throw (เช่น blob หาย/สิทธิ์ผิด) error จะหลุดขึ้นเป็น 500 ที่ endpoint ตามธรรมชาติ
14. **หน้า LIFF มีแท็บที่ยังไม่ถูกสร้าง** — `tab=slips|unpaid|report|rooms` แสดงข้อความ "ยังไม่เปิดใช้งาน" (`notice()`), `tab=meter` และ `tab=bill` ใช้แสดง view ตาม role
15. **ไม่มีชุดเทสต์อัตโนมัติ** — `package.json` ไม่มี `scripts`; สิ่งที่มีคือ `node smoke.js` ซึ่งทดสอบเฉพาะ `verify()` และรูปร่างการ์ด (ไม่แตะ network/Blob)
16. **ผูกห้องผ่าน QR เท่านั้น** — QR ผูกได้เฉพาะห้องที่ยังไม่มีผู้เช่า · เปลี่ยนผู้เช่าด้วย `POST /api/qr?room=` (ถอดคนเดิม + รหัสใหม่)

## เอกสารที่เกี่ยวข้อง

- [`API.md`](./API.md) — endpoint, การ auth, รูปแบบ error
- [`CONFIGURATION.md`](./CONFIGURATION.md) — environment variables และค่า default
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — deploy บน Vercel + Blob
- [`DEVELOPMENT.md`](./DEVELOPMENT.md) — รันในเครื่องและ code style
- [`TESTING.md`](./TESTING.md) — smoke test และสิ่งที่ทดสอบอัตโนมัติไม่ได้
- [`../HANDOFF.md`](../HANDOFF.md) — บันทึกส่งต่อทีม: กับดักที่เจอมาแล้วและงานที่ยังเหลือ
