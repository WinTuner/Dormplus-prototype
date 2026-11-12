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
| `POST` เท่านั้น | `/api/seed` | `?token=<SEED_TOKEN>` | `api/seed.js` |
| `POST` เท่านั้น | `/api/sendbill` | `?token=<SEED_TOKEN>` | `api/sendbill.js` |
| `POST` เท่านั้น | `/api/webhook` | `x-line-signature` (HMAC) | `api/webhook.js` |

`api/_auth.js`, `api/_line.js`, `api/_rooms.js`, `api/_store.js` เป็น shared module ไม่ใช่ endpoint (ขึ้นต้นด้วย `_`) <!-- VERIFY: Vercel ไม่สร้าง public route ให้ไฟล์ที่ขึ้นต้นด้วย `_` ใน api/ — เป็นพฤติกรรมแพลตฟอร์ม ไม่มีอะไรในเรพยืนยัน --> — ไฟล์ที่ชื่ออื่นใน `api/` กลายเป็น route ตามชื่อไฟล์โดยไม่ต้องประกาศใน `vercel.json` (ซึ่งมีแค่ rewrite `/` → `/liff/bill.html`)

## 2. ข้อตกลงร่วม (อ่านครั้งเดียว ใช้ทุก endpoint)

### 2.1 รูปแบบ error

เกือบทุก endpoint ใช้ envelope เดียวกัน:

```json
{ "error": { "code": "FORBIDDEN", "message": "ข้อความภาษาไทย" } }
```

`message` เป็นภาษาไทยเสมอ (แสดงตรง ๆ บนหน้า LIFF) — `code` มีค่าที่โค้ดใช้จริงแค่ 6 ตัว:

| HTTP | code | เกิดจาก |
|---|---|---|
| 400 | `VALIDATION` | field บังคับหาย/ผิดรูป |
| 401 | `UNAUTHORIZED` | ไม่มี Bearer token หรือไม่มี `CHANNEL_ID` (`_auth.requireUser`) |
| 403 | `FORBIDDEN` | idToken ไม่ผ่าน LINE verify, ไม่ใช่เจ้าของ, หรือไม่ได้ผูกห้องนั้น |
| 404 | `NOT_FOUND` | ไม่พบบิล/ไม่พบไฟล์สลิป |
| 409 | `INVALID_STATE` | แนบสลิปในบิลที่ `paid` แล้ว |
| 413 | `TOO_LARGE` | รูปเกิน 3MB |

ข้อยกเว้นที่ **ไม่ใช้ envelope** (โค้ดเขียนสตริงตรง ๆ) — ต้องระวังถ้าเขียน client:

| HTTP | body | เกิดจาก |
|---|---|---|
| 405 | `{ "error": "POST only" }` | `slip`, `run`, `seed`, `sendbill`, `webhook` ถูกเรียกด้วย method อื่น |
| 401 | `{ "error": "bad signature" }` | webhook signature ไม่ผ่าน |
| 400 | `{ "error": "invalid json" }` | webhook body ไม่ใช่ JSON |

### 2.2 การ auth 3 แบบ

1. **Bearer LIFF idToken** — `_auth.requireUser()` อ่าน `Authorization: Bearer <idToken>` แล้วยิง `POST https://api.line.me/oauth2/v2.1/verify` ด้วย `id_token` + `client_id` (= `LOGIN_CHANNEL_ID` หรือ prefix ก่อน `-` ของ `LIFF_ID`) แล้วเอา `sub` เป็น userId ถ้าไม่มี token/ไม่มี channel → `401 UNAUTHORIZED`; verify ไม่ผ่าน → `403 FORBIDDEN`
2. **`x-seed-token` bypass (ปิดโดยค่าเริ่มต้น)** — ทำงานเฉพาะเมื่อ `ALLOW_SEED_BYPASS=true` หรือ `VERCEL_ENV` เป็น `preview`/`development` **และ** header ตรงกับ `SEED_TOKEN` · เมื่อเข้าเงื่อนไข `requireUser()` จะคืน `OWNER_USER_ID` (หรือ `"dev"` ถ้าไม่ได้ตั้ง) · **production ปฏิเสธเสมอ**
3. **`?token=` ของ seed/sendbill** — endpoint สองตัวนี้ **ไม่เรียก `requireUser` เลย** เช็กแค่ query `token` เท่ากับ `SEED_TOKEN`

`isOwner(userId)` คือ `!!OWNER_USER_ID && userId === OWNER_USER_ID` → ถ้าไม่ได้ตั้ง `OWNER_USER_ID` ทุกคนเป็น non-owner (รวม `x-seed-token` ที่คืน `"dev"` ด้วย)

### 2.3 Cache / content type

| ไฟล์ | header ที่ตั้ง |
|---|---|
| `config`, `me`, `bill`, `rooms` | `Cache-Control: no-store` |
| `slip-image` | `Content-Type: image/*` + `Cache-Control: private, no-store` |
| `slip`, `run`, `seed`, `sendbill`, `webhook` | **ไม่ตั้ง `Cache-Control` เลย** |

ทุก response เป็น JSON ผ่าน `res.json()` ยกเว้น `slip-image` ที่ stream byte ดิบ (`res.end(...)`) ไม่มี CORS header, ไม่มี `OPTIONS` handler และไม่มี rate limit ในโค้ด

### 2.4 ที่เก็บข้อมูล (side effect ที่ทุก endpoint ใช้ร่วมกัน)

ค่า JSON ทุกตัวเขียนผ่าน `_store.set()` ลง Vercel Blob แบบ private ที่ pathname `kv/<key ที่ sanitize>.json` (อักขระนอก `a-zA-Z0-9._-` ถูกแทนด้วย `-` ดังนั้น `:` → `-`) ส่วนรูปสลิปเขียนตรงด้วย `put()` ที่ `slips/<room>-<timestamp>.<ext>`

---

### 2.5 endpoint เพิ่มเจ้าของ (`POST /api/owner`)

เจ้าของหอคนแรกมาจาก `OWNER_USER_ID` (ตั้งด้วยมือ) คนต่อไปรับสิทธิ์ด้วยรหัสที่เจ้าของเดิมสร้าง
รหัสมีอายุ **10 นาที ใช้ได้ครั้งเดียว** — ใครสแกน QR และยืนยัน idToken ได้ จะถูกบันทึกเป็นเจ้าของ (`owner:<userId>`)

| endpoint | auth | body | ผล |
|---|---|---|---|
| `POST /api/owner` | เจ้าของเท่านั้น | — | `{code, url, qr, expiresAt}` · `qr` เป็น SVG string ของ `https://liff.line.me/<LIFF_ID>?owner=<code>` |
| `POST /api/owner` | ผู้ใช้ที่ล็อกอิน LINE | `{code}` | `{owner:true}` (หรือ `{owner:true, already:true}` ถ้าเป็นเจ้าของอยู่แล้ว) |

- รหัสผิด → `404 NOT_FOUND` · หมดอายุ/ถูกใช้ → `410 INVITE_EXPIRED` · ไม่ได้ตั้ง `OWNER_USER_ID` → `409 INVALID_STATE`
- เมื่อรับสิทธิ์สำเร็จ ระบบสลับ rich menu ให้เป็นเมนูเจ้าของ (ถ้าตั้ง `RICHMENU_OWNER_ID`)
- endpoint ที่ตรวจ `isOwner()` ใช้ได้กับเจ้าของที่ได้สิทธิ์ทาง QR ด้วย (rooms, run, bill/slip ของห้องอื่น, ยืนยันการชำระในแชท)

### 2.6 QR ผูกห้องสำหรับผู้เช่า (`/api/qr`)

ผู้เช่าไม่ต้องพิมพ์ ``ผูก 203`` อีก: เจ้าของสร้าง QR ของห้อง แปะหน้าห้อง ผู้เช่าสแกนครั้งเดียวจบ
รหัสผูกกับห้องและ **ใช้ได้ตลอด** จนกว่าเจ้าของจะกดสร้างใหม่ (สร้างใหม่ = ใบที่แปะอยู่ใช้ไม่ได้ทันที)

| endpoint | auth | body/query | ผล |
|---|---|---|---|
| `GET /api/qr?room=203` | เจ้าของ | — | `{room, code, url, qr}` · สร้างรหัสให้ถ้ายังไม่มี |
| `POST /api/qr?room=203` | เจ้าของ | — | เหมือนกัน แต่ **หมุนรหัสใหม่** (`rotated:true`) |
| `POST /api/qr` | ผู้ใช้ที่ล็อกอิน LINE | `{code}` | `{ok:true, room, previous}` — เขียน `user-room:<userId>` + `room-user:<room>` + สลับเมนูผู้เช่า |

- รหัส 10 ตัว (ไม่มี 0/O/1/I/L) · เก็บ 2 key: `room-qr:<room>` และ `qr-code:<code>` (ตัวหลังถูกลบเมื่อหมุน)
- รหัสผิด/ถูกหมุนแล้ว → `404 NOT_FOUND`
- ห้องที่ไม่มีทั้งบิลและผู้เช่า → `404 NOT_FOUND` (กันพิมพ์เลขห้องผิด)
- **ข้อจำกัด:** QR นี้เป็นกุญแจของห้อง ไม่ผูกกับตัวบุคคล — ใครได้รูปไปก็ผูกได้จนกว่าเจ้าของจะหมุนรหัส (เหมือนกุญแจจริง)

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

- **Auth:** Bearer idToken (หรือ `x-seed-token` — เฉพาะ preview/dev)
- **Query/body:** ไม่มี
- **200:**

```json
{ "userId": "U1234...", "owner": false, "room": "203" }
```

`room` เป็น `null` เมื่อยังไม่ผูกห้อง (`user-room:<userId>` ไม่มี)
- **Error:** `401 UNAUTHORIZED`, `403 FORBIDDEN` (จาก `requireUser` เท่านั้น)
- **อ่าน Blob:** `user-room:<userId>`
- **Side effect:** ไม่มี

## 5. `GET /api/bill?room=203`

`api/bill.js` — บิลของห้องเดียว ผู้เช่าเห็นได้เฉพาะห้องที่ผูก เจ้าของเห็นทุกห้อง

- **Auth:** Bearer idToken + ถ้าไม่ใช่ owner ต้องมี `user-room:<userId> === room`
- **Query:** `room` (string, ไม่บังคับ — ถ้าไม่ส่งจะใช้ห้องที่ผูกไว้)
- **200:** bill object ทั้งก้อนจาก `bill:<room>` บวก `hasSlip`:

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
  "hasSlip": true
}
```

field ที่มีจริงขึ้นกับว่าเขียนผ่าน path ไหน: `run` สร้าง `room, period, rent, water, elec, waterUnits, elecUnits, total, due, status`; `slip` เพิ่ม `slipPath, slipNote, slipAt`; webhook เพิ่ม `paidAt` (ดู §13) — `hasSlip` คำนวณสด (`!!bill.slipPath`) ไม่ได้เก็บลง Blob
- **Error:** `400 VALIDATION` (ไม่มี `room` และยังไม่ผูกห้อง), `403 FORBIDDEN` (ผูกห้องอื่น), `404 NOT_FOUND` (ไม่มี `bill:<room>`), `401`/`403` จาก `requireUser`
- **อ่าน Blob:** `user-room:<userId>`, `bill:<room>`
- **Side effect:** ไม่มี
- **หมายเหตุ:** ไม่มีการตรวจ `req.method` — เรียกด้วย POST ก็ได้ผลเหมือน GET

## 6. `POST /api/slip`

`api/slip.js` — ผู้เช่าแนบสลิป (ไม่บังคับรูป) แล้วแจ้งเจ้าของให้ยืนยัน

- **Auth:** Bearer idToken + สิทธิ์รายห้องแบบเดียวกับ `/api/bill`
- **Body (JSON):**

| field | type | บังคับ | หมายเหตุ |
|---|---|---|---|
| `room` | string | ไม่ (fallback = ห้องที่ผูกไว้) | |
| `note` | string | ไม่ | เก็บเป็น `slipNote` (ค่าว่าง → `null`) |
| `image` | string (data URL) | ไม่ | ต้องตรง `/^data:(image\/(jpeg\|png\|webp));base64,(.+)$/` |

ขนาดรูปสูงสุด **3 MiB** (`MAX_BYTES = 3 * 1024 * 1024`) นับหลัง decode base64; นามสกุลไฟล์มาจาก mime (`jpeg` → `jpg`)
- **200:**

```json
{ "ok": true, "status": "pending", "total": 3796, "hasSlip": true }
```

- **Error (ตามลำดับที่โค้ดเช็ก):** `405` (`{error:"POST only"}`) → `401`/`403` จาก `requireUser` → `400 VALIDATION` (ไม่มี room) → `403 FORBIDDEN` (ไม่ได้ผูกห้อง) → `404 NOT_FOUND` (ไม่พบบิล) → `409 INVALID_STATE` (บิล `paid` แล้ว) → `400 VALIDATION` (mime ไม่อยู่ใน 3 ชนิด) → `413 TOO_LARGE`
- **เขียน Blob:** `slips/<room>-<Date.now()>.<ext>` (เฉพาะเมื่อมี `image`), `bill:<room>` = บิลเดิม + `status:"pending"`, `slipPath`, `slipNote`, `slipAt` (ISO)
- **Side effect อื่น:** `push()` การ์ด `confirmBubble` ไปที่ `OWNER_USER_ID` — ถ้า push ล้มเหลวแค่ `console.error("owner push failed")` แล้วยังตอบ 200
- ถ้าไม่ได้แนบรูปใหม่ `slipPath` เดิมถูกคงไว้ — ไฟล์เก่าไม่ถูกลบ

## 7. `GET /api/slip-image?room=203`

`api/slip-image.js` — stream รูปสลิปจาก private Blob

- **Auth:** Bearer idToken + สิทธิ์รายห้อง
- **Query:** `room` (string) — **ไม่มี fallback ไปห้องที่ผูกไว้** ถ้าไม่ส่งจะได้ `room = ""`
- **200:** byte ของรูป, `Content-Type` จาก `blob.blob.contentType` (fallback `image/jpeg`), `Cache-Control: private, no-store`
- **Error:** `403 FORBIDDEN` (ไม่ได้ผูกห้องนั้น — กรณีไม่ส่ง `room` ผู้เช่าจะได้ 403 นี้), `404 NOT_FOUND` (บิลยังไม่มี `slipPath`, หรือ blob หาย), `401`/`403` จาก `requireUser`
- **อ่าน Blob:** `user-room:<userId>`, `bill:<room>`, `get(bill.slipPath, {access:"private", useCache:false})`
- **Side effect:** ไม่มี

## 8. `GET /api/rooms`

`api/rooms.js` — หน้าจดมิเตอร์ของเจ้าของ: ทุกห้อง + config + มิเตอร์ล่าสุด + บิล + ผู้เช่า

- **Auth:** Bearer idToken + **ต้องเป็น owner** (`403 FORBIDDEN` "เฉพาะเจ้าของหอ")
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
      "tenant": "U1234..."
    }
  ]
}
```

`period` = `BILL_PERIOD || null`; `meter`/`bill` เป็น `null` ถ้ายังไม่มี; `tenant` เป็น `null` ถ้ายังไม่มีใครผูก; จำนวนห้องมาจาก `ROOMS` (default `201`–`212`)
- **Error:** `403 FORBIDDEN` (ไม่ใช่ owner), `401`/`403` จาก `requireUser`
- **อ่าน Blob:** `room:<room>`, `meter:<room>`, `bill:<room>`, `room-user:<room>` ต่อทุกห้อง (12 ห้อง default = 48 อ่านต่อ request)
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
    { "room": "202", "error": "ค่ามิเตอร์ไม่ถูกต้อง" }
  ]
}
```

ห้องที่ข้อมูลเสียจะถูกใส่เป็น `{room, error}` **โดยไม่ทำให้ request ล้ม** (สถานะยัง 200)
- **Error:** `405`, `401`/`403` จาก `requireUser`, `403 FORBIDDEN` (ไม่ใช่ owner), `400 VALIDATION` (`readings` ไม่ใช่ array/ว่าง), `400 VALIDATION` (ไม่มี period)
- **เขียน Blob:** `meter:<room>` = `{water, elec, at}` และ `bill:<room>` = บิลใหม่ทั้งใบ `status:"unpaid"` (เขียนทับบิลเดิมเสมอ ไม่สนสถานะเก่า — ประวัติหาย)
- **Side effect อื่น:** `push()` การ์ด `billBubble` ให้ `room-user:<room>` ถ้ามีผู้เช่า; push ล้มเหลว → `pushed:false` + `console.error` (ไม่ fail request)
- การคำนวณ: `water = Math.round(waterUnits * waterRate)`, `elec = Math.round(elecUnits * elecRate)`, `total = rent + water + elec`

## 10. `POST /api/seed?token=<SEED_TOKEN>`

`api/seed.js` — ใส่บิลตัวอย่างทุกห้องใน `ROOMS` (idempotent)

- **Auth:** **ไม่ใช้ `requireUser`** — เช็กแค่ `req.query.token === SEED_TOKEN`; ถ้าไม่ได้ตั้ง `SEED_TOKEN` หรือ token ไม่ตรง → `403 FORBIDDEN` ("ต้องมี token")
- **Query:** `token` (string) เท่านั้น
- **Body:** ไม่มี
- **200:**

```json
{ "ok": true, "period": "2026-11", "rooms": ["201", "202", "..."] }
```

- **Error:** `405` (`{error:"POST only"}`), `403 FORBIDDEN`
- **เขียน Blob:** `room:<room>` = `{rent, waterRate, elecRate}` **เฉพาะเมื่อยังไม่มี** (ห้อง index หาร 3 ลงตัวได้ rent `3220`), `bill:<room>` เขียนทับทุกห้องด้วยข้อมูลตัวอย่าง `status:"unpaid"`
- **Side effect อื่น:** ไม่มีการ push LINE
- ค่า default ของ seed: `period` = `BILL_PERIOD || "2026-11"`, `due` = `BILL_DUE || "2026-11-16"`, หน่วยน้ำ `4 + (i % 4)`, หน่วยไฟ `28 + (i % 6) * 7`

## 11. `POST /api/sendbill?token=<SEED_TOKEN>`

`api/sendbill.js` — ยิงการ์ดบิลหาหนึ่ง userId (เครื่องมือทดสอบ)

- **Auth:** **ไม่ใช้ `requireUser`** — เช็กแค่ `?token=` เทียบ `SEED_TOKEN` (เหมือน `/api/seed`)
- **Query:** `token` (string)
- **Body (JSON):**

| field | type | บังคับ |
|---|---|---|
| `to` | string (LINE userId) | ✅ |
| `room` | string | ✅ |

- **200:** `{ "ok": true, "sent": "203", "total": 3796 }`
- **Error:** `405` (`{error:"POST only"}`), `403 FORBIDDEN` (token ผิด/ไม่ได้ตั้ง), `400 VALIDATION` (`to` หรือ `room` หาย), `404 NOT_FOUND` (ไม่พบบิลห้องนั้น)
- **Side effect:** `push(to, [billBubble(bill, baseUrl)])` — **ไม่มี try/catch** ถ้า LINE ตอบไม่ 200 `_line.call()` throw แล้วหลุดเป็น error ที่ไม่ได้จัดการ (คาดว่า 500 จาก platform) <!-- VERIFY: รูปแบบ response 500 ของ Vercel function ที่ throw ไม่ออกมาเป็น JSON envelope — เป็นพฤติกรรมแพลตฟอร์ม ไม่มีในเรพ -->
- **อ่าน Blob:** `bill:<room>`

## 12. `POST /api/webhook`

`api/webhook.js` — รับ event จาก LINE Messaging API

- **Auth:** `x-line-signature` = base64(HMAC-SHA256(raw body, `LINE_CHANNEL_SECRET`)); ไม่มี secret = ปฏิเสธทุก request ถ้าไม่ผ่าน → `401 {error:"bad signature"}`
- **Body:** JSON ของ LINE (`{events:[...]}`) — อ่านเป็น raw buffer ก่อนเพื่อคำนวณ signature; parse ไม่ได้ → `400 {error:"invalid json"}`
- **200:** `{ "ok": true }` — **ตอบ 200 เสมอหลัง parse สำเร็จ** แม้ทุก event จะ throw (แต่ละ event มี `try/catch` ของตัวเองแล้ว `console.error("event failed", ...)`)
- **Error:** `405` (`{error:"POST only"}`), `401`, `400`
- **Side effect:** ตาม event — ดู §13

## 13. การจัดการ event ของ webhook

ทุก event ทำงานใน `Promise.all` และ **ตอบ 200 หลังทุก event ทำงานจบ** (ไม่มีการตอบ 200 ก่อน) ไม่มีการเก็บ `webhookEventId` จึงไม่มี idempotency — LINE retry = ทำงานซ้ำ

| event | เงื่อนไข | เขียน Blob | ส่ง LINE |
|---|---|---|---|
| `follow` | มี `source.userId` | `user:<userId>` = `{ followedAt: <epoch ms> }` | `reply` ข้อความต้อนรับ (บอกให้พิมพ์ "บิล") |
| `message` (text) | ข้อความ = `บิล` หรือ `bill` (case-insensitive เฉพาะ `bill`) | ไม่เขียน | ไม่มี `user-room:<userId>` → `reply` "ยังไม่ได้ผูกห้อง"; ไม่มี `bill:<room>` → `reply` "ยังไม่มีบิลรอบนี้"; ไม่งั้น `reply` การ์ด `billBubble` |
| `message` (text) | ตรง `/^ผูก\s*(\d{2,4})$/` | ไม่มี `bill:<room>` → ไม่เขียนอะไร; ไม่งั้นเขียน `user-room:<userId>` = `"<room>"` และ `room-user:<room>` = `userId` | `reply` "ผูกกับห้อง X แล้ว" หรือ "ไม่พบห้อง X" |
| `postback` | `postback.data` มี `action=confirm` | `bill:<room>` = บิลเดิม + `status:"paid"`, `paidAt` (ISO); ถ้า `paid` อยู่แล้วไม่เขียน | `reply` ยืนยันกลับ; `push` ข้อความแจ้งผู้เช่าจาก `room-user:<room>` (เฉพาะเมื่อมีและไม่ใช่คนเดียวกัน) |
| อื่น ๆ | — | — | ไม่มี (เมิน ยังตอบ 200) |

รายละเอียดที่ควรรู้:

- **`ผูก <room>` ต้องมีบิลอยู่ก่อน** — เช็ก `bill:<room>` ไม่ใช่ `ROOMS` ดังนั้นห้องที่ยังไม่เคยออกบิลผูกไม่ได้
- **postback `action=confirm` ตรวจเจ้าของแล้ว** — `webhook.js` เทียบ `event.source.userId` กับ `OWNER_USER_ID` ก่อนปิดบิล; ผู้ที่ไม่ใช่เจ้าของได้ข้อความ "เฉพาะเจ้าของหอกดยืนยันได้ครับ" และสถานะบิลไม่เปลี่ยน
- **การผูกห้องไม่มีการยืนยันตัวตนของห้อง** — ผู้ใช้คนไหนพิมพ์ `ผูก 203` ก็ผูกได้ และเขียน `room-user:203` ทับผู้เช่าคนเดิมได้ (การผูกซ้ำเปลี่ยนเจ้าของ mapping)
- **`OWNER_USER_ID` ไม่ถูกใช้ใน webhook เลย** — webhook ไม่รู้จัก role; สิทธิ์ทั้งหมดมาจาก `bill:<room>` ที่มีอยู่
- ถ้า `LINE_CHANNEL_ACCESS_TOKEN` ผิด/หมดอายุ `reply`/`push` throw แต่ `handleEvent` ถูกครอบด้วย `try/catch` ต่อ event → webhook ยังตอบ 200 ผู้ใช้แค่ไม่ได้รับข้อความ

## 14. สรุปการตรวจสิทธิ์ (จุดที่ไม่มี check ในโค้ด)

| Endpoint / event | สิ่งที่โค้ดตรวจ | สิ่งที่ **ไม่** ตรวจ |
|---|---|---|
| `/api/config` | — | ทุกอย่าง (public โดยตั้งใจ) |
| `/api/me` | idToken | — |
| `/api/bill`, `/api/slip`, `/api/slip-image` | idToken + `user-room:<userId> === room` (ยกเว้น owner) | ว่า `room` เป็นห้องที่อยู่ใน `ROOMS` |
| `/api/rooms`, `/api/run` | idToken + `isOwner` | — |
| `/api/seed`, `/api/sendbill` | `?token=` เท่ากับ `SEED_TOKEN` | ไม่มี auth ผู้ใช้, ไม่จำกัดจำนวนครั้ง, token อยู่ใน query (ติด access log) |
| `/api/webhook` | HMAC signature | ไม่ตรวจผู้ส่งต่อ event, ไม่มี idempotency |
| webhook `postback action=confirm` | signature ของ LINE + `isOwner(userId)` | ✅ ตรวจแล้ว |
| webhook `ผูก <room>` | signature ของ LINE | **ไม่ตรวจความเป็นเจ้าของห้อง / ไม่มีการยืนยันตัวตน** |
| ทุก endpoint ที่เรียก `requireUser` | idToken หรือ `x-seed-token` | `x-seed-token` เป็น bypass ที่ตั้งใจไว้ (คอมเมนต์ `shortcut:` ใน `api/_auth.js`) — ต้องลบก่อนใช้จริง |

## 15. เอกสารที่เกี่ยวข้อง

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — เส้นทาง request, state machine ของบิล, key map ใน Blob
- [`CONFIGURATION.md`](./CONFIGURATION.md) — env ทุกตัว, default, ผลของการไม่ตั้งค่า
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — deploy บน Vercel + Blob
- [`../HANDOFF.md`](../HANDOFF.md) — บันทึกส่งต่อทีม (กับดักที่เจอแล้ว, งานที่เหลือ)
