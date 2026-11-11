# DomPlus backend

FastAPI + Postgres (Supabase) ตาม [`docs/API.md`](../docs/API.md) และ [`docs/HANDOFF.md`](../docs/HANDOFF.md)

ตอนนี้มี `/healthz`, migration แรก (schema v1), seed หอตัวอย่าง 42 ห้อง และ endpoint ห้อง มิเตอร์ ออกบิล และรายการบิล

| Endpoint | ใครเรียกได้ | หมายเหตุ |
|---|---|---|
| `GET /v1/rooms?period=YYYY-MM` | เจ้าของหอ | ห้องทั้งหมดของหอใน session พร้อมผู้เช่า มิเตอร์ และบิลของรอบนั้น ไม่ส่ง `period` = เดือนนี้ (เวลาไทย) |
| `PUT /v1/rooms/:id/reading` | เจ้าของหอ | ส่งซ้ำทับค่าเดิมได้ · ออกบิลรอบนั้นแล้ว → 409 · ห้องของหออื่น → 403 |
| `POST /v1/billing/run` | เจ้าของหอ | ทั้งหอใน transaction เดียว · ออกเฉพาะห้องที่พร้อมและยังไม่มีบิล · ไม่มีห้องใหม่ → 409 |
| `GET /v1/invoices?period=&status=` | เจ้าของหอ | บิลของรอบ + `days_overdue` (เฉพาะ `unpaid`) + `summary` ยอดทั้งรอบ |

## Session (ชั่วคราว จนกว่าจะมี LINE Login)

ทุก route ใต้ `/v1` เอา `property_id` จาก session เท่านั้น ไม่รับจาก client (`app/auth.py`)
ตอนนี้ยังไม่มี LINE Login จึงตอบ 401 ทุก request ยกเว้นตั้ง `DEV_AUTH=true` แล้วส่ง header:

```bash
curl -H "X-Dev-Property: p_1" "http://127.0.0.1:8000/v1/rooms?period=2026-11"
curl -X PUT -H "X-Dev-Property: p_1" -H "Content-Type: application/json" \
     -d '{"period":"2026-11","water_now":135,"elec_now":640}' \
     http://127.0.0.1:8000/v1/rooms/r_301/reading
```

`X-Dev-Role` = `owner` (ค่าเริ่มต้น) หรือ `tenant` · `X-Dev-User` = ชื่อที่บันทึกลง `recorded_by`
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

seed รันซ้ำได้ ไม่สร้างข้อมูลซ้ำ ตัวเลขมิเตอร์ตรงกับ prototype (`server.py`)

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

## โครงไฟล์

```
app/main.py        create_app() + /healthz
app/routes/rooms.py    GET /v1/rooms · PUT /v1/rooms/:id/reading
app/routes/billing.py  POST /v1/billing/run · GET /v1/invoices
app/auth.py        session (property_id + role) · ตอนนี้เป็น DEV_AUTH ชั่วคราว
app/clock.py       วันนี้ตามเวลาไทย (routes รับผ่าน Depends เพื่อให้ test กำหนดวันได้)
app/ids.py         id ของ reading / invoice (rd_201_2026-11, inv_201_2026-11)
app/config.py      อ่าน DATABASE_URL, DEV_AUTH จาก env หรือ .env
app/db.py          engine (routes รับผ่าน Depends(get_engine) เพื่อให้ test สลับได้)
app/errors.py      ApiError + แปลง error ทุกแบบเป็นรูปแบบในสัญญา
app/seed.py        หอตัวอย่าง 42 ห้อง (python -m app.seed)
migrations/        Alembic · 0001 = db/schema.sql v1
tests/
```

## Schema

`migrations/versions/0001_initial_schema.py` คัดลอกมาจาก `db/schema.sql` ต่อจากนี้แก้ schema ด้วยการเพิ่ม migration ใหม่เท่านั้น

```bash
alembic revision -m "add xyz"   # แล้วเขียน op.execute(...) เอง (ไม่มี autogenerate เพราะไม่ใช้ ORM model)
```

RLS เปิดไว้ที่ตาราง rooms, readings, invoices, invoice_items, payments แต่ยังไม่มี policy
ตอนนี้ app ต่อด้วย user เจ้าของตาราง จึงยังไม่โดน RLS กรอง policy จะเพิ่มตอนทำ auth (กรองด้วย `property_id` จาก session)

## งานถัดไป (HANDOFF ข้อ 6)

- [x] วัน 1–2: schema + migration + seed 42 ห้อง
- [x] วัน 3–4 (ส่วนแรก): `/rooms` + `/readings` บน session ชั่วคราว
- [ ] วัน 3–4 (ส่วนที่เหลือ): LINE Login แทน DEV_AUTH + RLS policy (รอ LINE Channel ID)
- [x] วัน 5–6: `/billing/run` + `/invoices` (ยังไม่ส่ง LINE · `job_id` = null)
- [ ] วัน 7 ขึ้นไป: Procrastinate worker, LINE, สลิป, ทวง
