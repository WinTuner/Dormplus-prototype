# DormPlus — Handoff: backend

เอกสารส่งงานสำหรับคนรับช่วง back-end · อัปเดต 10 พ.ย. 2569

## 1. ตอนนี้มีอะไรแล้ว

| ส่วน | สถานะ | ที่อยู่ |
|---|---|---|
| เว็บแอปเจ้าของ + ผู้เช่า | ใช้ได้ | `web/` (รันที่ `/owner`, `/tenant`) |
| UI prototype (LINE-style) | ใช้ได้ | `prototype.html` |
| Mock backend (SQLite, stdlib) | ใช้ได้ | `server.py` |
| API `/v1/*` (adapter) | ใช้ได้ | `api_v1.py` |
| Rich menu 2 ชุด | เสร็จ | `docs/richmenu-*.png` |
| API contract | เสร็จ | `docs/API.md` |
| Schema Postgres | เสร็จ | `db/schema.sql` |
| Backend จริง (FastAPI) | **ยังไม่มี** | — |
| LINE OA / LIFF / auth | **ยังไม่มี** | — |

**`server.py` คือ reference implementation** — พฤติกรรมที่ถูกต้องดูจากไฟล์นี้ (คำนวณบิล, สถานะ, กันบิลซ้ำ) ไม่ใช่จาก UI

## 2. สิ่งที่ต้องสร้าง

1. FastAPI app ตาม `docs/API.md` (ทุก endpoint + error code)
2. Postgres ตาม `db/schema.sql` + migration (Alembic)
3. Worker + Scheduler (Procrastinate หรือ ARQ) สำหรับ:
   - `billing.run` — ออกบิลทั้งหอใน transaction เดียว
   - `notify.invoice` — ส่ง LINE ทีละห้อง + `message_log`
   - `dunning` — cron รายวัน 1/5/10 วันหลังครบกำหนด
   - `slip.verify` — เรียก SlipOK แล้วอัปเดตสถานะ
4. Auth: LINE Login → ตรวจ idToken → session cookie → resolve `property_id`
5. Webhook LINE (ตรวจ signature, ตอบ 200 เร็ว, ประมวลผล async)

## 3. กติกาที่ห้ามพลาด

| เรื่อง | เหตุผล |
|---|---|
| `UNIQUE(room_id, period)` ที่ DB | กันบิลซ้ำ — อย่าเช็คแค่ในโค้ด |
| ทุก query กรอง `property_id` จาก session | กันข้ามหอ (ห้ามรับจาก client) |
| งานในคิวต้อง idempotent | คิว retry, cron อาจยิงซ้ำ |
| เก็บ token OA เข้ารหัส | token หลุด = ส่งข้อความในนามหอคนอื่น |
| `paid` แก้ไม่ได้ | ต้องมี void/ใบเสร็จใหม่ + audit_log |
| ไม่คิดค่าปรับ | เจ้าของหอไม่เคยใช้ — อย่าเพิ่มโดยไม่ถาม |

## 4. ค่าที่ใช้ (จาก prototype)

- น้ำ 25 บาท/หน่วย · ไฟ 7 บาท/หน่วย (ตั้งได้ต่อหอ)
- ค่าเช่า 3,220 (มิเตอร์) / 3,500 (เหมา)
- ครบกำหนด +5 วันหลังออกบิล
- ทวงที่ 1 / 5 / 10 วันหลังเลยกำหนด

## 5. เกณฑ์ว่า "เสร็จ"

- [ ] ออกบิล 42 ห้องได้ใน 1 request และ rollback ทั้งก้อนถ้าล้ม
- [ ] ส่ง LINE ครบ 42 ห้อง และ `message_log` มี 42 แถว
- [ ] กดออกบิลซ้ำ → 409 ไม่สร้างซ้ำ
- [ ] ผู้เช่าแนบสลิป → `pending` → เจ้าของยืนยัน → `paid` + ใบเสร็จ
- [ ] สลิปยอดไม่ตรง → ไม่ผ่านอัตโนมัติ
- [ ] เรียก API ของหอ A ด้วย session หอ B → 403
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

## 8. วิธีรัน prototype เพื่อดูพฤติกรรม

```bash
python server.py       # http://127.0.0.1:8777
```
ข้อมูลทดสอบจะถูก seed ให้อัตโนมัติ (42 ห้อง, 12 ห้องจดแล้ว)
