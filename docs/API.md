# DormPlus — API Contract (v1)

สัญญาระหว่าง frontend (LIFF + เว็บเจ้าของ) กับ backend
ทุก endpoint เป็น JSON · ทุก request ที่ไม่ใช่ public ต้องมี session cookie

**สถานะ:** ✅ = `backend/` ทำแล้ว · ⬜ = ยังไม่ได้ทำ

| Endpoint | สถานะ |
|---|---|
| `GET /v1/rooms` | ✅ |
| `PUT /v1/rooms/:id/reading` | ✅ |
| `POST /v1/billing/run` | ✅ |
| `GET /v1/invoices` | ✅ |
| `POST /v1/invoices/:id/slip` | ✅ (ตรวจสลิปเป็น manual) |
| `POST /v1/invoices/:id/confirm` | ✅ |
| `POST /v1/invoices/:id/reject` | ✅ |
| `GET /v1/me/invoices` | ✅ (ผู้เช่าเห็นบิลห้องตัวเอง) |
| `GET /v1/liff-config` | ✅ |
| `POST /auth/line` · `POST /auth/logout` | ✅ |
| `POST /auth/line/link` | ✅ (รหัสเชิญ) |
| `POST /rooms/:id/invite` · `DELETE /rooms/:id/invite` | ✅ |
| `DELETE /tenants/:id/line` | ✅ |
| `GET /properties/:id` | ⬜ |
| `GET /invoices/:id` (รายละเอียด + items) | ⬜ |
| `GET /v1/reports/summary` | ⬜ |
| `POST /webhooks/line/:property_id` | ⬜ |

## กติกากลาง

- Base: `https://line-backend-ten.vercel.app/v1` (deployment จริง) — โดเมน `api.domplus.app` ในเอกสารรุ่นแรกยังไม่มีจริง
- เวลา: ISO-8601 UTC
- เงิน: จำนวนเต็มหน่วย "บาท" (ไม่ใช้ทศนิยม)
- รอบบิล: `period` = `YYYY-MM`
- Error:
```json
{ "error": { "code": "CONFLICT", "message": "บิลรอบ 2026-11 ออกไปแล้ว ..." } }
```
| code | HTTP | ความหมาย |
|---|---|---|
| `UNAUTHORIZED` | 401 | ไม่มี/หมดอายุ session |
| `FORBIDDEN` | 403 | ไม่ใช่เจ้าของหอนี้ |
| `NOT_FOUND` | 404 | ไม่พบ resource |
| `VALIDATION` | 422 | ข้อมูลไม่ถูกต้อง |
| `CONFLICT` | 409 | ผิดเงื่อนไข (เช่น บิลซ้ำ) |
| `UPSTREAM` | 502 | LINE/Slip API ล่ม |
| `SESSION_REVOKED` | 401 | cookie ยังไม่หมดอายุ แต่ผู้เช่าถูกถอด LINE หรือย้ายออกแล้ว → ล็อกอินใหม่ |
| `TOO_MANY_ATTEMPTS` | 429 | ลองรหัสเชิญผิดเกิน 10 ครั้งใน 1 ชั่วโมง (นับต่อบัญชี LINE) |

---

## Auth

### `POST /auth/line`
แลก LINE idToken เป็น session
```json
// req
{ "id_token": "eyJ..." }
// res 200
{ "user": { "room_no": "203", "name": "สมชาย", "property_id": "p_1" } }
```
- `LineLoginIn` รับแค่ `id_token` — ไม่มี `role` ใน request และ response ไม่มี `id`/`role`
- ระบบหา `property_id` และห้องจาก `line_user_id` ในตาราง `tenants` เท่านั้น (ไม่รับจาก client)
- ยังไม่มีทางล็อกอินของเจ้าของหอผ่าน LINE เลย — endpoint นี้สร้าง tenant session เสมอ ⬜

### `POST /auth/logout` → 204

### `POST /auth/line/link`
ครั้งแรกที่ผู้เช่าเปิด LIFF จาก QR เชิญ: ผูก LINE กับห้องแล้วเข้าสู่ระบบเลย (ตั้ง cookie เหมือน `/auth/line`)
```json
// req
{ "id_token": "eyJ...", "code": "K7MQ2PXA" }
// res 200
{ "user": { "room_no": "203", "name": "สมชาย", "property_id": "p_1" } }
```
- หอและห้องมาจากรหัสเชิญเท่านั้น ไม่รับจาก client
- รหัสใช้ได้ครั้งเดียว · คนเดิมเปิดลิงก์ซ้ำ = เข้าสู่ระบบอีกครั้ง (200) เมื่อรหัสยังไม่หมดอายุ/ไม่ถูกยกเลิก **และผู้เช่ายังอยู่ในห้องนั้น** (ย้ายออกแล้ว → `409 INVITE_USED`) — รหัสที่ตายแล้วตอบ 410 แม้เป็นคนที่เคยใช้
- รหัสไม่ถูกต้อง → `404 INVITE_NOT_FOUND` · คนอื่นใช้ไปแล้ว → `409 INVITE_USED` · หมดอายุ/ถูกยกเลิก/ผู้เช่าย้ายออก → `410 INVITE_EXPIRED`
- ผู้เช่าที่รหัสเชิญผูก LINE อื่นไว้แล้ว → `409 TENANT_ALREADY_LINKED`
- LINE บัญชีนี้ผูกกับห้องอื่นอยู่แล้ว (คนละห้อง) → `409 LINE_ON_ANOTHER_ROOM` (ต้องยกเลิกการผูกเดิมก่อน)
- รหัสไม่ระบุผู้เช่า (เชิญรูมเมท) → เพิ่มผู้เช่าใหม่ในห้อง ชื่อจากโปรไฟล์ LINE

---

## ผูก LINE กับห้อง (เจ้าของหอ)

LINE userId ผู้ใช้มองไม่เห็น เจ้าของหอจึงกรอกเองไม่ได้ ต้องให้ผู้เช่าสแกน QR เชิญแล้วล็อกอิน LINE เอง
(OA ทุกหออยู่ใต้ provider ของ DormPlus จึงใช้ LIFF ตัวเดียว และ userId เดียวกันส่งข้อความผ่าน OA ของหอได้)

### `POST /rooms/:id/invite` → 201
```json
// req (ไม่บังคับ)
{ "tenant_id": "t_203" }
// res
{ "code": "K7MQ2PXA", "link_url": "https://liff.line.me/<LIFF_ID>?code=K7MQ2PXA",
  "expires_at": "2026-11-19T10:00:00Z", "tenant_id": "t_203" }
```
- รหัส 8 ตัว (ไม่มี 0/O/1/I/L) อายุ 7 วัน ใช้ได้ 1 คน · เก็บแค่ hash · `code` แสดงครั้งเดียวตอนสร้าง
- ไม่ส่ง `tenant_id` = ผู้เช่าในห้องที่ยังไม่มี LINE · ถ้าไม่มีเลย = เชิญคนใหม่ (`tenant_id: null`)
- ออกรหัสใหม่ให้ผู้เช่าคนเดิม → รหัสเก่าที่ยังไม่ใช้ถูกยกเลิก
- `link_url` เป็น `null` ถ้ายังไม่ตั้ง `LIFF_ID` · ผู้เช่าที่ผูกแล้ว → `409 TENANT_ALREADY_LINKED`

### `DELETE /rooms/:id/invite`
ยกเลิกรหัสที่ยังไม่ถูกใช้ทั้งหมดของห้อง (เช่น ส่ง QR ผิดคน) → `{ "revoked": 1 }`

### `DELETE /tenants/:id/line` → 204
ยกเลิกการผูก LINE ของผู้เช่า · ครั้งหน้าที่เข้า LIFF จะได้ `403 NOT_LINKED`
(cookie เดิมใช้ไม่ได้ทันที — ทุก request ของผู้เช่าตรวจ `still_linked` ใหม่ → `401 SESSION_REVOKED`)

---

## หอและห้อง

### `GET /properties/:id`
```json
{ "id": "p_1", "name": "หอพักบ้านสวน", "billing_mode": "meter",
  "water_rate": 25, "elec_rate": 7, "due_days": 5, "rooms": 42 }
```

### `GET /rooms?period=2026-11`
เฉพาะเจ้าของหอ · ไม่ส่ง `period` = เดือนปัจจุบันตามเวลาไทย · `reading`, `invoice`, `tenant` เป็น `null` ถ้ายังไม่มี
```json
{ "period": "2026-11",
  "items": [
  { "id": "r_203", "room_no": "203", "rent": 3220, "mode": "meter",
    "tenant": { "name": "สมชาย", "line_linked": true },
    "reading": { "water_prev": 128, "water_now": 133, "elec_prev": 540, "elec_now": 571 },
    "invoice": { "id": "inv_1", "total": 3842, "status": "unpaid", "due_date": "2026-11-09" } }
] }
```

---

## มิเตอร์

### `PUT /rooms/:id/reading`
idempotent ต่อ `(room_id, period)` — ส่งซ้ำทับค่าเดิมได้จนกว่าจะออกบิล
```json
// req
{ "period": "2026-11", "water_now": 133, "elec_now": 571, "photo_url": "s3://..." }
// res 200
{ "water_units": 5, "elec_units": 31, "warning": null }
```
- "ครั้งก่อน" = reading ล่าสุดของห้องนี้ที่ `period` น้อยกว่ารอบที่ส่งมา
- `warning` = `"METER_DECREASED"` เมื่อค่าน้อยกว่าครั้งก่อน (ไม่ block, หน่วยที่ลดนับเป็น 0)
- `warning` = `"NO_PREVIOUS_READING"` เมื่อห้องนี้ยังไม่เคยจดมาก่อน (บันทึกได้, หน่วย = 0)
- ออกบิลรอบนั้นแล้ว → `409 CONFLICT` · ห้องของหออื่น → `403 FORBIDDEN` · เฉพาะเจ้าของหอ
- ส่งซ้ำโดยไม่มี `photo_url` → เก็บรูปเดิมไว้

---

## บิล

### `POST /billing/run`
สร้างบิลทั้งหอจากค่ามิเตอร์ที่จดแล้ว (ยังไม่ส่ง LINE — เส้นทางนี้ยังไม่ enqueue อะไร)
```json
// req
{ "period": "2026-11" }
// res 202
{ "job_id": "job_9", "period": "2026-11", "rooms_to_bill": 42,
  "skipped_no_reading": 0, "skipped_no_previous_reading": 0 }
```
- ทำทั้งหอใน transaction เดียว ล้มกลางทาง → rollback ทั้งหมด
- ออกบิลเฉพาะห้องที่พร้อมและยังไม่มีบิลรอบนี้ · ห้อง `vacant` ข้าม
  - ห้องคิดตามมิเตอร์: ต้องมี reading รอบนี้ (ไม่มี → `skipped_no_reading`) และ reading รอบก่อนหน้า (ไม่มี → `skipped_no_previous_reading`)
  - ห้องเหมาจ่าย (`mode = flat`): ไม่ต้องมี reading · บิล = ค่าเช่าอย่างเดียว
- กดซ้ำ: ออกบิลเฉพาะห้องที่เพิ่งพร้อม (เช่น จดมิเตอร์ทีหลัง) · ถ้าไม่มีห้องใหม่และรอบนี้มีบิลแล้ว → `409 CONFLICT`
- หน่วยคิดจาก reading รอบก่อนหน้า **ณ ตอนออกบิล** (ถ้าแก้มิเตอร์เดือนก่อนหลังจดเดือนนี้แล้ว บิลจะใช้ค่าที่แก้)
- ค่าน้ำ/ไฟ/วันครบกำหนดจาก `properties` ของหอ · ครบกำหนด = วันที่ออกบิล (เวลาไทย) + `due_days`
- สร้าง `invoice_items` (ค่าเช่า · ค่าน้ำ · ค่าไฟ) และเขียน `audit_log` action `billing.run`
- `/billing/run` ยังไม่ enqueue อะไร (Procrastinate มีโครงใน `app/queue.py` และ `/v1/cron/daily` เป็นตัว drain แต่การออกบิลเองยังทำใน request) → `job_id` = `null`

### `GET /invoices?period=2026-11&status=unpaid`
เฉพาะเจ้าของหอ · ไม่ส่ง `period` = เดือนปัจจุบันตามเวลาไทย · `status` = `unpaid` | `pending` | `paid` | `void`
```json
{ "period": "2026-11",
  "items": [ { "id": "inv_1", "room_no": "203", "total": 3842, "status": "unpaid",
               "due_date": "2026-11-09", "days_overdue": 0 } ],
  "summary": { "total": 167400, "paid": 120000, "pending": 3842, "unpaid": 43558 } }
```
- `days_overdue` นับเฉพาะบิล `unpaid` (บิลที่แนบสลิปรอตรวจ = 0)
- `summary` เป็นยอดทั้งรอบของหอ ไม่ขึ้นกับ `status` ที่กรอง · `total` ไม่รวมบิล `void`

### `GET /invoices/:id`
```json
{ "id": "inv_1", "period": "2026-11", "room_no": "203",
  "items": [ { "label": "ค่าเช่า", "qty": 1, "unit_price": 3220, "amount": 3220 },
             { "label": "ค่าน้ำ", "qty": 5, "unit_price": 25, "amount": 125 },
             { "label": "ค่าไฟ", "qty": 31, "unit_price": 7, "amount": 217 } ],
  "total": 3842, "status": "unpaid", "due_date": "2026-11-09",
  "payment": null }
```

---

## การชำระเงิน

### `POST /invoices/:id/slip`
ผู้เช่าแนบสลิป → ตั้งสถานะ `pending` (ยังไม่มีการตรวจสลิปอัตโนมัติ)
```json
// req
{ "slip_url": "s3://slips/203-1109.jpg" }
// res 200
{ "status": "pending", "verify": { "ok": null, "amount": 3842, "provider": "manual" } }
```
- ยังไม่มี integration ตรวจสลิป (SlipOK ยังไม่ต่อ) → `verify.ok` เป็น `null` เสมอ, `provider` = `"manual"` จนกว่าเจ้าของจะกดยืนยัน

### `POST /invoices/:id/confirm`
เจ้าของยืนยัน → `paid` + ออกใบเสร็จ
```json
// res 200
{ "status": "paid", "receipt_no": "REC-2026-11-0142", "paid_at": "2026-11-09T10:20:00Z" }
```

### `POST /invoices/:id/reject`
```json
{ "reason": "ยอดไม่ตรง" }   // → กลับเป็น unpaid + log
```

---

## รายงาน

### `GET /reports/summary?period=2026-11`
```json
{ "billed": 167400, "paid": 120000, "pending": 3842, "unpaid": 43558,
  "rooms_total": 42, "rooms_paid": 30, "rooms_overdue": 5 }
```

---

## Webhook (LINE → server)

### `POST /webhooks/line/:property_id`
- ตรวจ `X-Line-Signature` ด้วย channel secret ของหอนั้น
- ตอบ 200 ทันที แล้วประมวลผลแบบ async

---

## สถานะบิล (state machine)

```
unpaid ──แนบสลิป──▶ pending ──เจ้าของยืนยัน──▶ paid
   ▲                   │
   └─── reject ────────┘
```
- `paid` แก้ไม่ได้ (ต้องออกใบเสร็จใหม่/void)
- `audit_log` เขียนตอนออกบิล (billing run), ยืนยัน (confirm) และตีกลับ (reject) — **การแนบสลิป (`unpaid` → `pending`) ไม่เขียน**

---
## `409 INVALID_STATE`

`backend/` ใช้ code `INVALID_STATE` เมื่อบิลไม่ได้อยู่สถานะที่ transition นั้นต้องใช้ (แทนที่จะ silently no-op)
ตารางสถานะยังเหมือน state machine ด้านบน

| endpoint | สถานะที่ต้องเป็น | ถ้าไม่ใช่ |
|---|---|---|
| `POST /v1/invoices/:id/slip` | `unpaid` | `409` `INVALID_STATE` (`"บิลนี้อยู่ในสถานะ {status} จึงแนบสลิปไม่ได้"`) |
| `POST /v1/invoices/:id/confirm` | `pending` | `409` `INVALID_STATE` (`"บิลนี้อยู่ในสถานะ {status} จึงยืนยันไม่ได้"`) |

```json
{ "error": { "code": "INVALID_STATE",
             "message": "บิลนี้อยู่ในสถานะ pending จึงแนบสลิปไม่ได้" } }
```

- `404 NOT_FOUND` (`"ไม่พบบิล"`) มาก่อนการตรวจสถานะเสมอ
- แนบสลิปซ้ำบนบิล `pending`/`paid` และยืนยันซ้ำบนบิล `paid`/`unpaid` → `409` (ไม่มีการเขียน DB ใด ๆ)
- frontend ควรถือ `409 INVALID_STATE` = "refresh ข้อมูลบิลนี้แล้วแสดงสถานะจริง" ไม่ใช่ error ที่ต้อง retry

## ตัวอย่าง curl (`backend/` บนเครื่อง)

ทุกอย่างรันกับ `uvicorn app.main:app` ที่พอร์ต 8000 (ดู [`backend/README.md`](../backend/README.md)) · ต้องมี `DEV_AUTH=true` และส่ง header `X-Dev-Property` · บน PowerShell ใช้ `curl.exe` และ escape `"` แทน `'`


```bash
BASE=http://127.0.0.1:8000
```

### `GET /v1/rooms`

```bash
curl -s "$BASE/v1/rooms?period=2026-11"
```

```json
{ "items": [
    { "id": 1, "room_no": "201", "rent": 3220, "mode": "meter",
      "tenant": { "name": "ผู้เช่า 201", "line_linked": false },
      "reading": { "water_prev": 113, "water_now": 133, "elec_prev": 541, "elec_now": 571 },
      "invoice": { "id": 10, "total": 3930, "status": "paid", "due_date": "2026-11-09" } } ],
  "period": "2026-11" }
```

### `PUT /v1/rooms/:id/reading`

```bash
curl -s -X PUT "$BASE/v1/rooms/13/reading" \
  -H "Content-Type: application/json" \
  -d '{"period":"2026-11","water_now":140,"elec_now":600}'
```

```json
{ "water_units": 12, "elec_units": 0, "warning": "METER_DECREASED" }
```

### `POST /v1/billing/run`

```bash
curl -s -X POST "$BASE/v1/billing/run" \
  -H "Content-Type: application/json" \
  -d '{"period":"2026-11"}'
```

```json
{ "job_id": null, "period": "2026-11", "rooms_to_bill": 12,
  "skipped_no_reading": 0, "skipped_no_previous_reading": 0 }
```

- `period` เป็น field บังคับ — ส่ง `{}` จะได้ `422 VALIDATION`

### `GET /v1/invoices`

```bash
curl -s "$BASE/v1/invoices?status=unpaid"
```

```json
{ "items": [
    { "id": 11, "room_no": "202", "total": 3562, "status": "unpaid",
      "due_date": "2026-11-09", "days_overdue": 1 } ] }
```

### `GET /v1/liff-config`

public — ให้หน้า LIFF เอา `liff_id` ไป `liff.init()`

```json
{ "liff_id": "2012575885-l35sh1N4" }
```

### `GET /v1/me/invoices`

ผู้เช่าเท่านั้น — 12 รอบล่าสุดของห้องตัวเอง (ห้องมาจาก cookie)

```json
{ "items": [ { "id": "inv_202_2026-11", "period": "2026-11", "total": 3562,
               "status": "unpaid", "due_date": "2026-11-09" } ] }
```

### `POST /v1/invoices/:id/slip`

ผู้เช่าเท่านั้น — ห้องมาจาก cookie ไม่ใช่จาก request · แนบได้เฉพาะบิล `unpaid` (สถานะอื่น → 409)
`slip_url` ไม่บังคับ (ยังไม่มีระบบอัปโหลดรูปใน prototype นี้)

```bash
curl -s -X POST "$BASE/v1/invoices/inv_202_2026-11/slip" \
  -H "Content-Type: application/json" \
  -d '{"slip_url":"s3://slips/202-1109.jpg"}'
```

```json
{ "status": "pending", "verify": { "ok": null, "amount": 3562, "provider": "manual" } }
```

### `POST /v1/invoices/:id/confirm`

เจ้าของหอของหอนั้น · `pending` → `paid` + ออกเลขใบเสร็จ (`REC-<period>-NNNN`)

```bash
curl -s -X POST "$BASE/v1/invoices/inv_202_2026-11/confirm" \
  -H "Content-Type: application/json" \
  -d '{}'
```

```json
{ "status": "paid", "receipt_no": "REC-2026-11-0001", "paid_at": "2026-11-12T09:00:45Z" }
```

### `POST /v1/invoices/:id/reject`

เจ้าของหอของหอนั้น · `pending` → `unpaid` พร้อมเหตุผล (ลง `audit_log`)

```bash
curl -s -X POST "$BASE/v1/invoices/inv_202_2026-11/reject" \
  -H "Content-Type: application/json" \
  -d '{"reason":"ยอดในสลิปไม่ตรง"}'
```

```json
{ "status": "unpaid" }
```

### `GET /v1/reports/summary`

⬜ ยังไม่มี route นี้ใน `backend/` (`app/main.py` mount แค่ auth, rooms, billing, me, dunning, cron, invites) — ตัวอย่างด้านล่างเป็นสัญญาที่วางไว้

```bash
curl -s "$BASE/v1/reports/summary"
```

```json
{ "billed": 43112, "paid": 3930, "pending": 0, "unpaid": 39182, "invoices": 12 }
```

## Cron และการทวง (ไม่ใช้ session — ใช้ shared secret)

### `GET /v1/cron/daily`

⚠️ **endpoint นี้ไม่ถูกตั้งเวลาใน production แล้ว** — `backend/vercel.json` ไม่มี `crons` (ถอดออกเมื่อการทวงย้ายไป `line-app`: `GET /api/cron` ของ `line-app/vercel.json`, `0 2 * * *`) ถ้าเปิดทั้งคู่ผู้เช่าที่ผูกทั้งสองระบบจะได้เตือนสองชุด · ใช้ยิงมือ/ทดสอบได้ และเปิด `crons` กลับได้ถ้าย้ายการทวงมาฝั่งนี้ (แล้วปิดของ `line-app`)

Vercel ใส่ `Authorization: Bearer $CRON_SECRET` ให้เองเมื่อตั้ง env ไว้บนโปรเจกต์

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" "$BASE/v1/cron/daily"
```

```json
{ "queued": 3, "drained": true }
```

- ทำสามอย่างใน invocation เดียว: เลือกบิล `unpaid` ที่เลยกำหนด 1/5/10 วัน → enqueue → drain คิว (`run_worker(wait=False)`)
- ไม่ส่ง secret / secret ไม่ตรง / `CRON_SECRET` ว่าง → `401 UNAUTHORIZED` (ว่าง = ปฏิเสธเสมอ)
- ยังไม่ได้สร้างตารางคิว (`python -m app.queue` ครั้งเดียวต่อฐานข้อมูล) → `503 QUEUE_UNAVAILABLE`
- ไม่มี retry จาก Vercel: รอบที่พลาดจะถูกชดเชยรอบถัดไป เพราะการเลือกบิลอิง `message_log` ไม่ใช่วันที่

### `POST /v1/dunning/run`

สั่ง enqueue อย่างเดียว (ไม่ส่ง) — ใช้ยิงมือ หรือ owner session ก็ได้

```bash
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" "$BASE/v1/dunning/run"
```

```json
{ "queued": 3, "days": [1, 5] }
```

`?token=` ถูกปฏิเสธ `401` — token ต้องมาทาง header เท่านั้น (URL ติด access log)
