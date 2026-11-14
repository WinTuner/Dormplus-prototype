<!-- generated-by: gsd-doc-writer -->

# การตั้งค่า (CONFIGURATION)

เอกสารนี้อธิบายตัวแปรสภาพแวดล้อม (environment variables) และไฟล์ config **ทั้งหมด** ของ repo นี้ ซึ่งมีสองครึ่งที่แยกกัน deploy:

| ครึ่ง | stack | โปรเจกต์ Vercel (Root Directory) | อ่าน config จาก |
|---|---|---|---|
| **backend** | FastAPI + Postgres (Neon/Supabase) | `line-backend` (`backend/`) | `backend/app/config.py` ผ่าน `pydantic-settings` → env หรือ `backend/.env` |
| **line-app** | Vercel serverless JS + Vercel Blob | `line-app` (`line-app/`) | `process.env` ตรง ๆ ใน `line-app/api/*.js` — **ไม่มี dotenv** |

> **สำคัญ:** ทั้งสองครึ่งเป็นคนละโปรเจกต์ Vercel จึงมีชุด env แยกกัน ค่าที่ชื่อซ้ำกัน (เช่น `LIFF_ID`) ต้องใส่ทั้งสองโปรเจกต์ ไม่ใช่ใส่ที่เดียวแล้วใช้ร่วม

ที่มา: `backend/app/config.py`, `backend/.env.example`, `line-app/api/*.js`, `backend/vercel.json`, `line-app/vercel.json`, `line-app/README.md`, `Dockerfile`

---

## 1. Backend (FastAPI)

ตัวแปรที่โค้ดอ่านจริงมี 10 ตัว (นิยามใน `Settings` ที่ `backend/app/config.py`) บวกตัวแปรสำหรับ test และตัวแปรที่ platform ฉีดให้

| Variable | Prod | Local | Default | ผลเมื่อไม่มี / ผิด |
|---|---|---|---|---|
| `DATABASE_URL` | **จำเป็น** | **จำเป็น** | `postgresql+psycopg://postgres:postgres@localhost:5432/domplus` | ต่อ DB ไม่ได้ → `/healthz` ตอบ `503 DB_UNAVAILABLE`, route อื่นล้มเป็น 500 |
| `SESSION_SECRET` | **จำเป็น** | **จำเป็น** | `dev-only-change-me` (ถูกปฏิเสธ) | `app/session.py` โยน `RuntimeError` — login และทุก request ที่มี cookie ล้มเป็น 500 |
| `COOKIE_SECURE` | **ควรเป็น `true`** | `false` ถ้าเป็น HTTP | `true` | ตั้ง `true` บน `http://127.0.0.1` → browser ไม่ส่ง cookie `dp_session` กลับ → 401 ตลอด |
| `DEV_AUTH` | ต้องเป็น `false` | `true` ได้ | `false` | เปิดบน production จริงจะถูกเพิกเฉย **แต่** ดูข้อ 3.3 (ขึ้นกับ `VERCEL_ENV`) |
| `LINE_CHANNEL_ID` | **จำเป็นถ้าใช้ LINE Login** | ไม่ใส่ก็ได้ | `""` | `POST /v1/auth/line` ตอบ `503 LINE_NOT_CONFIGURED` |
| `LIFF_ID` | **จำเป็นถ้าใช้หน้า LIFF** | ไม่ใส่ก็ได้ | `""` | `GET /v1/liff-config` คืน `{"liff_id": ""}` → หน้า LIFF `liff.init()` ไม่ได้ |
| `LINE_CHANNEL_ACCESS_TOKEN` | **จำเป็นถ้าต้องส่งข้อความ** | ไม่ใส่ก็ได้ | `""` | push ไม่Throw แต่คืน `"skipped: no LINE_CHANNEL_ACCESS_TOKEN"` แล้ว log `skipped` — ผู้ใช้ไม่ได้รับข้อความ |
| `CRON_SECRET` | **จำเป็นถ้าใช้ Vercel Cron** | ไม่ใส่ก็ได้ | `""` | `/v1/cron/daily` ตอบ 401 ทุกครั้ง (ไม่มีทางรัน) |
| `DUNNING_TOKEN` | ทางเลือกแทน `CRON_SECRET` | — | — | ชื่อเก่าที่ยังรับผ่าน `AliasChoices`; ถ้าตั้งทั้งคู่ `CRON_SECRET` ชนะ |
| `PROPERTY_ID` | **ควรตั้งให้ตรงข้อมูล** | `p_1` | `p_1` | ไม่ error แต่ cron/dunning จะเลือกบิลของหอ `p_1` เท่านั้น — ข้อมูลหออื่นไม่ถูกทวง |
| `VERCEL_ENV` | platform ฉีดให้ | ไม่ต้องตั้ง | `""` | ใช้ตัดสิน `is_production` (ปิด `/docs`, ปิด `DEV_AUTH`) |
| `TEST_DATABASE_URL` | — | เฉพาะตอนรัน `pytest` | ไม่มี | ไม่ตั้ง → test ที่ต้องใช้ DB ถูกข้าม; **ฐานนี้ถูกล้างทุกครั้งที่รัน test** |
| `PORT` | platform ฉีดให้ | ไม่ต้องตั้ง | `8000` | Dockerfile ใช้ `${PORT:-8000}` |

### 1.1 `DATABASE_URL` — pooled vs unpooled

- **runtime บน Vercel:** ใช้ endpoint **pooled** ของ Neon (host ที่มี `-pooler`) + `?sslmode=require` ตาม `backend/README.md`
- **alembic / เครื่องมือ single-process:** ใช้ endpoint **unpooled** เพราะ migration รัน DDL หลายคำสั่งใน transaction เดียว (`backend/README.md` ข้อ "ฐานข้อมูลจริง (Neon)" และ `backend/.env` คอมเมนต์กำกับไว้)
- scheme ต้องเป็น `postgresql+psycopg://` (ไม่ใช่ `postgresql://`) — `backend/.env.example` ระบุให้เปลี่ยน scheme หลังคัดลอกจาก dashboard
- `migrations/env.py` อ่าน `DATABASE_URL` ผ่าน `get_settings()`; `alembic.ini` **ไม่มี** `sqlalchemy.url`
- test ใช้ `TEST_DATABASE_URL` แยก และจะ truncate ทุกตาราง — ห้ามชี้มาที่ฐานจริง ใช้ Neon branch แยก

<!-- VERIFY: ชื่อ endpoint pooled/unpooled จริงของ Neon และว่า production ตั้ง `?sslmode=require` ครบหรือไม่ — อยู่ใน Vercel Project → Settings → Environment Variables ไม่มีในเรพ -->
<!-- VERIFY: `DATABASE_URL` บน Vercel ของโปรเจกต์ `line-backend` ชี้ Neon ตัวเดียวกับที่ `backend/.env` ใช้หรือคนละตัว — เทียบจาก dashboard เท่านั้น -->

### 1.2 `SESSION_SECRET`

ใช้เซ็น cookie `dp_session` (HMAC-SHA256, stdlib, อายุ 7 วัน, `HttpOnly`, `SameSite=Lax`) ที่ `backend/app/session.py`

- ค่า default `dev-only-change-me` ถูกปฏิเสธโดย `_require_real_secret()` — deployment ที่ลืมตั้งจะ **fail loudly** ไม่ยอมเซ็น cookie
- เปลี่ยนค่า = ผู้ใช้ทุกคนถูก log out ทันที
- test ตั้ง `SESSION_SECRET=test-secret` เองใน `backend/tests/conftest.py`

### 1.3 `COOKIE_SECURE` และ `DEV_AUTH` (กับดักที่สำคัญ)

`COOKIE_SECURE=true` (default) ทำให้ cookie ถูกส่งเฉพาะ HTTPS — บนเครื่องที่รัน `http://127.0.0.1` ต้องตั้ง `false` ไม่งั้น login ผ่านแต่ request ถัดไป 401

`DEV_AUTH` เปิดทาง `X-Dev-Property` / `X-Dev-Role` / `X-Dev-User` / `X-Dev-Room` (ดู `backend/app/auth.py`) เพื่อเลือกหอและบทบาทได้โดยไม่ต้องมี LINE Login

- โค้ดเช็ก `dev_auth_active = dev_auth and not is_production`
- `is_production` เป็นจริง **เฉพาะเมื่อ `VERCEL_ENV == "production"`**
- ⚠️ บน Docker / Railway / Cloud Run (`Dockerfile` รองรับ) ที่ไม่มี `VERCEL_ENV` ค่า `is_production` เป็น `false` → ถ้าตั้ง `DEV_AUTH=true` ไว้ จะ**ใช้งานได้จริง** ใครก็สวมบทเจ้าของได้ ต้องมั่นใจว่า `DEV_AUTH=false` บนทุก deployment ที่ไม่ใช่เครื่องตัวเอง

### 1.4 `CRON_SECRET` / `DUNNING_TOKEN`

`backend/vercel.json` ประกาศ cron ไว้แล้ว:

```json
"crons": [{ "path": "/v1/cron/daily", "schedule": "0 2 * * *" }]
```

- Vercel เรียกเป็น `GET` และใส่ `Authorization: Bearer <CRON_SECRET>` ให้เองเมื่อตั้ง env นี้บนโปรเจกต์
- `app/routes/cron.py` เทียบด้วย `hmac.compare_digest` — ไม่มี header, ไม่มี secret, หรือค่าไม่ตรง → `401 UNAUTHORIZED`
- `app/routes/dunning.py` (`POST /v1/dunning/run`) รับ token ทาง header เท่านั้น **token ใน query string (`?token=`) ถูกปฏิเสธ 401** เพราะ URL หลุดเข้า access log; endpoint นี้ยังรับ owner session ได้ถ้าไม่ส่ง header
- `DUNNING_TOKEN` คือชื่อเก่าที่ยังใช้ได้ (`AliasChoices("CRON_SECRET", "DUNNING_TOKEN")`)
- ถ้าคิว Procrastinate ยังไม่ถูกสร้าง (`python -m app.queue`) cron จะตอบ `503 QUEUE_UNAVAILABLE`

<!-- VERIFY: บน Vercel dashboard ตั้ง `CRON_SECRET` ไว้หรือยัง และ cron `/v1/cron/daily` ถูก register จริงบน plan Hobby — `vercel.json` เป็นเพียงคำประกาศ -->
<!-- VERIFY: Hobby plan อนุญาต cron วันละครั้งและคลาดได้ถึง ±59 นาทีตามที่ README กล่าว — ตรวจที่ Vercel → Settings → Cron Jobs -->

### 1.5 กลุ่ม LINE ฝั่ง backend

| ตัวแปร | ใช้ที่ | หมายเหตุ |
|---|---|---|
| `LINE_CHANNEL_ID` | `app/routes/auth.py` | LINE Login channel ที่ออก idToken; ว่าง → 503 |
| `LIFF_ID` | `app/main.py` | `GET /v1/liff-config` คืนให้หน้า LIFF (public โดยตั้งใจ) |
| `LINE_CHANNEL_ACCESS_TOKEN` | `app/line_push.py` | Messaging API push; ว่าง → คืน `skipped:` ไม่ throw |

> `LINE_CHANNEL_ACCESS_TOKEN` ถูกอ่านโดย `Settings` แต่ **ไม่ปรากฏใน `backend/.env.example`** — ถ้าคัดลอก example ไปใช้ ต้องเพิ่มเองไม่งั้นการทวงหนี้จะ log `skipped` เงียบ ๆ

### 1.6 `PROPERTY_ID`

"1 deploy = 1 หอ" — session ทุกอันถือ `property_id` และ route ห้ามรับค่านี้จาก client (`backend/app/auth.py`) ค่า `PROPERTY_ID` ใช้เฉพาะตอน cron/dunning เลือกบิล (`due_for_reminder`) ถ้าตั้งผิดจะไม่ error แต่จะไม่พบบิลที่ถึงกำหนด

---

## 2. line-app (serverless JS)

โค้ดอ่าน `process.env` **17 ตัว** ใน `line-app/api/*.js` (นับจาก `api/config.js`, `api/dev.js`, `api/me.js`, `api/owner.js`, `api/qr.js`, `api/rooms.js`, `api/run.js`, `api/slip.js`, `api/webhook.js`, `api/_auth.js`, `api/_line.js`, `api/_rooms.js`) บวกตัวแปรที่ `@vercel/blob` อ่านเอง

| Variable | Prod | Local | Default | ผลเมื่อไม่มี / ผิด |
|---|---|---|---|---|
| `LINE_CHANNEL_SECRET` | **จำเป็น** | ต้องตั้งเอง | — | `verify()` คืน `false` → webhook ตอบ `401 bad signature` ทุก request (อาการ "Verify ไม่ผ่าน") |
| `LINE_CHANNEL_ACCESS_TOKEN` | **จำเป็น** | ต้องตั้งเอง | — | `call()` throw; `webhook`/`run`/`slip` ดักไว้จึงยัง 200 แต่ไม่มีข้อความออก; `api/dev.js` ไม่ดัก → **500** |
| `LIFF_ID` | **จำเป็นถ้าใช้ LIFF** | ไม่ใส่ก็ได้ | `null` (จาก `api/config.js`) | `/api/config` คืน `liffId: null` → หน้าเว็บขึ้น "เปิดหน้านี้จากปุ่มในแชท LINE เท่านั้น"; ปุ่มในการ์ดเป็น URL ตรง; ถ้าไม่มี `LOGIN_CHANNEL_ID` ด้วย ทุก endpoint ที่ต้องล็อกอินตอบ 401 |
| `LOGIN_CHANNEL_ID` | ไม่บังคับ | ไม่บังคับ | อนุมานจากส่วนหน้า `-` ของ `LIFF_ID` | ถ้า LIFF อยู่คนละ provider กับ LINE Login ต้องตั้ง ไม่งั้นตรวจ idToken ไม่ผ่าน (403) |
| `OWNER_USER_ID` | **จำเป็น** | ไม่ใส่ก็ได้ | — | ไม่มี root owner → `/api/rooms`, `/api/run` ตอบ 403 และไม่มีการ์ด "ยืนยันการชำระ" ส่งถึงใคร |
| `SEED_TOKEN` | **ไม่ควรตั้ง** | ตั้งได้ | — | ถ้าไม่ตั้งหรือสั้นกว่า 16 ตัว → `/api/dev` ตอบ 403 และ bypass ปิด (ปลอดภัยกว่า) |
| `ALLOW_SEED_BYPASS` | **ต้องไม่ตั้ง / `false`** | `true` ได้ | — (ปิด) | ไม่มีผลบน production; บน preview เปิด bypass + `/api/dev` (preview ใช้ Blob ชุดเดียวกับ production — อันตราย) |
| `RICHMENU_OWNER_ID` | ไม่บังคับ | ไม่บังคับ | — | ไม่สลับ rich menu ให้เจ้าของที่ถูกเชิญ (`api/owner.js`) |
| `RICHMENU_TENANT_ID` | ไม่บังคับ | ไม่บังคับ | — | ไม่สลับ rich menu ให้ผู้เช่าที่ผูกห้อง (`api/qr.js`) |
| `PUBLIC_BASE_URL` | แนะนำ | ไม่บังคับ | `` `https://${req.headers.host}` `` | ใช้ host ของ request — บน Vercel ปกติถูกต้อง |
| `ROOMS` | **ควรตั้งให้ตรงหอ** | ไม่บังคับ | `201`…`212` (12 ห้อง) | ใช้ห้อง 201–212; อ่านครั้งเดียวตอน module load |
| `DEFAULT_RENT` | ไม่บังคับ | ไม่บังคับ | `3500` | ค่าเช่าเริ่มต้น/ห้อง |
| `WATER_RATE` | ไม่บังคับ | ไม่บังคับ | `25` | ค่าน้ำ/หน่วย |
| `ELEC_RATE` | ไม่บังคับ | ไม่บังคับ | `7` | ค่าไฟ/หน่วย |
| `BILL_PERIOD` | ไม่บังคับ | ไม่บังคับ | `""` (seed ใช้ `2026-11`) | `/api/run` ถ้า body ไม่ส่ง `period` และ env ว่าง → `400 VALIDATION`; `/api/rooms` คืน `period: null` |
| `BILL_DUE` | ไม่บังคับ | ไม่บังคับ | `""` (seed ใช้ `2026-11-16`) | บิลเก็บ `due: ""`/`null` → การ์ดแสดงค่าว่าง |
| `VERCEL_ENV` | platform ฉีดให้ | `vercel dev` ตั้งเป็น `development` | `""` | ใช้ปิด bypass บน production (`IS_PRODUCTION`) |

ตัวแปรที่ **โค้ดไม่เคยอ่านเอง** แต่ platform/library ต้องใช้:

| Variable | ใครอ่าน | ต้องสร้างเองไหม |
|---|---|---|
| `BLOB_STORE_ID` | `@vercel/blob` | ไม่ต้อง — `vercel storage connect` ใส่ให้ |
| `VERCEL_OIDC_TOKEN` | `@vercel/blob` (คู่กับ `BLOB_STORE_ID`) | ไม่ต้อง — Vercel ฉีดตอน runtime |
| `BLOB_READ_WRITE_TOKEN` | — | **ไม่ถูกใช้** เพราะทุก call ใช้ `access: "private"` + OIDC |

<!-- VERIFY: ชื่อ/region ของ Blob store (`domplus-bills`, `sin1`) มาจาก README และ `vercel storage connect` ใส่ `BLOB_STORE_ID` จริงหรือไม่ — ตรวจ Project → Settings → Environment Variables -->
<!-- VERIFY: Vercel ฉีด `VERCEL_OIDC_TOKEN` ทุก deployment รวม Preview หรือไม่ — ไม่มีไฟล์ในเรพยืนยัน -->

### 2.1 `ROOMS` / `DEFAULT_RENT` / `WATER_RATE` / `ELEC_RATE`

`api/_rooms.js` อ่านค่าทั้งสี่ **ครั้งเดียวตอน module load** แล้วใส่ `const` ระดับบนสุด

- `ROOMS` เป็น comma-separated; เปลี่ยนแล้วข้อมูล Blob ของห้องเดิม (`room:<room>`, `bill:<room>`, `meter:<room>`) ไม่ถูกลบ
- ค่าเช่า/เรตถูก wrap ด้วย `Number()` — ใส่ค่าที่แปลงไม่ได้ (เช่น `25 บาท`) จะได้ `NaN` แล้วยอดบิลกลายเป็น `NaN` โดยไม่ error
- ค่าเฉพาะห้องเขียนทับได้ด้วย key `room:<room>` ใน Blob (`{...DEFAULTS, ...roomConfig}`)

### 2.2 `SEED_TOKEN` / `ALLOW_SEED_BYPASS`

`SEED_TOKEN` ต้องยาว **≥ 16 ตัว** ไม่งั้นไม่นับว่าตั้งแล้ว (`MIN_SEED_TOKEN_LENGTH` ใน `api/_auth.js`) ส่งทาง header `x-seed-token` เท่านั้น (ไม่รับใน URL) ใช้กับ:

- `POST /api/dev?do=seed` — สร้างบิลตัวอย่างทุกห้อง
- `POST /api/dev?do=sendbill` — ยิงการ์ดบิลหาหนึ่ง userId
- bypass การตรวจ idToken แล้วคืน `OWNER_USER_ID` (หรือ `"dev"` ถ้าไม่ได้ตั้ง)

`BYPASS_ALLOWED` เป็นจริงเมื่อ **ไม่ใช่ production** และ (`ALLOW_SEED_BYPASS=true` หรือ `VERCEL_ENV=development`) — บน production ปิดเสมอไม่ว่าตั้งอะไร และ `/api/dev` ตอบ 404

### 2.3 `OWNER_USER_ID` / `RICHMENU_*`

- `OWNER_USER_ID` = LINE userId ของเจ้าของหอคนแรก ("root") ตัดสินสิทธิ์ใน `roleOf()`/`isRoot()` และเป็นปลายทางการ์ดยืนยันการชำระ; root คนเดียวที่เชิญ/ถอนเจ้าของคนอื่นได้ (เจ้าของเพิ่มเติมเก็บใน Blob key `owner:<userId>`)
- `RICHMENU_OWNER_ID` ใช้ตอนรับสิทธิ์เจ้าของ (`api/owner.js`), `RICHMENU_TENANT_ID` ใช้ตอนผู้เช่าผูกห้องด้วย QR (`api/qr.js`) — ไม่ตั้งก็แค่ไม่สลับเมนู

---

## 3. รูปแบบไฟล์ config

### 3.1 `backend/.env`

`pydantic-settings` อ่าน `env_file=".env"` จาก **current working directory** และ `extra="ignore"`

```bash
# คัดลอกจาก .env.example แล้วแก้ค่า
DATABASE_URL=postgresql+psycopg://user:pass@host:5432/domplus
DEV_AUTH=false
LINE_CHANNEL_ID=
LIFF_ID=
SESSION_SECRET=change-me-to-a-long-random-value
COOKIE_SECURE=true
CRON_SECRET=
PROPERTY_ID=p_1
```

- ไม่ต้องใส่ quote; คอมเมนต์ขึ้นต้นด้วย `#`
- env ของ process ชนะไฟล์ `.env`
- ต้องรันคำสั่งจากโฟลเดอร์ `backend/` ไม่งั้นหา `.env` ไม่เจอ (ค่า default จะถูกใช้)
- `.gitignore` ของ backend คือ `.env*` — ไฟล์ `backend/.env.local` ที่มีอยู่เป็น artifact ของ Vercel CLI (`VERCEL_OIDC_TOKEN`) **ห้าม commit และห้ามคัดลอก token ลงเอกสาร**
- ไม่มี `config.json` / `config.yaml`; `alembic.ini` เก็บแค่ `script_location` กับ logger ไม่มี connection string

### 3.2 `line-app` ไม่มีไฟล์ config

- ไม่มี `.env`, `.env.example`, dotenv ใน dependency (`package.json` มี `@vercel/blob` + `qrcode-svg`)
- การใส่ `.env` เฉย ๆ **ไม่มีผล** เพราะไม่มีอะไรโหลดเข้า `process.env` (ไม่มี `--env-file` และไม่มี `scripts` ที่รันเซิร์ฟเวอร์)
- `line-app/vercel.json` เก็บเฉพาะ `git.deploymentEnabled`, `crons` (ไม่มีใน line-app), `rewrites` (`/` → `/liff/bill.html`) และ security headers
- ค่าทั้งหมดมาจาก Vercel → Project → Settings → Environment Variables หรือจาก shell ตอน `vercel dev`

---

## 4. Required vs optional — สรุปตาม environment

### Production

**Backend (`line-backend`)** ต้องตั้ง:

- `DATABASE_URL` (pooled + `sslmode=require`)
- `SESSION_SECRET` (ค่าสุ่มยาว ไม่ใช่ `dev-only-change-me`)
- `COOKIE_SECURE=true`
- `DEV_AUTH=false`
- `LINE_CHANNEL_ID` และ `LIFF_ID` (ถ้าเปิด LINE Login/LIFF)
- `LINE_CHANNEL_ACCESS_TOKEN` (ถ้าต้องส่งข้อความทวง)
- `CRON_SECRET` (ถ้าใช้ Vercel Cron)
- `PROPERTY_ID` (ถ้าไม่ใช่ `p_1`)

**line-app** ต้องตั้ง:

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LIFF_ID`
- `OWNER_USER_ID`

ไม่ตั้งใน production: `SEED_TOKEN`, `ALLOW_SEED_BYPASS`, `DEV_AUTH=true`

### Local

- backend: `cp .env.example .env` แล้วตั้ง `COOKIE_SECURE=false`; `DEV_AUTH=true` ได้; `SESSION_SECRET` อะไรก็ได้ที่ไม่ใช่ placeholder (test ใช้ `test-secret`); `LINE_*`/`CRON_SECRET` ไม่ใส่ก็รันได้แต่ฟีเจอร์นั้นจะปิด
- line-app: ไม่มี HTTP server ในเรพ — smoke test ตั้ง env เองในโปรเซส (`smoke.js`, `smoke-handlers.js`, `smoke-reads.js`) ถ้าจะยิง API จริงต้องตั้ง env ใน shell เองหรือใช้ `vercel dev`

---

## 5. ค่า default ทั้งหมดในโค้ด

| ค่า | Default | ที่มา |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://postgres:postgres@localhost:5432/domplus` | `backend/app/config.py` |
| `SESSION_SECRET` | `dev-only-change-me` (ถูกปฏิเสธ) | `backend/app/config.py`, `backend/app/session.py` |
| `COOKIE_SECURE` | `true` | `backend/app/config.py` |
| `DEV_AUTH` | `false` | `backend/app/config.py` |
| `PROPERTY_ID` | `p_1` | `backend/app/config.py` |
| `LINE_CHANNEL_ID` / `LIFF_ID` / `LINE_CHANNEL_ACCESS_TOKEN` / `CRON_SECRET` | `""` | `backend/app/config.py` |
| `PORT` | `8000` | `Dockerfile` |
| `ROOMS` | `201`–`212` | `line-app/api/_rooms.js` |
| `DEFAULT_RENT` | `3500` | `line-app/api/_rooms.js` |
| `WATER_RATE` | `25` | `line-app/api/_rooms.js` |
| `ELEC_RATE` | `7` | `line-app/api/_rooms.js` |
| `PUBLIC_BASE_URL` | `https://<host ของ request>` | `line-app/api/run.js`, `dev.js`, `webhook.js` |
| `LIFF_ID` (line-app) | `null` (ตอบใน `/api/config`) | `line-app/api/config.js` |
| `LOGIN_CHANNEL_ID` | prefix ของ `LIFF_ID` ก่อน `-` | `line-app/api/_auth.js` |
| รอบบิล/ครบกำหนดของ seed | `2026-11` / `2026-11-16` | `line-app/api/dev.js` |
| ค่าเช่าห้องที่ index หาร 3 ลงตัวตอน seed | `3220` | `line-app/api/dev.js` |
| userId ตอน bypass ที่ไม่ได้ตั้ง `OWNER_USER_ID` | `"dev"` | `line-app/api/_auth.js` |

---

## 6. แยกตาม environment (Production / Preview / Development)

Vercel อ่าน env ตาม scope ที่เลือกตอนสร้าง (Production, Preview, Development) ไม่มี `.env.production` / `.env.test` ในเรพ และโค้ดไม่มี conditional `NODE_ENV`

| ค่า | Production | Preview | Local (`vercel dev` / uvicorn) |
|---|---|---|---|
| `VERCEL_ENV` | `production` (Vercel ตั้ง) | `preview` | `development` หรือไม่ตั้ง |
| `DEV_AUTH` (backend) | `false` — ถ้า `true` จะถูกเพิกเฉย | เปิดได้ (ไม่ใช่ production) | เปิดได้ |
| `/docs`, `/redoc`, `/openapi.json` (backend) | ปิด | เปิด | เปิด |
| `SEED_TOKEN` / `ALLOW_SEED_BYPASS` (line-app) | ใช้ไม่ได้เด็ดขาด | ใช้ได้ถ้า `ALLOW_SEED_BYPASS=true` | ใช้ได้ |
| `COOKIE_SECURE` (backend) | `true` | `true` | `false` ถ้าเป็น HTTP |
| `DATABASE_URL` | pooled | ควรใช้ Neon branch แยก | local Postgres หรือ unpooled |
| Blob store (line-app) | store จริง | **ใช้ store เดียวกับ production** ตาม README | ต้องมี OIDC/credential เอง |

ข้อควรระวัง:

1. **Preview ของ line-app ใช้ env และ Blob ชุดเดียวกับ production** — อย่าเปิด `ALLOW_SEED_BYPASS` หรือรัน seed บน preview เพราะจะทับบิลจริง
2. **Preview ของ backend ใช้ DB ชุดเดียวกับ production ถ้าไม่ได้แยก env** — ควรตั้ง `DATABASE_URL` ของ Preview เป็น Neon branch
3. **แก้ env แล้วต้อง Redeploy** — line-app จับค่าใส่ `const` ตอน module load (`api/_line.js`, `api/_auth.js`, `api/_rooms.js`) และ instance ที่ warm อยู่จะใช้ค่าเดิมจนกว่าจะ deploy ใหม่
4. `PUBLIC_BASE_URL` บน Preview ถ้าตั้งเป็นโดเมน production ลิงก์ในการ์ดจะชี้ไป production

<!-- VERIFY: env ของ Preview ถูกตั้งแยกจาก Production หรือใช้ร่วมในโปรเจกต์ Vercel ทั้งสอง — ไม่มีในเรพ -->
<!-- VERIFY: Node.js runtime จริงบน Vercel (20.x หรือ 22.x) — `engines` ระบุ `>=20` แต่ dashboard เป็นตัวตัดสิน -->
---

## 7. Checklist ตั้งค่าครั้งแรก

**Backend**

1. ตั้ง `DATABASE_URL` (pooled) + `SESSION_SECRET` + `COOKIE_SECURE=true` + `DEV_AUTH=false`
2. ตั้ง `LINE_CHANNEL_ID` + `LIFF_ID` (+ `LINE_CHANNEL_ACCESS_TOKEN` ถ้าส่งข้อความ)
3. ตั้ง `CRON_SECRET` (หรือ `DUNNING_TOKEN`) และ `PROPERTY_ID`
4. รัน `python -m alembic upgrade head` (unpooled) และ `python -m app.queue` ครั้งเดียวต่อฐาน
5. Redeploy

**line-app**

1. ตั้ง `LINE_CHANNEL_SECRET` + `LINE_CHANNEL_ACCESS_TOKEN` จาก LINE Developers Console
2. ตั้ง `LIFF_ID` + `OWNER_USER_ID`
3. ตั้ง `ROOMS` / `DEFAULT_RENT` / `WATER_RATE` / `ELEC_RATE` ให้ตรงหอ (ไม่ตั้ง = 201–212, 3500, 25, 7)
4. ตั้ง `PUBLIC_BASE_URL` เป็นโดเมน production
5. Redeploy แล้วยิง webhook Verify จาก LINE Developers Console
