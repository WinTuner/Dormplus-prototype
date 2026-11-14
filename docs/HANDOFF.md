# DormPlus — Handoff: backend

เอกสารส่งงานสำหรับคนรับช่วง back-end · อัปเดต 14 พ.ย. 2569

## 1. ตอนนี้มีอะไรแล้ว

| ส่วน | สถานะ | ที่อยู่ |
|---|---|---|
| Rich menu 2 ชุด | เสร็จ | `docs/richmenu-*.png` |
| API contract | เสร็จ | `docs/API.md` |
| Schema Postgres | เสร็จ | `db/schema.sql` (snapshot อ่านอย่างเดียว) · ตัวที่รันจริงคือ `backend/migrations/` (alembic ถึง `0003`) |
| Backend จริง (FastAPI + Postgres) | บางส่วน | `backend/` — rooms, readings, billing run, invoices, slip/confirm/reject, LINE Login |
| LINE app ที่ deploy จริง | ใช้ได้ | `line-app/` (Vercel + Blob + LIFF) — ส่งบิล/แนบสลิป/ยืนยันในแชท · ดู `line-app/HANDOFF.md` |
| LINE OA / LIFF / auth (backend) | บางส่วน | LIFF login + session cookie เสร็จ · **ส่งข้อความ LINE ได้แล้ว** (`app/line_push.py` + คิว `app/tasks.py`) · ยังไม่มี webhook รับ event (LINE OA ชี้ที่ `line-app/`) · หน้า LIFF ของ backend อยู่ที่ `backend/liff/` |
| Deploy: `line-app` | ✅ | Vercel · auto จาก `master` · https://line-app-iota.vercel.app |
| Deploy: `backend` | ✅ | Vercel (serverless) · auto จาก `master` · https://line-backend-ten.vercel.app |
| Database จริง | ✅ | Neon Postgres (Vercel Marketplace) · schema `0003` + seed 42 ห้อง · `backend/.env` (ไม่อยู่ใน git) |

**สถานะ infra:** ทั้งสองโปรเจกต์ Vercel ผูก repo `WinTuner/domplus-prototype` และ deploy อัตโนมัติเมื่อ push `master`
(Root Directory: `line-app` / `backend`, Branch Tracking: `master`) · CI ที่ GitHub มี 2 job: `backend` (pytest + Postgres service) และ `line-app` (syntax + smoke 3 ชุด + ตรวจ script ในหน้า LIFF)

**`line-app/` คือของที่ผู้ใช้เห็นอยู่ตอนนี้** (การ์ดบิล, LIFF, การ์ดยืนยัน) · `backend/` deploy แล้วและมี DB จริง แต่ยังไม่มี UI ให้ผู้ใช้ — เป็นเป้าหมายระยะยาวตาม `docs/API.md`

> มีหน้า LIFF สองใบ: `line-app/liff/bill.html` (ใบที่ OA ใช้จริง) และ `backend/liff/index.html` (หน้าของ stack backend ที่เรียก `/v1/*` ด้วย cookie — ยังไม่ผูกกับ OA) อย่าสับสนเวลาจะแก้ UI ให้ผู้ใช้จริง

## 2. สิ่งที่ต้องสร้าง

1. 🟡 FastAPI app ตาม `docs/API.md` (ทุก endpoint + error code)
   — มีแล้ว: rooms, readings, billing run, invoices, slip, confirm, reject, `/me/invoices`, auth · เหลือ `GET /properties/:id`, `GET /invoices/:id`, webhook
2. ✅ Postgres ตาม `db/schema.sql` + migration (Alembic) — `backend/migrations/`
3. 🟡 Queue + cron (Procrastinate) — โค้ดพร้อม (`app/queue.py` · `app/tasks.py` · `app/dunning.py` · `app/routes/cron.py`) · **ตัวทวงรายวันไม่ต้องมี host แล้ว**: Vercel Cron ยิง `GET /v1/cron/daily` วันละครั้ง แล้ว drain คิวใน invocation เดียว (`run_worker(wait=False)`) เหลือแค่ตั้ง `CRON_SECRET` + สร้างตารางด้วย `python -m app.queue` (CLI `procrastinate schema --apply` ไม่รับ sync connector)
   - ✅ `dunning` — cron รายวัน 1/5/10 วันหลังครบกำหนด (รอตั้ง env + เปิด cron บน production)
   - ⬜ `billing.run` — ออกบิลทั้งหอใน transaction เดียว (ตอนนี้ทำใน request แบบ synchronous แล้ว `job_id` = `null`)
   - ⬜ `notify.invoice` — ส่ง LINE ทีละห้อง + `message_log`
   - ⬜ `slip.verify` — เรียก SlipOK แล้วอัปเดตสถานะ (ตอนนี้ `verify.ok` = `null` เจ้าของกดยืนยันเอง)
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
- [ ] cron ทวงทำงาน 1/5/10 วัน และไม่ส่งซ้ำในวันเดียวกัน — โค้ด + เทสต์พร้อม (`app/routes/cron.py`, `test_cron.py`, `test_dunning.py`) · เหลือตั้ง `CRON_SECRET` + apply schema แล้วรอรอบแรก

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
- สิทธิ์ Neon (มีแล้ว) — ไม่ต้องมี host ของ worker แล้ว (ใช้ Vercel Cron) เว้นแต่จะต้องการส่งถี่กว่ารายวัน

## 8. วิธีรันของจริง

`line-app/` — ตัวที่ deploy อยู่:

```bash
cd line-app && node smoke.js && node smoke-handlers.js && node smoke-reads.js   # offline tests
```

หลัง merge/deploy ตรวจของจริง (ไม่ต้องล็อกอิน):

```bash
node scripts/prod-smoke.mjs              # ทั้งสองโปรเจกต์
LINE_APP=https://… BACKEND=https://… node scripts/prod-smoke.mjs
```

ตรวจ: หน้า LIFF 200 + เป็น build ปัจจุบัน · `/api/me` 401 · `/api/dev` 404 · header nosniff/X-Frame-Options อยู่ถูกที่ · backend `/healthz` ok · `/docs` + `/openapi.json` ปิด · `/v1/rooms` 401 · dunning ปฏิเสธ `?token=`

`backend/` — FastAPI + Postgres:

```bash
cd backend && docker compose up -d && alembic upgrade head
python -m app.seed && uvicorn app.main:app --reload   # http://127.0.0.1:8000/docs
```

prototype เดิม (`server.py` + `web/` + `prototype.html`) ถูกลบแล้ว — ดูได้ใน git history
