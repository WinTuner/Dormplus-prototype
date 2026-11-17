# DormPlus

> ระบบออกบิลและทวงค่าเช่าหอพัก ที่เจ้าของแค่จดมิเตอร์

Repo นี้มีของจริง 2 ส่วน — เลือกอ่านตามงานที่ทำ

| ส่วน | stack | deploy | เอกสาร |
|---|---|---|---|
| [`line-app/`](line-app/) | Node · Vercel serverless · Vercel Blob หรือ Cloudflare R2 · LINE Messaging API + LIFF | **ใช้จริง** — https://line-app-iota.vercel.app | [`line-app/README.md`](line-app/README.md) · [`line-app/docs/`](line-app/docs/) |
| [`backend/`](backend/) | Python · FastAPI · Postgres (Neon) | **ใช้จริง** — https://line-backend-ten.vercel.app | [`backend/README.md`](backend/README.md) |

`line-app/` คือของที่ผู้เช่า/เจ้าของใช้จริง: จดมิเตอร์ → ออกบิล → การ์ดใน LINE → แนบสลิป → เจ้าของยืนยัน
มี **QR ผูกห้อง** (ปริ้นแปะประตู), **QR เพิ่มเจ้าของ/ผู้ช่วย**, **ประวัติบิลย้อนหลัง** และ **rich menu แยกตามบทบาท**
เพิ่มภายหลัง: **สลิปโอนก่อนบิลออก** (`prepay:<room>` ผูกกับบิลรอบถัดไปให้เอง) · **ใบเสร็จ** (`receiptNo`) · **ยกเลิกบิลพร้อมยอดที่ต้องคืน** (`refundDue`) · **สลิปเดียวจ่ายหลายรอบ** · **ทวงอัตโนมัติวันละครั้งผ่าน Vercel Cron** (`GET /api/cron`) · **ผู้เช่าใหม่ไม่เห็นบิลของผู้เช่าคนก่อน** (`tenancy:<room>` + `issuedAt`) · **ตรวจสลิปอัตโนมัติผ่าน SlipOK** (`api/_verify.js` — ยอด · บัญชีผู้รับ · สลิปซ้ำ; เปิดเมื่อตั้ง `SLIPOK_API_KEY` + `SLIPOK_BRANCH_ID`) · **แก้ไขราคาห้องรายห้อง** (`POST /api/rooms` — มีผลกับบิลที่ออกหลังจากนั้น)

ทั้งสองส่วนใช้สัญญา API เดียวกัน: [`docs/API.md`](docs/API.md) — ทุก endpoint ในสัญญาทำครบแล้ว (ตัวสุดท้ายคือ `GET /v1/reports/summary`) · งานที่เหลือและเกณฑ์ "เสร็จ": [`docs/HANDOFF.md`](docs/HANDOFF.md)

```text
line-app/     LINE OA → webhook → Flex bill card → LIFF (บิล/แนบสลิป) → postback ยืนยัน
backend/      FastAPI + Postgres: ห้อง · มิเตอร์ · ออกบิล · สลิป · confirm/reject · LINE Login
db/schema.sql Postgres DDL (migrations ของ backend มาจากไฟล์นี้)
docs/         เอกสารทั้ง repo: API · สถาปัตยกรรม · config · deploy · test cases · handoff
```

## เริ่มใช้งาน LINE app (ของที่ deploy อยู่)

```bash
cd line-app
node smoke.js && node smoke-handlers.js && node smoke-reads.js   # offline tests, ไม่ต้อง npm install
node smoke-usecases.js   # 168 use case ที่ automate ได้ (ชุดเดียวกับ docs/TEST-CASES.md)
node smoke-cron.js       # แจ้งเตือนรายวัน /api/cron + cron-lock
```

ต้องมี LINE OA + LIFF + Vercel + Blob ก่อน — ทำตาม [`line-app/README.md`](line-app/README.md) ข้อ 2–7 (สร้าง OA → deploy → ตั้ง env → seed → LIFF → ทดสอบ)

## เริ่มใช้กับหอจริง (3 ขั้น ใน `line-app/`)

1. **ผูกผู้เช่า** — เจ้าของเปิด LIFF → เลือกห้อง → "QR ผู้เช่า" → ปริ้นแปะหน้าประตู
2. **เพิ่มคนช่วย** — หน้าหลัก → "เพิ่มเจ้าของหอ (QR)" เลือก *เจ้าของหอ* หรือ *ผู้ช่วย (ดูอย่างเดียว)*
3. **ออกรอบบิล** — จดมิเตอร์ทีละห้อง → "ออกบิลและส่งเข้า LINE" → เจ้าของยืนยันสลิปในการ์ดในแชท

หลังเจ้าของยืนยัน ผู้เช่าเห็นใบเสร็จ (`receiptNo`) ในการ์ด · ผู้เช่าที่โอนก่อนบิลออกแนบสลิปไว้ได้ ระบบผูกให้รอบถัดไป · ออกบิลผิดให้ยกเลิก (void) แล้วออกใหม่ ระบบเก็บยอดที่ต้องคืน (`refundDue`) ไว้ให้

ราคาห้องแก้ได้จากปุ่ม **"แก้ไขราคาห้อง"** (ค่าเช่า/ค่าน้ำ/ค่าไฟ รายห้อง) — มีผลกับบิลที่ออกหลังจากนั้น บิลที่ออกไปแล้วแก้ไม่ได้

รายละเอียด (env, rich menu, ปัญหาที่เคยเจอ) อยู่ใน [`line-app/README.md`](line-app/README.md) และ [`line-app/HANDOFF.md`](line-app/HANDOFF.md)

## เริ่มพัฒนา backend

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate
pip install -e ".[dev]"
docker compose up -d          # Postgres 17 (พอร์ต 5432)
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload # http://127.0.0.1:8000/docs · หน้าเจ้าของที่ /owner (ต้องตั้ง OWNER_ACCESS_CODE)
pytest
```

รายละเอียด endpoint, session/cookie, DEV_AUTH และ test ทั้งหมดอยู่ใน [`backend/README.md`](backend/README.md)

## สถานะ

| ส่วน | สถานะ |
|---|---|
| `line-app/` — ส่งบิลใน LINE · LIFF แนบสลิป · เจ้าของยืนยัน/จดมิเตอร์ | ✅ ใช้งานได้ (ข้อจำกัดที่เหลือ: [`line-app/README.md`](line-app/README.md) หัวข้อ "ข้อจำกัดที่ยังเหลือ") |
| `backend/` — ห้อง · มิเตอร์ · ออกบิล · รายการบิล · สลิป · confirm/reject + ใบเสร็จ · LINE Login ผ่าน LIFF · **หน้าจอเจ้าของหอที่ `/owner`** | 🟡 deploy แล้ว (Vercel + Neon) · 150 tests (15 ไฟล์; ไม่มี Postgres = 25 ผ่าน / 125 ข้าม · CI รันครบพร้อม Postgres) · หน้า `/owner` ล็อกอินด้วยรหัสหอ (`OWNER_ACCESS_CODE`) ไม่ใช่ LINE |
| สรุปรายรับรายงวด (`GET /v1/reports/summary?period=`, เจ้าของ) | ✅ billed/paid/pending/unpaid + `rooms_total`/`rooms_paid`/`rooms_overdue` · `billed` = paid + pending + unpaid (ไม่นับบิล void) · ไม่ใส่ `period` = เดือนปัจจุบัน — เป็น endpoint สุดท้ายที่ค้างในสัญญา |
| RLS policy (กรอง `property_id` ที่ระดับ DB) | ✅ migration `0004` — `force row level security` ทุกตารางที่ผูกหอ (ยกเว้น `auth_failures`) · production ต้องต่อด้วย role ที่ไม่ `BYPASSRLS` (เช่น `dormplus_app`) ไม่งั้น policy ไม่มีผล |
| ส่งข้อความ LINE ฝั่ง backend | ✅ `app/line_push.py` + คิว `app/tasks.py` (ทวงค่าเช่า + ส่งบิลเมื่อออกบิล) · webhook รับ event มีแล้ว (`POST /v1/webhooks/line/:property_id`, ตรวจ signature) แต่ OA ยังชี้ที่ `line-app/` |
| Webhook ซ้ำ (LINE retry) | ✅ ตาราง `line_events` (migration `0005`, forced RLS, `on conflict do nothing`) — `webhookEventId` เดิมที่ส่งซ้ำเขียน `audit_log` แค่แถวเดียว · ไม่ได้ตั้ง `LINE_CHANNEL_SECRET` → `503 LINE_NOT_CONFIGURED` |
| คิวงาน + ทวงอัตโนมัติ (Procrastinate) | ✅ `queue.py` · `dunning.py` (1/5/10 วัน) · `GET /v1/cron/daily` ให้ Vercel Cron เรียกวันละครั้งแล้ว drain คิวใน invocation เดียว |
| ตรวจสลิปอัตโนมัติกับธนาคาร | ✅ `line-app` ต่อ SlipOK (`api/_verify.js`, เรียกจาก `api/slip.js`) — ยอดไม่ตรง (`1013`) · บัญชีผู้รับไม่ใช่ของหอ (`1014`) · สลิปซ้ำ (`1012`); ผลอยู่บน `bill.slipVerify` เป็น `ok:true|false|null` โดย `ok:null` = **ตรวจไม่ได้** ไม่ใช่ของปลอม · เปิดเมื่อตั้ง env `SLIPOK_API_KEY` + `SLIPOK_BRANCH_ID` ครบทั้งคู่ · **ปิดบิลเองอัตโนมัติ**: สลิปบิลรายเดือน (เดือนเดียวหรือหลายเดือน) ที่รูปใหม่ตรวจผ่านครบ `ok === true` → `paid` + ใบเสร็จ (`autoConfirmed: true`) ไม่ต้องรอเจ้าของ **เมื่อเจ้าของเปิดสวิตช์ "ปิดบิลอัตโนมัติ" ของหอ (`dorm.autoConfirm`, ค่าเริ่มต้น = ปิด)** · สลิปโอนก่อนบิลออก/prepay, ผล `ok:null`/`false` และการแก้แค่หมายเหตุ ยังรอเจ้าของกดยืนยัน · `SLIP_AUTO_CONFIRM=0\|off\|false` = kill switch ปิดทั้ง deployment แม้หอเปิดสวิตช์ (Preview ใช้ Blob store เดียวกับ production ให้ตั้ง `=0` ตอนทดสอบ) · ฝั่ง `backend` `slip.verify` ยัง manual |
| สลิปใบเดียวจ่ายสองบิลไม่ได้ | ✅ Blob key `slip-ref:<transRef>` จำว่า transRef นั้นถูกใช้กับห้องไหนแล้ว (ของเราเอง ไม่พึ่งหน่วยความจำของผู้ให้บริการ) |
| แก้ไขราคาห้อง | ✅ `POST /api/rooms` (เจ้าของเท่านั้น · รับ `rent` / `waterRate` / `elecRate` เป็นจำนวนเต็ม) + ปุ่ม "แก้ไขราคาห้อง" ใน LIFF · เก็บที่ `room:<room>` · ราคาใหม่มีผลกับบิลที่ออกหลังจากนั้น บิลที่ออกแล้วต้อง void แล้วออกใหม่ |
| หน้าจอเจ้าของของ backend (Thai web UI) | ✅ `/owner` — หน้าเดียว 4 แท็บ (มิเตอร์ · บิล · สลิป · รายงาน) · ล็อกอินด้วยรหัสหอ `POST /v1/auth/owner` → cookie `dp_session` (`role=owner`) · ไม่ได้ตั้ง `OWNER_ACCESS_CODE` = `503 OWNER_LOGIN_OFF` · กันเดารหัสด้วย `app/attempts.py` (429 `TOO_MANY_ATTEMPTS`) |
| QR ผูกผู้เช่ากับห้อง | ✅ `GET/POST /api/qr?room=` (เจ้าของสร้าง/หมุน) · ผู้เช่าสแกน → ผูกทันที |
| หลายเจ้าของ + ผู้ช่วย (ดูอย่างเดียว) | ✅ QR จากเจ้าของเดิม · สิทธิ์ `owner` / `viewer` · `/api/me` คืน `role` |
| ประวัติบิลย้อนหลัง | ✅ `bill:<period>:<room>` + หน้าดูย้อนหลังใน LIFF (เริ่มนับจากรอบที่ออกหลังฟีเจอร์นี้) |
| สลิปโอนก่อนบิลออก | ✅ ไม่มีบิลที่เปิดอยู่ → เก็บที่ `prepay:<room>` · `/api/run` ผูกให้บิลรอบถัดไปแล้วขึ้น `pending` + push การ์ดยืนยันให้เจ้าของทันที |
| ใบเสร็จ | ✅ `receiptNo` = `R<YYYYMM>-<room>` (ออกใหม่หลัง void ต่อท้าย `-<rev>`) · derive จากบิลเพราะ Blob ไม่มี transaction |
| ยกเลิกบิล + เงินที่ต้องคืน | ✅ `POST /api/bill` (`action: "void"`, ต้องมีเหตุผล) · บิลที่ชำระแล้วเก็บ `refundDue` ไว้ให้เจ้าของคืน · ดูย้อนหลังด้วย `GET /api/bill?voided=1` |
| สลิปเดียวจ่ายหลายรอบ | ✅ `POST /api/slip` รับ `periods: ["2026-10","2026-11"]` — ทุกรอบต้องยังเปิดอยู่ ได้ `pending` พร้อม `slipGroup` และเจ้าของได้การ์ดเดียว |
| ทวงอัตโนมัติใน LINE | ✅ `GET /api/cron` ให้ Vercel Cron เรียก 09:00 เวลาไทย · เตือนก่อนครบกำหนด 1–3 วัน / วันครบกำหนด / เลย 1–4 · 5–9 · 10+ วัน · กันส่งซ้ำด้วย `reminded:<room>:<period>:<kind>:<rev>` |
| ผู้เช่าใหม่ไม่เห็นบิลคนเก่า | ✅ เปลี่ยนผู้เช่าเขียน `tenancy:<room>` · บิลที่ `issuedAt` ก่อนวันนั้นถูกซ่อนจากผู้เช่า (เจ้าของ/ผู้ช่วยยังเห็น) |
| เพดาน 12 Vercel functions | ✅ ใช้ครบ 12 พอดี (`api/*.js` ที่ไม่ขึ้นต้นด้วย `_`) — ฟีเจอร์ใหม่ต้องรวมเข้าไฟล์เดิม |
| Rich menu 2 ชุด | ✅ เจ้าของ 6 ช่อง (2500×1686) · ผู้เช่า 3 ช่อง compact (2500×843) · สลับอัตโนมัติตามสิทธิ์ |

## กติกาที่ใส่ไว้ในระบบ

- รอบบิลรายเดือน · ครบกำหนด +5 วันหลังออกบิล
- น้ำ 25 บาท/หน่วย · ไฟ 7 บาท/หน่วย · ค่าเช่า 3,220 (มิเตอร์) / 3,500 (เหมา)
- **ไม่คิดค่าปรับล่าช้า** — ใช้การแจ้งเตือนและสถานะค้างชำระแทน
- ออกบิลซ้ำไม่ได้ (`UNIQUE(room_id, period)`)
- ค่ามิเตอร์น้อยกว่าครั้งก่อน → ขึ้นคำเตือนก่อนบันทึก
- บิลที่ชำระแล้วแก้ไม่ได้ — ต้องยกเลิก (void) แล้วออกใหม่เป็น `rev + 1` (ใบเสร็จได้เลขใหม่, ใบเดิมยังอยู่)
- ยกเลิกบิลที่ชำระแล้ว → เก็บ `refundDue` ไว้ ระบบไม่เคลื่อนเงินเอง เจ้าของเป็นคนคืน
- สลิปของผู้เช่าได้ไม่เกิน 5 ครั้ง/บิล และห่างกัน ≥ 30 วินาที (กัน quota ข้อความ LINE และกันที่เก็บเต็ม)
- สลิปเดียวจ่ายหลายรอบได้ ถ้าทุกรอบยัง `unpaid`/`pending` — รอบที่ปิดแล้วทำให้คำขอถูกปฏิเสธ (`409`)
- เปลี่ยนผู้เช่า → เขียน `tenancy:<room>` ผู้เช่าใหม่เห็นเฉพาะบิลที่ออกหลังวันนั้น
- ราคาห้อง (ค่าเช่า/ค่าน้ำ/ค่าไฟ) แก้รายห้องได้ — **บิลที่ออกแล้วใช้ราคาเดิมเสมอ** ต้อง void แล้วออกใหม่ถ้าจะแก้ยอด
- สลิปที่ตรวจผ่านผูกกับ `transRef` ผ่าน `slip-ref:<transRef>` — ใบเดิมเอาไปจ่ายบิลที่สองไม่ได้ · `verify.ok: null` = ตรวจไม่ได้ (ผู้ให้บริการล่ม/สลิปใหม่อ่านไม่ได้) ไม่ใช่สลิปปลอม และไม่บล็อกการแนบสลิป

## Rich Menu ที่ออกแบบไว้

| เจ้าของหอ | ผู้เช่า |
|---|---|
| ![owner](docs/richmenu-owner.png) | ![tenant](docs/richmenu-tenant.png) |

ขนาด: เจ้าของ 2500×1686 px · ผู้เช่า 2500×843 px (compact) — ใช้กับ `line-app/` ได้เลย (ภาพในตารางข้างบนเป็นภาพตัวอย่าง แต่ขนาดจริงตามที่ระบุใน `line-app/scripts/_richmenu-defs.js`)

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
LINE Platform ──webhook──▶ line-app/ ──▶ Vercel Blob หรือ R2 (kv/*.json, slips/*)
                              └─ LIFF bill.html (ล็อกอินด้วย idToken)

backend/ ──▶ Postgres (Neon)      ← webhook ยังไม่ผูก (OA ชี้ที่ line-app)
   └─ /owner (หน้าเว็บเจ้าของ · cookie จากรหัสหอ)
   ▲
docs/API.md ← สัญญา v1 ที่ทั้งคู่ยึด (เป็นข้อตกลง ไม่ใช่การเชื่อมต่อ)
```

- **LINE OA มี webhook ปลายทางเดียวคือ `line-app`** → `/api/webhook` · `backend/` มี endpoint รับแล้ว (`POST /v1/webhooks/line/:property_id` — ตรวจ signature, เขียน `audit_log`) แต่ยังไม่มี handler ตอบผู้ใช้ และยังไม่ผูกช่องทาง เพราะ LINE อนุญาต URL เดียวต่อ OA
- **ข้อมูลอยู่คนละที่** — ที่จดใน LIFF จะไม่โผล่ใน Postgres และกลับกัน · การย้ายไปที่เดียวเป็นงานใน [`docs/HANDOFF.md`](docs/HANDOFF.md)
- **สัญญาเดียวคือ `docs/API.md`** — แก้ path หรือรูป JSON ต้องแก้ฝั่ง backend และหน้า LIFF ให้ตรงกัน

| เรื่อง | `line-app/` | `backend/` |
|---|---|---|
| เก็บข้อมูล | Vercel Blob หรือ Cloudflare R2 (`api/_store.js` เลือกให้): `kv/*.json` + `slips/*` | Postgres (Neon) ตาม [`db/schema.sql`](db/schema.sql) |
| ทางเข้า | LINE webhook · หน้า LIFF (`liff/bill.html`) | `/liff` · `/owner` (หน้าเว็บเจ้าของ) · curl · pytest |
| auth | LINE idToken ทุก request (`api/_auth.js`) | cookie `dp_session` จาก LINE Login หรือรหัสหอ (`POST /v1/auth/owner`) หรือ `X-Dev-*` ตอน dev |
| ส่งข้อความ LINE | reply + push (การ์ดบิล/ยืนยัน) + push เตือนรายวันจาก `/api/cron` | push เตือนผ่านคิว (`app/line_push.py`) |
| cron / คิว | Vercel Cron → `GET /api/cron` (ทวงค่าเช่ารายวัน) | Vercel Cron → Procrastinate (หัวข้อถัดไป) |
| dependency | `@vercel/blob`, `aws4fetch`, `qrcode-svg` | FastAPI · SQLAlchemy · Alembic · procrastinate |

## ที่เก็บข้อมูลของ `line-app` — Blob หรือ R2

ทุกอย่างที่แตะ storage ผ่าน [`line-app/api/_store.js`](line-app/api/_store.js) ตัวเดียว (เทสต์สลับเป็นในหน่วยความจำได้) มีสอง backend:

| เงื่อนไข | backend | โค้ด |
|---|---|---|
| ไม่ได้ตั้ง `R2_BUCKET` | Vercel Blob | `@vercel/blob` |
| ตั้ง `R2_BUCKET` | Cloudflare R2 (S3 API) | [`line-app/api/_store-r2.js`](line-app/api/_store-r2.js) + `aws4fetch` (ไม่ใช้ `@aws-sdk/client-s3` — ประหยัดขนาด bundle ตอน cold start) |

- R2 ต้องมี env ครบสี่ตัว: `R2_ACCOUNT_ID` · `R2_BUCKET` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` (ขาดตัวใดตัวหนึ่ง = throw ตอนสร้าง store)
- path คงรูปเดิม `kv/<key>.json` และ `slips/*` ทั้งสอง backend — ย้ายข้อมูลด้วย [`line-app/scripts/migrate-blob-to-r2.js`](line-app/scripts/migrate-blob-to-r2.js) (`BLOB_READ_WRITE_TOKEN=… R2_*=… node scripts/migrate-blob-to-r2.js [--dry] [--only=kv|slips]`) **ก่อน** ตั้ง `R2_BUCKET` บน deployment จะได้สลับด้วย env ตัวเดียว
- `bill-state:<room>` คือสำเนาย่อของบิลแต่ละงวด (period/status/total/due/paidAt/issuedAt/receiptNo/refundDue…) เก็บ 24 งวดล่าสุดต่อห้อง · เขียนโดย `saveBills()` ใน [`line-app/api/_bills.js`](line-app/api/_bills.js) (เรียก `indexState()` ใน [`line-app/api/_ledger.js`](line-app/api/_ledger.js)) · ทวงรายวัน, `GET /api/bill?overdue=1` และ `?income=` อ่านคีย์นี้คีย์เดียวต่อห้องแทนที่จะไล่อ่านทีละงวด (ห้องที่ยังไม่มีคีย์จะถูกสร้างใหม่จากบิลจริงตอนอ่าน)
- แคชในหน่วยความจำ 10 วินาที เฉพาะคีย์ที่เปลี่ยนช้า (`dorm`, `room:`, `bill-state:`, `bills:`, `rooms:`) · คีย์ที่เกี่ยวกับเงิน (`bill:`, `slip-ref:`, `qr-code:`) ไม่แคช และทุกครั้งที่เขียนจะล้างแคชของคีย์นั้น

## ทดสอบ (ไม่ต้องต่อเน็ต)

**`line-app/`** — ไม่ต้อง `npm install` ก็รันได้ (ใช้ `node:assert` ล้วน):

```bash
cd line-app
node smoke.js           # signature ของ webhook + รูปร่าง Flex card
node smoke-handlers.js  # dev gate, QR binding, rate limit, confirm, ออกบิล
node smoke-reads.js     # concurrency ของ read, ลำดับ, history, สิทธิ์
node smoke-usecases.js  # 168 use case (receipt · void/refund · prepay · group slip · tenancy · income/overdue)
node smoke-cron.js      # /api/cron: ชนิดการเตือน, dedup ต่อ rev, cron-lock, push ล้ม
npm test                # รันสามตัวแรกตามลำดับ (usecases/cron ไม่อยู่ใน npm test แต่ CI รัน)
```

`node smoke-usecases.js` คือชุดเดียวกับ [`docs/TEST-CASES.md`](docs/TEST-CASES.md) (269 เคสใน 19 use case: 244 automate ✅ / 25 manual 🖐 / 0 ยังไม่สร้าง ⏳ — เคสที่ automate ได้ใน `line-app` มี 168 เคส ที่เหลือเป็น manual/LINE e2e หรือ pytest ฝั่ง backend) และ CI รันทั้งห้าไฟล์

**`backend/`** — ต้องมี Postgres ก่อน (test ที่ต้องใช้ DB จะถูกข้ามถ้าไม่ได้ตั้ง `TEST_DATABASE_URL`):

```bash
cd backend
docker compose up -d
TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test pytest -q
```

⚠️ ฐานข้อมูลใน `TEST_DATABASE_URL` **ถูกล้างทุกครั้งที่รัน** — ห้ามชี้ไปที่ Neon ตัวจริง

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml), workflow `ci`) รันทั้งสองชุดบน push เข้า `master` และทุก PR: job `line-app` ตรวจ syntax ทุก `api/*.js` + inline script ของ `liff/bill.html` แล้วรัน smoke ครบห้าไฟล์ (`smoke.js`, `smoke-handlers.js`, `smoke-reads.js`, `smoke-usecases.js`, `smoke-cron.js`) · job `backend` ยก Postgres 16 ขึ้นมาแล้ว `pytest -q`

## Cron รายวัน (line-app) — ทวงค่าเช่าใน LINE

[`line-app/vercel.json`](line-app/vercel.json) ตั้ง Vercel Cron ไว้แล้ว:

```json
{ "crons": [{ "path": "/api/cron", "schedule": "0 2 * * *" }] }
```

02:00 UTC = 09:00 เวลาไทย · Vercel ยิง `GET /api/cron` พร้อม `Authorization: Bearer $CRON_SECRET` ให้เองถ้าตั้ง env นี้บนโปรเจกต์ (ต้องยาว ≥ 16 ตัว ไม่งั้นตอบ `503 NOT_CONFIGURED`)

- เตือนผู้เช่าตาม **ช่วง** ไม่ใช่วันตรงตัว: ก่อนครบกำหนด 1–3 วัน · วันครบกำหนด · เลย 1–4 / 5–9 / 10+ วัน (เฉพาะบิล `unpaid` ที่มี `due` และเป็นของผู้เช่าปัจจุบัน)
- กันส่งซ้ำด้วย `reminded:<room>:<period>:<kind>:<rev>` — บิลที่ void แล้วออกใหม่ (`rev + 1`) ถูกเตือนใหม่ได้ · push ล้ม = ไม่เขียน mark รอบถัดไปลองอีก
- `cron-lock` (15 นาที) ลดโอกาส Vercel retry ซ้อนกัน แต่ Blob ไม่มี compare-and-set จึงไม่รับประกัน at-most-once
- ถ้ามีห้องเลยกำหนด จะสรุปส่ง `OWNER_USER_ID` หนึ่งข้อความ

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://line-app-iota.vercel.app/api/cron
```

endpoint/auth/response เต็มอยู่ใน [`line-app/docs/API.md`](line-app/docs/API.md) ข้อ 9A · env ทั้งหมดอยู่ใน [`line-app/docs/CONFIGURATION.md`](line-app/docs/CONFIGURATION.md)

## Cron รายวัน + คิว (backend — ไม่ได้ตั้งเวลา)

⚠️ [`backend/vercel.json`](backend/vercel.json) **ไม่มี `crons` แล้ว** (เหลือแค่ `git.deploymentEnabled`) เพราะการทวงจริงย้ายไป `line-app` (§ก่อนหน้า) — เปิดทั้งคู่เมื่อไหร่ผู้เช่าที่ผูกทั้งสองระบบจะได้เตือนสองชุด · endpoint ยังอยู่และใช้ยิงมือ/ทดสอบได้ตามด้านล่าง

ถ้าจะย้ายการทวงมาฝั่งนี้: ใส่ `crons` กลับ (`{ "path": "/v1/cron/daily", "schedule": "0 2 * * *" }`) แล้วปิด cron ของ `line-app`

02:00 UTC = 09:00 เวลาไทย · Vercel ใส่ `Authorization: Bearer $CRON_SECRET` ให้เองถ้าตั้ง env `CRON_SECRET` ไว้บนโปรเจกต์ (ชื่อเก่า `DUNNING_TOKEN` ก็รับ)

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

> หมายเหตุ: คิว/ทวงอัตโนมัติทำงานแล้ว (ดูหัวข้อนี้และแถว "คิวงาน + ทวงอัตโนมัติ" ในตารางสถานะด้านบน)

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
| [`docs/API.md`](docs/API.md) | สัญญา v1 — ทุก endpoint ทำใน backend แล้ว (สลิปยังตรวจ manual ฝั่งนี้) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | ภาพรวมทั้ง repo — สองสแตก, ข้อมูล, auth, ที่เก็บ state |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | env ของทั้งสองฝั่ง + ค่า default |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | deploy ทั้งสองโปรเจกต์ Vercel · Neon · cron · rollback |
| [`docs/TESTING.md`](docs/TESTING.md) | ชุดทดสอบ offline, pytest, manual matrix, CI |
| [`docs/TEST-CASES.md`](docs/TEST-CASES.md) | 269 test case ใน 19 use case (244 automate / 25 manual / 0 ยังไม่สร้าง) |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | งานที่เหลือ + เกณฑ์ "เสร็จ" |
| [`backend/README.md`](backend/README.md) | endpoint · session · migration · test ของ backend |

> เอกสารเชิงลึกชุด `ARCHITECTURE` / `CONFIGURATION` / `GETTING-STARTED` / `DEVELOPMENT` / `TESTING` / `DEPLOYMENT` มีสองชุด: [`line-app/docs/`](line-app/docs/) ครอบเฉพาะครึ่ง LINE app และ [`docs/`](docs/) ครอบภาพรวมทั้ง repo รวม backend

## หลังตรวจสลิป — ตีกลับ · คืนเงิน · รายรับ · ค้างชำระ

นอกจากกดยืนยัน/ยกเลิกบิล เจ้าของมีงานเหล่านี้ใน `line-app` (รายละเอียดเต็มใน [`line-app/docs/API.md`](line-app/docs/API.md) ข้อ 5):

| งาน | เรียกยังไง | ผล |
|---|---|---|
| ตีกลับสลิป (บิลไม่ถูกยกเลิก) | `POST /api/bill` `{ action: "reject", room, period, reason }` | เฉพาะบิล `pending` · บิลกลับเป็น `unpaid` · สลิปเดิมยังอยู่บนบิล (`slipRejected`) เป็นหลักฐาน และยังนับในเพดาน 5 ครั้ง · push บอกผู้เช่าให้แนบใหม่ |
| บันทึกว่าคืนเงินแล้ว | `POST /api/bill` `{ action: "refunded", room, period, rev, kind?, note? }` | `kind: "void"` (บิลที่ยกเลิกหลังชำระ) หรือ `kind: "overpaid"` (โอนเกิน) · เขียน `refundedAt`/`refundedBy` · บันทึกซ้ำ → `409` · ระบบไม่เคลื่อนเงินเอง |
| เงินที่ยังต้องคืน (ข้ามห้อง) | `GET /api/bill?voided=1&refunds=1[&room=]` | รายการ `refundDue` ที่ยังไม่คืน (`kind: "void"` + `"overpaid"`) พร้อม `count`/`total` · คืนแล้วหลุดจากรายการ · เฉพาะเจ้าของ/ผู้ช่วย |
| ยอดค้างชำระ | `GET /api/bill?overdue=1[&room=]` | บิล `unpaid` ที่เลย `due` · นับวันฝั่งเซิร์ฟเวอร์ (เวลาไทย) · คืน `count`/`total`/`maxDaysOverdue`/`items` |
| รายรับของเดือน | `GET /api/bill?income=YYYY-MM` | นับตาม **`paidAt`** ไม่ใช่งวดของบิล (บิล ต.ค. ที่จ่าย 2 พ.ย. = รายรับ พ.ย.) · เฉพาะบิล `paid` · อ่านย้อนหลัง 12 เดือนของแต่ละห้อง |

## กติกาสลิป + การส่งข้อความที่ไม่ซ้ำ

- **สลิปใหม่ต้องมีรูป** — แนบสลิปเปล่า ๆ ไม่ได้ (`400`) · แต่ **โน้ต** ของสลิปที่ส่งไปแล้วแก้ได้โดยไม่ต้องแนบรูปใหม่ (รูปและผลตรวจเดิมยังอยู่) · สลิปหลายงวดต้องมีรูปเสมอ
- **สลิปเก่า/จ่ายก่อนบิลออก = "ตรวจไม่ได้" ไม่ใช่ของปลอม** — `paidAt` เก่ากว่า 30 วัน หรือจ่ายก่อน `issuedAt` ของบิล → ปรับเป็น `ok: null` พร้อมเหตุผล (`stale` / จ่ายก่อนบิลออก) · ไม่บล็อกการแนบหรือการยืนยัน เจ้าของยังตัดสินเอง
- **push ที่ต้องมีครั้งเดียว** — ใบเสร็จ · การ์ดยืนยันสลิปล่วงหน้า · ทวงอัตโนมัติ ส่งด้วย `X-Line-Retry-Key` (derived จากเนื้อข้อความ) · LINE ตอบ `409` แปลว่าข้อความนั้นถึงผู้ใช้แล้ว ถือว่าสำเร็จ ไม่ retry

## เพิ่มเพื่อน OA หลังผูกห้อง

LINE ไม่อนุญาตให้แอปเพิ่มเพื่อนให้ตัวเอง — หลังผู้เช่าผูกห้อง/ผูกสิทธิ์เสร็จ หน้า LIFF จะเรียก `liff.getFriendship()` ถ้ายังไม่ได้เพิ่มเพื่อนจะขึ้นการ์ด "เพิ่มเพื่อน DormPlus" ซึ่งเปิด `liff.requestFriendship()` ให้ผู้ใช้กดเอง (มีปุ่ม "ตรวจอีกครั้ง" เรียก `getFriendship()` ซ้ำ) · ถ้าอ่านสถานะไม่ได้ (`null`) จะไม่ขึ้นการ์ด

## สิทธิ์การใช้งาน

โปรเจกต์นี้ไม่ใช่ open source และไม่มีไฟล์ `LICENSE` ในรีโป — สิทธิ์เป็นของเจ้าของโครงการ
