<!-- generated-by: gsd-doc-writer -->

# การทดสอบ (TESTING)

repo นี้แยกเป็นสองครึ่งที่ deploy แยกกัน และมีชุด test คนละแบบ: **`line-app/`** ใช้สคริปต์ Node ล้วน (`node:assert`, ไม่ต่อเน็ต) และ **`backend/`** ใช้ pytest กับ Postgres จริง ไม่มี browser test และไม่มี LINE end-to-end ใน CI — เอกสารนี้แยกให้เห็นชัดว่าอะไรถูกตรวจอัตโนมัติ อะไรต้องกดมือ และอะไรยังไม่มีใครตรวจ

ที่มา: `line-app/smoke.js`, `line-app/smoke-handlers.js`, `line-app/smoke-reads.js`, `line-app/package.json`, `backend/tests/*.py`, `backend/pyproject.toml`, `backend/docker-compose.yml`, `.github/workflows/ci.yml`, `scripts/prod-smoke.mjs`

---

## 1. ภาพรวม — อะไรถูกทดสอบด้วยอะไร

| ชั้น | ไฟล์ | รันด้วย | ต้องมีอะไร | ครอบอะไร |
|---|---|---|---|---|
| `line-app` handlers | `smoke.js`, `smoke-handlers.js`, `smoke-reads.js` | `node` (หรือ `npm test`) | Node ≥ 20 · ไม่ต้องมีเน็ต · **ไม่ต้อง `npm install`** | signature ของ webhook, Flex card, QR binding + move-confirm, rate limit, ยืนยันการชำระ, ออกบิล, roles/invite, slip limits, concurrency ของ read |
| `backend` API | `backend/tests/*.py` (9 ไฟล์) | `pytest` | Python ≥ 3.11 · **Postgres** สำหรับ test ที่แตะ DB | สัญญา error, session cookie, LINE idToken, ห้อง/มิเตอร์, ออกบิล, สลิป/ยืนยัน/ตีกลับ, ผูก LINE, dunning, cron |
| LIFF inline script | `line-app/liff/bill.html` | `node --check` (ใน CI) | Node | แค่ **parse ได้** ไม่ได้รัน logic |
| production หลัง deploy | `scripts/prod-smoke.mjs` | `node scripts/prod-smoke.mjs` | เน็ต + URL จริง | 14 ข้อ: build ปัจจุบัน, security header, endpoint ที่ต้อง auth ตอบ 401, dev endpoint ปิด, cron ป้องกัน secret |

> ไม่มี Jest/Vitest/Playwright และไม่มี coverage tool ใน repo นี้ — ทุกอย่างข้างบนคือทั้งหมดที่มี

---

## 2. `line-app/` — offline smoke (ไม่ต่อเน็ต)

### 2.1 คำสั่ง

```bash
cd line-app

npm test                 # = node smoke.js && node smoke-handlers.js && node smoke-reads.js

node smoke.js            # signature + Flex card + auth guards
node smoke-handlers.js   # dev gate, QR binding, rate limit, confirm, ออกบิล, roles, slip limits
node smoke-reads.js      # concurrency, ลำดับ, history, สิทธิ์
```

`package.json` ตั้ง `"test": "node smoke.js && node smoke-handlers.js && node smoke-reads.js"` และ `"engines": {"node": ">=20"}` — รันทีละไฟล์ได้ แต่ถ้าตัวแรกตก ตัวถัดไปจะไม่ถูกรันใน `npm test`

**ไม่ต้อง `npm install`:** ทั้งสามไฟล์ `require` เฉพาะ builtin ของ Node (`assert`, `crypto`, `module`, `path`) และ stub dependency เองผ่าน `Module._load` / `require.cache` — ข้อยกเว้นเดียวคือ block QR ใน `smoke.js` ที่จะพิมพ์ `qrcode-svg not installed, QR check skipped` ถ้ายังไม่ได้ติดตั้ง (`smoke.js` บรรทัด 88–101)

### 2.2 `smoke.js` — ตรวจอะไร

| block | assert อะไร |
|---|---|
| signature | payload+secret เดียวกัน → ผ่าน · signature ผิด → `false` · ไม่มี signature → `false` |
| `billBubble` | `type === "flex"`, `altText` มีจำนวนเงิน `3,842`, `contents.type === "bubble"`, มี `ห้อง 203`, สีแบรนด์ `#4FD8D2`, ปุ่มชี้ไปหน้า LIFF |
| `confirmBubble` | ปุ่มเป็นการ์ดเจ้าของเป็น `postback` และ `data` มี `action=confirm` + `room=203` |
| bypass ของ seed token | `BYPASS_ALLOWED` เป็น `false` เมื่อไม่มี env / production (แม้เปิด opt-in) / preview, เป็น `true` เมื่อ preview + `ALLOW_SEED_BYPASS=true` หรือ `vercel dev` |
| owner/viewer | `OWNER_USER_ID` เป็น owner · คนที่ถูกเชิญเป็น owner ได้ · viewer ไม่ใช่ owner แต่ `canView` ได้ · ผู้เช่าไม่ใช่อะไรทั้งนั้น · ไม่ตั้ง `OWNER_USER_ID` → เฉพาะคนที่ถูกเชิญเป็น owner |
| QR | SVG เริ่มด้วย `<svg`, มี `viewBox`, ไม่มี `width` ตายตัว (ถ้าติดตั้ง `qrcode-svg`) |

### 2.3 `smoke-handlers.js` — ตรวจอะไร

stub ทั้งหมด: Blob store เป็น `Map` ในหน่วยความจำ, `fetch` ถูกแทนที่ (เฉพาะ `/oauth2/v2.1/verify` ที่ idToken ขึ้นต้นด้วย `U` ถือว่าผ่าน), `qrcode-svg` ถูกแทนด้วย class ที่คืน `<svg/>`

| กลุ่ม | ตัวอย่างที่ assert |
|---|---|
| dev gate | `POST /api/dev` บน production-like env → 404 และเขียนอะไรไม่ลง store |
| QR binding | ผูกห้องว่างได้ + แจ้ง owner · ห้องที่มีคนอยู่แล้ว → 409 `ROOM_TAKEN` และคนเดิมไม่เสียห้อง · สแกนซ้ำห้องตัวเองได้ · คนที่ไม่ใช่ owner ดู QR ไม่ได้ (403) · ห้องนอก `ROOMS` → 404 · เปลี่ยนผู้เช่า → คืน `unbound: true`, ออก code ใหม่, ผูกเก่าใช้ไม่ได้ |
| move confirm | คนที่ผูกห้องอยู่แล้วสแกนห้องใหม่ → 409 `MOVE_CONFIRM_REQUIRED` พร้อม `current` · ยืนยันแล้วย้ายจริงและห้องเก่าเลิกผูก · สแกนห้องเดิมซ้ำไม่ push ซ้ำ |
| rate limit | รหัสผิดครบ `MAX_FAILURES` ครั้ง/ชั่วโมง → 429 · ห้องที่มีคนอยู่ได้ 409 ไม่กินโควตา (ยังสแกนห้องว่างต่อได้) |
| ยืนยันการชำระ (postback) | ผู้เช่ากดยืนยันไม่ได้ · owner กดแล้วปิดบิลของ period นั้นเท่านั้น · การ์ดเก่าที่ไม่มี `period` ปิดบิลใบใหม่ไม่ได้แม้สถานะ `pending` · ใบใหม่ + history ถูกอัปเดตทั้งคู่ · signature ปลอม → 401 |
| ออกบิล | บิลที่ `paid` แล้วไม่ถูกรีเซ็ต · บิล `unpaid` ออกซ้ำได้ (แก้เลขผิด) · หน่วยติดลบ/ไม่ใช่จำนวนเต็ม/ห้องนอก `ROOMS` → error และไม่เขียนบิล · บิล legacy ที่ใช้ key `bill:<room>` ก็ถูกกัน · ผู้เช่าเรียก → 403 · period ผิดรูปแบบ → 400 |
| idToken cache | token เดิมยืนยันกับ LINE ครั้งเดียว · token ที่ถูกปฏิเสธไม่ถูก cache |
| roles / invite / revoke | `/api/me` คืน `role`/`owner`/`root` ถูก · owner ที่ถูกเชิญสร้าง owner ใหม่ไม่ได้แต่สร้าง viewer ได้ · viewer เชิญใครไม่ได้ · invite ที่สร้างโดย non-root ก่อนกฎนี้ → 410 · คนที่ไม่ใช่ root ไม่เห็น userId ของสมาชิก · root ลบตัวเองไม่ได้ (409) · userId ที่มี `../` → 400 · เพิกถอนแล้วสิทธิ์หายใน request ถัดไป และ invite ที่คนนั้นสร้างตายตาม |
| slip limits | note > 500 ตัวอักษร หรือ note ไม่ใช่ string → 400 · 1 สลิป/30 วินาที (`SLIP_TOO_SOON`) · 5 สลิป/บิล (`SLIP_LIMIT`) · แนบใหม่ลบไฟล์เก่า · `slipCount` ใน history เพิ่ม · owner ไม่ติด limit |
| ออกบิลห้องซ้ำใน request เดียว | อันที่สองตก, ยอดที่ออกคืออันแรก |
| ลำดับ period | บิลเดือนใหม่ยังเป็น "ใบปัจจุบัน" แม้เขียนเดือนเก่าทีหลัง |
| slip image | ผู้เช่าห้องอื่น → 403 · owner เปิดสลิปที่ไม่มี → 404 |

### 2.4 `smoke-reads.js` — ตรวจอะไร

| assert | ค่า |
|---|---|
| อ่านห้อง 42 ห้องแล้วได้ครบตาม `ROOMS` และลำดับคงที่ | 200 |
| การอ่านซ้อนกันจริงแต่มีขอบเขต | peak > 1 และ ≤ 48 (12 ห้อง × 4 read) |
| `/api/rooms` ไม่พา LINE userId ของผู้เช่าออกไป | assert ว่าไม่มี `Usecret-tenant-id` ใน response |
| แสดงแค่ว่าห้องถูกผูกหรือไม่ | `linked` true/false |
| history เรียงใหม่→เก่า, ข้ามเดือนที่ไม่มีบิล, รองรับบิล legacy และ `hasSlip` | 200 |
| read ของ history มีขอบเขต 6 และอ่าน binding ครั้งเดียว | peak ≤ 6, `user-room:tenant` ถูกอ่าน 1 ครั้ง |
| ผู้เช่าขอห้องอื่น | 403 |

### 2.5 ข้อจำกัดของชุดนี้

- ทุกอย่างถูก stub: **ไม่ได้ทดสอบ Vercel Blob จริง, LINE Messaging API จริง, runtime ของ Vercel, หรือ LIFF**
- ตรวจได้เฉพาะ request ที่เรียก handler ตรง ๆ ด้วย `req`/`res` ปลอม — routing, header ที่ platform ใส่, และ timeout ไม่ถูกทดสอบ
- เป็น sequential ทั้งหมด: เคสยิงพร้อมกันจริงไม่ถูกจำลอง (ดูข้อ 10)

---

## 3. `backend/` — pytest

### 3.1 ติดตั้งและเตรียม Postgres

```bash
# จาก root ของ repo
pip install -e "backend[dev]"        # CI ใช้คำสั่งนี้
# หรือจาก backend/
pip install -e ".[dev]"
```

`dev` extras มีแค่ `pytest>=8` กับ `httpx>=0.27` (`backend/pyproject.toml`)

```bash
cd backend
docker compose up -d                 # postgres:17 บน localhost:5432
```

`docker/init-test-db.sql` สร้างฐาน `domplus_test` ให้ครั้งแรกที่ volume ถูกสร้าง — ถ้า volume เดิมมีอยู่แล้วและยังไม่มีฐานนี้ ต้อง `create database domplus_test;` เอง ไม่งั้น alembic จะล้ม (ไม่ skip)

### 3.2 รัน

```bash
cd backend

pytest                                    # ไม่ตั้ง TEST_DATABASE_URL → test ที่ต้องใช้ DB ถูก skip
pytest -q                                 # แบบ CI
pytest tests/test_cron.py -q              # ไฟล์เดียว
pytest -q -k "cron"                       # ตามชื่อ

TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test pytest -q
```

บน PowerShell:

```powershell
$env:TEST_DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test"
pytest -q
```

> ⚠️ **ฐานข้อมูลใน `TEST_DATABASE_URL` ถูกล้างทุกครั้งที่รัน** — `conftest.py` สั่ง alembic `downgrade base` แล้ว `upgrade head` ทั้ง session (ลบทุกตาราง) และ truncate ทุกตารางก่อนทุก test ห้ามชี้ไปที่ Neon/Supabase ตัวจริง

ผลที่เห็นจริงตอนรันโดยไม่มี Postgres: **20 passed, 86 skipped** (test ที่ไม่ต้องใช้ DB รันได้หมด) — ตัวเลขนี้เป็น snapshot ไม่ใช่สัญญา

### 3.3 ไฟล์ test แต่ละไฟล์

| ไฟล์ | ต้องมี DB | ครอบอะไร |
|---|---|---|
| `test_app.py` | บางตัว (`test_healthz_ok`) | `/docs` เปิดนอก production / ปิดบน production · `DEV_AUTH` ถูกเพิกเฉยบน production · 404 ใช้รูป `{"error": {"code","message"}}` · `/healthz` 503 เมื่อ DB ล่ม |
| `test_session_and_line.py` | ไม่ | cookie sign/unsign, token ถูกแก้, secret อื่น, หมดอายุ, default secret ถูกปฏิเสธ · idToken `aud` ต้องตรง channel · `POST /v1/auth/line` → 503 เมื่อยังไม่ตั้ง `LINE_CHANNEL_ID` |
| `test_cron.py` | ไม่ (stub queue) | `GET /v1/cron/daily`: ไม่มี secret / secret ผิด / token ทาง query → 401 · secret ถูก → 200 `{"queued":1,"drained":true}` และ drain ใน invocation เดียว · ไม่ตั้ง `CRON_SECRET` → fail closed |
| `test_rooms.py` | ใช่ | 401 ไม่มี session · `DEV_AUTH` header เลือก session · ผู้เช่า → 403 · หออื่นเห็น/แก้ห้องนี้ไม่ได้ · list ตาม period + invoice ของ period · บันทึกมิเตอร์เทียบเดือนก่อน, ส่งซ้ำทับได้, เลขลดลงเตือนแต่บันทึก, ออกบิลแล้วแก้ไม่ได้ (409), ห้องไม่รู้จัก, ค่าผิด → 422 |
| `test_schema_and_seed.py` | ใช่ | seed สร้าง demo dorm และตัวเลขตรง prototype · seed ซ้ำไม่เปลี่ยนอะไร · DB กันบิลซ้ำ `(room, period)` · สถานะบิลถูกล็อกด้วย constraint |
| `test_billing.py` | ใช่ | `POST /v1/billing/run`: ออกบิลเฉพาะห้องที่มี reading · 42 ห้องใน request เดียว · รันซ้ำ 409 · จดมิเตอร์ทีหลังแล้วรันซ้ำออกเฉพาะห้องนั้น · พังกลางทาง rollback ทั้งก้อน · ใช้มิเตอร์เดือนก่อนค่าล่าสุด · ห้องเหมาจ่าย/ห้องว่าง · ผู้เช่า → 403 · period ผิด → 400 · `GET /v1/invoices`: `days_overdue`, `summary`, กรองสถานะ, ค่า default period, หออื่นไม่เห็น |
| `test_slip_confirm_reject.py` | ใช่ | สลิป → `pending` และเก็บ URL ตามที่หน้าเว็บส่ง · แนบห้องอื่น → 404 · แนบซ้ำ → 409 · ยืนยันแล้ว `paid` + `receipt_no` ไม่ซ้ำ · ยืนยันก่อนมีสลิปไม่ได้ · หออื่นยืนยันไม่ได้ · **ยืนยันรอ lock ระดับหอ** (`test_confirm_waits_for_the_dorm_lock`) · ตีกลับ → `unpaid` + `audit_log` |
| `test_line_link.py` | ใช่ | ออก invite ให้ผู้เช่าที่ยังไม่มี LINE · invite ใหม่ยกเลิกอันเก่า · ผูกแล้ว login ได้ทันที · พิมพ์ตัวเล็ก/เว้นวรรคได้ · เปิดซ้ำได้ · คนอื่นใช้ซ้ำ 409 · หมดอายุ/ถูกยกเลิก 410 · รหัสผิด 404 · ผูกครั้งเดียวต่อบัญชี · รูมเมท · หออื่นทำไม่ได้ · ยกเลิกผูก/move-out ตัด session เดิม · เดารหัสถี่ถูก rate limit |
| `test_dunning.py` | ใช่ | เลือกบิลตามวัน overdue (1/5/10) · kind ต่อบิล · `due_for_reminder` ใช้ `SELECT` เดียว · push ล้มไม่นับว่าส่งแล้วและ task โยน error ให้คิว retry · ผู้เช่าที่ไม่มี LINE ไม่ถูก enqueue · บิล `paid` ข้าม · เคย log kind นั้นแล้วไม่เลือกซ้ำ · หออื่นไม่ถูกแตะ |

### 3.4 fixtures ใน `conftest.py`

| fixture | ทำอะไร |
|---|---|
| `engine` (session scope) | ถ้าไม่มี `TEST_DATABASE_URL` → `pytest.skip` ทั้งไฟล์ที่ขอ · downgrade ถึง `base` แล้ว upgrade ถึง `head` ครั้งเดียวต่อ session |
| `seeded` | truncate 10 ตาราง (`... restart identity cascade`) แล้วรัน `seed()` ใหม่ทุก test |
| `client_for` | สร้าง `TestClient` บน engine ที่ส่งมา และ override `get_engine` / `current_session` / `today` ได้ |
| `owner`, `phone`, `line_ready`, `billed`, `second_dorm` | ตัวช่วยเฉพาะไฟล์ (สร้าง invite/ผู้เช่า, ตั้ง LINE ให้พร้อม, สร้างบิลก่อน test) |

`conftest.py` ตั้ง `SESSION_SECRET=test-secret` และ `COOKIE_SECURE=false` ให้เอง เพราะ `app/session.py` ปฏิเสธ default secret และ `TestClient` คุยผ่าน `http://testserver` (cookie แบบ `Secure` จะไม่ถูกส่งกลับ)

### 3.5 ข้อจำกัดของชุดนี้

- `TestClient` เรียก ASGI app ในโปรเซสเดียว — ไม่มี network, TLS, reverse proxy, หรือ timeout จริง
- ไม่มี worker ของ Procrastinate: `test_cron.py`/`test_dunning.py` แทน `due_for_reminder`, `queue_reminders`, `drain_queue` ด้วย stub
- การ push LINE ถูก monkeypatch — ไม่มีข้อความจริงถูกส่ง
- test ที่ต้อง DB ทั้งหมด **ไม่รัน** ถ้าไม่มี Postgres: เขียวทั้ง suite ทั้งที่ตัวที่รันจริงเหลือ 20 ตัว (ดูข้อ 10)

---

## 4. รันทุกอย่างในคำสั่งเดียว (ก่อน push)

```bash
cd line-app && npm test && cd ..
cd backend && TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test pytest -q
node scripts/prod-smoke.mjs    # หลัง deploy เท่านั้น (ต้องมี URL จริง)
```

---

## 5. ถ้า test ตก หมายความว่าอะไร

| ชุดที่ตก | ความหมาย | ไปดูตรงไหนก่อน |
|---|---|---|
| `smoke.js` | signature ของ webhook เพี้ยน (จะรับของปลอมหรือทิ้งของจริง) · การ์ดบิลผิดยอด/ผิดปุ่ม · seed bypass เปิดได้บน production · สิทธิ์ owner/viewer เพี้ยน | `api/_line.js`, `api/_auth.js` |
| `smoke-handlers.js` | มีช่องโหว่ที่แตะเงินหรือการผูกห้อง: แย่งห้องคนอื่น, ยืนยันบิลผิดใบ, limit หลุด, เพิกถอนสิทธิ์ไม่จริง | handler ที่ชื่อใน assert (`api/qr.js`, `api/webhook.js`, `api/run.js`, `api/owner.js`, `api/slip.js`) |
| `smoke-reads.js` | อ่าน Blob เกินขอบเขต (จะช้าจน timeout บน production) หรือผู้เช่าอ่านห้องคนอื่นได้ | `api/rooms.js`, `api/bill.js` |
| pytest (ไฟล์ที่ต้อง DB) | สัญญา API หรือ state machine เปลี่ยน — บ่อยสุดคือ migration ไม่ตรงกับ model หรือ constraint ถูกถอด | `backend/app/routes/*`, `backend/migrations/` |
| pytest (ไฟล์ที่ไม่ต้อง DB) | session cookie / cron auth / error shape พัง ซึ่งเป็นชั้น security | `app/session.py`, `app/routes/cron.py`, `app/errors.py` |
| `prod-smoke.mjs` | deploy ไม่ตรงกับโค้ด: build เก่า, header หาย, dev endpoint ยังเปิด, endpoint ที่ต้อง auth ตอบ 200 | Vercel deployment + env ของโปรเจกต์นั้น |
| `node --check liff/bill.html` (ใน CI) | inline script ของหน้า LIFF parse ไม่ได้ — ถ้า merge ไปจะเห็นเป็นจอขาวใน LINE | `line-app/liff/bill.html` |

---

## 6. Coverage

**ไม่มีการตั้ง coverage threshold ที่ไหนเลย** — ไม่มี `.coveragerc`, `.nycrc`, `pytest-cov`, หรือ `--cov` ใน CI และ `line-app` ไม่มี coverage tool (ทดสอบด้วย `assert` ตรง ๆ) ดังนั้นตัวเลข coverage ที่ "ควรมี" ไม่มีอยู่ใน repo นี้

สิ่งที่ถูกตรวจอัตโนมัติจริงคือรายการในข้อ 2 และ 3 เท่านั้น ที่เหลือ (หัวข้อ 7) ต้องกดมือ

---

## 7. Manual matrix — สิ่งที่ automation แตะไม่ได้

ทั้งหมดนี้ต้องมี LINE OA จริง + LIFF จริง (HTTPS) + Vercel deployment เพราะ smoke test stub LINE และ Blob ไปแล้ว:

| flow | ขั้นตอนย่อ | ต้องเห็นอะไร |
|---|---|---|
| **QR bind** | เปิด LIFF ในแอป LINE จริง → สแกน QR ที่หน้า owner สร้าง → ยืนยันผูก | ผูกสำเร็จ, เห็นบิลของห้องตัวเอง, owner ได้ข้อความแจ้ง |
| **move-confirm** | บัญชีที่ผูกห้องอยู่แล้วสแกน QR ห้องอื่น | ขึ้นคำถามยืนยันก่อนย้าย (ไม่ย้ายเงียบ ๆ แม้มาจากลิงก์ `?bind=` ที่ถูก forward) · ยืนยันแล้วห้องเก่าเลิกผูก |
| **viewer role** | owner เชิญผู้ช่วย (viewer) → เปิด LIFF ด้วยบัญชีนั้น | เห็นบิล/สลิป/รายงาน แต่ปุ่ม "ออกบิลทั้งหอ", "เจ้าของและผู้ช่วย" หาย และยืนยันการชำระไม่ได้ |
| **slip upload** | ผู้เช่าแนบรูปสลิปจาก LIFF picker | สถานะเป็น "รอตรวจสอบ", owner เห็นรูปในหน้า "สลิปรอตรวจ" |
| **owner confirm card** | owner กดปุ่มยืนยันบน Flex card ในแชท (ไม่ใช่หน้าเว็บ) | webhook รับ postback จริง, บิลเป็น `paid`, ผู้เช่าได้รับการ์ดตอบกลับ |
| **rich menu** | `node scripts/setup-richmenu.js` แล้ว `node scripts/set-richmenu-image.js` → ผูก/เพิกถอนผู้ใช้ | เมนูเปลี่ยนตามบทบาทเมื่อผูก และกลับเมนู tenant เมื่อถูกเพิกถอน |

**matrix ละเอียดระดับ endpoint + สคริปต์ LINE e2e อยู่ใน [`line-app/docs/TESTING.md`](../line-app/docs/TESTING.md) หัวข้อ 6 และ 7** — ที่นี่ไม่ทำซ้ำ

---

## 8. ตรวจ production หลัง deploy

```bash
node scripts/prod-smoke.mjs
LINE_APP=https://... BACKEND=https://... node scripts/prod-smoke.mjs
```

ค่า default คือ `https://line-app-iota.vercel.app` และ `https://line-backend-ten.vercel.app` (ดู `scripts/prod-smoke.mjs` บรรทัด 8–9) ใช้ `fetch` ของ Node 20+ ไม่มี dependency และ **ไม่ต้องล็อกอิน** — ตรวจ 14 ข้อ:

- หน้า LIFF ตอบ 200 และเป็น build ปัจจุบัน (`qr-ph` อยู่ใน HTML)
- `/api/config` 200 · API มี `X-Content-Type-Options: nosniff` และ `X-Frame-Options: DENY` · หน้า LIFF **ไม่** ถูก frame-deny (LINE ต้องฝังได้)
- `/api/me` ไม่มี token → 401 · `POST /api/dev` → 404
- backend `/healthz` คืน `{"status":"ok"}` · `/docs` และ `/openapi.json` → 404
- `/v1/rooms` ไม่มี session → 401 · `/v1/dunning/run?token=guess` → 401
- `/v1/cron/daily` ไม่มี secret → 401

exit code 1 ถ้ามีข้อใดตก **สคริปต์นี้ไม่ถูกรันใน CI** (ไม่มี step ใน `.github/workflows/ci.yml`) — ต้องรันเองหลัง deploy

---

## 9. ตรวจ cron รายวันด้วยมือ

`backend/vercel.json` ตั้ง `{"crons":[{"path":"/v1/cron/daily","schedule":"0 2 * * *"}]}` (02:00 UTC = 09:00 ไทย) และ Vercel ใส่ header ให้เองเมื่อตั้ง `CRON_SECRET` บนโปรเจกต์

```bash
# ต้องได้ 200 {"queued":N,"drained":true}
curl -i -H "Authorization: Bearer $CRON_SECRET" https://line-backend-ten.vercel.app/v1/cron/daily

# ต้องได้ 401
curl -i https://line-backend-ten.vercel.app/v1/cron/daily
curl -i "https://line-backend-ten.vercel.app/v1/cron/daily?token=$CRON_SECRET"
```

| อาการ | ความหมาย |
|---|---|
| 200 + `{"queued":0,"drained":true}` | ไม่มีบิลถึงกำหนด — ปกติ |
| 200 + `queued > 0` แต่ผู้เช่าไม่ได้รับข้อความ | `LINE_CHANNEL_ACCESS_TOKEN` ไม่ได้ตั้ง หรืองาน `line.push_text` log `skipped` |
| 401 | ไม่มี/ผิด `CRON_SECRET` (หรือไม่ได้ตั้ง env — endpoint fail closed) |
| 503 `QUEUE_UNAVAILABLE` | ยังไม่ได้สร้างตาราง Procrastinate → `python -m app.queue` ครั้งเดียวต่อฐานข้อมูล |
| 500 | ต่อ DB ไม่ได้ — เช็ค `/healthz` ก่อน |

test อัตโนมัติที่ครอบส่วนนี้: `backend/tests/test_cron.py` (5 เคส ยืนยัน 401 ทั้งสามแบบและ 200 + drain) และข้อ `/v1/cron/daily → 401` ใน `prod-smoke.mjs`

---

## 10. ช่องว่างที่รู้อยู่ (อย่าอ่านว่า "ผ่าน test แล้วปลอดภัย")

1. **ไม่มี browser/UI test เลย** — `liff/bill.html` มี inline JS หลายร้อยบรรทัดที่ CI ตรวจแค่ `node --check` ว่า parse ได้ ไม่มีใครตรวจว่าปุ่มทำงาน, สถานะแสดงถูก, หรือ layout ไม่พัง
2. **ไม่มี LINE end-to-end ใน CI** — webhook, postback, rich menu และการส่งข้อความจริงถูก stub/monkeypatch ทั้งหมด; regression ที่เกิดจาก LINE API เปลี่ยนจะไม่ถูกจับ
3. **ไม่มี test ของ Blob จริง** — `smoke-*.js` ใช้ `Map` แทน `api/_store.js`; พฤติกรรมของ `list`/`put`/`get` (pagination, overwrite, permission) ไม่ถูกทดสอบ
4. **race ของ line-app ไม่มี lock** — Blob store เป็น read-modify-write ไม่มี compare-and-swap:
   - แนบสลิป 2 ครั้งพร้อมกัน → เขียนทับกัน, push การ์ด owner 2 ใบ
   - owner กดยืนยัน 2 เครื่องพร้อมกัน → push ผู้เช่า 2 ครั้ง
   - 2 คนสแกน QR ห้องว่างเดียวกันเป๊ะ → คนหลังอาจทับคนแรก

   test ที่มีอยู่ยืนยันได้แค่เคส **sequential** (เช่น `ROOM_TAKEN` เมื่อผูกไปแล้ว) ตารางเต็มอยู่ใน [`line-app/docs/TESTING.md`](../line-app/docs/TESTING.md) หัวข้อ 8.3
5. **backend กัน race ได้แค่บางจุด** — ยืนยันการชำระมี lock ระดับหอ (`test_confirm_waits_for_the_dorm_lock`) และ DB กันบิลซ้ำด้วย `UNIQUE(room_id, period)` แต่ไม่มี test ของ concurrent request จริงจากหลายโปรเซส (TestClient เป็น single-process)
6. **ไม่มี load/performance test** — ขอบเขต concurrency ของ read ถูก pin ด้วย `assert` (peak ≤ 48 และ ≤ 6) แต่ไม่ได้วัดเวลา
7. **ไม่มี coverage measurement** — ดูข้อ 6
8. **`prod-smoke.mjs` เป็น manual** — ไม่มี schedule หรือ workflow เรียก มันจึงเขียวค้างได้แม้ production พัง

---

## 11. เขียน test ใหม่

### line-app

- เพิ่มเข้าไฟล์ที่มีอยู่ให้ตรงหมวด (`smoke.js` = โครงสร้าง/สิทธิ์พื้นฐาน, `smoke-handlers.js` = handler ที่แตะเงิน/ผูกห้อง, `smoke-reads.js` = read/concurrency) หรือสร้างไฟล์ใหม่แล้วต่อท้าย `"test"` ใน `line-app/package.json`
- ใช้ `node:assert` และ stub แบบเดิม: `require.cache[require.resolve("./api/_store")] = {...}` สำหรับ store, แทน `global.fetch` สำหรับ LINE, `call(handler, {body, user})` สำหรับ handler
- ทุกเคสต้องรันได้โดยไม่ต้องมีเน็ตและไม่ต้องมี `node_modules` — ถ้าต้องใช้ dependency ให้ stub ผ่าน `Module._load` เหมือน `qrcode-svg`
- ห้ามใช้ `process.env` ของเครื่องจริง: ตั้งค่าที่ต้องใช้บนหัวไฟล์ (ไฟล์ที่มีอยู่ตั้ง `LINE_CHANNEL_SECRET`, `OWNER_USER_ID`, `ROOMS` เอง)

### backend

- วางใน `backend/tests/test_<area>.py` ชื่อฟังก์ชัน `test_...` (ตรงกับ `testpaths = ["tests"]` ใน `pyproject.toml`)
- เคสที่แตะ DB ต้องรับ fixture `seeded` (หรือ `engine`) — ถ้าไม่รับ `TEST_DATABASE_URL` มันจะถูก skip เงียบ ๆ
- ใช้ `client_for(engine, session=..., day=...)` เพื่อเลือก session และวันที่ แทนการแก้ `datetime` ในโค้ด
- อย่าใช้ DB จริงใน `.env`: `TEST_DATABASE_URL` คือฐานที่ถูกล้าง

---

## เอกสารที่เกี่ยวข้อง

- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — โครงสร้างสองครึ่ง, data flow, state machine ของบิล
- [`docs/CONFIGURATION.md`](CONFIGURATION.md) — env ทุกตัว (`TEST_DATABASE_URL`, `CRON_SECRET`, `DEV_AUTH`)
- [`line-app/docs/TESTING.md`](../line-app/docs/TESTING.md) — matrix ระดับ endpoint, LINE e2e script, ตาราง race เต็ม
- [`backend/README.md`](../backend/README.md) — วิธีรัน backend และ seed
