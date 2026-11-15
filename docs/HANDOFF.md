# DormPlus — Handoff: backend

เอกสารส่งงานสำหรับคนรับช่วง back-end · อัปเดต 14 พ.ย. 2569

## 1. ตอนนี้มีอะไรแล้ว

| ส่วน | สถานะ | ที่อยู่ |
|---|---|---|
| Rich menu 2 ชุด | เสร็จ | `docs/richmenu-*.png` |
| API contract | เสร็จ | `docs/API.md` |
| Schema Postgres | เสร็จ | `db/schema.sql` (snapshot อ่านอย่างเดียว) · ตัวที่รันจริงคือ `backend/migrations/` (alembic ถึง `0004` = RLS) |
| Backend จริง (FastAPI + Postgres) | บางส่วน | `backend/` — rooms, readings, billing run, invoices, slip/confirm/reject, LINE Login |
| LINE app ที่ deploy จริง | ใช้ได้ | `line-app/` (Vercel + Blob + LIFF) — ส่งบิล/แนบสลิป/ยืนยันในแชท · ดู `line-app/HANDOFF.md` |
| LINE OA / LIFF / auth (backend) | บางส่วน | LIFF login + session cookie เสร็จ · **ส่งข้อความ LINE ได้แล้ว** (`app/line_push.py` + คิว `app/tasks.py`) · **webhook รับ event มีแล้ว** (`POST /v1/webhooks/line/:property_id` ตรวจ signature → `audit_log`) แต่ OA ยังชี้ที่ `line-app/` และยังไม่มี handler ตอบผู้ใช้ · หน้า LIFF ของ backend อยู่ที่ `backend/liff/` |
| Deploy: `line-app` | ✅ | Vercel · auto จาก `master` · https://line-app-iota.vercel.app |
| Deploy: `backend` | ✅ | Vercel (serverless) · auto จาก `master` · https://line-backend-ten.vercel.app |
| Database จริง | ✅ | Neon Postgres (Vercel Marketplace) · schema `0004` + seed 42 ห้อง · app ต่อด้วย role `dormplus_app` (ไม่มี BYPASSRLS, ต้องมีเพื่อให้ RLS ทำงาน) · `backend/.env` (ไม่อยู่ใน git) |

**สถานะ infra:** ทั้งสองโปรเจกต์ Vercel ผูก repo `WinTuner/Dormplus-prototype` และ deploy อัตโนมัติเมื่อ push `master`
(Root Directory: `line-app` / `backend`, Branch Tracking: `master`) · CI ที่ GitHub มี 2 job: `backend` (pytest + Postgres service) และ `line-app` (syntax + smoke 5 ชุด: `smoke.js`, `smoke-handlers.js`, `smoke-reads.js`, `smoke-usecases.js`, `smoke-cron.js` + ตรวจ script ในหน้า LIFF)

**`line-app/` คือของที่ผู้ใช้เห็นอยู่ตอนนี้** (การ์ดบิล, LIFF, การ์ดยืนยัน) · `backend/` deploy แล้วและมี DB จริง แต่ยังไม่มี UI ให้ผู้ใช้ — เป็นเป้าหมายระยะยาวตาม `docs/API.md`

> มีหน้า LIFF สองใบ: `line-app/liff/bill.html` (ใบที่ OA ใช้จริง) และ `backend/liff/index.html` (หน้าของ stack backend ที่เรียก `/v1/*` ด้วย cookie — ยังไม่ผูกกับ OA) อย่าสับสนเวลาจะแก้ UI ให้ผู้ใช้จริง

## 2. สิ่งที่ต้องสร้าง

1. ✅ FastAPI app ตาม `docs/API.md` (ทุก endpoint + error code)
   — ครบทุกข้อในสัญญา: rooms, properties, readings, billing run (+ ส่งข้อความบิลเข้า LINE), invoices, invoice detail, reports summary, slip, confirm, reject, `/me/invoices`, auth, webhook (ตรวจ signature + กัน event ซ้ำ)
2. ✅ Postgres ตาม `db/schema.sql` + migration (Alembic) — `backend/migrations/`
3. 🟡 Queue + cron (Procrastinate) — โค้ดพร้อม (`app/queue.py` · `app/tasks.py` · `app/dunning.py` · `app/routes/cron.py`) · **`backend/vercel.json` ไม่มี `crons` แล้ว (ตั้งใจ)** เพราะ `line-app` เป็นเจ้าของการทวงรายวันอยู่ (`line-app/api/cron.js` + `_remind.js`, Vercel Cron `0 2 * * *`) — ถ้าเปิดทั้งคู่ผู้เช่าที่ผูกทั้งสองระบบจะได้เตือนสองชุด · endpoint `GET /v1/cron/daily` ยังใช้ยิงมือ/ทดสอบได้ (drain คิวใน invocation เดียวด้วย `run_worker(wait=False)`) · ถ้าจะย้ายการทวงมา backend: เปิด `crons` กลับ + ตั้ง `CRON_SECRET` + สร้างตารางด้วย `python -m app.queue` แล้วปิด cron ของ `line-app` (CLI `procrastinate schema --apply` ไม่รับ sync connector)
   - ✅ `dunning` — ตัวทวงรายวันเดินอยู่ที่ `line-app` แล้ว (1/3 วันก่อนครบกำหนด, วันครบกำหนด, 1/5/10 วันหลัง) · ฝั่ง backend เป็นโค้ดที่ยังไม่ถูกตั้งเวลา (ไม่มี `crons` โดยตั้งใจ)
   - ✅ `billing.run` — ออกบิลทั้งหอใน transaction เดียว และส่งข้อความบิลเข้า LINE หลัง commit (enqueue 1 งานต่อใบ + drain ในคำขอเดียวกัน · คิวไม่พร้อม = `queued: 0` ไม่ทำให้บิลที่บันทึกแล้วล้ม)
   - ✅ `notify.invoice` — `app/notify.py` + `line.push_text` kind `invoice` + `message_log` (ผู้เช่าคนเดียวต่อห้องตามสูตร dunning)
   - ⬜ `slip.verify` — เรียก SlipOK แล้วอัปเดตสถานะ (ตอนนี้ `verify.ok` = `null` เจ้าของกดยืนยันเอง)
4. ✅ Auth: LINE Login → ตรวจ idToken → session cookie → resolve `property_id` — เสร็จแล้ว · **RLS ใช้งานจริงแล้ว** (migration `0004`: force RLS + policy กรองด้วย `app.property_id` ที่ตั้งต่อ connection ใน `app/db.py`)
5. ✅ Webhook LINE — `POST /v1/webhooks/line/:property_id` ตรวจ `X-Line-Signature` (HMAC ของ raw body) แล้วเขียน `audit_log` · event ซ้ำถูกกันด้วย `webhookEventId` (ตาราง `line_events`, migration `0005`) · **ยังไม่ผูกช่องทาง** (webhook ของ OA ชี้ที่ `line-app`) และยังไม่มี handler ที่ตอบผู้ใช้

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
- [x] ส่ง LINE ครบ 42 ห้อง และ `message_log` มี 42 แถว — พิสูจน์ด้วยเทสต์ (`backend/tests/test_billing.py::test_all_42_bills_reach_the_tenant_and_the_message_log`: ผูก LINE 42 ห้อง → ออกบิล → รันงานที่เข้าคิวด้วย LINE ที่ stub → `message_log` 42 แถว `kind='invoice'`) · **ยังไม่เคยส่งจริงหาผู้เช่า** (ต้องมีผู้เช่าจริงผูก LINE + คิวถูก apply schema บนฐานจริง)
- [x] กดออกบิลซ้ำ → 409 ไม่สร้างซ้ำ — `backend/tests/test_billing.py`
- [x] ผู้เช่าแนบสลิป → `pending` → เจ้าของยืนยัน → `paid` + ใบเสร็จ — `backend/tests/test_slip_confirm_reject.py`
- [ ] สลิปยอดไม่ตรง → ไม่ผ่านอัตโนมัติ
- [x] เรียก API ของหอ A ด้วย session หอ B → 403 — `backend/tests/test_rooms.py`
- [x] ทวงรายวัน (1–3 วันก่อนครบกำหนด · วันครบกำหนด · 1/5/10 วันหลัง) และไม่ส่งซ้ำในวันเดียวกัน — เดินอยู่ที่ `line-app/api/cron.js` + `_remind.js` (Vercel Cron 09:00 ไทย, dedup ต่อ `rev`, `cron-lock` กันรอบซ้อน; ยังเป็น at-least-once) · เทสต์ `line-app/smoke-cron.js` · ฝั่ง backend (`app/routes/cron.py`, `test_cron.py`, `test_dunning.py`) ยังเป็นโค้ดที่ไม่ถูกตั้งเวลา

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
