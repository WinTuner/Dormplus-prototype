# DormPlus — API Contract (v1)

สัญญาระหว่าง frontend (LIFF + เว็บเจ้าของ) กับ backend
ทุก endpoint เป็น JSON · ทุก request ที่ไม่ใช่ public ต้องมี session cookie

**สถานะ:** ✅ = adapter `api_v1.py` ตอบได้แล้ว (ใช้พัฒนา frontend ได้) · ⬜ = backend จริงต้องสร้าง

| Endpoint | สถานะ |
|---|---|
| `GET /v1/rooms` | ✅ |
| `PUT /v1/rooms/:id/reading` | ✅ |
| `POST /v1/billing/run` | ✅ |
| `GET /v1/invoices` | ✅ |
| `POST /v1/invoices/:id/slip` | ✅ (ตรวจสลิปเป็น manual) |
| `POST /v1/invoices/:id/confirm` | ✅ |
| `GET /v1/reports/summary` | ✅ |
| `POST /auth/line` · `POST /auth/logout` | ⬜ |
| `GET /properties/:id` | ⬜ |
| `GET /invoices/:id` (รายละเอียด + items) | ⬜ |
| `POST /invoices/:id/reject` | ⬜ |
| `POST /webhooks/line/:property_id` | ⬜ |

## กติกากลาง

- Base: `https://api.domplus.app/v1`
- เวลา: ISO-8601 UTC
- เงิน: จำนวนเต็มหน่วย "บาท" (ไม่ใช้ทศนิยม)
- รอบบิล: `period` = `YYYY-MM`
- Error:
```json
{ "error": { "code": "INVOICE_ALREADY_SENT", "message": "บิลรอบนี้ถูกส่งแล้ว" } }
```
| code | HTTP | ความหมาย |
|---|---|---|
| `UNAUTHORIZED` | 401 | ไม่มี/หมดอายุ session |
| `FORBIDDEN` | 403 | ไม่ใช่เจ้าของหอนี้ |
| `NOT_FOUND` | 404 | ไม่พบ resource |
| `VALIDATION` | 422 | ข้อมูลไม่ถูกต้อง |
| `CONFLICT` | 409 | ผิดเงื่อนไข (เช่น บิลซ้ำ) |
| `UPSTREAM` | 502 | LINE/Slip API ล่ม |

---

## Auth

### `POST /auth/line`
แลก LINE idToken เป็น session
```json
// req
{ "id_token": "eyJ...", "role": "owner" }
// res 200
{ "user": { "id": "u_1", "role": "owner", "property_id": "p_1", "name": "คุณแมว" } }
```
- `role` = `owner` | `tenant`
- tenant: ระบบหา `property_id` จากห้องที่ผูกกับ `line_user_id`

### `POST /auth/logout` → 204

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
สร้างบิลทั้งหอจากค่ามิเตอร์ที่จดแล้ว → เข้าคิวส่ง LINE
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
- backend ตอนนี้ยังไม่มีคิว → `job_id` = `null`

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
ผู้เช่าแนบสลิป → ระบบตรวจ → ตั้งสถานะ `pending`
```json
// req
{ "slip_url": "s3://slips/203-1109.jpg" }
// res 200
{ "status": "pending", "verify": { "ok": true, "amount": 3842, "provider": "slipok" } }
```
- ถ้า API ตรวจล่ม → `status = "pending"`, `verify.ok = null` (รอเจ้าของตรวจ)

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
- ทุกการเปลี่ยนสถานะเขียน `audit_log`

---

## Implementation notes — adapter `api_v1.py`

ส่วนนี้บันทึกว่า adapter ที่มีอยู่จริง (`api_v1.py` บน `server.py` + SQLite) ต่างจากสัญญาข้างบนตรงไหน
ใช้เพื่อพัฒนา frontend ได้ถูก แต่ **ไม่ใช่** พฤติกรรมของ backend จริง

Base URL ของ prototype: `http://127.0.0.1:8777/v1` (ไม่ใช่ `https://api.domplus.app/v1`) — รัน `python server.py`
แล้วเสิร์ฟเฉพาะ `127.0.0.1` ฐานข้อมูล `domplus.db` ถูก seed อัตโนมัติตอน start (42 ห้อง, 12 ห้องแรกจดมิเตอร์รอบ `2026-11` แล้ว)

| หัวข้อ | สัญญา | adapter `api_v1.py` |
|---|---|---|
| Auth | session cookie ทุก request ที่ไม่ใช่ public | ไม่มีเลย — `handle()` ไม่ตรวจ header/cookie ใด ๆ เปิดให้เรียกได้ทุก request (ป้องกันด้วยการ bind `127.0.0.1` เท่านั้น) |
| `/auth/*`, `/properties/:id`, `/invoices/:id`, `reject`, webhook | มีในสัญญา | ยังไม่ implement — ตกลงที่ `404 NOT_FOUND` |
| Pagination | — | ไม่มี `limit`/`offset`/cursor คืนทุกรายการเสมอ |
| รูปแบบ id | string (`r_203`, `inv_1`, `p_1`) | SQLite `INTEGER` (`1`, `10`, …) — path param เป็นตัวเลขเท่านั้น (`^/v1/rooms/(\d+)/reading$`) |
| `period` | ต่อ request | ค่าคงที่ `server.PERIOD = "2026-11"`; `PUT /v1/rooms/:id/reading` อ่าน "ครั้งก่อน" จาก period `'2026-10'` แบบ hardcode; `GET /v1/invoices` และ `GET /v1/reports/summary` **รับ `?period=` แต่ไม่ใช้** (ตอบข้อมูล `2026-11` เสมอ) |
| ชนิดข้อมูลใน SQLite | — | เงิน/หน่วยเป็น `INTEGER`; `due_date`, `period` เป็น `TEXT` (`YYYY-MM` / `YYYY-MM-DD`); เวลาเขียนด้วย `datetime('now')` ของ SQLite (UTC string) |
| `tenant.line_linked` | Boolean จริง | `false` ตลอด — prototype ไม่มีตารางผูก LINE |
| `PUT /v1/rooms/:id/reading` | รับ `photo_url` | รับแล้วทิ้ง ไม่บันทึกรูป; `water_units`/`elec_units` ถูก clamp ที่ 0 (`max(0, now - prev)`) |
| `POST /v1/billing/run` | `202` + `job_id`, `rooms_to_bill`, `skipped_no_reading` | `200` + `{"ok": true, "billed": N}`; `N` = จำนวนห้องที่มี reading รอบนี้ (นับซ้ำได้ถ้าออกบิลไปแล้ว เพราะ insert ใช้ `ON CONFLICT DO NOTHING`); ไม่มีคิว/ไม่มี `job_id` |
| `POST /v1/invoices/:id/slip` | ตรวจสลิปผ่าน provider (slipok) | ตรวจ manual: `verify.ok` เป็น `null` เสมอ, `verify.provider = "manual"`, ไม่เก็บ `slip_url` |
| `POST /v1/invoices/:id/confirm` | `paid` + `receipt_no` + `paid_at` | `paid` + `receipt_no` (รูปแบบ `REC-2026-11-0011` = `REC-{PERIOD}-{id:04d}`) — **ไม่มี `paid_at`** ใน response (เขียนลง `payments.confirmed_at` แทน) |
| `GET /v1/invoices` | มี `summary` ต่อท้าย | ไม่มี `summary`; `?status=` ใช้ได้ |
| `GET /v1/reports/summary` | `billed`/`paid`/`pending`/`unpaid` + `rooms_total`/`rooms_paid`/`rooms_overdue` | คืน `billed`/`paid`/`pending`/`unpaid` + `invoices` (จำนวนบิล) — ไม่มี field นับห้อง |
| `GET /v1/rooms` | ตามตัวอย่างข้างบน | เพิ่ม `period` และ `rates { water, elec }` ระดับบนสุด |
| error code | `UNAUTHORIZED`/`FORBIDDEN`/`VALIDATION`/`UPSTREAM`/`CONFLICT` | สร้างแค่ `NOT_FOUND` (404) และ `INVALID_STATE` (409); path ที่ไม่รู้จักคืน `{"error": {"code": "NOT_FOUND", "message": "<path>"}}` |
| `audit_log` | ทุกการเปลี่ยนสถานะ | ยังไม่มีตาราง/การเขียน log |

## `409 INVALID_STATE`

สัญญาเดิมในหัวข้อ "กติกากลาง" มีแต่ `CONFLICT` — adapter ใช้ code `INVALID_STATE` เมื่อบิลไม่ได้อยู่สถานะที่ переходนั้นต้องใช้
(แทนที่จะ silently no-op) ตารางสถานะยังเหมือน state machine ด้านบน

| endpoint | สถานะที่ต้องเป็น | ถ้าไม่ใช่ |
|---|---|---|
| `POST /v1/invoices/:id/slip` | `unpaid` | `409` `INVALID_STATE` (`"บิลนี้อยู่สถานะ {status} แนบสลิปซ้ำไม่ได้"`) |
| `POST /v1/invoices/:id/confirm` | `pending` | `409` `INVALID_STATE` (`"บิลนี้อยู่สถานะ {status} ยืนยันไม่ได้"`) |

```json
{ "error": { "code": "INVALID_STATE",
             "message": "บิลนี้อยู่สถานะ pending แนบสลิปซ้ำไม่ได้" } }
```

- `404 NOT_FOUND` (`"ไม่พบบิล"`) มาก่อนการตรวจสถานะเสมอ
- แนบสลิปซ้ำบนบิล `pending`/`paid` และยืนยันซ้ำบนบิล `paid`/`unpaid` → `409` (ไม่มีการเขียน DB ใด ๆ)
- frontend ควรถือ `409 INVALID_STATE` = "refresh ข้อมูลบิลนี้แล้วแสดงสถานะจริง" ไม่ใช่ error ที่ต้อง retry

## ตัวอย่าง curl (prototype)

ทุกอย่างรันกับ `python server.py` ที่พอร์ต 8777 · ตัวอย่าง response เป็นค่าที่วัดจริงจาก seed
(ตัวเลขจะเปลี่ยนตามข้อมูลใน `domplus.db`) · บน PowerShell ใช้ `curl.exe` และ escape `"` แทน `'`

```bash
BASE=http://127.0.0.1:8777
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
  "period": "2026-11", "rates": { "water": 25, "elec": 7 } }
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
  -d '{}'
```

```json
{ "ok": true, "billed": 12 }
```

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

```bash
curl -s "$BASE/v1/reports/summary"
```

```json
{ "billed": 43112, "paid": 3930, "pending": 0, "unpaid": 39182, "invoices": 12 }
```
