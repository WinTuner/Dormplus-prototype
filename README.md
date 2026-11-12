# DormPlus

> ระบบออกบิลและทวงค่าเช่าหอพัก ที่เจ้าของแค่จดมิเตอร์

Repo นี้มีของจริง 2 ส่วน — เลือกอ่านตามงานที่ทำ

| ส่วน | stack | deploy | เอกสาร |
|---|---|---|---|
| [`line-app/`](line-app/) | Node · Vercel serverless · Vercel Blob · LINE Messaging API + LIFF | **ใช้จริง** — https://line-app-iota.vercel.app | [`line-app/README.md`](line-app/README.md) · [`line-app/docs/`](line-app/docs/) |
| [`backend/`](backend/) | Python · FastAPI · Postgres (Neon) | **ใช้จริง** — https://line-backend-ten.vercel.app | [`backend/README.md`](backend/README.md) |

`line-app/` คือของที่ผู้เช่า/เจ้าของใช้จริง: จดมิเตอร์ → ออกบิล → การ์ดใน LINE → แนบสลิป → เจ้าของยืนยัน
มี **QR ผูกห้อง** (ปริ้นแปะประตู), **QR เพิ่มเจ้าของ/ผู้ช่วย**, **ประวัติบิลย้อนหลัง** และ **rich menu แยกตามบทบาท**

ทั้งสองส่วนใช้สัญญา API เดียวกันเป็นเป้าหมาย: [`docs/API.md`](docs/API.md) · งานที่เหลือและเกณฑ์ "เสร็จ": [`docs/HANDOFF.md`](docs/HANDOFF.md)

```text
line-app/     LINE OA → webhook → Flex bill card → LIFF (บิล/แนบสลิป) → postback ยืนยัน
backend/      FastAPI + Postgres: ห้อง · มิเตอร์ · ออกบิล · สลิป · confirm/reject · LINE Login
db/schema.sql Postgres DDL (migrations ของ backend มาจากไฟล์นี้)
docs/         สัญญา API + handoff
```

## เริ่มใช้งาน LINE app (ของที่ deploy อยู่)

```bash
cd line-app
node smoke.js          # offline test, ไม่ต้อง npm install
```

ต้องมี LINE OA + LIFF + Vercel + Blob ก่อน — ทำตาม [`line-app/README.md`](line-app/README.md) ข้อ 2–6 (สร้าง OA → deploy → ตั้ง env → seed → LIFF → ทดสอบ)

## เริ่มใช้กับหอจริง (3 ขั้น ใน `line-app/`)

1. **ผูกผู้เช่า** — เจ้าของเปิด LIFF → เลือกห้อง → "QR ผู้เช่า" → ปริ้นแปะหน้าประตู
2. **เพิ่มคนช่วย** — หน้าหลัก → "เพิ่มเจ้าของหอ (QR)" เลือก *เจ้าของหอ* หรือ *ผู้ช่วย (ดูอย่างเดียว)*
3. **ออกรอบบิล** — จดมิเตอร์ทีละห้อง → "ออกบิลและส่งเข้า LINE" → เจ้าของยืนยันสลิปในการ์ดในแชท

รายละเอียด (env, rich menu, ปัญหาที่เคยเจอ) อยู่ใน [`line-app/README.md`](line-app/README.md) และ [`line-app/HANDOFF.md`](line-app/HANDOFF.md)

## เริ่มพัฒนา backend

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate
pip install -e ".[dev]"
docker compose up -d          # Postgres 17 (พอร์ต 5432)
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload # http://127.0.0.1:8000/docs
pytest
```

รายละเอียด endpoint, session/cookie, DEV_AUTH และ test ทั้งหมดอยู่ใน [`backend/README.md`](backend/README.md)

## สถานะ

| ส่วน | สถานะ |
|---|---|
| `line-app/` — ส่งบิลใน LINE · LIFF แนบสลิป · เจ้าของยืนยัน/จดมิเตอร์ | ✅ ใช้งานได้ (มีข้อจำกัดเรื่อง auth อ่านใน [`line-app/HANDOFF.md`](line-app/HANDOFF.md)) |
| `backend/` — ห้อง · มิเตอร์ · ออกบิล · รายการบิล · สลิป · confirm/reject + ใบเสร็จ · LINE Login ผ่าน LIFF | 🟡 deploy แล้ว (Vercel + Neon) · test 58 ตัว · ยังไม่มีหน้า UI ฝั่งเจ้าของ |
| RLS policy (กรอง `property_id` ที่ระดับ DB) | ⬜ ตอนนี้กรองในโค้ด |
| ส่งข้อความ LINE / webhook ฝั่ง backend | ⬜ `line-app/` ทำแล้ว แต่ backend ยังไม่ส่งเอง |
| คิวงาน + ทวงอัตโนมัติ (Procrastinate) | ⬜ |
| ตรวจสลิปอัตโนมัติกับธนาคาร | ⬜ ประเมินแล้ว: ตัวฟรี (SlipVerify) ไม่น่าไว้ใจ → ถอยออก · รอเลือกเจ้าที่มีบริษัท/SLA (Checkslip · Check-Slip) |
| หน้าจอเจ้าของของ backend (Thai web UI) | ⬜ `line-app/` มีหน้าจดมิเตอร์ของเจ้าของแล้ว |
| QR ผูกผู้เช่ากับห้อง | ✅ `GET/POST /api/qr?room=` (เจ้าของสร้าง/หมุน) · ผู้เช่าสแกน → ผูกทันที |
| หลายเจ้าของ + ผู้ช่วย (ดูอย่างเดียว) | ✅ QR จากเจ้าของเดิม · สิทธิ์ `owner` / `viewer` · `/api/me` คืน `role` |
| ประวัติบิลย้อนหลัง | ✅ `bill:<period>:<room>` + หน้าดูย้อนหลังใน LIFF (เริ่มนับจากรอบที่ออกหลังฟีเจอร์นี้) |
| Rich menu 2 ชุด | ✅ เจ้าของ 6 ช่อง (2500×1686) · ผู้เช่า 3 ช่อง compact (2500×843) · สลับอัตโนมัติตามสิทธิ์ |

## กติกาที่ใส่ไว้ในระบบ

- รอบบิลรายเดือน · ครบกำหนด +5 วันหลังออกบิล
- น้ำ 25 บาท/หน่วย · ไฟ 7 บาท/หน่วย · ค่าเช่า 3,220 (มิเตอร์) / 3,500 (เหมา)
- **ไม่คิดค่าปรับล่าช้า** — ใช้การแจ้งเตือนและสถานะค้างชำระแทน
- ออกบิลซ้ำไม่ได้ (`UNIQUE(room_id, period)`)
- ค่ามิเตอร์น้อยกว่าครั้งก่อน → ขึ้นคำเตือนก่อนบันทึก

## Rich Menu ที่ออกแบบไว้

| เจ้าของหอ | ผู้เช่า |
|---|---|
| ![owner](docs/richmenu-owner.png) | ![tenant](docs/richmenu-tenant.png) |

ขนาด 2500×1686 px (LINE large rich menu) — ใช้กับ `line-app/` ได้เลย

## เอกสาร

- [`line-app/README.md`](line-app/README.md) — ตั้งค่า OA/LIFF/deploy + troubleshooting ของ app ที่ใช้จริง
- [`line-app/docs/`](line-app/docs/) — architecture · API · configuration · deployment · development · testing
- [`backend/README.md`](backend/README.md) — endpoint, session, test
- [`docs/API.md`](docs/API.md) — สัญญา API v1 (เป้าหมายที่ backend ยึด)
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — งานที่เหลือและเกณฑ์ "เสร็จ"
- [`db/schema.sql`](db/schema.sql) — โครงฐานข้อมูล Postgres

> prototype ตัวเดิม (`server.py` + `web/` + `prototype.html` บน SQLite) ถูกลบออกจาก master แล้ว —
> ดูย้อนหลังได้ใน git history ก่อน commit ที่ลบ

## สิทธิ์การใช้งาน

โปรเจกต์นี้ไม่ใช่ open source และไม่มีไฟล์ `LICENSE` ในรีโป — สิทธิ์เป็นของเจ้าของโครงการ
