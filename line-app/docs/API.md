<!-- generated-by: gsd-doc-writer -->

# API (HTTP endpoints)

เอกสารนี้อธิบาย endpoint ทั้งหมดที่ deploy อยู่ใต้ `api/` ของโปรเจกต์นี้ ทุกอย่างมาจากการอ่านโค้ดจริงใน `api/*.js` (ไม่มี endpoint หรือ field ที่เดาขึ้นมา) — path ฝั่งขวาของตารางคือไฟล์ที่ให้บริการ

Base URL: ไม่มีในเรพ — ใช้โดเมนของ deployment นั้น (`PUBLIC_BASE_URL` หรือ `https://<host>` ที่ request เข้ามา) <!-- VERIFY: production URL ของโปรเจกต์นี้ไม่มีในเรพ; HANDOFF.md ระบุ https://line-app-iota.vercel.app แต่ไม่ได้ยืนยันจาก Vercel -->

## 1. Endpoint ทั้งหมด

| Method ที่โค้ดยอมรับ | Path | Auth | ไฟล์ |
|---|---|---|---|
| ทุก method (ไม่ได้ตรวจ — ใช้ GET) | `/api/config` | ไม่มี (public) | `api/config.js` |
| ทุก method (ไม่ได้ตรวจ — ใช้ GET) | `/api/me` | Bearer idToken | `api/me.js` |
| ทุก method (ไม่ได้ตรวจ — ใช้ GET) | `/api/bill` | Bearer idToken + สิทธิ์รายห้อง | `api/bill.js` |
| `POST` เท่านั้น | `/api/slip` | Bearer idToken + สิทธิ์รายห้อง | `api/slip.js` |
| ทุก method (ไม่ได้ตรวจ — ใช้ GET) | `/api/slip-image` | Bearer idToken + สิทธิ์รายห้อง | `api/slip-image.js` |
| ทุก method (ไม่ได้ตรวจ — ใช้ GET) | `/api/rooms` | Bearer idToken + owner | `api/rooms.js` |
| `POST` เท่านั้น | `/api/run` | Bearer idToken + owner | `api/run.js` |
| `GET` / `POST` / `DELETE` | `/api/owner` | Bearer idToken (ดู §2.5) | `api/owner.js` |
| `GET` / `POST` | `/api/qr` | Bearer idToken (ดู §2.6) | `api/qr.js` |
| `POST` เท่านั้น | `/api/dev?do=seed` | header `x-seed-token` · มีเฉพาะ `vercel dev` หรือ preview ที่ตั้ง `ALLOW_SEED_BYPASS=true` (production ตอบ 404) | `api/dev.js` |
| `POST` เท่านั้น | `/api/dev?do=sendbill` | header `x-seed-token` · มีเฉพาะ `vercel dev` หรือ preview ที่ตั้ง `ALLOW_SEED_BYPASS=true` (production ตอบ 404) | `api/dev.js` |
| `POST` เท่านั้น | `/api/webhook` | `x-line-signature` (HMAC) | `api/webhook.js` |

`api/_auth.js`, `api/_line.js`, `api/_rooms.js`, `api/_store.js` เป็น shared module ไม่ใช่ endpoint (ขึ้นต้นด้วย `_`) <!-- VERIFY: Vercel ไม่สร้าง public route ให้ไฟล์ที่ขึ้นต้นด้วย `_` ใน api/ — เป็นพฤติกรรมแพลตฟอร์ม ไม่มีอะไรในเรพยืนยัน --> — ไฟล์ที่ชื่ออื่นใน `api/` กลายเป็น route ตามชื่อไฟล์โดยไม่ต้องประกาศใน `vercel.json` (ซึ่งมีแค่ rewrite `/` → `/liff/bill.html`)

## 2. ข้อตกลงร่วม (อ่านครั้งเดียว ใช้ทุก endpoint)

### 2.1 รูปแบบ error

เกือบทุก endpoint ใช้ envelope เดียวกัน:

```json
{ "error": { "code": "FORBIDDEN", "message": "ข้อความภาษาไทย" } }
```

`message` เป็นภาษาไทยเสมอ (แสดงตรง ๆ บนหน้า LIFF) — `code` ที่โค้ดใช้:

| HTTP | code | เกิดจาก |
|---|---|---|
| 400 | `VALIDATION` | field บังคับหาย/ผิดรูป |
| 401 | `UNAUTHORIZED` | ไม่มี Bearer token หรือไม่มี `CHANNEL_ID` (`_auth.requireUser`) |
| 403 | `FORBIDDEN` | idToken ไม่ผ่าน LINE verify, ไม่ใช่เจ้าของ, หรือไม่ได้ผูกห้องนั้น |
| 404 | `NOT_FOUND` | ไม่พบบิล/ไม่พบไฟล์สลิป |
| 409 | `INVALID_STATE` | แนบสลิปในบิลที่ `paid` แล้ว, ถอนสิทธิ์เจ้าของหอคนแรก |
| 409 | `ROOM_TAKEN` | สแกน QR ห้องที่มีผู้เช่าผูกอยู่แล้ว |
| 409 | `MOVE_CONFIRM_REQUIRED` | ผู้เช่าที่มีห้องอยู่แล้วสแกน QR ห้องอื่น — `error` มี `current` (ห้องเดิม) กับ `room` (ห้องใหม่) ด้วย |
| 410 | `INVITE_EXPIRED` | รหัสเชิญเจ้าของหมดอายุ/ใช้แล้ว/คนสร้างไม่มีสิทธิ์แล้ว |
| 413 | `TOO_LARGE` | รูปเกิน 3MB |
| 429 | `TOO_MANY_ATTEMPTS` | เดารหัส QR/รหัสเชิญผิดเกิน 10 ครั้งใน 1 ชม. |
| 429 | `SLIP_LIMIT` | ผู้เช่าส่งสลิปบิลเดียวครบ 5 ครั้งแล้ว |
| 429 | `SLIP_TOO_SOON` | ผู้เช่าส่งสลิปซ้ำภายใน 30 วินาที |

ทุก error ใช้ envelope เดียวกัน (ไม่มีข้อยกเว้นแล้ว) — ต้องระวังถ้าเขียน client:

| HTTP | body | เกิดจาก |
|---|---|---|
| 405 | `{ "error": { "code": "METHOD_NOT_ALLOWED", "message": "POST only" } }` | `slip`, `run`, `seed`, `sendbill`, `webhook` ถูกเรียกด้วย method อื่น |
| 401 | `{ "error": { "code": "UNAUTHORIZED", "message": "bad signature" } }` | webhook signature ไม่ผ่าน |
| 400 | `{ "error": { "code": "VALIDATION", "message": "invalid json" } }` | webhook body ไม่ใช่ JSON |

### 2.2 การ auth 3 แบบ

1. **Bearer LIFF idToken** — `_auth.requireUser()` อ่าน `Authorization: Bearer <idToken>` แล้วยิง `POST https://api.line.me/oauth2/v2.1/verify` ด้วย `id_token` + `client_id` (= `LOGIN_CHANNEL_ID` หรือ prefix ก่อน `-` ของ `LIFF_ID`) แล้วเอา `sub` เป็น userId ถ้าไม่มี token/ไม่มี channel → `401 UNAUTHORIZED`; verify ไม่ผ่าน → `403 FORBIDDEN` · token ที่ verify ผ่านแล้วถูกจำไว้ใน memory ของ instance (เก็บเป็น sha256) ไม่เกิน 5 นาทีและไม่เกิน `exp` ของ token — หน้า LIFF ที่เรียก API 3-4 ครั้งจึงถาม LINE ครั้งเดียว · token ที่ไม่ผ่านไม่ถูกจำ
2. **`x-seed-token` bypass (ปิดโดยค่าเริ่มต้น)** — ทำงานเฉพาะเมื่อ `VERCEL_ENV=development` (`vercel dev`) หรือ `ALLOW_SEED_BYPASS=true` บนที่ที่ไม่ใช่ production **และ** header ตรงกับ `SEED_TOKEN` (ยาว ≥ 16 ตัว เทียบแบบ constant-time) · เมื่อเข้าเงื่อนไข `requireUser()` จะคืน `OWNER_USER_ID` (หรือ `"dev"` ถ้าไม่ได้ตั้ง) · **production ปฏิเสธเสมอ**
3. **`/api/dev` (seed/sendbill)** — ใช้ header `x-seed-token` ตามเงื่อนไขเดียวกับข้อ 2 · บน production ตอบ `404` เสมอ · ไม่อ่าน token จาก URL

สิทธิ์มาจาก `roleOf(userId)` ใน `_auth.js`:

| role | ใคร | ทำอะไรได้ |
|---|---|---|
| root | userId ใน `OWNER_USER_ID` (ตั้งด้วยมือ) | ทุกอย่าง + เชิญเจ้าของเพิ่ม + ถอนสิทธิ์คนอื่น · ถูกถอนไม่ได้ |
| `owner` | root หรือคนที่มี `owner:<userId>` role `owner` | ออกบิล หมุน QR ยืนยันการชำระ เชิญผู้ช่วย |
| `viewer` | คนที่มี `owner:<userId>` role `viewer` | ดูบิล/สลิป/รายงาน (`canView`) เท่านั้น |

`isOwner` = role `owner` · `canView` = role `owner` หรือ `viewer` · `isRoot` = เทียบกับ `OWNER_USER_ID` · role ถูกอ่านจาก Blob ทุก request จึงถอนสิทธิ์แล้วมีผลทันที · ถ้าไม่ได้ตั้ง `OWNER_USER_ID` ไม่มี root (`x-seed-token` คืน `"dev"` ซึ่งไม่มีสิทธิ์)

### 2.3 Cache / content type

| ไฟล์ | header ที่ตั้ง |
|---|---|
| `config`, `me`, `bill`, `rooms`, `owner` | `Cache-Control: no-store` |
| `slip-image` | `Content-Type: image/*` + `Cache-Control: private, no-store` |
| `slip`, `run`, `seed`, `sendbill`, `webhook` | **ไม่ตั้ง `Cache-Control` เลย** |

ทุก response เป็น JSON ผ่าน `res.json()` ยกเว้น `slip-image` ที่ stream byte ดิบ (`res.end(...)`) ไม่มี CORS header และไม่มี `OPTIONS` handler · rate limit มีเฉพาะการเดารหัส (`_limit.js`) และการส่งสลิป (§6)

`vercel.json` ใส่ header: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (ลิงก์ `?bind=`/`?owner=` ไม่หลุดไปกับ Referer), `Permissions-Policy: microphone=(), geolocation=(), payment=(), usb=()` ให้ทุก path · `X-Frame-Options: DENY` **เฉพาะ `/api/(.*)`** — ไม่ใส่กับหน้า LIFF เพราะถ้า LINE โหลด LIFF ใน iframe หน้าจะขึ้นขาว · ยังไม่ใส่ Content-Security-Policy เพราะหน้า LIFF โหลด SDK จาก `static.line-scdn.net` และใช้ inline script — ต้องทดสอบในแอป LINE จริงก่อน

### 2.4 ที่เก็บข้อมูล (side effect ที่ทุก endpoint ใช้ร่วมกัน)

ค่า JSON ทุกตัวเขียนผ่าน `_store.set()` ลง Vercel Blob แบบ private ที่ pathname `kv/<key ที่ sanitize>.json` (อักขระนอก `a-zA-Z0-9._-` ถูกแทนด้วย `-` ดังนั้น `:` → `-`) ส่วนรูปสลิปเขียนผ่าน `_store.putFile()` / ลบด้วย `_store.delFile()` ที่ `slips/<room>-<timestamp>.<ext>`

---

### 2.5 เจ้าของและผู้ช่วย (`/api/owner`)

เจ้าของหอคนแรก (root) มาจาก `OWNER_USER_ID` (ตั้งด้วยมือ) คนต่อไปรับสิทธิ์ด้วยรหัสเชิญ
รหัสมีอายุ **10 นาที ใช้ได้ครั้งเดียว** — ใครสแกน QR และยืนยัน idToken ได้ จะถูกบันทึกที่ `owner:<userId>` = `{addedAt, addedBy, role}`

| endpoint | auth | body | ผล |
|---|---|---|---|
| `GET /api/owner` | owner | — | `{root, members:[{name, role, root, you, addedAt}]}` · root ได้ `userId` ของแต่ละคนด้วย (คนอื่นไม่ได้) · `name` มาจากโปรไฟล์ LINE (`null` ถ้า LINE ไม่บอก) |
| `POST /api/owner` | owner | `{role?}` | `{code, url, qr, role, expiresAt}` · `role` = `owner` (default) หรือ `viewer` · **เฉพาะ root เชิญ `owner` ได้** เจ้าของคนอื่นเชิญได้แค่ `viewer` (ไม่งั้น `403`) |
| `POST /api/owner` | ผู้ใช้ที่ล็อกอิน LINE | `{code}` | `{owner, role}` — มีสิทธิ์นั้นอยู่แล้วได้ `{already:true}` · viewer ที่ได้รหัส owner ถูกอัปเกรด |
| `DELETE /api/owner` | **root เท่านั้น** | `{userId}` | `{ok:true, removed}` · ลบ `owner:<userId>` + `menu:<userId>`, สลับ rich menu กลับเป็นเมนู default, ส่งข้อความแจ้งคนที่ถูกถอน |

- รหัสผิด → `404 NOT_FOUND` · หมดอายุ/ถูกใช้ → `410 INVITE_EXPIRED` · ไม่ได้ตั้ง `OWNER_USER_ID` → `409 INVALID_STATE`
- **รหัสใช้ได้เท่าที่คนสร้างยังมีสิทธิ์** — ตอนรับรหัสจะตรวจคนสร้างอีกครั้ง: รหัส `owner` ต้องมาจาก root, รหัส `viewer` ต้องมาจาก owner ที่ยังไม่ถูกถอน ไม่งั้น `410 INVITE_EXPIRED`
- ถอนสิทธิ์: ไม่ใช่ root → `403` · ถอน root → `409 INVALID_STATE` · `userId` ไม่ใช่รูป `U…` → `400` · ไม่มีสิทธิ์อยู่แล้ว → `404`
- เมื่อรับสิทธิ์สำเร็จ ระบบสลับ rich menu ให้เป็นเมนูเจ้าของ (ถ้าตั้ง `RICHMENU_OWNER_ID`) และแจ้ง root พร้อมชื่อ LINE ของคนใหม่
- หน้า LIFF: ปุ่ม "เจ้าของและผู้ช่วย" ในหน้าหลักเจ้าของ (ผู้ช่วยไม่เห็นปุ่มนี้)

### 2.6 QR ผูกห้องสำหรับผู้เช่า (`/api/qr`)

ผู้เช่าไม่ต้องพิมพ์ ``ผูก 203`` อีก: เจ้าของสร้าง QR ของห้อง แปะหน้าห้อง ผู้เช่าสแกนครั้งเดียวจบ
รหัสผูกกับห้องและ **ใช้ได้ตลอด** จนกว่าเจ้าของจะกดสร้างใหม่ (สร้างใหม่ = ใบที่แปะอยู่ใช้ไม่ได้ทันที)

| endpoint | auth | body/query | ผล |
|---|---|---|---|
| `GET /api/qr?room=203` | เจ้าของ | — | `{room, code, url, qr}` · สร้างรหัสให้ถ้ายังไม่มี |
| `POST /api/qr?room=203` | เจ้าของ | — | **เปลี่ยนผู้เช่า:** ถอดผู้เช่าที่ผูกอยู่ (`unbound:true`) + รหัสใหม่ (`rotated:true`) + เขียน `tenancy:<room>` (ดูล่าง) · `prepayArchived:true` เมื่อมีสลิปโอนล่วงหน้าของคนเดิมถูกเก็บเข้า `prepay-old:*` |
| `POST /api/qr` | ผู้ใช้ที่ล็อกอิน LINE | `{code, confirmMove?}` | `{ok:true, room, previous}` — เขียน `user-room:<userId>` + `room-user:<room>` + สลับเมนูผู้เช่า |

- รหัส 10 ตัว (ไม่มี 0/O/1/I/L) · เก็บ 2 key: `room-qr:<room>` และ `qr-code:<code>` (ตัวหลังถูกลบเมื่อหมุน)
- **ผู้เช่าใหม่ไม่เห็นบิลของคนเก่า:** เมื่อผู้เช่าออกจากห้อง — กด "เปลี่ยนผู้เช่า" (เขียนเสมอ แม้ไม่มีใครผูกอยู่) หรือผู้เช่าย้ายไปห้องอื่นด้วย `confirmMove` (เขียนให้ห้องที่ออก) — ระบบเขียน `tenancy:<room>` = `{ since: <ISO now> }` · การผูกเองไม่เขียน · ห้องที่ยังไม่มี `tenancy` แสดงทุกบิลเหมือนเดิม (ผู้เช่าปัจจุบันไม่เสียประวัติ ช่องโหว่เปิดเฉพาะหลังเปลี่ยนผู้เช่า ซึ่งจากนี้ทุกครั้งจะเขียน record)
- **สลิปโอนล่วงหน้าของคนเดิม:** ตอนเขียน `tenancy` ถ้ามี `prepay:<room>` จะคัดลอกไป `prepay-old:<room>:<slipAt>` (ไฟล์รูปเก็บไว้) ตั้ง `prepay:<room>` เป็น `null` และ push ข้อความหา `OWNER_USER_ID` `ห้อง <room>: ผู้เช่าเดิมมีสลิปโอนล่วงหน้าค้างอยู่ — ไม่ถูกผูกกับผู้เช่าใหม่ ตรวจสอบ/คืนเงินเอง` (push พังแค่ log)
- รหัสผิด/ถูกหมุนแล้ว → `404 NOT_FOUND`
- ห้องที่ไม่มีทั้งบิลและผู้เช่า → `404 NOT_FOUND` (กันพิมพ์เลขห้องผิด)
- **QR ผูกได้เฉพาะห้องที่ยังว่าง** — ห้องที่มีผู้เช่าผูกอยู่แล้วตอบ `409 ROOM_TAKEN` คนที่ถ่ายรูป QR ไปจึงแย่งห้องไม่ได้ · ผูกสำเร็จแล้วเจ้าของได้ข้อความแจ้ง · ย้ายห้องแล้วห้องเก่าเลิกส่งบิลให้ · ผิดเกิน 10 ครั้ง/ชม. → `429 TOO_MANY_ATTEMPTS`
- **ย้ายห้องต้องยืนยัน** — ผู้เช่าที่ผูกห้องอื่นอยู่แล้วได้ `409 MOVE_CONFIRM_REQUIRED` (`error.current` = ห้องเดิม, `error.room` = ห้องใหม่) จนกว่าจะส่ง `confirmMove: true` · ลิงก์ `?bind=` ที่คนอื่นส่งมาจึงย้ายห้องใครเงียบ ๆ ไม่ได้ · หน้า LIFF ถาม "ย้ายไปห้อง X?" แล้วส่งซ้ำพร้อม flag ให้เอง

## 3. `GET /api/config`

`api/config.js` — public, ใช้ให้หน้า LIFF รู้ LIFF ID ก่อน `liff.init()`

- **Auth:** ไม่มี
- **Query/body:** ไม่มี
- **200:**

```json
{ "liffId": "2012575885-l35sh1N4" }
```

`liffId` เป็น `null` ถ้าไม่ได้ตั้ง `LIFF_ID` (หน้าเว็บจะขึ้นว่า "เปิดหน้านี้จากปุ่มในแชท LINE เท่านั้น")
- **Error:** ไม่มีเส้นทาง error ในโค้ด (ไม่ตรวจ method ด้วย)
- **Side effect:** ไม่มี

## 4. `GET /api/me`

`api/me.js` — บอกว่าใครเรียก และผูกกับห้องไหน

- **Auth:** Bearer idToken (หรือ `x-seed-token` — เฉพาะ `vercel dev`)
- **Query/body:** ไม่มี
- **200:**

```json
{ "userId": "U1234...", "owner": false, "role": null, "root": false, "room": "203" }
```

`role` = `"owner"` / `"viewer"` / `null` (ผู้เช่าหรือคนทั่วไป) · `owner` = `role === "owner"` (เก็บไว้ให้หน้าเก่า) · `root` = เป็น `OWNER_USER_ID` หรือไม่ · หน้า LIFF ใช้ `role` ตัดสินว่าจะเปิดหน้าเจ้าของ (owner และ viewer เปิดได้ทั้งคู่) · `room` เป็น `null` เมื่อยังไม่ผูกห้อง (`user-room:<userId>` ไม่มี)
- **Error:** `401 UNAUTHORIZED`, `403 FORBIDDEN` (จาก `requireUser` เท่านั้น)
- **อ่าน Blob:** `user-room:<userId>`, `owner:<userId>` (สองตัวอ่านพร้อมกัน), `menu:<userId>` (เฉพาะ owner)
- **Side effect:** owner ที่ยังไม่ได้เมนูเจ้าของจะถูก link `RICHMENU_OWNER_ID` ให้ครั้งแรก

## 5. `GET /api/bill?room=203[&period=YYYY-MM][&history=1]`

`api/bill.js` — บิลของห้องเดียว ผู้เช่าเห็นได้เฉพาะห้องที่ผูก เจ้าของเห็นทุกห้อง

- **Auth:** Bearer idToken + ถ้าไม่ใช่ owner ต้องมี `user-room:<userId> === room`
- **Query:** `room` (string, ไม่บังคับ — ถ้าไม่ส่งจะใช้ห้องที่ผูกไว้)
- **กรองตามสัญญาเช่า (ผู้เช่าเท่านั้น):** ผู้เช่าเห็นเฉพาะบิลที่ออก **ตั้งแต่เริ่มสัญญาเช่าปัจจุบัน** (`tenancy:<room>.since` — ดู §2.6): บิลที่ `issuedAt < since` หรือไม่มี `issuedAt` ถือเป็นของผู้เช่าคนก่อน · ห้องที่ไม่มี `tenancy` (ยังไม่เคยเปลี่ยนผู้เช่าหลังเพิ่มฟีเจอร์นี้) เห็นทุกบิลเหมือนเดิม · เจ้าของ/ผู้ช่วยไม่ถูกกรอง · บิลล่าสุดที่ถูกซ่อนตอบเหมือนไม่มีบิล (`404` + `error.advance`) · `period=` ที่ถูกซ่อน → `404` · `history=1` ตัดรายการที่ถูกซ่อนออก
- **200:** bill object ทั้งก้อนจาก `bill:<room>` บวก `hasSlip` (และ `advance` เมื่อเรียกแบบ "บิลล่าสุด" ไม่ส่ง `period`/`history`):

```json
{
  "room": "203",
  "period": "2026-11",
  "rent": 3500,
  "water": 100,
  "elec": 196,
  "waterUnits": 4,
  "elecUnits": 28,
  "total": 3796,
  "due": "2026-11-16",
  "status": "unpaid",
  "slipPath": "slips/203-1762...jpg",
  "slipNote": null,
  "slipAt": "2026-11-12T...",
  "paidAt": "2026-11-13T...",
  "hasSlip": true,
  "advance": null
}
```

`advance` = `{ slipAt, hasSlip, note }` จาก `prepay:<room>` เมื่อผู้เช่าโอนก่อนบิลออกแล้วยังไม่มีบิลมารับ มิฉะนั้น `null` · อ่านคู่กับบิลแบบขนาน · ไม่มีใน `period=` และ `history=1`

field ที่มีจริงขึ้นกับว่าเขียนผ่าน path ไหน: `run` สร้าง `room, period, rent, water, elec, waterUnits, elecUnits, total, due, status`; `slip` เพิ่ม `slipPath, slipNote, slipAt`; webhook เพิ่ม `paidAt` (ดู §13) — `hasSlip` คำนวณสด (`!!bill.slipPath`) ไม่ได้เก็บลง Blob
- **Error:** `400 VALIDATION` (ไม่มี `room` และยังไม่ผูกห้อง), `403 FORBIDDEN` (ผูกห้องอื่น), `404 NOT_FOUND` (ไม่มีบิล — กรณีเรียกแบบบิลล่าสุด body เป็น `{ error: { code, message, advance } }` โดย `advance` เป็นรูปเดียวกับข้างบนหรือ `null` เพื่อให้หน้า LIFF แสดง "โอนแล้ว รอบิลออก"), `401`/`403` จาก `requireUser`
- **อ่าน Blob:** `user-room:<userId>`, `bill:<room>`, `prepay:<room>` (เฉพาะแบบบิลล่าสุด), `tenancy:<room>` (เฉพาะผู้เช่า)
- **Side effect:** ไม่มี
- **หมายเหตุ:** ไม่มีการตรวจ `req.method` — เรียกด้วย POST ก็ได้ผลเหมือน GET

## 6. `POST /api/slip`

`api/slip.js` — ผู้เช่าแนบสลิป (ไม่บังคับรูป) แล้วแจ้งเจ้าของให้ยืนยัน

**สองทางตามสถานะบิลล่าสุด** (สำหรับผู้เช่า บิลล่าสุดที่ไม่ใช่ของสัญญาเช่าปัจจุบัน — ดู §5 — นับเป็น "ไม่มีบิล" จึงเข้าทางโอนก่อนบิลออก และไม่แตะบิลเก่า · เจ้าของไม่ถูกกรอง): ถ้า `bill:<room>` เป็น `unpaid`/`pending` สลิปผูกกับบิลนั้น (ทางปกติ) · ถ้าไม่มีบิลเลย หรือบิลล่าสุด `paid` แล้ว ถือว่าเป็น **สลิปโอนก่อนบิลออก** เก็บเป็น `prepay:<room>` และ `/api/run` จะผูกให้กับบิลรอบถัดไปเอง (ไม่มี `409 INVALID_STATE` สำหรับบิลที่ชำระแล้วอีกต่อไป)

- **Auth:** Bearer idToken + สิทธิ์รายห้องแบบเดียวกับ `/api/bill`
- **Body (JSON):**

| field | type | บังคับ | หมายเหตุ |
|---|---|---|---|
| `room` | string | ไม่ (fallback = ห้องที่ผูกไว้) | |
| `note` | string | ไม่ | เก็บเป็น `slipNote` (ค่าว่าง → `null`) · ยาวไม่เกิน 500 ตัวอักษร |
| `image` | string (data URL) | ไม่ | ต้องตรง `/^data:(image\/(jpeg\|png\|webp));base64,(.+)$/` |

ขนาดรูปสูงสุด **3 MiB** (`MAX_BYTES = 3 * 1024 * 1024`) นับหลัง decode base64; นามสกุลไฟล์มาจาก mime (`jpeg` → `jpg`)
- **200:**

```json
{ "ok": true, "status": "pending", "total": 3796, "hasSlip": true }
```

ทางโอนก่อนบิลออก (ไม่มี `total` เพราะยังไม่มีบิล):

```json
{ "ok": true, "status": "advance", "hasSlip": true }
```

- **Error (ตามลำดับที่โค้ดเช็ก — ไม่มี `404` แล้ว เพราะห้องที่ไม่มีบิลเข้าทางโอนก่อนบิลออก):** `405 METHOD_NOT_ALLOWED` → `401`/`403` จาก `requireUser` → `400 VALIDATION` (`note` ไม่ใช่ข้อความหรือยาวเกิน 500) → `400 VALIDATION` (ไม่มี room) → `403 FORBIDDEN` (ไม่ได้ผูกห้อง) → `429 SLIP_LIMIT` / `429 SLIP_TOO_SOON` → `400 VALIDATION` (mime ไม่อยู่ใน 3 ชนิด) → `413 TOO_LARGE`
- **จำกัดการส่ง (ผู้เช่าเท่านั้น เจ้าของไม่ติด):** ไม่เกิน 5 ครั้งต่อบิล และห่างกันอย่างน้อย 30 วินาที — ทุกสลิป push การ์ดหาเจ้าของ ซึ่งกินโควตาข้อความของ LINE OA · สลิปที่ถูกปฏิเสธไม่ส่งข้อความ · นับใน `slipCount` ของบิล (ทางโอนก่อนบิลออกนับใน `slipCount` / `slipAt` ของ `prepay:<room>` ด้วยกติกาเดียวกัน)
  - ⚠️ เป็น **best-effort**: Blob ไม่มี atomic counter ถ้ายิงหลาย request พร้อมกันอาจมีบางตัวหลุดเกิน 5 (ตัวนับกันสแปม ไม่ใช่ด่านความปลอดภัย)
  - การออกบิล `unpaid` รอบเดิมใหม่ (`/api/run`) จะสร้างบิลใหม่และรีเซ็ต `slipCount`
- **เขียน Blob:** `slips/<room>-<Date.now()>.<ext>` (เฉพาะเมื่อมี `image`), `bill:<room>` และ `bill:<period>:<room>` = บิลเดิม + `status:"pending"`, `slipPath`, `slipNote`, `slipAt` (ISO), `slipCount`
- **Side effect อื่น:** `push()` การ์ด `confirmBubble` ไปที่ `OWNER_USER_ID` — ถ้า push ล้มเหลวแค่ `console.error("owner push failed")` แล้วยังตอบ 200
- ถ้าไม่ได้แนบรูปใหม่ `slipPath` เดิมถูกคงไว้ · ถ้าแนบรูปใหม่ รูปเดิมถูกลบหลังบันทึกบิลแล้ว (ลบไม่สำเร็จแค่ `console.error`)
- **ทางโอนก่อนบิลออก:** ตรวจสิทธิ์ ตรวจ note และจำกัดการส่งเหมือนทางปกติ · เขียนรูปที่ `slips/<room>-advance-<Date.now()>.<ext>` และ `prepay:<room>` = `{ room, slipPath, slipNote, slipAt, slipCount, by }` (`slipCount` = ครั้งก่อน + 1, `by` = userId ผู้ส่ง) · ไม่แตะ `bill:*` · push ข้อความ text หา `OWNER_USER_ID`: `ห้อง <room> แจ้งโอนก่อนบิลออก — <note> · ระบบจะผูกสลิปนี้กับบิลรอบถัดไปให้เอง` (ไม่มี ` — <note>` ถ้าไม่มีหมายเหตุ · push ล้มเหลวไม่ fail request)

## 7. `GET /api/slip-image?room=203[&advance=1]`

`api/slip-image.js` — stream รูปสลิปจาก private Blob

- **Auth:** Bearer idToken + สิทธิ์รายห้อง
- **Query:** `room` (string) — **ไม่มี fallback ไปห้องที่ผูกไว้** ถ้าไม่ส่งจะได้ `room = ""` · `advance=1` → stream `prepay:<room>.slipPath` (สลิปโอนก่อนบิลออก) ด้วยสิทธิ์แบบเดียวกัน; ไม่ส่ง = สลิปของ `bill:<room>` เหมือนเดิม — ผู้เช่าจะไม่ได้สลิปของบิลที่ถูกซ่อนตามสัญญาเช่า (§5) → `404 ยังไม่มีสลิป` (`advance=1` ไม่ต้องกรอง เพราะ `prepay` ของคนเดิมถูกเก็บออกตอนเปลี่ยนผู้เช่า)
- **200:** byte ของรูป, `Content-Type` จาก `blob.blob.contentType` (fallback `image/jpeg`), `Cache-Control: private, no-store`
- **Error:** `403 FORBIDDEN` (ไม่ได้ผูกห้องนั้น — กรณีไม่ส่ง `room` ผู้เช่าจะได้ 403 นี้), `404 NOT_FOUND` (บิล — หรือ `prepay` เมื่อส่ง `advance` — ยังไม่มี `slipPath`, หรือ blob หาย), `401`/`403` จาก `requireUser`
- **อ่าน Blob:** `user-room:<userId>`, `bill:<room>` (หรือ `prepay:<room>`), `get(bill.slipPath, {access:"private", useCache:false})`
- **Side effect:** ไม่มี

## 8. `GET /api/rooms`

`api/rooms.js` — หน้าจดมิเตอร์ของเจ้าของ: ทุกห้อง + config + มิเตอร์ล่าสุด + บิล + ผู้เช่า

- **Auth:** Bearer idToken + owner หรือ viewer (`canView` · `403 FORBIDDEN` "เฉพาะเจ้าของหอ")
- **Query/body:** ไม่มี
- **200:**

```json
{
  "period": "2026-11",
  "rooms": [
    {
      "room": "201",
      "config": { "rent": 3500, "waterRate": 25, "elecRate": 7 },
      "meter": { "water": 4, "elec": 28, "at": "2026-11-12T..." },
      "bill": { "room": "201", "total": 3796, "status": "unpaid" },
      "linked": true,
      "tenant": true,
      "advance": { "slipAt": "2026-11-10T...", "hasSlip": true }
    }
  ]
}
```

`period` = `BILL_PERIOD || null`; `meter`/`bill` เป็น `null` ถ้ายังไม่มี; `advance` = `{ slipAt, hasSlip }` ถ้าห้องนั้นมีสลิปโอนก่อนบิลออกรออยู่ (`prepay:<room>`) มิฉะนั้น `null`; `linked` บอกแค่ว่ามีผู้เช่าผูกห้องอยู่หรือไม่ (`tenant` เป็นค่าเดียวกัน เก็บไว้ให้หน้าเก่า) — **ไม่ส่ง LINE userId ของผู้เช่า** เพราะหน้าจอไม่ได้ใช้ และผู้ช่วยแบบดูอย่างเดียวไม่ควรได้; จำนวนห้องมาจาก `ROOMS` (default `201`–`212`)
- **Error:** `403 FORBIDDEN` (ไม่ใช่ owner), `401`/`403` จาก `requireUser`
- **อ่าน Blob:** `room:<room>`, `meter:<room>`, `bill:<room>`, `room-user:<room>`, `prepay:<room>` ต่อทุกห้อง (12 ห้อง default = 60 อ่านต่อ request · อ่านพร้อมกันทีละไม่เกิน 12 ห้อง)
- **Side effect:** ไม่มี

## 9. `POST /api/run`

`api/run.js` — เจ้าของบันทึกหน่วยมิเตอร์รอบใหม่ ออกบิล และ push การ์ดหาผู้เช่า

- **Auth:** Bearer idToken + **ต้องเป็น owner**
- **Body (JSON):**

| field | type | บังคับ | หมายเหตุ |
|---|---|---|---|
| `readings` | array ของ `{room:string, water:number, elec:number}` | ✅ (ต้องไม่ว่าง) | เป็น **หน่วย** ไม่ใช่บาท |
| `period` | string | ไม่ (fallback `BILL_PERIOD`) | ถ้าไม่มีทั้งคู่ → `400` |
| `due` | string | ไม่ (fallback `BILL_DUE`) | ไม่มีทั้งคู่ → `due: null` |

- **200:**

```json
{
  "ok": true,
  "period": "2026-11",
  "due": "2026-11-16",
  "rooms": [
    { "room": "201", "total": 3796, "pushed": true },
    { "room": "203", "total": 3796, "pushed": true, "prepaid": true },
    { "room": "202", "error": "ค่ามิเตอร์ไม่ถูกต้อง" }
  ]
}
```

ห้องที่ข้อมูลเสียจะถูกใส่เป็น `{room, error}` **โดยไม่ทำให้ request ล้ม** (สถานะยัง 200) · ห้องเดียวกันซ้ำใน `readings` → ตัวแรกออกบิล ตัวที่ซ้ำได้ `error` · ห้องทำงานพร้อมกันทีละ 6 ห้อง (`rooms` ยังเรียงตาม `readings`) — 12 ห้องจาก ~12 วินาทีเหลือ ~1 วินาทีเมื่อแต่ละ round trip 80ms
- **Error:** `405`, `401`/`403` จาก `requireUser`, `403 FORBIDDEN` (ไม่ใช่ owner), `400 VALIDATION` (`readings` ไม่ใช่ array/ว่าง), `400 VALIDATION` (ไม่มี period)
- **เขียน Blob:** `meter:<room>` = `{water, elec, at}` และ `bill:<room>` = บิลใหม่ทั้งใบ (มี `issuedAt` = ISO ตอนออก/ออกซ้ำ ใช้แยกบิลของผู้เช่าปัจจุบันออกจากผู้เช่าคนก่อน) `status:"unpaid"` (ถ้ามี `prepay:<room>` บิลใหม่เริ่มที่ `status:"pending"` พร้อม `slipPath`, `slipNote`, `slipAt`, `slipCount` ที่คัดลอกจาก prepay และ `prepaid:true` แล้วตั้ง `prepay:<room>` เป็น `null` หลัง `saveBill` สำเร็จ · ข้ามห้องที่บิลรอบนั้นแจ้งชำระหรือชำระแล้ว (ไม่แตะ prepay) · บิล `unpaid` ออกใหม่ทับได้เพื่อแก้เลขผิด · หน่วยต้องเป็นจำนวนเต็ม ≥ 0 และห้องต้องอยู่ใน `ROOMS`)
- **Side effect อื่น:** `push()` การ์ด `billBubble` ให้ `room-user:<room>` ถ้ามีผู้เช่า; push ล้มเหลว → `pushed:false` + `console.error` (ไม่ fail request) · ถ้าบิลมีสลิปจาก prepay จะ push การ์ด `confirmBubble` หา `OWNER_USER_ID` ด้วย เพื่อให้กดยืนยันได้ทันที (พังก็กลืน) และแถวผลลัพธ์ของห้องนั้นมี `prepaid:true`
- การคำนวณ: `water = Math.round(waterUnits * waterRate)`, `elec = Math.round(elecUnits * elecRate)`, `total = rent + water + elec`

## 10. `POST /api/dev?do=seed` (header `x-seed-token`)

`api/dev.js` — ใส่บิลตัวอย่างทุกห้องใน `ROOMS` (idempotent)

- **Auth:** production → `404` เสมอ · ที่อื่นต้องเปิด dev tools (ดู 2.2) และส่ง header `x-seed-token` ที่ตรงกับ `SEED_TOKEN` (≥ 16 ตัว) ไม่งั้น `403 FORBIDDEN`
- **Header:** `x-seed-token` (ไม่อ่าน token จาก URL)
- **Body:** ไม่มี
- **200:**

```json
{ "ok": true, "period": "2026-11", "rooms": ["201", "202", "..."] }
```

- **Error:** `404` (production หรือ dev tools ปิด), `405 METHOD_NOT_ALLOWED`, `403 FORBIDDEN`
- **เขียน Blob:** `room:<room>` = `{rent, waterRate, elecRate}` **เฉพาะเมื่อยังไม่มี** (ห้อง index หาร 3 ลงตัวได้ rent `3220`), `bill:<room>` เขียนทับทุกห้องด้วยข้อมูลตัวอย่าง `status:"unpaid"`
- **Side effect อื่น:** ไม่มีการ push LINE
- ค่า default ของ seed: `period` = `BILL_PERIOD || "2026-11"`, `due` = `BILL_DUE || "2026-11-16"`, หน่วยน้ำ `4 + (i % 4)`, หน่วยไฟ `28 + (i % 6) * 7`

## 11. `POST /api/dev?do=sendbill` (header `x-seed-token`)

`api/dev.js` — ยิงการ์ดบิลหาหนึ่ง userId (เครื่องมือทดสอบ)

- **Auth:** เหมือน `/api/dev?do=seed`
- **Header:** `x-seed-token`
- **Body (JSON):**

| field | type | บังคับ |
|---|---|---|
| `to` | string (LINE userId) | ✅ |
| `room` | string | ✅ |

- **200:** `{ "ok": true, "sent": "203", "total": 3796 }`
- **Error:** `404` (production หรือ dev tools ปิด), `405 METHOD_NOT_ALLOWED`, `403 FORBIDDEN` (token ผิด/สั้นกว่า 16 ตัว), `400 VALIDATION` (`to` หรือ `room` หาย), `404 NOT_FOUND` (ไม่พบบิลห้องนั้น)
- **Side effect:** `push(to, [billBubble(bill, baseUrl)])` — **ไม่มี try/catch** ถ้า LINE ตอบไม่ 200 `_line.call()` throw แล้วหลุดเป็น error ที่ไม่ได้จัดการ (คาดว่า 500 จาก platform) <!-- VERIFY: รูปแบบ response 500 ของ Vercel function ที่ throw ไม่ออกมาเป็น JSON envelope — เป็นพฤติกรรมแพลตฟอร์ม ไม่มีในเรพ -->
- **อ่าน Blob:** `bill:<room>`

## 12. `POST /api/webhook`

`api/webhook.js` — รับ event จาก LINE Messaging API

- **Auth:** `x-line-signature` = base64(HMAC-SHA256(raw body, `LINE_CHANNEL_SECRET`)); ไม่มี secret = ปฏิเสธทุก request ถ้าไม่ผ่าน → `401 { error: { code: "UNAUTHORIZED", message: "bad signature" } }`
- **Body:** JSON ของ LINE (`{events:[...]}`) — อ่านเป็น raw buffer ก่อนเพื่อคำนวณ signature; parse ไม่ได้ → `400 { error: { code: "VALIDATION", message: "invalid json" } }`
- **200:** `{ "ok": true }` — **ตอบ 200 เสมอหลัง parse สำเร็จ** แม้ทุก event จะ throw (แต่ละ event มี `try/catch` ของตัวเองแล้ว `console.error("event failed", ...)`)
- **Error:** `405 METHOD_NOT_ALLOWED`, `401`, `400`
- **Side effect:** ตาม event — ดู §13

## 13. การจัดการ event ของ webhook

ทุก event ทำงานใน `Promise.all` และ **ตอบ 200 หลังทุก event ทำงานจบ** (ไม่มีการตอบ 200 ก่อน) ไม่มีการเก็บ `webhookEventId` จึงไม่มี idempotency — LINE retry = ทำงานซ้ำ

| event | เงื่อนไข | เขียน Blob | ส่ง LINE |
|---|---|---|---|
| `follow` | มี `source.userId` | `user:<userId>` = `{ followedAt: <epoch ms> }` | `reply` ข้อความต้อนรับ (บอกให้พิมพ์ "บิล") |
| `message` (text) | ข้อความ = `บิล` หรือ `bill` (case-insensitive เฉพาะ `bill`) | ไม่เขียน | ไม่มี `user-room:<userId>` → `reply` "ยังไม่ได้ผูกห้อง"; ไม่มี `bill:<room>` หรือบิลนั้นไม่ใช่ของสัญญาเช่าปัจจุบัน (`tenancy`) → `reply` "ยังไม่มีบิลรอบนี้"; ไม่งั้น `reply` การ์ด `billBubble` |
| `message` (text) | ตรง `/^ผูก\s*(\d{2,4})$/` | ไม่มี `bill:<room>` → ไม่เขียนอะไร; ไม่งั้นเขียน `user-room:<userId>` = `"<room>"` และ `room-user:<room>` = `userId` | `reply` "ผูกกับห้อง X แล้ว" หรือ "ไม่พบห้อง X" |
| `postback` | `postback.data` มี `action=confirm` | `bill:<room>` = บิลเดิม + `status:"paid"`, `paidAt` (ISO); ถ้า `paid` อยู่แล้วไม่เขียน | `reply` ยืนยันกลับ; `push` ข้อความแจ้งผู้เช่าจาก `room-user:<room>` (เฉพาะเมื่อมี ไม่ใช่คนเดียวกัน และบิลนั้นเป็นของสัญญาเช่าปัจจุบัน) |
| อื่น ๆ | — | — | ไม่มี (เมิน ยังตอบ 200) |

รายละเอียดที่ควรรู้:

- **postback `action=confirm` ตรวจเจ้าของแล้ว** — `webhook.js` เทียบ `event.source.userId` กับ `OWNER_USER_ID` ก่อนปิดบิล; ผู้ที่ไม่ใช่เจ้าของได้ข้อความ "เฉพาะเจ้าของหอกดยืนยันได้ครับ" และสถานะบิลไม่เปลี่ยน
- **ไม่มีคำสั่งแชท `ผูก <room>` แล้ว** — ผูกห้องได้ทาง QR (`/api/qr`) อย่างเดียว · postback ยืนยันระบุ `period` และยืนยันได้เฉพาะบิล `pending`
- **`OWNER_USER_ID` ไม่ถูกใช้ใน webhook เลย** — webhook ไม่รู้จัก role; สิทธิ์ทั้งหมดมาจาก `bill:<room>` ที่มีอยู่
- ถ้า `LINE_CHANNEL_ACCESS_TOKEN` ผิด/หมดอายุ `reply`/`push` throw แต่ `handleEvent` ถูกครอบด้วย `try/catch` ต่อ event → webhook ยังตอบ 200 ผู้ใช้แค่ไม่ได้รับข้อความ

## 14. สรุปการตรวจสิทธิ์ (จุดที่ไม่มี check ในโค้ด)

| Endpoint / event | สิ่งที่โค้ดตรวจ | สิ่งที่ **ไม่** ตรวจ |
|---|---|---|
| `/api/config` | — | ทุกอย่าง (public โดยตั้งใจ) |
| `/api/me` | idToken | — |
| `/api/bill`, `/api/slip`, `/api/slip-image` | idToken + `user-room:<userId> === room` (ยกเว้น owner) | ว่า `room` เป็นห้องที่อยู่ใน `ROOMS` |
| `/api/rooms` | idToken + `canView` (owner/viewer) | — |
| `/api/run` | idToken + `isOwner` | — |
| `/api/owner` | GET/POST invite: `isOwner` (invite `owner` ต้อง root) · POST `{code}`: idToken · DELETE: root | — |
| `/api/qr` | GET/POST `?room=`: `isOwner` · POST `{code}`: idToken + rate limit + ยืนยันย้ายห้อง | — |
| `/api/dev?do=seed`, `/api/dev?do=sendbill` | production → 404 · ที่อื่น header `x-seed-token` (≥ 16 ตัว) | ไม่มี auth ผู้ใช้ (เครื่องมือ dev) |
| `/api/webhook` | HMAC signature | ไม่ตรวจผู้ส่งต่อ event, ไม่มี idempotency |
| webhook `postback action=confirm` | signature ของ LINE + `isOwner(userId)` | ✅ ตรวจแล้ว |
| ทุก endpoint ที่เรียก `requireUser` | idToken หรือ `x-seed-token` | `x-seed-token` ใช้ได้เฉพาะ `vercel dev` / preview ที่เปิด `ALLOW_SEED_BYPASS` · production ปิดเสมอ |

## 15. เอกสารที่เกี่ยวข้อง

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — เส้นทาง request, state machine ของบิล, key map ใน Blob
- [`CONFIGURATION.md`](./CONFIGURATION.md) — env ทุกตัว, default, ผลของการไม่ตั้งค่า
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — deploy บน Vercel + Blob
- [`../HANDOFF.md`](../HANDOFF.md) — บันทึกส่งต่อทีม (กับดักที่เจอแล้ว, งานที่เหลือ)
