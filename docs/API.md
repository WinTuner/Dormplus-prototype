# DomPlus — API Contract (v1)

สัญญาระหว่าง frontend (LIFF + เว็บเจ้าของ) กับ backend
ทุก endpoint เป็น JSON · ทุก request ที่ไม่ใช่ public ต้องมี session cookie

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
```json
{ "items": [
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
- `warning` = `"METER_DECREASED"` เมื่อค่าน้อยกว่าครั้งก่อน (ไม่ block)

---

## บิล

### `POST /billing/run`
สร้างบิลทั้งหอจากค่ามิเตอร์ที่จดแล้ว → เข้าคิวส่ง LINE
```json
// req
{ "period": "2026-11" }
// res 202
{ "job_id": "job_9", "rooms_to_bill": 42, "skipped_no_reading": 0 }
```
- ถ้ามีบิลรอบนี้แล้ว → `409 CONFLICT`

### `GET /invoices?period=2026-11&status=unpaid`
```json
{ "items": [ { "id": "inv_1", "room_no": "203", "total": 3842, "status": "unpaid",
               "due_date": "2026-11-09", "days_overdue": 0 } ],
  "summary": { "total": 167400, "paid": 120000, "pending": 3842, "unpaid": 43558 } }
```

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
