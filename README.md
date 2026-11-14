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
node smoke.js && node smoke-handlers.js && node smoke-reads.js   # offline tests, ไม่ต้อง npm install
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

## สองครึ่งของระบบ — คุยกันแบบไหน

`line-app/` กับ `backend/` เป็น **สองสแตกอิสระ** — ไม่มีโค้ดร่วม ไม่มีฐานข้อมูลร่วม และ **ไม่เรียก HTTP หากัน** · deploy แยกเป็น 2 โปรเจกต์ Vercel (root directory คนละโฟลเดอร์)

```text
LINE Platform ──webhook──▶ line-app/ ──▶ Vercel Blob (kv/*.json, slips/*)
                              └─ LIFF bill.html (ล็อกอินด้วย idToken)

backend/ ──▶ Postgres (Neon)      ← ไม่ได้รับ webhook จาก LINE OA
   ▲
docs/API.md ← สัญญา v1 ที่ทั้งคู่ยึด (เป็นข้อตกลง ไม่ใช่การเชื่อมต่อ)
```

- **LINE OA มี webhook ปลายทางเดียวคือ `line-app`** → `/api/webhook` · `backend/` ไม่มี route รับ webhook (สัญญาข้อ `POST /webhooks/line/:property_id` ยัง ⬜ ใน [`docs/API.md`](docs/API.md))
- **ข้อมูลอยู่คนละที่** — ที่จดใน LIFF จะไม่โผล่ใน Postgres และกลับกัน · การย้ายไปที่เดียวเป็นงานใน [`docs/HANDOFF.md`](docs/HANDOFF.md)
- **สัญญาเดียวคือ `docs/API.md`** — แก้ path หรือรูป JSON ต้องแก้ฝั่ง backend และหน้า LIFF ให้ตรงกัน

| เรื่อง | `line-app/` | `backend/` |
|---|---|---|
| เก็บข้อมูล | Vercel Blob: `kv/*.json` + `slips/*` | Postgres (Neon) ตาม [`db/schema.sql`](db/schema.sql) |
| ทางเข้า | LINE webhook · หน้า LIFF (`liff/bill.html`) | `/liff` ของ backend · curl · pytest |
| auth | LINE idToken ทุก request (`api/_auth.js`) | cookie `dp_session` จาก LINE Login หรือ `X-Dev-*` ตอน dev |
| ส่งข้อความ LINE | reply + push ในการ์ดบิล | push เตือนผ่านคิว (`app/line_push.py`) |
| cron / คิว | ไม่มี | Vercel Cron → Procrastinate (หัวข้อถัดไป) |
| dependency | `@vercel/blob`, `qrcode-svg` | FastAPI · SQLAlchemy · Alembic · procrastinate |

## ทดสอบ (ไม่ต้องต่อเน็ต)

**`line-app/`** — ไม่ต้อง `npm install` ก็รันได้ (ใช้ `node:assert` ล้วน):

```bash
cd line-app
node smoke.js           # signature ของ webhook + รูปร่าง Flex card
node smoke-handlers.js  # dev gate, QR binding, rate limit, confirm, ออกบิล
node smoke-reads.js     # concurrency ของ read, ลำดับ, history, สิทธิ์
npm test                # รันทั้งสามตัวตามลำดับ
```

**`backend/`** — ต้องมี Postgres ก่อน (test ที่ต้องใช้ DB จะถูกข้ามถ้าไม่ได้ตั้ง `TEST_DATABASE_URL`):

```bash
cd backend
docker compose up -d
TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test pytest -q
```

⚠️ ฐานข้อมูลใน `TEST_DATABASE_URL` **ถูกล้างทุกครั้งที่รัน** — ห้ามชี้ไปที่ Neon ตัวจริง

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml), workflow `ci`) รันทั้งสองชุดบน push เข้า `master` และทุก PR: job `line-app` ตรวจ syntax ทุก `api/*.js` + inline script ของ `liff/bill.html` แล้วรัน smoke ทั้งสาม · job `backend` ยก Postgres 16 ขึ้นมาแล้ว `pytest -q`

## Cron รายวัน + คิว (backend)

[`backend/vercel.json`](backend/vercel.json) ตั้ง Vercel Cron ไว้แล้ว:

```json
{ "crons": [{ "path": "/v1/cron/daily", "schedule": "0 2 * * *" }] }
```

02:00 UTC = 09:00 เวลาไทย · Vercel ยิง `GET` มาที่ `/v1/cron/daily` และใส่ `Authorization: Bearer $CRON_SECRET` ให้เองถ้าตั้ง env `CRON_SECRET` ไว้บนโปรเจกต์ (ชื่อเก่า `DUNNING_TOKEN` ก็รับ)

สิ่งที่ endpoint ทำใน invocation เดียว ([`backend/app/routes/cron.py`](backend/app/routes/cron.py)):

1. ตรวจ token ด้วย `hmac.compare_digest` — ไม่มี token หรือไม่ตรง → 401 (token ทาง query string ถูกปฏิเสธ)
2. เลือกบิล `unpaid` ที่เลยกำหนด 1 / 5 / 10 วัน และยังไม่เคยส่ง kind นั้น
3. enqueue งาน `line.push_text` แล้ว **drain คิวในโปรเซสเดียวกัน** (`run_worker_async(wait=False)`) — ไม่ต้องมี worker ค้าง
4. ตอบ `{ "queued": n, "drained": true }` · ถ้ายังไม่ได้สร้างตาราง procrastinate → 503 `QUEUE_UNAVAILABLE`

```bash
python -m app.queue                                  # ครั้งเดียวต่อฐานข้อมูล (สร้างตารางของ procrastinate)
curl -H "Authorization: Bearer $CRON_SECRET" https://line-backend-ten.vercel.app/v1/cron/daily
```

ต้องมี `LINE_CHANNEL_ACCESS_TOKEN` ด้วย ไม่งั้น task จะ log `skipped` แทนที่จะส่ง · ถ้าอยากส่งถี่กว่านี้ให้รัน `procrastinate -a app.queue.app worker` บน host ที่ค้างได้ ชี้ Postgres ตัวเดียวกัน

> ตาราง "สถานะ" ด้านบนยังไม่ได้อัปเดตข้อคิว/ทวงอัตโนมัติ — ของจริงทำแล้วตามหัวข้อนี้

## ตรวจ production หลัง deploy

```bash
node scripts/prod-smoke.mjs
LINE_APP=https://... BACKEND=https://... node scripts/prod-smoke.mjs
```

[`scripts/prod-smoke.mjs`](scripts/prod-smoke.mjs) ไม่มี dependency (ใช้ `fetch` ของ Node 20+) และตรวจเฉพาะสิ่งที่ไม่ต้องล็อกอิน:

- หน้า LIFF ตอบ 200 และเป็น build ปัจจุบัน (`qr-ph` อยู่ในหน้า)
- `/api/config` ตอบ 200 · API มี `X-Content-Type-Options: nosniff` + `X-Frame-Options: DENY` · หน้า LIFF **ไม่** ถูก frame-deny (LINE ต้องฝังได้)
- `/api/me` ไม่มี token → 401 · `/api/dev` บน production → 404
- backend `/healthz` = `{"status":"ok"}` · `/docs` และ `/openapi.json` → 404
- `/v1/rooms` ไม่มี session → 401 · `/v1/dunning/run?token=` → 401 (ไม่รับ token ทาง query) · `/v1/cron/daily` ไม่มี secret → 401

exit code 1 ถ้ามีข้อไหนตก — ใช้เป็น gate หลัง merge ได้เลย

## แผนที่เอกสาร

| เอกสาร | อ่านเมื่อ |
|---|---|
| [`line-app/docs/GETTING-STARTED.md`](line-app/docs/GETTING-STARTED.md) | เริ่มจากศูนย์บนเครื่อง → smoke → deploy ครั้งแรก |
| [`line-app/docs/ARCHITECTURE.md`](line-app/docs/ARCHITECTURE.md) | อยากเข้าใจเส้นทาง request, Blob key, สิทธิ์ |
| [`line-app/docs/API.md`](line-app/docs/API.md) | endpoint ของ `line-app` ทีละตัว |
| [`line-app/docs/CONFIGURATION.md`](line-app/docs/CONFIGURATION.md) | env ทั้งหมดของ `line-app` + ค่า default |
| [`line-app/docs/DEVELOPMENT.md`](line-app/docs/DEVELOPMENT.md) | เพิ่ม handler/endpoint · convention · branch/PR |
| [`line-app/docs/TESTING.md`](line-app/docs/TESTING.md) | smoke test เชิงลึก + manual matrix + LINE e2e |
| [`line-app/docs/DEPLOYMENT.md`](line-app/docs/DEPLOYMENT.md) | deploy · rich menu · rollback |
| [`docs/API.md`](docs/API.md) | สัญญา v1 (เป้าหมายของ backend) |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | งานที่เหลือ + เกณฑ์ "เสร็จ" |
| [`backend/README.md`](backend/README.md) | endpoint · session · migration · test ของ backend |

> เอกสารเชิงลึกชุด `ARCHITECTURE` / `CONFIGURATION` / `GETTING-STARTED` / `DEVELOPMENT` / `TESTING` / `DEPLOYMENT` อยู่ใต้ `line-app/docs/` และครอบเฉพาะครึ่ง LINE app — ฝั่ง backend สรุปไว้ใน `backend/README.md`

## สิทธิ์การใช้งาน

โปรเจกต์นี้ไม่ใช่ open source และไม่มีไฟล์ `LICENSE` ในรีโป — สิทธิ์เป็นของเจ้าของโครงการ
