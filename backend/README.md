# DormPlus backend

FastAPI + Postgres (Supabase) ตาม [`docs/API.md`](../docs/API.md) และ [`docs/HANDOFF.md`](../docs/HANDOFF.md)

ตอนนี้มี `/healthz`, migration แรก (schema v1), seed หอตัวอย่าง 42 ห้อง, endpoint ห้อง มิเตอร์ ออกบิล รายการบิล,
LINE Login ผ่าน LIFF และ flow แนบสลิป → เจ้าของยืนยัน/ตีกลับ

| Endpoint | ใครเรียกได้ | หมายเหตุ |
|---|---|---|
| `GET /healthz` | ทุกคน | ตรวจว่า DB ตอบ |
| `GET /v1/liff-config` | ทุกคน | `{ "liff_id": ... }` ให้หน้า LIFF เอาไป `liff.init()` (public โดยตั้งใจ) |
| `POST /v1/auth/line` | หน้า LIFF | รับ `id_token` → ตรวจกับ LINE → ตั้ง cookie `dp_session` (7 วัน) · ยังไม่ผูกห้อง → 403 `NOT_LINKED` · ยังไม่ตั้ง `LINE_CHANNEL_ID` → 503 |
| `POST /v1/auth/logout` | ใครก็ได้ | ลบ cookie (204) |
| `GET /v1/me/invoices` | ผู้เช่า | บิลของห้องตัวเอง 12 รอบล่าสุด — ห้องมาจาก session ไม่ใช่ request |
| `GET /v1/rooms?period=YYYY-MM` | เจ้าของหอ | ห้องทั้งหมดของหอใน session พร้อมผู้เช่า มิเตอร์ และบิลของรอบนั้น ไม่ส่ง `period` = เดือนนี้ (เวลาไทย) |
| `PUT /v1/rooms/:id/reading` | เจ้าของหอ | ส่งซ้ำทับค่าเดิมได้ · ออกบิลรอบนั้นแล้ว → 409 · ห้องของหออื่น → 403 |
| `POST /v1/billing/run` | เจ้าของหอ | ทั้งหอใน transaction เดียว · ออกเฉพาะห้องที่พร้อมและยังไม่มีบิล · ไม่มีห้องใหม่ → 409 |
| `GET /v1/invoices?period=&status=` | เจ้าของหอ | บิลของรอบ + `days_overdue` (เฉพาะ `unpaid`) + `summary` ยอดทั้งรอบ |
| `POST /v1/invoices/:id/slip` | ผู้เช่า (ห้องตัวเอง) | แจ้งชำระ → `pending` + แถวใน `payments` · สถานะอื่น → 409 |
| `POST /v1/invoices/:id/confirm` | เจ้าของหอ | `pending` → `paid` + `receipt_no` (`REC-<period>-NNNN`) + `paid_at` |
| `POST /v1/invoices/:id/reject` | เจ้าของหอ | `pending` → `unpaid` พร้อมเหตุผล (ลง `audit_log`) |

หน้า LIFF ผู้เช่าอยู่ที่ `/liff` (เสิร์ฟจาก `backend/liff/`)

## Session

ทุก route ใต้ `/v1` เอา `property_id` จาก session เท่านั้น ไม่รับจาก client (`app/auth.py`)

1. **LINE Login (ของจริง)** — `POST /v1/auth/line` รับ LIFF idToken, ตรวจกับ
   `api.line.me/oauth2/v2.1/verify` (`app/line.py`), หาห้องจาก `tenants.line_user_id`
   แล้วเซ็น cookie `dp_session` (HttpOnly, SameSite=Lax) ด้วย `SESSION_SECRET`
   ต้องตั้ง `LINE_CHANNEL_ID` ก่อน ไม่งั้นตอบ 503 `LINE_NOT_CONFIGURED`
2. **Dev headers (เฉพาะตอนพัฒนา)** — ตั้ง `DEV_AUTH=true` แล้วส่ง header:

```bash
curl -H "X-Dev-Property: p_1" "http://127.0.0.1:8000/v1/rooms?period=2026-11"
curl -X PUT -H "X-Dev-Property: p_1" -H "Content-Type: application/json" \
     -d '{"period":"2026-11","water_now":135,"elec_now":640}' \
     http://127.0.0.1:8000/v1/rooms/r_301/reading
```

`X-Dev-Role` = `owner` (ค่าเริ่มต้น) หรือ `tenant` · `X-Dev-User` = ชื่อที่บันทึกลง `recorded_by`
· `X-Dev-Room` = ห้องของผู้เช่า (จำเป็นสำหรับ `/v1/me/invoices` และการแนบสลิป)

**ห้ามเปิด `DEV_AUTH` บน server จริง** เพราะใครก็ส่ง header เป็นหอไหนก็ได้

## รันในเครื่อง

ต้องมี Python 3.11 ขึ้นไป และ Postgres 1 ตัว (Docker หรือ Supabase ก็ได้)

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate          # macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env            # แก้ DATABASE_URL ถ้าไม่ได้ใช้ Docker
```

```bash
docker compose up -d            # Postgres 17 ที่พอร์ต 5432 พร้อมฐาน domplus และ domplus_test
alembic upgrade head            # สร้างตาราง
python -m app.seed              # หอ p_1 · 42 ห้อง · มิเตอร์ ต.ค. ครบ · พ.ย. 12 ห้อง · บิลค้าง 9 ใบ
uvicorn app.main:app --reload   # http://127.0.0.1:8000/healthz และ /docs
```

seed รันซ้ำได้ ไม่สร้างข้อมูลซ้ำ (ตัวเลขชุดเดียวกับที่ใช้ในเทสต์)

## Test

```bash
pytest
```

test ที่ต้องใช้ฐานข้อมูลจะอ่าน `TEST_DATABASE_URL` ถ้าไม่ได้ตั้งไว้จะถูกข้าม
**ฐานข้อมูลนั้นถูกล้างทุกครั้งที่รัน test** ห้ามชี้ไปที่ฐานข้อมูลจริง

ที่ test อยู่ตอนนี้:
- รูปแบบ error ตามสัญญา (`{"error": {"code", "message"}}`)
- `/healthz` ตอบ 503 เมื่อต่อฐานข้อมูลไม่ได้
- ฐานข้อมูลกันบิลซ้ำเอง (`UNIQUE(room_id, period)`) และรับเฉพาะสถานะบิลที่อยู่ใน state machine
- seed สร้างข้อมูลครบ และรันซ้ำแล้วไม่เปลี่ยนอะไร
- ไม่มี session → 401 · ผู้เช่าเรียก → 403 · หอ B เห็นและแก้ห้องของหอ A ไม่ได้ (403)
- มิเตอร์: คำนวณหน่วยจากเดือนก่อน · ส่งซ้ำทับค่าเดิม · เลขลดลงยังบันทึกแต่เตือน · ห้องที่ยังไม่เคยจดเตือน `NO_PREVIOUS_READING` · ออกบิลแล้วแก้ไม่ได้ (409) · ข้อมูลผิด → 422
- ออกบิล: 42 ห้องใน request เดียว (126 รายการ) · ล้มกลางทาง rollback ทั้งก้อน · กดซ้ำ 409 ไม่สร้างซ้ำ · จดมิเตอร์ทีหลังแล้วกดอีกครั้งออกเฉพาะห้องนั้น · ใช้มิเตอร์เดือนก่อนค่าล่าสุด · ห้องเหมาจ่ายไม่ต้องจด · ห้องว่างข้าม · หอ B ไม่กระทบหอ A
- รายการบิล: `days_overdue` ไม่นับบิลรอตรวจ · `summary` · กรองสถานะ · หอ B ไม่เห็นบิลหอ A
- session cookie: ปลอมแล้วไม่ผ่าน · secret อื่นไม่ผ่าน · หมดอายุไม่ผ่าน · idToken `aud` ไม่ตรง OA → 401 · ยังไม่ตั้ง `LINE_CHANNEL_ID` → 503
- สลิป/ยืนยัน/ตีกลับ: ผู้เช่าแนบได้เฉพาะบิลห้องตัวเอง (ห้องอื่น 404) · สถานะไม่ใช่ `unpaid` → 409 · ยืนยันแล้วได้ `receipt_no` ไม่ซ้ำ · หออื่นยืนยันไม่ได้ · ตีกลับแล้วกลับเป็น `unpaid` + ลง `audit_log`

## Docker

```bash
docker build -t dormplus-backend .        # จาก root ของ repo (Dockerfile คัดลอก backend/ ทั้งโฟลเดอร์)
docker run --rm -p 8000:8000 \
  -e DATABASE_URL=postgresql+psycopg://postgres:postgres@host.docker.internal:5432/domplus \
  dormplus-backend
```

`PORT` ถูกอ่านจาก env (Railway / Cloud Run ใส่ให้เอง) ค่าเริ่มต้น 8000 · ยังไม่รัน migration อัตโนมัติ —
ต้อง `alembic upgrade head` ก่อน start หรือทำเป็น release command ของผู้ให้บริการ

## โครงไฟล์

```
app/main.py        create_app() + /healthz + /v1/liff-config (+ mount /liff)
app/routes/rooms.py    GET /v1/rooms · PUT /v1/rooms/:id/reading
app/routes/billing.py  POST /v1/billing/run · GET /v1/invoices · POST /v1/invoices/:id/{slip,confirm,reject}
app/routes/auth.py     POST /v1/auth/line · POST /v1/auth/logout
app/routes/me.py       GET /v1/me/invoices (ผู้เช่าเห็นบิลตัวเอง)
app/auth.py        current_session (cookie หรือ X-Dev-*) + owner_session / tenant_session
app/session.py     เซ็น/ตรวจ cookie dp_session (stdlib HMAC)
app/line.py        ตรวจ LIFF idToken กับ api.line.me
app/clock.py       วันนี้ตามเวลาไทย (routes รับผ่าน Depends เพื่อให้ test กำหนดวันได้)
app/ids.py         id ของ reading / invoice / payment (rd_201_2026-11, inv_201_2026-11, pay_201_2026-11)
app/config.py      อ่าน DATABASE_URL, DEV_AUTH, LINE_CHANNEL_ID, LIFF_ID, SESSION_SECRET, COOKIE_SECURE
app/db.py          engine (routes รับผ่าน Depends(get_engine) เพื่อให้ test สลับได้)
app/errors.py      ApiError + แปลง error ทุกแบบเป็นรูปแบบในสัญญา
app/seed.py        หอตัวอย่าง 42 ห้อง (python -m app.seed)
liff/index.html    หน้า LIFF ผู้เช่า (เสิร์ฟที่ /liff)
migrations/        Alembic · 0001 = db/schema.sql v1
tests/
Dockerfile         image สำหรับ deploy (context = root ของ repo)
```

## Schema

`migrations/versions/0001_initial_schema.py` คัดลอกมาจาก `db/schema.sql` ต่อจากนี้แก้ schema ด้วยการเพิ่ม migration ใหม่เท่านั้น

```bash
alembic revision -m "add xyz"   # แล้วเขียน op.execute(...) เอง (ไม่มี autogenerate เพราะไม่ใช้ ORM model)
```

RLS เปิดไว้ที่ตาราง rooms, readings, invoices, invoice_items, payments แต่ยังไม่มี policy
ตอนนี้ app ต่อด้วย user เจ้าของตาราง จึงยังไม่โดน RLS กรอง ทุก query กรอง `property_id` จาก session ในโค้ดแทน

## งานถัดไป (HANDOFF ข้อ 6)

- [x] วัน 1–2: schema + migration + seed 42 ห้อง
- [x] วัน 3–4: `/rooms` + `/readings` · LINE Login ผ่าน LIFF → session cookie
- [ ] วัน 3–4 (ค้าง): RLS policy กรอง `property_id`
- [x] วัน 5–6: `/billing/run` + `/invoices` (ยังไม่ส่ง LINE · `job_id` = null)
- [ ] วัน 5–6 (ค้าง): หน้าเจ้าของ (`web/`) ต่อ backend จริง
- [ ] วัน 7–8: Procrastinate worker + ส่ง LINE จริง 1 หอ + `message_log`
- [x] วัน 9–10 (แบบ manual): แนบสลิป → ยืนยัน/ตีกลับ + ใบเสร็จ
- [ ] วัน 9–10 (ค้าง): ตรวจสลิปอัตโนมัติ (`slip.verify` + SlipOK)
- [ ] วัน 11–12: ทวงอัตโนมัติ 1/5/10 วัน + รายงาน
- [ ] วัน 13–14: error code ที่เหลือ, log, backup
