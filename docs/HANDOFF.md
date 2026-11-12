# DormPlus — Handoff: backend

เอกสารส่งงานสำหรับคนรับช่วง back-end · อัปเดต 12 พ.ย. 2569

## 1. ตอนนี้มีอะไรแล้ว

| ส่วน | สถานะ | ที่อยู่ |
|---|---|---|
| Rich menu 2 ชุด | เสร็จ | `docs/richmenu-*.png` |
| API contract | เสร็จ | `docs/API.md` |
| Schema Postgres | เสร็จ | `db/schema.sql` |
| Backend จริง (FastAPI + Postgres) | บางส่วน | `backend/` — rooms, readings, billing run, invoices, slip/confirm/reject, LINE Login |
| LINE app ที่ deploy จริง | ใช้ได้ | `line-app/` (Vercel + Blob + LIFF) — ส่งบิล/แนบสลิป/ยืนยันในแชท · ดู `line-app/HANDOFF.md` |
| LINE OA / LIFF / auth (backend) | บางส่วน | LIFF login + session cookie เสร็จ · webhook/ส่งข้อความยังไม่มี (`backend/app/routes/auth.py`, `backend/liff/`) |

**`line-app/` คือของที่รันจริงอยู่ตอนนี้** — พฤติกรรมที่ผู้ใช้เห็น (การ์ดบิล, LIFF, การ์ดยืนยัน) ดูจากที่นั่น · `backend/` คือเป้าหมายระยะยาวตาม `docs/API.md`

## 2. สิ่งที่ต้องสร้าง

1. 🟡 FastAPI app ตาม `docs/API.md` (ทุก endpoint + error code)
   — มีแล้ว: rooms, readings, billing run, invoices, slip, confirm, reject, `/me/invoices`, auth · เหลือ `GET /properties/:id`, `GET /invoices/:id`, webhook
2. ✅ Postgres ตาม `db/schema.sql` + migration (Alembic) — `backend/migrations/`
3. ⬜ Worker + Scheduler (Procrastinate หรือ ARQ) สำหรับ:
   - `billing.run` — ออกบิลทั้งหอใน transaction เดียว (ตอนนี้ทำใน request แบบ synchronous แล้ว `job_id` = `null`)
   - `notify.invoice` — ส่ง LINE ทีละห้อง + `message_log`
   - `dunning` — cron รายวัน 1/5/10 วันหลังครบกำหนด
   - `slip.verify` — เรียก SlipOK แล้วอัปเดตสถานะ (ตอนนี้ `verify.ok` = `null` เจ้าของกดยืนยันเอง)
4. 🟡 Auth: LINE Login → ตรวจ idToken → session cookie → resolve `property_id` — เสร็จแล้ว · ยังไม่มี RLS policy
5. ⬜ Webhook LINE (ตรวจ signature, ตอบ 200 เร็ว, ประมวลผล async)

## 3. กติกาที่ห้ามพลาด

| เรื่อง | เหตุผล |
|---|---|
| `UNIQUE(room_id, period)` ที่ DB | กันบิลซ้ำ — อย่าเช็คแค่ในโค้ด |
| ทุก query กรอง `property_id` จาก session | กันข้ามหอ (ห้ามรับจาก client) |
| งานในคิวต้อง idempotent | คิว retry, cron อาจยิงซ้ำ |
| เก็บ token OA เข้ารหัส | token หลุด = ส่งข้อความในนามหอคนอื่น |
| `paid` แก้ไม่ได้ | ต้องมี void/ใบเสร็จใหม่ + audit_log |
| ไม่คิดค่าปรับ | เจ้าของหอไม่เคยใช้ — อย่าเพิ่มโดยไม่ถาม |

## 4. ค่าที่ใช้ (จาก `backend/app/seed.py` และ `line-app/api/_rooms.js`)

- น้ำ 25 บาท/หน่วย · ไฟ 7 บาท/หน่วย (ตั้งได้ต่อหอ)
- ค่าเช่า 3,220 (มิเตอร์) / 3,500 (เหมา)
- ครบกำหนด +5 วันหลังออกบิล
- ทวงที่ 1 / 5 / 10 วันหลังเลยกำหนด

## 5. เกณฑ์ว่า "เสร็จ"

- [x] ออกบิล 42 ห้องได้ใน 1 request และ rollback ทั้งก้อนถ้าล้ม — `backend/tests/test_billing.py`
- [ ] ส่ง LINE ครบ 42 ห้อง และ `message_log` มี 42 แถว
- [x] กดออกบิลซ้ำ → 409 ไม่สร้างซ้ำ — `backend/tests/test_billing.py`
- [x] ผู้เช่าแนบสลิป → `pending` → เจ้าของยืนยัน → `paid` + ใบเสร็จ — `backend/tests/test_slip_confirm_reject.py`
- [ ] สลิปยอดไม่ตรง → ไม่ผ่านอัตโนมัติ
- [x] เรียก API ของหอ A ด้วย session หอ B → 403 — `backend/tests/test_rooms.py`
- [ ] cron ทวงทำงาน 1/5/10 วัน และไม่ส่งซ้ำในวันเดียว

## 6. ลำดับงานที่แนะนำ (2 สัปดาห์)

| วัน | งาน |
|---|---|
| 1–2 | schema + migration + seed 42 ห้อง |
| 3–4 | auth LINE + `/rooms` + `/readings` |
| 5–6 | `/billing/run` + `/invoices` + หน้าเจ้าของต่อ API จริง |
| 7–8 | ส่ง LINE จริง 1 หอ + `message_log` |
| 9–10 | สลิป + ยืนยัน + ใบเสร็จ |
| 11–12 | cron ทวง + รายงาน |
| 13–14 | เก็บขอบ: error code, log, `/healthz`, backup |

## 7. ของที่ต้องขอจากเจ้าของโปรเจกต์

- LINE Channel ID / Secret / Access Token ของ OA ทดสอบ
- บัญชี SlipOK (หรือผู้ให้บริการตรวจสลิป)
- โดเมน + subdomain สำหรับ LIFF (ต้อง HTTPS)
- สิทธิ์ Supabase/Railway

## 8. วิธีรันของจริง

`line-app/` — ตัวที่ deploy อยู่:

```bash
cd line-app && node smoke.js   # offline test
```

`backend/` — FastAPI + Postgres:

```bash
cd backend && docker compose up -d && alembic upgrade head
python -m app.seed && uvicorn app.main:app --reload   # http://127.0.0.1:8000/docs
```

prototype เดิม (`server.py` + `web/` + `prototype.html`) ถูกลบแล้ว — ดูได้ใน git history
