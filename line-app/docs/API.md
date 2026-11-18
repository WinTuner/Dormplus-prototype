<!-- generated-by: gsd-doc-writer -->

# API (HTTP endpoints)

เอกสารนี้อธิบาย endpoint ทั้งหมดที่ deploy อยู่ใต้ `api/` ของโปรเจกต์นี้ ทุกอย่างมาจากการอ่านโค้ดจริงใน `api/*.js` (ไม่มี endpoint หรือ field ที่เดาขึ้นมา) — path ฝั่งขวาของตารางคือไฟล์ที่ให้บริการ

Base URL: ไม่มีในเรพ — ใช้โดเมนของ deployment นั้น (`PUBLIC_BASE_URL` หรือ `https://<host>` ที่ request เข้ามา) <!-- VERIFY: production URL ของโปรเจกต์นี้ไม่มีในเรพ; HANDOFF.md ระบุ https://line-app-iota.vercel.app แต่ไม่ได้ยืนยันจาก Vercel -->

## 1. Endpoint ทั้งหมด

| Method ที่โค้ดยอมรับ | Path | Auth | ไฟล์ |
|---|---|---|---|
| ทุก method (ไม่ได้ตรวจ — ใช้ GET) | `/api/config` | ไม่มี (public) | `api/config.js` |
| ทุก method (ไม่ได้ตรวจ — ใช้ GET) | `/api/me` | Bearer idToken | `api/me.js` |
| `GET` (ทุก method ที่ไม่ใช่ POST ถูกอ่านเป็น GET) / `POST` (ยกเลิกบิล) | `/api/bill` | Bearer idToken + สิทธิ์รายห้อง (POST: เจ้าของเท่านั้น) | `api/bill.js` |
| `POST` เท่านั้น | `/api/slip` | Bearer idToken + สิทธิ์รายห้อง | `api/slip.js` |
| ทุก method (ไม่ได้ตรวจ — ใช้ GET) | `/api/slip-image` | Bearer idToken + สิทธิ์รายห้อง | `api/slip-image.js` |
| ทุก method (ไม่ได้ตรวจ — ใช้ GET) | `/api/rooms` | Bearer idToken + owner | `api/rooms.js` |
| `POST` เท่านั้น | `/api/run` | Bearer idToken + owner | `api/run.js` |
| `GET` / `POST` / `DELETE` | `/api/owner` | Bearer idToken (ดู §2.5) | `api/owner.js` |
| `GET` / `POST` | `/api/qr` | Bearer idToken (ดู §2.6) | `api/qr.js` |
| `POST` เท่านั้น | `/api/dev?do=seed` | header `x-seed-token` · มีเฉพาะ `vercel dev` หรือ preview ที่ตั้ง `ALLOW_SEED_BYPASS=true` (production ตอบ 404) | `api/dev.js` |
| `POST` เท่านั้น | `/api/dev?do=sendbill` | header `x-seed-token` · มีเฉพาะ `vercel dev` หรือ preview ที่ตั้ง `ALLOW_SEED_BYPASS=true` (production ตอบ 404) | `api/dev.js` |
| `POST` เท่านั้น | `/api/webhook` | `x-line-signature` (HMAC) | `api/webhook.js` |
| `GET` เท่านั้น | `/api/cron` | `Authorization: Bearer <CRON_SECRET>` (Vercel Cron แนบให้เอง) | `api/cron.js` |

`api/_auth.js`, `api/_line.js`, `api/_rooms.js`, `api/_store.js` (และ `_bills.js`, `_remind.js`, `_async.js`, `_limit.js`, `_qr.js`) เป็น shared module ไม่ใช่ endpoint (ขึ้นต้นด้วย `_`) <!-- VERIFY: Vercel ไม่สร้าง public route ให้ไฟล์ที่ขึ้นต้นด้วย `_` ใน api/ — เป็นพฤติกรรมแพลตฟอร์ม ไม่มีอะไรในเรพยืนยัน --> — ไฟล์ที่ชื่ออื่นใน `api/` กลายเป็น route ตามชื่อไฟล์โดยไม่ต้องประกาศใน `vercel.json` (ซึ่งมี `rewrites` (`/` → `/liff/bill.html`), `crons` (`/api/cron`), `headers` และ `git.deploymentEnabled`)

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
| 409 | `INVALID_STATE` | ถอนสิทธิ์เจ้าของหอคนแรก, ยกเลิกบิลที่ `void` แล้ว (`POST /api/bill`), ส่งสลิปหลายงวด (`periods`) แต่มีงวดที่ไม่มีบิล / ไม่ใช่ของสัญญาเช่าปัจจุบัน / ไม่ใช่ `unpaid`\|`pending` (ข้อความระบุงวดนั้น) |
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
| `config` | `Cache-Control: public, max-age=300, s-maxage=300` (ค่าเดียวสำหรับทุกคน — หน้าเว็บขอครั้งแรกก่อน `liff.init`) |
| `me`, `bill`, `rooms`, `owner` | `Cache-Control: no-store` |
| `slip-image` | `Content-Type: image/*` + `Cache-Control: private, no-store` |
| `slip`, `run`, `webhook` | **ไม่ตั้ง `Cache-Control` เลย** (ส่วน `config`, `dev`, `me`, `owner`, `qr`, `rooms`, `bill` ตั้ง `no-store` เอง) |

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
| `POST /api/owner` | ผู้ใช้ที่ล็อกอิน LINE | `{code}` | `{owner, role}` — มีสิทธิ์นั้นอยู่แล้วได้ `{already:true}` (**รหัสถูกใช้แล้วด้วย** ส่งต่อให้คนอื่นไม่ได้อีก) · viewer ที่ได้รหัส owner ถูกอัปเกรด |
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
| `POST /api/qr?room=203&mode=add` | เจ้าของ | — | **เพิ่มสมาชิก (รูมเมท):** รหัสแยกสำหรับเพิ่มบัญชีที่สอง ไม่แตะผู้เช่าหลัก · สแกนซ้ำได้ (idempotent) · ออกใหม่ = รหัสเก่าใช้ไม่ได้ · `POST ?room=` (ไม่มี mode) = เปลี่ยนผู้เช่า และล้างสมาชิกทั้งหมด |
| `POST /api/qr?room=203` | เจ้าของ | — | **เปลี่ยนผู้เช่า:** ถอดผู้เช่าที่ผูกอยู่ (`unbound:true`) + รหัสใหม่ (`rotated:true`) + เขียน `tenancy:<room>` (ดูล่าง) · `prepayArchived:true` เมื่อมีสลิปโอนล่วงหน้าของคนเดิมถูกเก็บเข้า `prepay-old:*` · **ล้างสมาชิกทุกคนและรหัส `mode=add` ที่ค้างอยู่** |
| `POST /api/qr` | ผู้ใช้ที่ล็อกอิน LINE | `{code, confirmMove?}` | `{ok:true, room, previous}` — เขียน `user-room:<userId>` + `room-users:<room>` (สมาชิก; คนแรกเป็นผู้เช่าหลักใน `room-user:<room>`) + สลับเมนูผู้เช่า · สมาชิกเห็นบิลและแนบสลิปได้ แต่การ์ด/ทวง/ใบเสร็จส่งหาผู้เช่าหลักคนเดียว |

- รหัส 10 ตัว (ไม่มี 0/O/1/I/L) · เก็บ 2 key: `room-qr:<room>` และ `qr-code:<code>` (ตัวหลังถูกลบเมื่อหมุน)
- **ผู้เช่าใหม่ไม่เห็นบิลของคนเก่า:** เมื่อผู้เช่าออกจากห้อง — กด "เปลี่ยนผู้เช่า" (เขียนเสมอ แม้ไม่มีใครผูกอยู่) หรือผู้เช่าย้ายไปห้องอื่นด้วย `confirmMove` (เขียนให้ห้องที่ออก) — ระบบเขียน `tenancy:<room>` = `{ since: <ISO now> }` · การผูกเองไม่เขียน · ห้องที่ยังไม่มี `tenancy` แสดงทุกบิลเหมือนเดิม (ผู้เช่าปัจจุบันไม่เสียประวัติ ช่องโหว่เปิดเฉพาะหลังเปลี่ยนผู้เช่า ซึ่งจากนี้ทุกครั้งจะเขียน record)
- **สลิปโอนล่วงหน้าของคนเดิม:** ตอนเขียน `tenancy` ถ้ามี `prepay:<room>` จะคัดลอกไป `prepay-old:<room>:<slipAt>` (ไฟล์รูปเก็บไว้) ตั้ง `prepay:<room>` เป็น `null` และ push ข้อความหา `OWNER_USER_ID` `ห้อง <room>: ผู้เช่าเดิมมีสลิปโอนล่วงหน้าค้างอยู่ — ไม่ถูกผูกกับผู้เช่าใหม่ ตรวจสอบ/คืนเงินเอง` (push พังแค่ log)
- รหัสผิด/ถูกหมุนแล้ว → `404 NOT_FOUND`
- ห้องที่ไม่อยู่ใน `ROOMS` → `404 NOT_FOUND` (กันพิมพ์เลขห้องผิด — endpoint นี้ไม่ตรวจว่าห้องมีผู้เช่าหรือบิลหรือไม่)
- **QR ผูกได้เฉพาะห้องที่ยังว่าง** — ห้องที่มีผู้เช่าผูกอยู่แล้วตอบ `409 ROOM_TAKEN` คนที่ถ่ายรูป QR ไปจึงแย่งห้องไม่ได้ · ผูกสำเร็จแล้วเจ้าของได้ข้อความแจ้ง · ย้ายห้องแล้วห้องเก่าเลิกส่งบิลให้ · ผิดเกิน 10 ครั้ง/ชม. → `429 TOO_MANY_ATTEMPTS`
- **ย้ายห้องต้องยืนยัน** — ผู้เช่าที่ผูกห้องอื่นอยู่แล้วได้ `409 MOVE_CONFIRM_REQUIRED` (`error.current` = ห้องเดิม, `error.room` = ห้องใหม่) จนกว่าจะส่ง `confirmMove: true` · ลิงก์ `?bind=` ที่คนอื่นส่งมาจึงย้ายห้องใครเงียบ ๆ ไม่ได้ · หน้า LIFF ถาม "ย้ายไปห้อง X?" แล้วส่งซ้ำพร้อม flag ให้เอง

### 2.7 การเขียนแบบมีเงื่อนไข (CAS) — กันเขียนทับกัน

R2 เก็บ ETag ให้ทุก object จึงอ่านก่อนเขียนได้ 3 แบบใน `api/_store.js`:

| ฟังก์ชัน | ใช้กับ | พฤติกรรม |
|---|---|---|
| `update(key, apply, attempts = 3)` | ดัชนีที่ต้อง **รวม** รายการ: `bill-state:<room>` (`_ledger.indexState`), `bills:<room>` (`_bills.indexBills`) | อ่าน ETag → `apply(current)` → เขียน `If-Match` · แพ้ 412 อ่านใหม่แล้วรวมซ้ำ · ครบ 3 ครั้งยังแพ้ → throw (ไม่เขียนเงียบ ๆ) · `apply` คืน `undefined` = ไม่ต้องเขียน |
| `create(key, value)` | `slip-ref:<transRef>` (`slip.rememberRef`) | เขียน `If-None-Match: *` — สำเร็จเฉพาะคนแรกที่สร้าง key · คนที่สองได้ `false` และสลิปถูกปฏิเสธว่า "สลิปนี้ถูกใช้ไปแล้ว" |
| `get` / `set` | ข้อมูลที่เจ้าของเป็นคนแก้ทีละคน (บิล, การตั้งหอ) | ไม่มีเงื่อนไข — ตัวหลังทับตัวแรก |

บน Vercel Blob (ยังไม่ได้ตั้ง `R2_*`) ทั้ง `update` และ `create` ถอยเป็นเขียนครั้งเดียวโดยไม่มีเงื่อนไข — สลิปซ้ำจึงกันได้เท่าที่รอบ requests ไม่ทับกันพอดี

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

## 5. `GET /api/bill?room=203[&period=YYYY-MM][&history=1][&voided=1]` และ `POST /api/bill` (ยกเลิกบิล)

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
  "receiptNo": "R202611-203",
  "hasSlip": true,
  "advance": null
}
```

- **`receiptNo`:** เลขใบเสร็จ `R<yyyymm>-<room>` และต่อท้าย `-<rev>` เมื่อ `rev > 1` (เช่น `R202611-203`, `R202611-203-2`) — webhook เขียนตอนเจ้าของยืนยัน · เลขคำนวณจากบิลโดยตรง (ไม่ใช้ตัวนับกลาง เพราะ Blob ไม่มี transaction ตัวนับร่วมอาจแจกเลขซ้ำ; หนึ่งบิลต่อห้องต่อรอบจึงไม่ซ้ำ) · บิลที่ `paid` ก่อนมีฟีเจอร์นี้ไม่มีเลขเก็บไว้ แต่ API คำนวณให้ตอนอ่านด้วยสูตรเดียวกัน · บิลที่ยังไม่ `paid` ได้ `null` (เฉพาะ `history=1`; แบบ `period=`/ล่าสุดไม่มี field นี้เมื่อยังไม่ชำระ)
- **ไม่ส่ง `confirmedBy` / `voidedBy` ให้ผู้เช่า:** สองฟิลด์นี้เป็น LINE userId ของเจ้าของหอ — ผู้เช่าได้บิลที่ตัดสองฟิลด์ออก (เจ้าของ/ผู้ช่วยได้ครบ) · บิลที่ระบบปิดเอง (`autoConfirmed:true`) มี `confirmedBy: null` และ `confirmedVia: "slipok"`
- **`voided=1` (เจ้าของ/ผู้ช่วยเท่านั้น):** `{ room, items: [bill, ...] }` — บิลที่ถูกยกเลิก **ทุกใบ** (เก็บตอนกดยกเลิก ไม่ต้องรอออกใหม่) ที่ `bill-void:<period>:<room>:<rev>` ตามรายการ `bill-voids:<room>` เรียงรอบใหม่→เก่า แล้ว `rev` มาก→น้อย · แต่ละรายการคือบิลตามที่เป็นตอนถูกยกเลิก (`voidReason`, `receiptNo`, `refundDue`, สลิป ฯลฯ ไม่แก้) · `period=YYYY-MM` กรองเฉพาะรอบ · ผู้เช่า (แม้ห้องตัวเอง) → `403 FORBIDDEN` · ดัชนีเก็บล่าสุด 200 รายการ
- **`history=1`:** `{ room, items: [{ period, total, status, receiptNo, due, hasSlip }] }` — `status` เป็น `unpaid` / `pending` / `paid` / `void`
- **บิลที่ถูกยกเลิก** (`status:"void"`) ยังถูกส่งกลับตามปกติ พร้อม `voidedAt`, `voidedBy`, `voidReason`, `statusBefore` (และ `receiptNo`, field สลิปเดิมที่เก็บไว้เป็นหลักฐาน) · `rev` = ครั้งที่ออกบิลของรอบนั้น (ไม่มี = 1) เพิ่มเมื่อออกบิลใหม่แทนบิลที่ `void` · `slipGroup` = `{ periods, total }` เมื่อสลิปนี้จ่ายหลายงวด (ดู §6)

`advance` = `{ slipAt, hasSlip, note }` จาก `prepay:<room>` เมื่อผู้เช่าโอนก่อนบิลออกแล้วยังไม่มีบิลมารับ มิฉะนั้น `null` · ส่งเฉพาะเมื่อสลิปนั้นจะถูกผูกได้จริง (`_prepay.usableIn`: ผู้ส่งยังเป็นผู้เช่าห้องนี้ — เจ้าของหอหรือผู้เช่าร่วมที่ผูกด้วย QR "เพิ่มผู้เช่า" ก็นับ) สลิปที่ค้างจากผู้เช่าคนเก่าจึงไม่ถูกโชว์ว่า "ระบบจัดการให้แล้ว" · อ่านคู่กับบิลแบบขนาน · ไม่มีใน `period=` และ `history=1`

field ที่มีจริงขึ้นกับว่าเขียนผ่าน path ไหน: `run` สร้าง `room, period, rent, water, elec, waterUnits, elecUnits, total, due, status, rev, issuedAt` และถ้าผูกสลิปโอนล่วงหน้าเพิ่ม `slipPath, slipNote, slipAt, slipCount, slipVerify, prepaid: true`; `slip` เพิ่ม `slipPath, slipNote, slipAt, slipCount` (และ `slipGroup` เมื่อส่ง `periods`); webhook เพิ่ม `paidAt, confirmedBy, receiptNo` (ดู §13; ปิดโดยสลิปที่ตรวจผ่านเพิ่ม `autoConfirmed: true, confirmedVia: "slipok"` และ `confirmedBy: null` — `slip` เขียนเอง ใช้ตัวช่วย `_pay.js` ชุดเดียวกับ webhook); `POST /api/bill` เพิ่ม `voidedAt, voidedBy, voidReason, statusBefore` — `hasSlip` คำนวณสด (`!!bill.slipPath`) ไม่ได้เก็บลง Blob
- **Error:** `400 VALIDATION` (ไม่มี `room` และยังไม่ผูกห้อง, `period` ผิดรูป), `403 FORBIDDEN` (ผูกห้องอื่น, หรือผู้เช่าขอ `voided=1`), `404 NOT_FOUND` (ไม่มีบิล — กรณีเรียกแบบบิลล่าสุด body เป็น `{ error: { code, message, advance } }` โดย `advance` เป็นรูปเดียวกับข้างบนหรือ `null` เพื่อให้หน้า LIFF แสดง "โอนแล้ว รอบิลออก"), `401`/`403` จาก `requireUser`
- **อ่าน Blob:** `user-room:<userId>`, `bill:<room>`, `prepay:<room>` (เฉพาะแบบบิลล่าสุด), `tenancy:<room>` (เฉพาะผู้เช่า — อ่านพร้อมกับบิล ไม่ใช่ก่อน), `bill-voids:<room>` + `bill-void:<period>:<room>:<rev>` (เฉพาะ `voided=1`)
- **Side effect:** ไม่มี
- **หมายเหตุ:** GET ไม่ตรวจ `req.method` (ยกเว้น POST ที่เข้า path ยกเลิกบิลด้านล่าง)

### `GET /api/bill?pending=1` — บิลที่รอตรวจสลิป (ทุกงวด)

เจ้าของ/ผู้ช่วยเท่านั้น (ผู้เช่า → `403`) · ทุกห้องใน `ROOMS` · มาจากดัชนี `bill-state:<room>` (1 อ่าน/ห้อง) แล้วอ่าน `bill:<period>:<room>` เฉพาะห้องที่มีบิล `pending` · ครอบ **ทุกงวด** ไม่ใช่แค่งวดล่าสุดของห้อง เพราะผู้เช่าจ่ายงวดเก่าได้ (`periods` ของ `/api/slip`) และการ์ดที่ส่งเข้าแชทต้องมีที่กดยืนยันในหน้าเจ้าของด้วย · → `{ count, total, items: [{ room, period, total, due, slipAt, slipCount, slipPath, slipVerify }] }` เรียง `period` เก่าสุดก่อน แล้วเลขห้อง

### `GET /api/bill?overdue=1` — ยอดค้างชำระ (นับที่เซิร์ฟเวอร์)

บิล `unpaid` ที่มี `due` และ `due` **น้อยกว่า** วันนี้ (เวลา Asia/Bangkok — `_ledger.bangkokToday()`) · `due` = วันนี้ยังไม่ถือว่าค้าง · `pending` / `paid` / `void` / ไม่มี `due` ไม่นับ · อ่านบิลล่าสุด + ย้อนหลังอีก 12 งวดต่อห้อง (เท่ากับที่ cron ทวงใช้) · `daysOverdue` = จำนวนวันปฏิทินจาก `due` ถึงวันนี้ (ข้ามเดือน/ปีถูกต้อง)

- **ผู้เช่า:** เฉพาะห้องที่ผูก (ส่ง `room` ห้องอื่น → `403`; ยังไม่ผูก → `400`) และกรองตามสัญญาเช่าเหมือน `history` → `{ today, room, count, total, maxDaysOverdue, items: [{ period, total, due, daysOverdue }] }` เรียง `due` เก่าสุดก่อน
- **เจ้าของ/ผู้ช่วย:** ทุกห้องใน `ROOMS` (`room=` เลือกห้องเดียว, ไม่มีห้องนั้น → `404`) → `{ today, count, total, rooms: [{ room, count, total, maxDaysOverdue, items }] }` เฉพาะห้องที่ `count > 0` เรียง `maxDaysOverdue` มาก→น้อย แล้วเลขห้อง
- **อ่าน Blob:** `bill:<room>`, `bills:<room>`, `bill:<period>:<room>` (ต่อห้อง อ่านพร้อมกันแบบจำกัดจำนวน), `tenancy:<room>` (ผู้เช่า)

### `GET /api/bill?income=YYYY-MM` — รายรับของเดือน (ตามวันที่ชำระ)

เจ้าของ/ผู้ช่วยเท่านั้น (ผู้เช่า → `403`, เดือนผิดรูป → `400`) · นับบิล `status:"paid"` ที่ `paidAt` ตกในเดือนนั้นตามเวลา Asia/Bangkok **ไม่ว่าบิลจะเป็นของรอบไหน** (บิล ต.ค. ที่จ่าย 2 พ.ย. = รายรับ พ.ย.; `2026-10-31T17:30:00Z` คือ 1 พ.ย. ในไทย) · บิล `void` ไม่นับ (เป็นเงินที่ต้องคืน ดู `refundDue`) · ต่อห้องอ่านทุกรอบในดัชนีตั้งแต่ เดือน−12 **ขึ้นไปโดยไม่มีเพดานบน** (บิลรอบถัดไปที่ออกก่อนและจ่ายเดือนนี้ก็นับ เช่น บิล ธ.ค. ที่จ่าย 20 พ.ย. = รายรับ พ.ย. ไม่ใช่ ธ.ค.) — อ่านจำกัดจำนวน จึงมีอย่างเดียวที่ไม่นับคือบิลที่จ่ายหลังรอบของมันเกิน 12 เดือน · → `{ month, total, count, items: [{ room, period, total, paidAt, receiptNo }] }` เรียงตาม `paidAt`

### `GET /api/bill?voided=1&refunds=1` — เงินที่ยังต้องคืน

เจ้าของ/ผู้ช่วยเท่านั้น (ผู้เช่า → `403`) · ทุกห้อง (`room=` เลือกห้องเดียว) · มี 2 ชนิด แต่ละรายการมี `kind`: `"void"` = บิลที่ยกเลิกหลังจ่าย (จากคลัง `bill-void:`) ที่มี `refundDue` และยังไม่มี `refundedAt` · `"overpaid"` = บิลที่ `paid` แล้วแต่สลิปที่ยืนยันมากกว่ายอดบิล (`refundReason:"overpaid"`, `refundDue` = ส่วนเกิน) อ่านจากแท็ก `"<period>:<rev>"` ใน `overpaid:<room>` แล้วเก็บเฉพาะบิลที่ยังเป็น rev นั้น มี `refundDue` และยังไม่มี `refundedAt` → `{ room?, count, total, items: [{ ...บิล, kind } ...] }`

### `POST /api/bill` — บันทึกว่าคืนเงินแล้ว (`refunded`)

นโยบาย: ระบบไม่โอนเงินเอง เจ้าของคืนเงินนอกระบบแล้วกดบันทึก

- **Auth:** `isOwner` เท่านั้น (ผู้ช่วย/ผู้เช่า → `403`)
- **Body:** `{ "action": "refunded", "kind": "void", "room": "203", "period": "2026-11", "rev": 1, "note": "โอนคืนแล้ว" }` — `kind` ไม่บังคับ: `"void"` (ค่าเริ่มต้น) หรือ `"overpaid"` · `rev` จำนวนเต็ม ≥ 1 · `note` ไม่บังคับ ≤ 200 ตัวอักษร
- **200:** `{ ok: true, room, period, rev, refundedAt, refundDue }` (`kind:"overpaid"` เพิ่ม `kind`)
- **Error:** `400 VALIDATION` (รวม `kind` ที่ไม่รู้จัก) · `404` (ห้องไม่อยู่ใน `ROOMS` หรือไม่มี `bill-void:<period>:<room>:<rev>`; `overpaid`: ไม่มี `bill:<period>:<room>`) · `409 INVALID_STATE` (ไม่มี `refundDue` = ไม่เคยจ่าย/ไม่ได้จ่ายเกิน, หรือ `refundedAt` มีแล้ว; `overpaid`: บิลไม่ใช่ `paid` หรือ rev ไม่ตรง)
- **เขียน Blob:** `bill-void:<period>:<room>:<rev>` += `refundedAt` (ISO), `refundedBy` (userId เจ้าของ), `refundNote` · ถ้า `bill:<period>:<room>` ยังเป็น void ของ `rev` เดียวกัน อัปเดตด้วย `saveBill` (`bill:<room>` ตามไปด้วย) — ถ้าออกบิลใหม่ (rev ถัดไป) แล้ว บิลใหม่ไม่รับ field เหล่านี้ · `kind:"overpaid"`: ตั้ง `refundedAt/refundedBy/refundNote` บนบิล `paid` นั้นเอง (`saveBill`) ไม่แตะสถานะหรือยอด
- **ผู้เช่าไม่เห็น `refundedBy`** (ตัดออกพร้อม `confirmedBy`/`voidedBy`) แต่เห็น `refundDue`/`refundedAt` ในบิลของตัวเอง

### `POST /api/bill` — ยกเลิกบิล (void)

`paid` แก้ไม่ได้ ทางเดียวคือ **ยกเลิกแล้วออกบิลใหม่** (`/api/run` ออกบิลรอบที่ `void` ได้ และเพิ่ม `rev` ทำให้ใบเสร็จใหม่ได้เลข `-2`)

- **Auth:** Bearer idToken + `isOwner` (ผู้ช่วยดูอย่างเดียวและผู้เช่า → `403 FORBIDDEN`)
- **Body:** `{ "action": "void", "room": "203", "period": "2026-11", "reason": "กรอกยอดผิด" }` — `reason` บังคับ 1–200 ตัวอักษร (ตัดช่องว่างหัวท้าย) · `period` รูป `YYYY-MM` ที่เดือน 01–12
- **200:** `{ "ok": true, "room": "203", "period": "2026-11", "status": "void" }` · ถ้าบิลนั้นจ่ายแล้ว — หรือยัง `pending` แต่สลิปผ่านการตรวจ (`slipVerify.ok === true`: เงินเข้าจริง ขาดแค่การกดยืนยัน) — เพิ่ม `"refund": <ยอดที่หอต้องคืน>` = `total` + ส่วนเกินจากยอดโอนเกินที่ยังไม่ได้คืน (เท่ากับ `refundDue` ของบิลที่ยกเลิก) · สลิปที่ตรวจไม่ได้ (`ok: null`) ไม่ทำให้เกิดยอดคืน เพราะยังไม่รู้ว่ามีเงินจริง
- **Error:** `403 FORBIDDEN` → `400 VALIDATION` (action ไม่ใช่ `void`/`reject`/`refunded`, ไม่มี room, period ผิดรูป, reason ว่าง/ยาวเกิน) → `404 NOT_FOUND` (room ไม่อยู่ใน `ROOMS`, หรือไม่มี `bill:<period>:<room>`) → `409 INVALID_STATE` (`void` อยู่แล้ว)
- **เขียน Blob:** `bill:<period>:<room>` = บิลเดิม + `status:"void"`, `voidedAt` (ISO), `voidedBy` (userId เจ้าของ), `voidReason`, `statusBefore` (สถานะก่อนยกเลิก) และ `refundDue` (ยอดที่ต้องคืน เมื่อยกเลิกบิลที่จ่ายแล้ว หรือบิล `pending` ที่สลิปผ่านการตรวจ = `total` + ส่วนเกิน `overpaid` ที่ยังไม่ได้คืน) ผ่าน `saveBill` — สำเนาที่ยกเลิกไม่รับ `refundDue`/`refundReason`/`refundedAt`/`refundedBy`/`refundNote` จากบิลเดิม (ไม่งั้นส่วนเกินที่ค้างจะถูกทับ และการคืนส่วนเกินไปแล้วจะซ่อนยอดคืนเต็มว่า "คืนแล้ว") ถ้าส่วนเกินถูกคืนไปก่อนยกเลิก จะเก็บเป็น `priorRefund: { reason:"overpaid", amount, refundedAt }` เพื่อดูประวัติเท่านั้น · — `bill:<room>` ตามไปด้วยเมื่อเป็นรอบล่าสุด · `receiptNo` และ field สลิปคงไว้เป็นหลักฐาน · **เก็บเข้าคลังทันที** ที่ `bill-void:<period>:<room>:<rev>` + `bill-voids:<room>` (idempotent — `/api/run` เก็บซ้ำได้)
- **Side effect:** push ข้อความหาผู้เช่า `บิลห้อง <room> รอบ <period> ถูกยกเลิก — <reason>` เฉพาะเมื่อมีผู้เช่าผูกอยู่และบิลนั้นเป็นของสัญญาเช่าปัจจุบัน (push พังแค่ log)
- **ผลต่อส่วนอื่น:** `/api/run` ออกบิลรอบที่ `void` ใหม่ได้ (`rev = เดิม + 1`; ออกบิล `unpaid` ซ้ำคง `rev` เดิม) · webhook ยืนยันบิล `void` → "บิลนี้ถูกยกเลิกแล้ว" ไม่เปลี่ยนอะไร · `/api/slip` ถือบิลล่าสุดที่ `void` เป็น "ไม่มีบิลที่ต้องจ่าย" (ทางโอนก่อนบิลออก) · แชท "บิล" ตอบข้อความยกเลิกแทนการ์ดจ่ายเงิน

#### `action: "reject"` — ตีกลับสลิป (ไม่ยกเลิกบิล)

- **Body:** `{ "action": "reject", "room": "203", "period": "2026-11", "reason": "ยอดในสลิปไม่ตรง" }`
- **ต้องเป็นบิล `pending`** — สถานะอื่น → `409 INVALID_STATE`
- **200:** `{ "ok": true, "room", "period", "status": "unpaid", "rejected": reason }`
- **เขียน Blob:** `status` กลับเป็น `unpaid` + `slipRejected: { at, by, reason }` · **สลิปเดิมยังอยู่** (`slipPath`, `slipAt`, `slipVerify`) เป็นหลักฐาน และ `slipCount` ยังนับในเพดาน 5 ครั้ง
- **Side effect:** push `สลิปห้อง <room> รอบ <period> ไม่ผ่าน — <reason>` หาผู้เช่าที่ผูกอยู่ (push พังแค่ log)
- **ผลต่อส่วนอื่น:** ผู้เช่าแนบสลิปใหม่ได้ทันที (สถานะกลับเป็น `pending`) · การ์ดยืนยันเดิมกดไม่ได้เพราะบิลไม่ใช่ `pending` แล้ว · งวดอื่นของสลิปกลุ่มไม่ถูกแตะ (ตีกลับเป็นรายงวด)

## 6. `POST /api/slip`

`api/slip.js` — ผู้เช่าแนบสลิปแล้วแจ้งเจ้าของให้ยืนยัน · **ผู้เช่าต้องแนบรูปเมื่อส่งสลิปใหม่** (ไม่มี `image` → `400 VALIDATION` "ต้องแนบรูปสลิป" เมื่อบิล/prepay ยังไม่มีสลิป และเสมอสำหรับ `periods`) · **ข้อยกเว้น:** ผู้เช่าแก้หมายเหตุของสลิปที่ส่งไปแล้วได้โดยไม่แนบรูป — บิล `pending` ที่มี `slipPath` อยู่แล้ว หรือ `prepay:<room>` ที่มี `slipPath` (บิลที่อยู่ในสลิปหลายงวดไม่เข้าข้อนี้) · การแก้แบบนี้คงรูปและผลตรวจเดิม (รวม `slipAmount`/`overpaid`/`shortBy`) ไม่เรียกผู้ให้บริการใหม่ แต่ยังนับ `slipCount` และจำกัดความถี่ · เจ้าของ/ผู้ช่วยบันทึกโดยไม่มีรูปได้ (เช่นรับเงินสด) — การ์ดยืนยันของสลิปที่ไม่มีรูปจะไม่มีปุ่ม "ดูสลิป" และมีบรรทัดเตือน "ไม่มีรูปสลิป — ตรวจยอดเงินเข้าเองก่อนยืนยัน"

**สองทางตามสถานะบิลล่าสุด** (สำหรับผู้เช่า บิลล่าสุดที่ไม่ใช่ของสัญญาเช่าปัจจุบัน — ดู §5 — นับเป็น "ไม่มีบิล" จึงเข้าทางโอนก่อนบิลออก และไม่แตะบิลเก่า · เจ้าของไม่ถูกกรอง): ถ้า `bill:<room>` เป็น `unpaid`/`pending` สลิปผูกกับบิลนั้น (ทางปกติ) · ถ้าไม่มีบิลเลย หรือบิลล่าสุด `paid` / `void` แล้ว ถือว่าเป็น **สลิปโอนก่อนบิลออก** เก็บเป็น `prepay:<room>` และ `/api/run` จะผูกให้กับบิลรอบถัดไปเอง (ไม่มี `409 INVALID_STATE` สำหรับบิลที่ชำระแล้วอีกต่อไป)

- **Auth:** Bearer idToken + สิทธิ์รายห้องแบบเดียวกับ `/api/bill`
- **Body (JSON):**

| field | type | บังคับ | หมายเหตุ |
|---|---|---|---|
| `room` | string | ไม่ (fallback = ห้องที่ผูกไว้) | |
| `note` | string | ไม่ | เก็บเป็น `slipNote` (ค่าว่าง → `null`) · ยาวไม่เกิน 500 ตัวอักษร |
| `image` | string (data URL) | **ผู้เช่า: บังคับเมื่อเป็นสลิปใหม่** (ยกเว้นแก้หมายเหตุสลิปที่ส่งแล้ว ดูด้านบน) · เจ้าของ: ไม่ | ต้องตรง `/^data:(image\/(jpeg\|png\|webp));base64,(.+)$/` |
| `periods` | string[] | ไม่ | **จ่ายหลายงวดในสลิปเดียว** — `YYYY-MM` ไม่ซ้ำ 1–12 รอบ · ไม่ส่ง = พฤติกรรมเดิมทุกอย่าง (ดูหัวข้อด้านล่าง) |

ขนาดรูปสูงสุด **3 MiB** (`MAX_BYTES = 3 * 1024 * 1024`) นับหลัง decode base64; นามสกุลไฟล์มาจาก mime (`jpeg` → `jpg`)
- **200:**

```json
{ "ok": true, "status": "pending", "total": 3796, "hasSlip": true,
  "verify": { "provider": "slipok", "ok": true, "amount": 3796, "transRef": "010092101507665143",
              "paidAt": "2026-11-10T03:15:07.000Z", "bank": "006" } }
```

**ปิดบิลอัตโนมัติ (`autoConfirmed`):** สลิปปิดบิลเองโดยเจ้าของไม่ต้องกด เมื่อ **ครบทุกข้อ** — (1) เป็นสลิปของบิลรายเดือน (ทางบิลเดียวหรือทาง `periods`) (2) มี **รูปใหม่ที่ตรวจในคำขอนี้** (ส่งแค่หมายเหตุ หรือเจ้าของบันทึกโดยไม่มีรูป ไม่ปิดเอง) (3) ผลตรวจสุดท้ายเป็น `ok === true` เป๊ะ — บัญชีผู้รับของหอ + ยอดตรงพอดี + ไม่ซ้ำ + ไม่เก่าเกิน 30 วัน + ไม่โอนก่อนบิลออก; `null`/`false`/เกิน/ขาด/stale/early/ซ้ำ ยังเป็น `pending` + การ์ดยืนยันเหมือนเดิม (4) **หอเปิดสวิตช์ `dorm.autoConfirm === true`** (ตั้งในหน้าตั้งค่าหอ ผ่าน `POST /api/rooms { dorm: { autoConfirm } }`; **ค่าเริ่มต้น = ปิด** ไม่เคยตั้ง/`false` = `pending` รอเจ้าของกดทุกใบ) และ (5) env `SLIP_AUTO_CONFIRM` ไม่ใช่ `0`/`off`/`false` — ค่าเหล่านั้นเป็น kill switch ของทั้ง deployment และ **ชนะ** สวิตช์ของหอ (ลำดับ: env ปิด → ปิด · ไม่งั้น `dorm.autoConfirm === true` → เปิด · นอกนั้น → ปิด; env อื่น ๆ ไม่เคยเปิดให้เอง) · **ไม่ปิดเอง:** สลิปโอนก่อนบิลออก (`advance`) และ prepay ที่ `/api/run` หรือการอ่านซ้ำของ slip ผูกกับบิล — ตอนส่งยังไม่มียอดบิลให้เทียบ และเจ้าของตัดสินใจให้เป็นมือ
- คำตอบ: `{ "ok": true, "status": "paid", "autoConfirmed": true, "receiptNo": "R202611-203", "total": 3796, "hasSlip": true, "verify": { … } }` · แบบ `periods`: `{ "ok": true, "status": "paid", "autoConfirmed": true, "periods": [...], "total": …, "receiptNos": ["R202610-203", "R202611-203"], "hasSlip": true, "verify": { … } }`
- บิลที่ปิดเอง = `status:"paid"`, `paidAt`, `receiptNo` (เลขเดียวกับที่เจ้าของกดยืนยัน), `autoConfirmed:true`, `confirmedVia:"slipok"`, `confirmedBy:null` (ไม่มีผู้กด); เขียนครั้งเดียวผ่าน `saveBills` (ไม่ผ่านสถานะ `pending`) · ผู้เช่าได้ใบเสร็จ (`receiptBubble`, retry key รูปแบบเดียวกับตอนเจ้าของยืนยัน) · เจ้าของ **ไม่ได้การ์ดยืนยัน** แต่ได้ข้อความสั้น "ห้อง X ชำระแล้ว N บาท (ตรวจสลิปอัตโนมัติ)" (หลายงวดระบุรอบทั้งหมด ข้อความเดียว) พร้อมปุ่ม "ดูสลิป" เปิด LIFF — ไม่มีปุ่มยืนยัน/ตีกลับ · retry key `auto-paid:<room>:<periods>:<slipAt>` · push พัง (ใบเสร็จหรือข้อความเจ้าของ) แค่ log ไม่ทำให้คำขอของผู้เช่าล้ม
- เจ้าของยกเลิก (void) บิลที่ปิดเองได้ตามกติกาเดิม (`paid` → `void`, `refundDue` = ยอดบิล)

`verify` = ผลตรวจสลิป (มีทุกกรณี; `ok` เป็น `true` / `false` / `null`):
- `true` — ผู้ให้บริการยืนยันยอดตรง + บัญชีผู้รับเป็นของหอ + สลิปไม่ซ้ำ · **บิลรายเดือนที่ได้ `ok:true` จากรูปใหม่ในคำขอนี้ปิดเองเป็น `paid`** (ดูหัวข้อ "ปิดบิลอัตโนมัติ" ด้านล่าง) · ทางโอนก่อนบิลออกและ prepay ที่ผูกกับบิลยังเป็น `pending` ให้เจ้าของกดยืนยัน
- `false` — `reason` บอกเหตุ: ยอดไม่ตรง · บัญชีผู้รับไม่ใช่ของหอ · สลิปซ้ำ (ของผู้ให้บริการหรือ `slip-ref:<transRef>` ของเรา)
- `null` — **ตรวจไม่ได้** (ไม่ได้ตั้ง `SLIPOK_API_KEY`/`SLIPOK_BRANCH_ID`, ผู้ให้บริการล่ม, หรืออ่านสลิปไม่ได้) — ไม่ใช่ "ปลอม"
  - รูปแบบ error จริงของผู้ให้บริการคือ `{ code, message, data }` **ไม่มี `success:false`** → โค้ดถือว่า "success ต้องเป็น `true` อย่างชัดเจน" และต้องมี `transRef` ถึงจะนับว่าผ่าน
- **สลิปเก่า (`stale`)** — ถ้าเวลาโอน (`paidAt`) เก่ากว่า 30 วันจากตอนส่ง สลิปยังถูกเก็บและบิลยังเป็น `pending` แต่ `ok:true` ถูกลดเป็น `ok:null` + `reason: "สลิปเก่า — โอนเมื่อ N วันก่อน"` + `stale:true` + `staleDays:N` (คง `amount`, `transRef`, `paidAt`, `bank`) · ลดหลังบันทึก `slip-ref:<transRef>` แล้ว สลิปเก่าที่ถูกใช้ซ้ำจึงยังถูกจับเป็นสลิปซ้ำ · ใช้ทั้งบิลเดียว หลายงวด และโอนก่อนบิลออก · ไม่เคยปฏิเสธสลิป (`markStale` ใน `api/_verify.js`)
- **โอนก่อนบิลออก (`early`)** — ถ้า `paidAt` เก่ากว่า `issuedAt` ของบิล (หลายงวด: ของบิลรอบล่าสุด) สลิปยังถูกเก็บและบิลยัง `pending` แต่ `ok:true` ถูกลดเป็น `ok:null` + `early:true` + `reason: "โอนก่อนบิลออก — ตรวจว่าเป็นสลิปของบิลนี้"` · ถ้าชนทั้งสองกฎ (เก่าเกิน 30 วันและก่อนบิลออก) เก็บทั้ง `stale` และ `early` และต่อ `reason` ด้วย " · " · ใช้กับบิลเดียวและหลายงวดเท่านั้น **ไม่ใช้กับทางโอนก่อนบิลออก และ prepay ที่ผูกกับบิล** (สลิปล่วงหน้าตั้งใจให้เก่ากว่าบิล) · ข้ามเมื่อไม่มี `issuedAt` (บิลเก่า) หรือไม่มี `paidAt` · ลดหลัง `slip-ref` เหมือน `stale` (`markEarly` ใน `api/_verify.js`) · ถ้าผู้ให้บริการไม่ให้ `paidAt` (ปิด SlipOK/ตรวจไม่ได้) สองกฎนี้ทำงานไม่ได้โดยตั้งใจ: `slipAt` คือเวลาที่เรารับรูป ไม่ใช่เวลาที่เงินโอน และ `ok` เป็น `null` อยู่แล้ว
- **ยอดไม่ตรงกับบิล (ติดธงอย่างเดียว ไม่บล็อก ไม่เก็บเป็นเครดิตรอบหน้า)** — เมื่อผลตรวจมี `amount` ระบบเทียบกับยอดบิล (หลายงวด: ผลรวม) แล้วเก็บบนบิล `slipAmount` และ `overpaid` (= สลิป − ยอดบิล ถ้า > 0) หรือ `shortBy` (= ยอดบิล − สลิป ถ้า > 0); หลายงวดเก็บชุดเดียวกันใน `slipGroup` และบนทุกบิลของกลุ่ม · เกิน → `ok:false` `reason: "ยอดในสลิปเกินบิล X บาท"` · ขาด → `ok:false` `reason: "ยอดในสลิปขาด X บาท"` · รหัส 1013 ที่ไม่มี `amount` คง "ยอดในสลิปไม่ตรงกับบิล" และไม่มีตัวเลขให้เก็บ · สลิปล่วงหน้าถูกเทียบตอนผูกกับบิล (`prepaidCopy`) · ส่งสลิปใหม่ล้างตัวเลขของสลิปเดิม · บิลยัง `pending` เจ้าของยืนยันหรือปฏิเสธเอง
  - การ์ดยืนยันของเจ้าของ (`confirmBubble`) แสดง "ยอดในสลิปเกินบิล X บาท — ต้องคืนผู้เช่า" หรือ "ยอดในสลิปขาด X บาท"; ถ้าไม่ได้อ่านยอดจากสลิป (`ok` ไม่ใช่ `true` และไม่มี `slipAmount`) การ์ดบอก "ยังไม่ได้ตรวจยอดในสลิป — เทียบยอดเงินเข้าเอง"
  - **ตอนเจ้าของยืนยัน** (§13): ถ้า `overpaid > 0` บิลที่ `paid` ได้ `refundDue = overpaid` + `refundReason: "overpaid"` และแท็ก `"<period>:<rev>"` ถูกเพิ่ม (ไม่ซ้ำ สูงสุด 200) ใน index `overpaid:<room>` · สลิปหลายงวด: ใส่ที่บิลของงวดใหม่สุดของกลุ่ม **ครั้งเดียว** · คำตอบถึงเจ้าของมี "ยอดเกิน X บาท — ต้องคืนผู้เช่า" · `/api/bill` ใช้สัญญานี้ (`refundDue`, `refundReason`, `overpaid:<room>`) ส่วน `refundedAt`/`refundedBy`/`refundNote` ตั้งตอนเจ้าของกด "คืนเงินแล้ว"

**`pay`** = QR พร้อมเพย์สำหรับบิลนี้ (มีเมื่อเจ้าของใส่พร้อมเพย์ในหน้าตั้งค่าหอ **และ** บิลยัง `unpaid`/`pending`):
`{ "payload": "000201010212...6304XXXX", "qr": "<svg …>" }` · `payload` เป็น EMVCo มาตรฐาน (tag 00/01/29/53/54/58 + CRC16) · `qr` เป็น SVG พร้อมแสดง · `null` เมื่อไม่มีพร้อมเพย์หรือบิลจ่ายแล้ว/ถูกยกเลิก
- ไม่มีรูปใหม่ (ส่งแค่มือ/หมายเหตุ) → คงผลเดิมของสลิปนั้น

ทางโอนก่อนบิลออก (ไม่มี `total` เพราะยังไม่มีบิล):

```json
{ "ok": true, "status": "advance", "hasSlip": true, "verify": { "provider": "slipok", "ok": null, "reason": "not_configured" } }
```

ถ้าเจ้าของออกบิลระหว่างที่คำขอนี้กำลังทำงาน (`/api/run` อ่าน `prepay:` ไปก่อนที่จะถูกเขียน) หลังเขียน `prepay:<room>` โค้ดอ่าน `bill:<room>` อีกครั้ง — ถ้าตอนนี้มีบิล `unpaid` ที่ผู้เช่าจ่ายได้ (ผู้ส่งต้องเป็นผู้เช่าปัจจุบัน และไม่ใช่บิลของผู้เช่าเก่า) จะผูกสลิปเข้าบิลนั้นเลย (บิล `pending`, `prepaid:true`, ล้าง `prepay:` ถ้า `slipAt` ยังตรง, push การ์ดยืนยันหาเจ้าของ) แล้วตอบ `{ "ok": true, "status": "pending", "attached": true, "total": 3532, "hasSlip": true, "verify": {...} }` แทน `status:"advance"` · `/api/run` ทำการตรวจซ้ำแบบกลับด้านหลังเขียนบิล (§9) — ฝั่งใดช้ากว่าจะเห็นอีกฝั่ง ถ้าทั้งคู่ผูกพร้อมกันเนื้อหาเหมือนกันและการ์ดถึงเจ้าของใบเดียว (retry key ด้านล่าง)

- **200 แบบหลายงวด (`periods`):**

```json
{ "ok": true, "status": "pending", "periods": ["2026-10", "2026-11"], "total": 7491, "hasSlip": true }
```

- **Error (ตามลำดับที่โค้ดเช็ก — ไม่มี `404` แล้ว เพราะห้องที่ไม่มีบิลเข้าทางโอนก่อนบิลออก):** `405 METHOD_NOT_ALLOWED` → `401`/`403` จาก `requireUser` → `400 VALIDATION` (`note` ไม่ใช่ข้อความหรือยาวเกิน 500) → `400 VALIDATION` (ไม่มี room) → `403 FORBIDDEN` (ไม่ได้ผูกห้อง) → `404 NOT_FOUND` (เจ้าของระบุ `room` ที่ไม่อยู่ใน `ROOMS`) → `400 VALIDATION` (ผู้เช่าไม่แนบ `image` ขณะที่ไม่มีสลิปเดิมให้แก้หมายเหตุ) → `429 SLIP_LIMIT` / `429 SLIP_TOO_SOON` → `400 VALIDATION` (mime ไม่อยู่ใน 3 ชนิด) → `413 TOO_LARGE`
- **จำกัดการส่ง (ผู้เช่าเท่านั้น เจ้าของไม่ติด):** ไม่เกิน 5 ครั้งต่อบิล และห่างกันอย่างน้อย 30 วินาที — ทุกสลิป push การ์ดหาเจ้าของ ซึ่งกินโควตาข้อความของ LINE OA · สลิปที่ถูกปฏิเสธไม่ส่งข้อความ · นับใน `slipCount` ของบิล (ทางโอนก่อนบิลออกนับใน `slipCount` / `slipAt` ของ `prepay:<room>` ด้วยกติกาเดียวกัน)
  - ทางสลิปกลุ่มนับจากบิลรอบล่าสุดของ **ทั้งรายการที่ส่งมาและบิลล่าสุดของห้อง** — ส่ง `periods` ที่เป็นงวดเก่างวดเดียวจึงไม่ใช่ทางลัดเลี่ยงเพดาน
  - ⚠️ เป็น **best-effort**: Blob ไม่มี atomic counter ถ้ายิงหลาย request พร้อมกันอาจมีบางตัวหลุดเกิน 5 (ตัวนับกันสแปม ไม่ใช่ด่านความปลอดภัย)
  - การออกบิล `unpaid` รอบเดิมใหม่ (`/api/run`) จะสร้างบิลใหม่และรีเซ็ต `slipCount`
- **การตรวจซ้ำก่อนเขียน (Blob ไม่มี compare-and-set):** อ่าน `bill:<period>:<room>` อีกครั้งก่อนบันทึก ถ้าบิลถูกยืนยันหรือยกเลิกไปแล้วในระหว่างที่รูปกำลังอัปโหลด/ตรวจ → `409 INVALID_STATE` · บิลที่จ่ายแล้วจึงไม่ย้อนกลับเป็น `pending` (ใบเสร็จจะหายจากรายงาน) และบิลที่ยกเลิกแล้วไม่ฟื้น · สลิปกลุ่มตรวจซ้ำทุกงวดก่อนเขียน
- **เขียน Blob:** `slips/<room>-<Date.now()>.<ext>` (เฉพาะเมื่อมี `image`), `bill:<room>` และ `bill:<period>:<room>` = บิลเดิม + `status:"pending"`, `slipPath`, `slipNote`, `slipAt` (ISO), `slipCount`
- **LINE retry key (กัน push ซ้ำเมื่อคำขอแข่งกัน):** `push(to, messages, { retryKey })` ใน `api/_line.js` ส่ง header `X-Line-Retry-Key` (UUID ที่แฮชจากสตริง `retryKey` แบบคงที่ ต้องมีของที่ทำให้ข้อความต่างกันอยู่ในสตริง เพื่อไม่ให้ LINE ตัดข้อความที่ต่างจริงทิ้งเป็นซ้ำ แต่คำขอที่แข่งกันต้องได้คีย์เดียวกัน) — LINE จำคีย์ 24 ชั่วโมงและตอบ `409` เมื่อซ้ำ ซึ่งโค้ดนับเป็นสำเร็จ (`{ duplicate: true }`) ถ้ามี retry key · ไม่มี retry key แล้วได้ 409 ยัง throw เหมือนเดิม · คีย์ที่ใช้: ใบเสร็จ `receipt:<room>:<userId ผู้เช่า>:<period:rev:total:receiptNo:slipAt,...>` (ไม่ใส่ `paidAt` เพราะสอง confirm ที่แข่งกันประทับเวลาคนละค่า) · เตือนรายวัน `remind:<room>:<วันที่>:<period:kind:rev:total:due,...>` (ใส่ยอดและวันครบกำหนดของแต่ละการ์ด เพื่อให้บิลที่ออกใหม่ rev เดิมแต่ยอด/วันที่เปลี่ยนไม่ถูก LINE ตัดทิ้งเป็นข้อความซ้ำ) · สรุปถึงเจ้าของ `remind-summary:<วันที่>:<ข้อความสรุป>` (สรุปที่ข้อความต่างกันไม่ถูกตัด) · การ์ดยืนยันของสลิปล่วงหน้าที่ผูกกับบิล `confirm:<room>:<period>:<total>:<slipAt>`
- **Side effect อื่น:** `push()` การ์ด `confirmBubble` ไปที่ `OWNER_USER_ID` — ถ้า push ล้มเหลวแค่ `console.error("owner push failed")` แล้วยังตอบ 200
- ถ้าไม่ได้แนบรูปใหม่ `slipPath` เดิมถูกคงไว้ · ถ้าแนบรูปใหม่ รูปเดิมถูกลบหลังบันทึกบิลแล้ว (ลบไม่สำเร็จแค่ `console.error`)
- **ทางโอนก่อนบิลออก:** ตรวจสิทธิ์ ตรวจ note และจำกัดการส่งเหมือนทางปกติ · เขียนรูปที่ `slips/<room>-advance-<Date.now()>.<ext>` และ `prepay:<room>` = `{ room, slipPath, slipNote, slipAt, slipCount, by, slipVerify }` + `byStaff:true` เมื่อเจ้าของ/ผู้ช่วยเป็นคนบันทึก (`slipCount` = ครั้งก่อน + 1, `by` = userId ผู้ส่ง) · prepay ที่ `byStaff` เป็นของห้อง ไม่ผูกกับผู้เช่าคนใด จึงถูกผูกเข้าบิลได้ทั้งโดย `/api/run` และการตรวจซ้ำของ `/api/slip` (prepay ของผู้เช่าผูกได้เมื่อ `by` ยังเป็นผู้เช่าปัจจุบันของห้องนั้น — ผู้เช่าหลัก เจ้าของหอ หรือผู้เช่าร่วมที่ผูกด้วย QR “เพิ่มผู้เช่า” ก็นับ ดู `_prepay.usableIn`) · ตอบ `status:"advance"` ถูกต้อง ณ ตอนตอบ — ถ้า `/api/run` ผูกให้ทีหลัง LIFF โหลดบิลใหม่หลังส่งสลิปอยู่แล้วจึงเห็น `pending` · **รูปของ prepay ที่ถูกแทนจะไม่ถูกลบ** (บิลที่กำลังถูกเขียนอยู่อาจอ้างถึง path นั้น) · ไม่แตะ `bill:*` · push ข้อความ text หา `OWNER_USER_ID`: `ห้อง <room> แจ้งโอนก่อนบิลออก — <note> · ระบบจะผูกสลิปนี้กับบิลรอบถัดไปให้เอง` (ไม่มี ` — <note>` ถ้าไม่มีหมายเหตุ · push ล้มเหลวไม่ fail request)

### สลิปเดียวจ่ายหลายงวด (`periods`)

เมื่อส่ง `periods` สลิปไม่ผ่านทางโอนก่อนบิลออก — **ทุก** `bill:<p>:<room>` ต้องมีอยู่, เป็นของสัญญาเช่าปัจจุบัน (เจ้าของไม่ถูกกรอง) และเป็น `unpaid`/`pending` ไม่งั้น `409 INVALID_STATE` ที่ระบุงวดนั้น (ไม่เขียนอะไรเลย) · ตรวจ note/รูป/สิทธิ์ห้องเหมือนเดิม · จำกัดการส่ง (5 ครั้ง / 30 วินาที) นับจากบิลของ **รอบล่าสุด** ในรายการ · `periods` ผิดรูป/ซ้ำ/ว่าง/เกิน 12 → `400 VALIDATION`

- **เขียน Blob:** ทุกบิลเป็น `pending` ด้วย `slipPath`, `slipNote`, `slipAt` เดียวกัน, `slipCount` = ของตัวเอง + 1 และ `slipGroup: { periods: [เรียงแล้ว], total: <ผลรวม>, slipAmount?, overpaid?, shortBy? }` (ผ่าน `saveBill`; ฟิลด์ยอดอยู่บนทุกบิลด้วย) · กฎ `early` เทียบกับ `issuedAt` ของบิลรอบล่าสุด · ถ้าไม่ส่งรูปใหม่ ใช้รูปเดิมของบิลรอบล่าสุดที่มีรูป
- **รูปเดิมที่ถูกแทน** ลบเฉพาะเมื่อไม่มีบิลอื่นของห้อง (ตาม index `bills:<room>` และ `bill:<room>`) ชี้ไปที่รูปนั้นอยู่ — กติกานี้ใช้กับทางสลิปบิลเดียวด้วย เพราะบิลอาจยังแชร์รูปกับงวดอื่นอยู่ · สลิปบิลเดียวของบิลที่เคยอยู่ในกลุ่มจะล้าง `slipGroup`
- **Side effect:** push การ์ด `confirmBubble` **ใบเดียว** หา `OWNER_USER_ID` แสดงทุกงวดกับยอดรวม ปุ่มยืนยันส่ง `action=confirm&room=<r>&periods=<p1,p2>` (กลุ่มที่มีงวดเดียวใช้การ์ดปกติ `period=`) — ดูการยืนยันที่ §13

## 7. `GET /api/slip-image?room=203[&period=YYYY-MM][&advance=1][&archived=1]`

`api/slip-image.js` — stream รูปสลิปจาก private Blob

- **Auth:** Bearer idToken + สิทธิ์รายห้อง · `archived=1` เป็นของเจ้าของ/ผู้ช่วยเท่านั้น
- **Query:** `room` (string) — **ไม่มี fallback ไปห้องที่ผูกไว้** ถ้าไม่ส่งจะได้ `room = ""` · `period=YYYY-MM` → สลิปของ **งวดนั้น** (`bill:<period>:<room>`) ไม่ใช่งวดล่าสุดของห้อง — หน้าเจ้าของมีสลิปรอตรวจได้หลายงวดของห้องเดียว · `advance=1` → stream `prepay:<room>.slipPath` (สลิปโอนก่อนบิลออก) ด้วยสิทธิ์แบบเดียวกัน · `archived=1` → สลิปโอนล่วงหน้าของผู้เช่าคนก่อน (`prepay-old:<room>`) ให้เจ้าของเปิดดูหลังเปลี่ยนผู้เช่า · ไม่ส่ง = สลิปของ `bill:<room>` เหมือนเดิม — ผู้เช่าจะไม่ได้สลิปของบิลที่ถูกซ่อนตามสัญญาเช่า (§5) → `404 ยังไม่มีสลิป` (`advance=1` ไม่ต้องกรอง เพราะ `prepay` ของคนเดิมถูกเก็บออกตอนเปลี่ยนผู้เช่า; `period` ที่ไม่มีบิลนั้น → `404` ไม่ fallback ไปงวดล่าสุด)
- **200:** byte ของรูป, `Content-Type` จาก `blob.blob.contentType` (fallback `image/jpeg`), `Cache-Control: private, no-store`
- **Error:** `403 FORBIDDEN` (ไม่ได้ผูกห้องนั้น — กรณีไม่ส่ง `room` ผู้เช่าจะได้ 403 นี้), `404 NOT_FOUND` (บิล — หรือ `prepay` เมื่อส่ง `advance` — ยังไม่มี `slipPath`, หรือ blob หาย), `401`/`403` จาก `requireUser`
- **อ่าน Blob:** `user-room:<userId>`, `bill:<room>` (หรือ `bill:<period>:<room>` เมื่อส่ง `period`, `prepay:<room>`), `get(bill.slipPath, {access:"private", useCache:false})`
- **Side effect:** ไม่มี

## 8. `GET /api/rooms` · `POST /api/rooms`

`api/rooms.js` — หน้าจดมิเตอร์ของเจ้าของ: ทุกห้อง + config + มิเตอร์ล่าสุด + บิล + ผู้เช่า · `?settings=1` ขอค่าตั้งของหอ · `POST` บันทึกค่าตั้งของหอ (`{dorm}`) หรือราคาของห้องเดียว (`{room, rent, waterRate, elecRate}`)

- **Auth:** Bearer idToken + owner หรือ viewer (`canView` · `403 FORBIDDEN` "เฉพาะเจ้าของหอ") — **`POST` เป็นของเจ้าของเท่านั้น** (viewer/ผู้เช่า → 403)
- **Query/body:** `GET` ไม่มี · `GET ?settings=1` คืน `{ dorm, defaults, rooms }` · `POST { "dorm": { "name", "rent", "waterRate", "elecRate", "dueDay", "promptpay", "autoConfirm" } }` (ส่งเฉพาะฟิลด์ที่จะแก้; `null` = ล้างค่ากลับไปใช้ env) · `POST { "room": "211", "rent": 1, ... }`
- **200 (`GET ?settings=1`):** `{ "dorm": { "name": "หอพักบ้านสวน", "rent": 3000, "dueDay": 5 } | null, "defaults": { "rent": 3000, "waterRate": 25, "elecRate": 7 }, "rooms": 12 }`
- **200 (`POST`):** `{ "dorm": {...}, "defaults": {...} }` หรือ `{ "room": "211", "config": {...} }`
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

`period` = `BILL_PERIOD || null`; `meter`/`bill` เป็น `null` ถ้ายังไม่มี; `advance` = `{ slipAt, hasSlip, verify }` ถ้าห้องนั้นมีสลิปโอนก่อนบิลออกรออยู่ (`prepay:<room>`) มิฉะนั้น `null` (`verify` = ผลตรวจของสลิปนั้น หรือ `null` ถ้ายังไม่ได้ตรวจ); `linked` บอกแค่ว่ามีผู้เช่าผูกห้องอยู่หรือไม่ (`tenant` เป็นค่าเดียวกัน เก็บไว้ให้หน้าเก่า); **`members`** = จำนวนบัญชีที่ผูกห้อง (`room-users:<room>`), **`tenantName`** = ชื่อผู้เช่าหลัก (จาก LINE ตอนผูก; `null` ถ้า LINE ไม่ให้ชื่อ), **`memberNames`** = ชื่อทุกบัญชีในห้อง — **ไม่ส่ง LINE userId ของผู้เช่า** เพราะหน้าจอไม่ได้ใช้ และผู้ช่วยแบบดูอย่างเดียวไม่ควรได้; จำนวนห้องมาจาก `ROOMS` (default `201`–`212`)
- **Error:** `POST` → `400 VALIDATION` (ค่าไม่ใช่จำนวนเต็ม ≥ 0 หรือไม่ส่งค่าใดเลย) · `404 NOT_FOUND` (ห้องไม่อยู่ใน `ROOMS`) · `403 FORBIDDEN` (ผู้ช่วย/ผู้เช่า) · `GET` → `403 FORBIDDEN` (ไม่ใช่ owner/viewer), `401`/`403` จาก `requireUser`
- **Side effect (`POST`):** เขียน `dorm` (ค่าตั้งของหอ: `name`, `rent`, `waterRate`, `elecRate`, `dueDay`, `promptpay`, `autoConfirm`) หรือ `room:<room>` — **มีผลกับบิลที่ออกหลังจากนี้เท่านั้น** บิลที่ออกแล้วเก็บยอดเดิม (แก้บิลที่พิมพ์ไปแล้วต้องยกเลิก + ออกใหม่) · `dueDay` (1–28) ใช้สร้างวันครบกำหนดของบิล = วันที่นั้นของเดือนที่ออกบิล (แทน `BILL_DUE`) · `promptpay` = เบอร์มือถือ 10 หลัก / บัตรประชาชน 13 หลัก / e-Wallet 15 หลัก (เก็บเป็นตัวเลขล้วน) ใช้สร้าง QR ในบิล · `autoConfirm` = boolean (`true`/`false` เท่านั้น มิฉะนั้น 400; ไม่เคยตั้ง = `false`; ผู้ช่วยตั้งไม่ได้ 403) เปิดให้สลิปบิลรายเดือนที่ตรวจผ่านครบ `ok:true` ปิดบิลเอง ดูหัวข้อ `/api/slip` · `GET ?settings=1` คืนค่านี้ใน `dorm.autoConfirm`
- **อ่าน Blob:** `room:<room>`, `meter:<room>`, `bill:<room>`, `room-user:<room>`, `prepay:<room>` ต่อทุกห้อง (12 ห้อง default = 60 อ่านต่อ request · อ่านพร้อมกันทีละไม่เกิน 12 ห้อง)
- **Side effect:** ไม่มี

## 9. `POST /api/run`

`api/run.js` — เจ้าของบันทึกหน่วยมิเตอร์รอบใหม่ ออกบิล และ push การ์ดหาผู้เช่า

- **Auth:** Bearer idToken + **ต้องเป็น owner**
- **Body (JSON):**

| field | type | บังคับ | หมายเหตุ |
|---|---|---|---|
| `readings` | array ของ `{room:string, water:number, elec:number, dial?:{water,elec}}` | ✅ (ต้องไม่ว่าง) | เป็น **หน่วย** ไม่ใช่บาท · `water`/`elec` ต้องมีทั้งคู่ — ไม่ส่ง / `null` / ข้อความว่างถูกปฏิเสธ (ไม่นับเป็น 0) แต่ `0` ที่ส่งมาตรง ๆ ใช้ได้ · `dial` (ไม่บังคับ) = เลขบนหน้าปัดที่เจ้าของยืนยันจากรูป ใช้หักเดือนถัดไป; ค่าที่ไม่ใช่ตัวเลขถูกเมิน |
| `period` | string | ไม่ (fallback `BILL_PERIOD`) | ถ้าไม่มีทั้งคู่ → `400` |
| `due` | string | ไม่ (fallback `BILL_DUE`) | ไม่มีทั้งคู่ → `due: null` |

#### `action: "read"` — อ่านเลขมิเตอร์จากรูป (ไม่เขียนอะไร)

- **Body:** `{ "action": "read", "image": "data:image/jpeg;base64,…" }` — รับเฉพาะ data URL ของ `jpeg|png|webp` · ยาวเกิน 3,000,000 ตัวอักษร → `413 TOO_LARGE`
- **200:** `{ "ok": true, "reading": { "water": 1523.4, "elec": 8450, "confidence": "high", "note": "หน้าปัดกลาง" } }` — `water`/`elec` เป็น `null` ได้เมื่อไม่เห็นมิเตอร์ชนิดนั้น · `confidence` เป็น `high` หรือ `low`
- **Error:** `400 VALIDATION` (ไม่ใช่ data URL) · `503 METERS_OFF` (ไม่ได้ตั้ง `GEMINI_API_KEY`) · `422 UNREADABLE` (ผู้ให้บริการล่ม อ่านไม่ได้ หรือไม่เห็นตัวเลข)
- **ไม่เขียน Blob เลย** — ตัวเลขเป็นเพียงข้อเสนอให้เจ้าของตรวจแล้วกรอกเอง (เลขผิด = เก็บเงินผิด) · รูปถูกส่งไป **Google Gemini** (`GEMINI_MODEL`, ค่าเริ่มต้น `gemini-2.5-flash`) — ต้องแจ้งใน PDPA ว่าเป็นการส่งข้อมูลไปต่างประเทศ · ใช้คีย์ใน header `x-goog-api-key` ไม่ใช่ query string · timeout 15 วินาที

- **200:**

```json
{
  "ok": true,
  "period": "2026-11",
  "due": "2026-11-16",
  "rooms": [
    { "room": "201", "total": 3796, "pushed": true },
    { "room": "203", "total": 3796, "pushed": true, "prepaid": true },
    { "room": "202", "error": "ต้องกรอกหน่วยน้ำและไฟ" }
  ]
}
```

ห้องที่ข้อมูลเสียจะถูกใส่เป็น `{room, error}` **โดยไม่ทำให้ request ล้ม** — ข้อความที่เป็นไปได้: `ไม่มีห้องนี้ในหอ`, `ต้องกรอกหน่วยน้ำและไฟ` (ขาดหน่วยใดหน่วยหนึ่ง — ไม่เขียนมิเตอร์/บิลของห้องนั้น), `หน่วยมิเตอร์ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป` (ไม่ใช่จำนวนเต็ม, ติดลบ, เกิน 100000, หรือไม่ใช่ตัวเลข/ข้อความ), `ห้องนี้ซ้ำในคำขอเดียวกัน`, `บิลรอบนี้…แก้ไม่ได้` · ลำดับตรวจ: ห้อง → หน่วยขาด → หน่วยผิดรูป → สถานะบิล (สถานะยัง 200) · ห้องเดียวกันซ้ำใน `readings` → ตัวแรกออกบิล ตัวที่ซ้ำได้ `error` · ห้องทำงานพร้อมกันทีละ 6 ห้อง (`rooms` ยังเรียงตาม `readings`) — 12 ห้องจาก ~12 วินาทีเหลือ ~1 วินาทีเมื่อแต่ละ round trip 80ms
- **Error:** `405`, `401`/`403` จาก `requireUser`, `403 FORBIDDEN` (ไม่ใช่ owner), `400 VALIDATION` (`readings` ไม่ใช่ array/ว่าง), `400 VALIDATION` (ไม่มี period)
- **เขียน Blob:** `meter:<room>` = `{water, elec, at, dial?}` (`dial` = เลขหน้าปัดที่เจ้าของยืนยันจากรูป ใช้คำนวณส่วนต่างเดือนถัดไป; ไม่ส่ง/ผิดรูป = ไม่เก็บ) และ `bill:<room>` = บิลใหม่ทั้งใบ (มี `issuedAt` = ISO ตอนออก/ออกซ้ำ ใช้แยกบิลของผู้เช่าปัจจุบันออกจากผู้เช่าคนก่อน) `status:"unpaid"` (ถ้ามี `prepay:<room>` บิลใหม่เริ่มที่ `status:"pending"` พร้อม `slipPath`, `slipNote`, `slipAt`, `slipCount`, `slipVerify` ที่คัดลอกจาก prepay และ `prepaid:true` แล้วตั้ง `prepay:<room>` เป็น `null` หลัง `saveBill` สำเร็จ · ถ้าตอนอ่านแรกยังไม่มี prepay ที่ใช้ได้ หลังเขียนบิลจะอ่าน `prepay:<room>` ซ้ำอีกครั้ง — ถ้ามีสลิปโผล่มาระหว่างนั้น (ผู้ส่งเป็นผู้เช่าปัจจุบัน และบิลรอบนี้ยัง `unpaid` ตัวเดิม) จะผูกให้ทันทีแบบเดียวกัน (`POST /api/slip` ตรวจซ้ำกลับด้าน ดู §6) · การ์ดยืนยันถึงเจ้าของใช้ retry key `confirm:<room>:<period>:<slipAt>` (ไม่ซ้ำแม้ทั้งสองฝั่งผูก) · ข้ามห้องที่บิลรอบนั้นแจ้งชำระหรือชำระแล้ว (ไม่แตะ prepay) · บิล `unpaid` ออกใหม่ทับได้เพื่อแก้เลขผิด (คง `rev`) · บิล `void` ออกใหม่ได้ด้วย `rev` = เดิม + 1 (บิลใหม่เริ่มสะอาด ไม่ติด `receiptNo`/`void*`) **และก่อนเขียนทับ บิล `void` เดิมถูกเก็บไว้ที่ `bill-void:<period>:<room>:<rev เดิม>` ทั้งก้อน** พร้อมเพิ่ม `<period>:<rev>` ใน `bill-voids:<room>` (อ่านคืนได้ที่ `GET /api/bill?voided=1`, §5) · `paid` แก้ไม่ได้ ต้อง void ก่อน · หน่วยต้องเป็นจำนวนเต็ม ≥ 0 และห้องต้องอยู่ใน `ROOMS`)
- **Side effect อื่น:** `push()` การ์ด `billBubble` ให้ `room-user:<room>` ถ้ามีผู้เช่า (บิลที่ไม่มี `due` ไม่มีบรรทัด "ครบกำหนด" บนการ์ด) — การ์ดผู้เช่ากับการ์ดยืนยันของเจ้าของส่งพร้อมกัน; push ล้มเหลว → `pushed:false` + `console.error` (ไม่ fail request) · ถ้าบิลมีสลิปจาก prepay จะ push การ์ด `confirmBubble` หา `OWNER_USER_ID` ด้วย เพื่อให้กดยืนยันได้ทันที (พังก็กลืน) และแถวผลลัพธ์ของห้องนั้นมี `prepaid:true`
- การคำนวณ: `water = Math.round(waterUnits * waterRate)`, `elec = Math.round(elecUnits * elecRate)`, `total = rent + water + elec`

## 9A. `GET /api/cron`

`api/cron.js` + `api/_remind.js` — งานเตือนบิลค้างรายวัน Vercel Cron เรียกวันละครั้ง (`vercel.json` → `crons`, `0 2 * * *` = 09:00 เวลาไทย) · ไม่ใช่ endpoint สำหรับผู้ใช้ — เรียกมือด้วย `curl` ได้ (ดู DEPLOYMENT)

- **Auth:** header `Authorization: Bearer <CRON_SECRET>` เทียบแบบ constant-time (`sameSecret`) · ไม่ใช้ idToken
- **Error:** `405 METHOD_NOT_ALLOWED` (ไม่ใช่ GET) → `503 NOT_CONFIGURED` (ไม่ได้ตั้ง `CRON_SECRET` หรือสั้นกว่า 16 ตัว) → `401 UNAUTHORIZED` (`bad cron secret`)
- **200:** `{ "ok": true, "today": "2026-11-13", "sent": [{ "room": "203", "period": "2026-11", "kind": "before_3" }], "failed": 0 }` — `today` = วันที่เวลา Asia/Bangkok · `sent` เรียงตามห้อง/รอบ · `failed` = จำนวนข้อความที่ push ไม่สำเร็จหรือห้องที่ประมวลผลล้ม (ไม่ทำให้ request ล้ม) · ถ้ามีรอบที่กำลังทำงานอยู่ (cron retry ซ้อน) จะตอบ `{ "ok": true, "skipped": "another run is in progress" }` โดยไม่ส่งอะไร
- **ชนิดการเตือน (`kind`)** ตัดสินจากจำนวนวันถึง `due` ของบิลที่ยัง `unpaid` และมี `due` — เป็น "ช่วง" ไม่ใช่วันตรงตัว เพื่อให้ cron ที่พลาดไปวันหนึ่งส่งให้ในรอบถัดไป:

| kind | เงื่อนไข |
|---|---|
| `before_3` | เหลือ 1–3 วันก่อนครบกำหนด |
| `due_0` | ครบกำหนดวันนี้ |
| `after_1` | เลยกำหนด 1–4 วัน |
| `after_5` | เลยกำหนด 5–9 วัน |
| `after_10` | เลยกำหนด 10 วันขึ้นไป |

- **ส่งซ้ำไม่ได้ (dedup):** ก่อนส่งอ่าน `reminded:<room>:<period>:<kind>:<rev>` (ถ้าไม่มี อ่านคีย์เดิมที่ไม่มี `rev` ด้วย เพื่อไม่ให้รอบแรกหลัง deploy ส่งซ้ำของเก่า) ถ้ามีค่าแล้วข้าม · หลัง push สำเร็จเขียนเวลา ISO ลงคีย์นั้น · บิลที่ถูกยกเลิกแล้วออกใหม่ (rev ใหม่) จึงถูกเตือนใหม่ได้ · push ล้มเหลว = ไม่เขียน รอบถัดไปลองใหม่ · เขียนคีย์ไม่สำเร็จ = แค่ log (ผู้เช่าได้ข้อความแล้ว เสี่ยงซ้ำวันถัดไปเท่านั้น)
- **ใครได้รับ:** `room-user:<room>` เท่านั้น และเฉพาะบิลของสัญญาเช่าปัจจุบัน (`visibleToTenant`) · ห้องที่ไม่มีผู้เช่าข้าม · บิลที่ `paid`/`pending`/`void` หรือไม่มี `due` ไม่ถูกเตือน · ตรวจบิลล่าสุด + รอบเก่ากว่าที่ยัง `unpaid` ย้อนหลังไม่เกิน 12 รอบ
- **การส่ง:** ผู้เช่าหนึ่งห้องได้หนึ่ง push **ต่อการ์ด 5 ใบ** (ห้องที่มีบิลค้างเกิน 5 รอบจะได้หลาย push ในรอบเดียว) · ถ้ามีเตือนชนิด `after_*` ไปแล้วอย่างน้อยหนึ่งห้อง push ข้อความสรุปหา `OWNER_USER_ID` หนึ่งข้อความ (`สรุปทวงวันนี้: เลยกำหนด N ห้อง (…) · ส่งเตือนแล้ว M ข้อความ`; พังแค่ log)
- **อ่าน/เขียน Blob:** อ่าน `bill:<room>`, `bills:<room>`, `bill:<period>:<room>`, `reminded:…`, `room-user:<room>`, `tenancy:<room>` · เขียน `reminded:…` · ห้องทำงานพร้อมกันทีละ 4 · Blob ไม่มี lock: ถ้า cron สองรอบซ้อนกันในจังหวะเดียว (Vercel retry) อาจส่งซ้ำได้

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
| `message` (text) | ข้อความ = `บิล` หรือ `bill` (case-insensitive เฉพาะ `bill`) | ไม่เขียน | ไม่มี `user-room:<userId>` → `reply` "ยังไม่ได้ผูกห้อง"; ไม่มี `bill:<room>` หรือบิลนั้นไม่ใช่ของสัญญาเช่าปัจจุบัน (`tenancy`) → `reply` "ยังไม่มีบิลรอบนี้"; บิลล่าสุด `void` → `reply` ข้อความ `บิลห้อง <room> รอบ <period> ถูกยกเลิก — <เหตุผล>`; ไม่งั้น `reply` การ์ด `billBubble` |
| `message` (text) | ข้อความอื่นที่ไม่ใช่ "บิล"/"bill" | ไม่เขียน | ข้ามเงียบ ๆ — **การผูกห้องทำทาง QR เท่านั้น** (`POST /api/qr` ด้วยรหัสจากหน้าเจ้าของ ไม่มีคำสั่งพิมพ์ในแชทแล้ว) |
| `postback` | `postback.data` มี `action=confirm&room=&period=` | `bill:<period>:<room>` (+ `bill:<room>` ถ้าเป็นรอบล่าสุด) = บิลเดิม + `status:"paid"`, `paidAt` (ISO), `confirmedBy`, `receiptNo` (+ `refundDue`, `refundReason:"overpaid"` และแท็กใน `overpaid:<room>` เมื่อสลิปจ่ายเกิน — reply ต่อท้าย "ยอดเกิน X บาท — ต้องคืนผู้เช่า"); `paid` อยู่แล้วไม่เขียน; `void` → reply "บิลนี้ถูกยกเลิกแล้ว" ไม่เขียน | `reply` ยืนยันกลับ; `push` ใบเสร็จ (`receiptBubble` — Flex "ใบเสร็จรับเงิน" ปุ่ม "ดูใบเสร็จ" เปิด LIFF `?room=<room>&receipt=<period>#receipt/<period>`) ให้ผู้เช่าจาก `room-user:<room>` (เฉพาะเมื่อมี ไม่ใช่คนเดียวกัน และบิลนั้นเป็นของสัญญาเช่าปัจจุบัน; push พังแค่ log) |
| `postback` | `action=confirm&room=&periods=p1,p2` (สลิปเดียวหลายงวด) | ยืนยันเฉพาะบิลในรายการที่ยัง `pending` และมี `slipGroup.periods` ตรงกับการ์ดนี้ — แต่ละใบได้ `receiptNo` ของตัวเอง; ยอดเกินของสลิปกลุ่มลงที่บิลงวดใหม่สุดของกลุ่มครั้งเดียว (ถ้างวดนั้นถูกปิดไปก่อนแล้ว ไม่ซ้ำ); บิลที่ paid/void แล้วหรือผู้เช่าส่งสลิปใหม่ไปแล้วถูกข้ามและระบุใน reply | `reply` สรุปงวดที่ยืนยัน/ที่ข้าม; ผู้เช่าได้ใบเสร็จใบละบิล (push ละไม่เกิน 5 ข้อความตามขีดจำกัดของ LINE — เกินแบ่งหลาย push) · `periods` ผิดรูป/เกิน 12 → reply ปฏิเสธ · ไม่มีบิลที่รอยืนยันเลย → reply แจ้งและไม่เขียน |
| อื่น ๆ | — | — | ไม่มี (เมิน ยังตอบ 200) |

รายละเอียดที่ควรรู้:

- **postback `action=confirm` ตรวจเจ้าของแล้ว** — `webhook.js` เทียบ `event.source.userId` กับ `OWNER_USER_ID` ก่อนปิดบิล; ผู้ที่ไม่ใช่เจ้าของได้ข้อความ "เฉพาะเจ้าของหอกดยืนยันได้ครับ" และสถานะบิลไม่เปลี่ยน
- **ไม่มีคำสั่งแชท `ผูก <room>` แล้ว** — ผูกห้องได้ทาง QR (`/api/qr`) อย่างเดียว · postback ยืนยันระบุ `period` และยืนยันได้เฉพาะบิล `pending`
- **postback ตรวจสิทธิ์ด้วย `isOwner()`** — `OWNER_USER_ID` หรือเจ้าของที่ถูกเชิญ (`owner:<userId>`) เท่านั้นที่ปิดบิลได้ · ผู้ที่ไม่ใช่เจ้าของถูกปฏิเสธและสถานะไม่เปลี่ยน
- ถ้า `LINE_CHANNEL_ACCESS_TOKEN` ผิด/หมดอายุ `reply`/`push` throw แต่ `handleEvent` ถูกครอบด้วย `try/catch` ต่อ event → webhook ยังตอบ 200 ผู้ใช้แค่ไม่ได้รับข้อความ

## 14. สรุปการตรวจสิทธิ์ (จุดที่ไม่มี check ในโค้ด)

| Endpoint / event | สิ่งที่โค้ดตรวจ | สิ่งที่ **ไม่** ตรวจ |
|---|---|---|
| `/api/config` | — | ทุกอย่าง (public โดยตั้งใจ) |
| `/api/me` | idToken | — |
| `/api/bill`, `/api/slip`, `/api/slip-image` | idToken + `user-room:<userId> === room` (ยกเว้น owner) · `GET /api/bill?voided=1`: ต้องเป็น owner/ผู้ช่วย · `POST /api/bill` และ `POST /api/slip` ของเจ้าของ: `room` ต้องอยู่ใน `ROOMS` | ว่า `room` อยู่ใน `ROOMS` สำหรับการอ่านของเจ้าของ/ผู้ช่วย |
| `/api/rooms` | idToken + `canView` (owner/viewer) | — |
| `/api/run` | idToken + `isOwner` | — |
| `/api/owner` | GET/POST invite: `isOwner` (invite `owner` ต้อง root) · POST `{code}`: idToken · DELETE: root | — |
| `/api/qr` | GET/POST `?room=`: `isOwner` · POST `{code}`: idToken + rate limit + ยืนยันย้ายห้อง | — |
| `/api/dev?do=seed`, `/api/dev?do=sendbill` | production → 404 · ที่อื่น header `x-seed-token` (≥ 16 ตัว) | ไม่มี auth ผู้ใช้ (เครื่องมือ dev) |
| `/api/cron` | `Authorization: Bearer <CRON_SECRET>` (≥ 16 ตัว) | ไม่ใช้ idToken |
| `/api/webhook` | HMAC signature | ไม่ตรวจผู้ส่งต่อ event, ไม่มี idempotency |
| webhook `postback action=confirm` | signature ของ LINE + `isOwner(userId)` | ✅ ตรวจแล้ว |
| ทุก endpoint ที่เรียก `requireUser` | idToken หรือ `x-seed-token` | `x-seed-token` ใช้ได้เฉพาะ `vercel dev` / preview ที่เปิด `ALLOW_SEED_BYPASS` · production ปิดเสมอ |

## 15. เอกสารที่เกี่ยวข้อง

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — เส้นทาง request, state machine ของบิล, key map ใน Blob
- [`CONFIGURATION.md`](./CONFIGURATION.md) — env ทุกตัว, default, ผลของการไม่ตั้งค่า
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — deploy บน Vercel + Blob
- [`../HANDOFF.md`](../HANDOFF.md) — บันทึกส่งต่อทีม (กับดักที่เจอแล้ว, งานที่เหลือ)
