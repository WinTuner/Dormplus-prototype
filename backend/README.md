# DomPlus backend

FastAPI + Postgres (Supabase) ตาม [`docs/API.md`](../docs/API.md) และ [`docs/HANDOFF.md`](../docs/HANDOFF.md)

ตอนนี้มีแค่โครง: `/healthz`, migration แรก (schema v1) และ seed หอตัวอย่าง 42 ห้อง ยังไม่มี endpoint `/v1/*`

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

## โครงไฟล์

```
app/main.py        create_app() + /healthz
app/config.py      อ่าน DATABASE_URL จาก env หรือ .env
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
- [ ] วัน 3–4: auth LINE + `/rooms` + `/readings`
- [ ] วัน 5–6: `/billing/run` + `/invoices`
- [ ] วัน 7 ขึ้นไป: Procrastinate worker, LINE, สลิป, ทวง
