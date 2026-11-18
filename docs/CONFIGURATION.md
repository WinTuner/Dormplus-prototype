<!-- generated-by: gsd-doc-writer -->

# การตั้งค่า (CONFIGURATION)

เอกสารนี้อธิบายตัวแปรสภาพแวดล้อม (environment variables) และไฟล์ config **ทั้งหมด** ของ repo นี้ ซึ่งมีสองครึ่งที่แยกกัน deploy:

| ครึ่ง | stack | โปรเจกต์ Vercel (Root Directory) | อ่าน config จาก |
|---|---|---|---|
| **backend** | FastAPI + Postgres (Neon/Supabase) | `line-backend` (`backend/`) | `backend/app/config.py` ผ่าน `pydantic-settings` → env หรือ `backend/.env` |
| **line-app** | Vercel serverless JS + Cloudflare R2 (fallback Vercel Blob) | `line-app` (`line-app/`) | `process.env` ตรง ๆ ใน `line-app/api/*.js` — **ไม่มี dotenv ใน runtime** |

> **สำคัญ:** ทั้งสองครึ่งเป็นคนละโปรเจกต์ Vercel จึงมีชุด env แยกกัน ค่าที่ชื่อซ้ำกัน (เช่น `LIFF_ID`, `CRON_SECRET`) ต้องใส่ทั้งสองโปรเจกต์ ไม่ใช่ใส่ที่เดียวแล้วใช้ร่วม — และ `CRON_SECRET` ทั้งสองที่ **ไม่ใช่ค่าเดียวกันก็ได้**

ที่มา: `backend/app/config.py`, `backend/app/db.py`, `backend/app/attempts.py`, `backend/.env.example`, `line-app/.env.example`, `line-app/api/*.js` (รวม `api/_verify.js`, `api/_pay.js`, `api/_gemini.js`, `api/_store.js`, `api/_store-r2.js`), `line-app/scripts/*.js`, `backend/vercel.json`, `line-app/vercel.json`, `backend/migrations/versions/0005_line_events.py`, `backend/README.md`, `line-app/README.md`, `docs/DEPLOYMENT.md`, `Dockerfile`

---

## 1. Backend (FastAPI)

ตัวแปรที่โค้ดอ่านจริงมี 15 ตัว (นิยามใน `Settings` ที่ `backend/app/config.py`) บวกตัวแปรสำหรับ test และตัวแปรที่ platform ฉีดให้

| Variable | Prod | Local | Default | ผลเมื่อไม่มี / ผิด |
|---|---|---|---|---|
| `DATABASE_URL` | **จำเป็น** | **จำเป็น** | `postgresql+psycopg://postgres:postgres@localhost:5432/domplus` | ต่อ DB ไม่ได้ → `/healthz` ตอบ `503 DB_UNAVAILABLE`, route อื่นล้มเป็น 500 |
| `SESSION_SECRET` | **จำเป็น** | **จำเป็น** | `dev-only-change-me` (ถูกปฏิเสธ) | `app/session.py` โยน `RuntimeError` — login และทุก request ที่มี cookie ล้มเป็น 500 |
| `COOKIE_SECURE` | **ควรเป็น `true`** | `false` ถ้าเป็น HTTP | `true` | ตั้ง `true` บน `http://127.0.0.1` → browser ไม่ส่ง cookie `dp_session` กลับ → 401 ตลอด |
| `DEV_AUTH` | ต้องเป็น `false` | `true` ได้ | `false` | เปิดบน production จริงจะถูกเพิกเฉย **แต่** ขึ้นกับการตรวจ `is_production` (`VERCEL_ENV` / `RAILWAY_ENV` / `K_SERVICE` — ดู §1.3) |
| `OWNER_ACCESS_CODE` | **จำเป็นถ้าใช้หน้าจอเจ้าของหอ `/owner`** | ตั้งก็ได้ | `""` | ว่าง = `POST /v1/auth/owner` ตอบ `503 OWNER_LOGIN_OFF` (หน้า `/owner` เปิดได้แต่ล็อกอินไม่ผ่าน) · เป็นรหัสใช้ร่วมของหอเดียว ไม่ใช่บัญชีรายคน |
| `LINE_CHANNEL_ID` | **จำเป็นถ้าใช้ LINE Login** | ไม่ใส่ก็ได้ | `""` | `POST /v1/auth/line` ตอบ `503 LINE_NOT_CONFIGURED` |
| `LIFF_ID` | **จำเป็นถ้าใช้หน้า LIFF** | ไม่ใส่ก็ได้ | `""` | `GET /v1/liff-config` คืน `{"liff_id": ""}` → หน้า LIFF `liff.init()` ไม่ได้ |
| `LINE_CHANNEL_ACCESS_TOKEN` | **จำเป็นถ้าต้องส่งข้อความ** | ไม่ใส่ก็ได้ | `""` | push ไม่Throw แต่คืน `"skipped: no LINE_CHANNEL_ACCESS_TOKEN"` แล้ว log `skipped` — ผู้ใช้ไม่ได้รับข้อความ |
| `LINE_CHANNEL_SECRET` | **จำเป็นถ้าจะรับ webhook** | ไม่ใส่ก็ได้ | `""` | `POST /v1/webhooks/line/:property_id` ตอบ `503 LINE_NOT_CONFIGURED`; ค่าต้องเป็น channel secret ของ OA เดียวกับ access token · ใช้เมื่อ `properties.line_secret_enc` ว่างเท่านั้น |
| `SECRET_ENC_KEY` | **จำเป็นถ้าเก็บ secret รายหอ** | ไม่ใส่ก็ได้ | `""` | กุญแจ Fernet สำหรับ `properties.line_secret_enc`; ไม่ตั้ง → `scripts/set_line_secret.py` เขียนไม่ได้ และ webhook ถอดค่าเดิมไม่ได้ → `503 LINE_SECRET_UNREADABLE` |
| `CRON_SECRET` | ไม่บังคับ (cron ของ backend ปิดอยู่) | ไม่ใส่ก็ได้ | `""` | endpoint `/v1/cron/daily` ยังอยู่แต่ตอบ 401 ทุกครั้ง จนกว่าจะตั้งค่านี้ — ใช้เมื่อยิงมือหรือเปิด cron กลับ (ดู §1.4) |
| `DUNNING_TOKEN` | ทางเลือกแทน `CRON_SECRET` | — | — | ชื่อเก่าที่ยังรับผ่าน `AliasChoices`; ถ้าตั้งทั้งคู่ `CRON_SECRET` ชนะ · **alias นี้มีเฉพาะฝั่ง backend** `line-app` ไม่รับชื่อนี้ |
| `PROPERTY_ID` | **ควรตั้งให้ตรงหอ** | `p_1` | `p_1` | ไม่ error แต่ทุก connection ถูกตั้ง `app.property_id` เป็นค่านี้ → RLS จะไม่เห็นแถวของหออื่นเลย และ cron จะเลือกบิลเฉพาะหอนี้ (ดู §1.6) · deployment ที่ไม่ได้ตั้ง env นี้จะเดินเป็น `p_1` เงียบ ๆ |
| `VERCEL_ENV` | platform ฉีดให้ | `vercel dev` ตั้งเป็น `development` | `""` | ใช้ตัดสิน `is_production` (ปิด `/docs`, ปิด `DEV_AUTH`) เมื่อค่าเป็น `"production"` เท่านั้น |
| `RAILWAY_ENV` | platform ฉีดให้ (ดูหมายเหตุ) | ไม่ต้องตั้ง | `""` | **ค่าใดก็ได้ที่ไม่ว่าง = `is_production`** (ไม่ต้องเป็น `"production"`) — ชื่อ env มาจากชื่อ field `railway_env` ตรง ๆ ไม่มี alias |
| `K_SERVICE` / `CLOUD_RUN_SERVICE` | platform ฉีดให้ | ไม่ต้องตั้ง | `""` | Cloud Run ตั้งชื่อ service ให้เอง → ไม่ว่าง = `is_production` · รับได้ทั้งสองชื่อ (`AliasChoices("K_SERVICE", "CLOUD_RUN_SERVICE")`) |
| `TEST_DATABASE_URL` | — | เฉพาะตอนรัน `pytest` | ไม่มี | ไม่ตั้ง → test ที่ต้องใช้ DB ถูกข้าม; **ฐานนี้ถูกล้างทุกครั้งที่รัน test** |
| `PORT` | platform ฉีดให้ | ไม่ต้องตั้ง | `8000` | Dockerfile ใช้ `${PORT:-8000}` |

### 1.1 `DATABASE_URL` — pooled vs unpooled และ role ที่ใช้

- **runtime บน Vercel:** ใช้ endpoint **pooled** (host ที่มี `-pooler`) + `?sslmode=require` ตาม `backend/README.md`
- **alembic / เครื่องมือ single-process:** ใช้ endpoint **unpooled** เพราะ migration รัน DDL หลายคำสั่งใน transaction เดียว (`backend/README.md`)
- **role ของ runtime ต้องเป็น `dormplus_app`** — role นี้มีสิทธิ์ DML บนทุกตาราง + sequences แต่ **ไม่มี `BYPASSRLS`** ซึ่งจำเป็นเพราะ RLS policy ของ migration `0004`/`0005` จะถูกข้ามทั้งหมดถ้า role มีค่านี้ (`neondb_owner` บน Neon มี) ตรวจด้วย `select rolbypassrls from pg_roles where rolname = current_user`
- **alembic ใช้ role ที่มีสิทธิ์ DDL (owner) แยกจาก runtime** — migration สร้าง/แก้ตารางและ policy จึงใช้ `neondb_owner` ได้ ส่วน `DATABASE_URL` ที่ production ใช้เสิร์ฟ request ต้องเป็น `dormplus_app` เท่านั้น
- ถ้าเปลี่ยน role ต้องตรวจว่า `select count(*) from rooms` เห็นข้อมูล **หลัง** ตั้ง `app.property_id` แล้ว (ถ้าเห็น 0 แถว ให้สงสัย `BYPASSRLS` หรือ setting ที่ยังไม่ถูกตั้ง)
- scheme ต้องเป็น `postgresql+psycopg://` (ไม่ใช่ `postgresql://`) — `backend/.env.example` ระบุให้เปลี่ยน scheme หลังคัดลอกจาก dashboard
- `migrations/env.py` อ่าน `DATABASE_URL` ผ่าน `get_settings()` (หรือ `config.attributes["database_url"]` เมื่อ test ส่งเข้ามา); `alembic.ini` **ไม่มี** `sqlalchemy.url`
- test ใช้ `TEST_DATABASE_URL` แยก และจะ truncate ทุกตาราง — ห้ามชี้มาที่ฐานจริง ใช้ Neon branch แยก (CI ต่อด้วย `postgres` ซึ่งเป็น superuser จึงข้าม RLS — `tests/test_rls.py` ระบุเรื่องนี้ไว้)

> `backend/.env.example` อ้างหน้าคัดลอก connection string ของ **Supabase** ส่วน `backend/README.md` อธิบาย production ด้วย **Neon** (pooled) — ทั้งสองใช้ได้ ขอแค่ได้ URI ที่มี `?sslmode=require` และเปลี่ยน scheme เป็น `postgresql+psycopg://`

<!-- VERIFY: ชื่อ endpoint pooled/unpooled จริงของ Neon และว่า production ตั้ง `?sslmode=require` ครบหรือไม่ — อยู่ใน Vercel Project → Settings → Environment Variables ไม่มีในเรพ -->
<!-- VERIFY: `DATABASE_URL` บน Vercel ของโปรเจกต์ `line-backend` ชี้ Neon ตัวเดียวกับที่ `backend/.env` ใช้หรือคนละตัว — เทียบจาก dashboard เท่านั้น -->
<!-- VERIFY: role ที่ผูกกับ `DATABASE_URL` บน production คือ `dormplus_app` จริง (ไม่ใช่ `neondb_owner`) — ตรวจได้จาก dashboard/psql เท่านั้น -->

> **ตรวจแล้ว 2026-11-16 (read-only):** ตอนนั้นฐานข้อมูลที่ `backend/.env` ใช้อยู่ head = `0004` และมี role `dormplus_app` ที่ `rolbypassrls = false` — **แต่ connection ของ `.env` ในเครื่องนี้ล็อกอินเป็น `neondb_owner` ซึ่ง `rolbypassrls = true`** แปลว่า RLS ถูกข้ามเมื่อรัน backend จากเครื่องนี้ ถ้าจะทดสอบเรื่องข้ามหอในเครื่อง ต้องเปลี่ยน `.env` ไปใช้ `dormplus_app` (หรือเชื่อ `tests/test_rls.py` ที่ `set local role` เอง) — production ยังต้องยืนยันจาก Vercel env ว่าใช้ `dormplus_app`

> **Head ของ migration ในเรพตอนนี้คือ `0006`** (`backend/migrations/versions/0006_invoice_child_indexes.py`) ต่อจาก `0005` (`0005_line_events.py`) และ `0004` — สร้างตาราง `line_events` (PK `event_id`) พร้อม RLS policy แบบเดียวกับ `0004` เพื่อกัน LINE ส่ง event ซ้ำ แล้วบันทึก `audit_log` ซ้ำ ฐาน/deployment ที่ยังไม่ `upgrade head` จะทำให้ `POST /v1/webhooks/line/:property_id` ล้มตอน insert `line_events` (500) · `0006` เพิ่มเฉพาะ index บน FK ของ `invoice_items`/`payments` (ไม่เปลี่ยนตาราง/policy/grant)
<!-- VERIFY: ฐาน Neon ที่ production ใช้อยู่ `alembic_version` = `0006` แล้วหรือยัง — เช็กได้จาก `select version_num from alembic_version` เท่านั้น ไม่มีในเรพ -->

### 1.2 `SESSION_SECRET`

ใช้เซ็น cookie `dp_session` (HMAC-SHA256, stdlib, อายุ 7 วัน, `HttpOnly`, `SameSite=Lax`) ที่ `backend/app/session.py`

- ค่า default `dev-only-change-me` ถูกปฏิเสธโดย `_require_real_secret()` — deployment ที่ลืมตั้งจะ **fail loudly** ไม่ยอมเซ็น cookie
- เปลี่ยนค่า = ผู้ใช้ทุกคนถูก log out ทันที
- test ตั้ง `SESSION_SECRET=test-secret` เองใน `backend/tests/conftest.py`

### 1.3 `COOKIE_SECURE` และ `DEV_AUTH` (กับดักที่สำคัญ)

`COOKIE_SECURE=true` (default) ทำให้ cookie ถูกส่งเฉพาะ HTTPS — บนเครื่องที่รัน `http://127.0.0.1` ต้องตั้ง `false` ไม่งั้น login ผ่านแต่ request ถัดไป 401

`DEV_AUTH` เปิดทาง `X-Dev-Property` / `X-Dev-Role` / `X-Dev-User` / `X-Dev-Room` (ดู `backend/app/auth.py`) เพื่อเลือกหอและบทบาทได้โดยไม่ต้องมี LINE Login

- โค้ดเช็ก `dev_auth_active = dev_auth and not is_production`
- `is_production` (`backend/app/config.py`) เป็นจริงเมื่อ **ข้อใดข้อหนึ่ง**: `VERCEL_ENV == "production"` · `RAILWAY_ENV` ไม่ว่าง (ค่าใดก็ได้) · `K_SERVICE` / `CLOUD_RUN_SERVICE` ไม่ว่าง — ไม่ใช่แค่ Vercel แล้ว
- ⚠️ ยังมีช่องว่าง: Docker / VM เปล่า ๆ ที่ไม่ตั้ง `RAILWAY_ENV` หรือ `K_SERVICE` เอง → `is_production` ยังเป็น `false` → ถ้าตั้ง `DEV_AUTH=true` ไว้ จะ**ใช้งานได้จริง** ใครก็สวมบทเจ้าของได้ ต้องมั่นใจว่า `DEV_AUTH=false` บนทุก deployment ที่ไม่ใช่เครื่องตัวเอง

<!-- VERIFY: Railway ฉีดชื่อ `RAILWAY_ENVIRONMENT` ไม่ใช่ `RAILWAY_ENV` — โค้ดอ่านเฉพาะ `RAILWAY_ENV` (field `railway_env` ไม่มี alias) จึงต้องยืนยันจาก runtime หรือตั้งค่านี้เอง -->

### 1.4 `CRON_SECRET` / `DUNNING_TOKEN` — cron รันที่ line-app ไม่ใช่ backend

**cron ที่ส่งข้อความทวงจริงคือของ `line-app`** เพราะ `line-app` เป็นตัวที่ถือ LINE userId ของผู้เช่าและส่งการ์ดบิลอยู่แล้ว

- `line-app/vercel.json`: `"crons": [{ "path": "/api/cron", "schedule": "0 2 * * *" }]`
- `backend/vercel.json`: **ไม่มี `crons` แล้ว** (มีแค่ `git.deploymentEnabled`) — ตั้งใจปิดไว้เพื่อไม่ให้ผู้เช่าที่ผูก LINE กับ backend ได้เตือนสองชุด ถ้าเปิดทั้งคู่จะมีการทวงซ้ำ
- endpoint ฝั่ง backend (`GET /v1/cron/daily`) **ยังอยู่** ใช้ยิงมือ/ทดสอบได้ และเปิด cron กลับได้ถ้าย้ายการทวงมาฝั่งนี้ (แล้วปิดของ `line-app`) — ต้องตั้ง `CRON_SECRET` บนโปรเจกต์ `line-backend` ก่อน ไม่งั้นได้ 401

ฝั่ง backend (`app/routes/cron.py`):

- Vercel เรียกเป็น `GET` และใส่ `Authorization: Bearer <CRON_SECRET>` ให้เองเมื่อตั้ง env นี้บนโปรเจกต์
- เทียบด้วย `hmac.compare_digest` — ไม่มี header, ไม่มี secret, หรือค่าไม่ตรง → `401 UNAUTHORIZED`
- `app/routes/dunning.py` (`POST /v1/dunning/run`) รับ token ทาง header เท่านั้น **token ใน query string (`?token=`) ถูกปฏิเสธ 401** เพราะ URL หลุดเข้า access log; endpoint นี้ยังรับ owner session ได้ถ้าไม่ส่ง header
- `DUNNING_TOKEN` คือชื่อเก่าที่ยังใช้ได้ (`AliasChoices("CRON_SECRET", "DUNNING_TOKEN")`) — **เฉพาะ backend**; `line-app` อ่าน `process.env.CRON_SECRET` ตรง ๆ ไม่มี alias
- ถ้าคิว Procrastinate ยังไม่ถูกสร้าง (`python -m app.queue`) cron จะตอบ `503 QUEUE_UNAVAILABLE`

ฝั่ง line-app (`line-app/api/cron.js`) — ดู §2.4

- **ตรวจแล้ว 2026-11-16:** `vercel crons list` โปรเจกต์ `line-app` คืน `/api/cron  0 2 * * *` (ลงทะเบียนจริง) · `GET /api/cron` ไม่มี header → `401` (แปลว่า `CRON_SECRET` ถูกตั้งแล้ว) · โปรเจกต์ `line-backend` ไม่มี cron job เลย
<!-- VERIFY: Hobby plan อนุญาต cron วันละครั้งและคลาดได้ถึง ±59 นาทีตามที่ README กล่าว — เป็นข้อจำกัดของ plan ไม่ได้ประกาศในเรพ -->

### 1.5 กลุ่ม LINE ฝั่ง backend

| ตัวแปร | ใช้ที่ | หมายเหตุ |
|---|---|---|
| `LINE_CHANNEL_ID` | `app/routes/auth.py` | LINE Login channel ที่ออก idToken; ว่าง → 503 |
| `LIFF_ID` | `app/main.py` | `GET /v1/liff-config` คืนให้หน้า LIFF (public โดยตั้งใจ) |
| `LINE_CHANNEL_ACCESS_TOKEN` | `app/line_push.py`, `app/dunning.py` | Messaging API push; ว่าง → คืน `skipped:` ไม่ throw · `queue_reminders` เช็กก่อน: ไม่มี token = คืน 0 ไม่เขียนคิว/`message_log` (เดิมเขียน `skipped` ทุกใบทุกวัน) |
| `LINE_CHANNEL_SECRET` | `app/routes/webhooks.py` | ตรวจ `X-Line-Signature` (HMAC-SHA256 ของ raw body แบบ base64) **เมื่อ `properties.line_secret_enc` ว่าง**; ไม่มีทั้งสองที่ → `503 LINE_NOT_CONFIGURED` · `property_id` ใน path ต้องเท่ากับ `PROPERTY_ID` ไม่งั้น `404 NOT_FOUND` · signature ผิด → `401 UNAUTHORIZED` |
| `SECRET_ENC_KEY` | `app/secrets.py` | กุญแจ Fernet (urlsafe base64 32 ไบต์) สำหรับถอด `properties.line_secret_enc` / `line_token_enc` · ไม่ตั้งหรือผิดรูป → เขียน/อ่านไม่ได้ · ถอดค่าเดิมไม่ได้ → webhook ตอบ `503 LINE_SECRET_UNREADABLE` (ไม่ใช่ 401 เพื่อให้ LINE retry) · หมุนกุญแจแล้วต้องรัน `scripts/set_line_secret.py` ใหม่ |

webhook ฝั่งนี้บันทึกทุก event ลงตาราง `line_events` (migration `0005`) ด้วย `webhookEventId` เป็น PK — LINE ส่งซ้ำจะไม่เพิ่ม `audit_log` แถวที่สอง และยังตอบ 200 เพื่อให้ LINE หยุด retry · **endpoint นี้ยังไม่ได้ผูกกับ OA จริง** (LINE Console ยังชี้ไปที่ `line-app`)

> `LINE_CHANNEL_ACCESS_TOKEN` มีอยู่ใน `backend/.env.example` แล้ว · ถ้าไม่ตั้ง การทวงหนี้จะไม่ทำอะไรเลย (คืน 0 ไม่เขียน `skipped` ทิ้งวันละแถวต่อบิล) และกลับมาทำงานเองเมื่อใส่ token

### 1.6 `PROPERTY_ID` — ตัวคุม RLS และการเลือกบิล

"1 deploy = 1 หอ" — `app/db.py` เรียก `attach_property()` ทุกครั้งที่สร้าง engine แล้วรัน `select set_config('app.property_id', <PROPERTY_ID>, true)` **ที่ต้นทุก transaction** (event `begin`; ตั้งแบบ local เพื่อให้ถูกต้องหลัง PgBouncer transaction pooling) (รวมถึง test) ทำให้ policy ของ migration `0004` (และ `line_events` ใน `0005`) กรองทุกตารางให้เห็นเฉพาะหอเดียว

- ค่า setting ว่าง/NULL = **ไม่เห็นแถวใดเลย** ไม่ใช่เห็นทุกแถว — ถ้าตั้งผิดจะดูเหมือน "ข้อมูลหาย" ไม่ใช่ error
- การกรอง `property_id` ในโค้ดยังอยู่ครบ — RLS เป็นชั้นกันพลาด ไม่ได้แทนที่
- session ทุกอันถือ `property_id` และ route ห้ามรับค่านี้จาก client (`backend/app/auth.py`)
- ค่าเดียวกันนี้ยังใช้ตอน cron/dunning เลือกบิล (`due_for_reminder`) ถ้าตั้งผิดจะไม่พบบิลที่ถึงกำหนด
- ค่า default คือ `p_1` — deployment ที่ไม่ได้ตั้ง env นี้จะเสิร์ฟหอ `p_1` เงียบ ๆ ไม่ error

<!-- VERIFY: โปรเจกต์ Vercel `line-backend` ไม่ได้ตั้ง `PROPERTY_ID` (จึงใช้ `p_1`) — เป็นค่าที่เห็นได้จาก Project → Settings → Environment Variables เท่านั้น -->

### 1.7 `OWNER_ACCESS_CODE` — ล็อกอินหน้าจอเจ้าของหอ `/owner`

"1 deploy = 1 หอ" และยังไม่มีตารางบัญชีเจ้าของ หอจึงมีเจ้าของเชิงตัวตนคนเดียวคือ **ใครก็ตามที่รู้รหัสใช้ร่วมนี้** — ไม่ใช่บัญชีรายคน ไม่มี username, ไม่มีหลายสิทธิ์

- อ่านที่ `Settings.owner_access_code` (`backend/app/config.py`, default `""`) และใช้ที่ `login_owner()` ใน `backend/app/routes/auth.py` เท่านั้น · อยู่ใน `backend/.env.example` แล้ว (บรรทัด `OWNER_ACCESS_CODE=`)
- **ว่าง = ปิด** — `POST /v1/auth/owner` ตอบ `503 OWNER_LOGIN_OFF` ทันทีโดยไม่ตรวจรหัส (หน้า `/owner` ยังโหลดได้ แต่ล็อกอินไม่ผ่าน) · ไม่ใช่ 401 เพื่อให้แยก "ยังไม่ตั้งค่า" ออกจาก "รหัสผิด"
- **รหัสผิด = `401 UNAUTHORIZED`** เทียบด้วย `hmac.compare_digest` (constant time — เดาจากรอยต่อเวลาไม่ได้)
- **rate limit:** นับเฉพาะครั้งที่ผิด ผ่าน `backend/app/attempts.py` ด้วย scope `owner-login` และ actor = IP ของ request (`request.client.host`, ไม่มี client ก็ `"unknown"`) — ผิดครบ **10 ครั้งใน 1 ชั่วโมง** ครั้งถัดไปได้ `429 TOO_MANY_ATTEMPTS` (ตาราง `auth_failures`, migration `0003`) · ครั้งที่สำเร็จไม่ถูกนับและไม่รีเซ็ตตัวนับ
- **ผลเมื่อผ่าน:** ตั้ง cookie `dp_session` ด้วย `{uid: "owner", role: "owner", property_id: <PROPERTY_ID>}` อายุ 7 วัน — สิทธิ์เจ้าของมาพร้อม `property_id` ของ deployment จึงเห็นเฉพาะหอตัวเอง (RLS ตาม §1.6)
- เปลี่ยนรหัส = เซสชันเดิมยังใช้ได้จนหมดอายุ (7 วัน) เพราะ payload ไม่ผูกกับรหัส; ต้องการเตะออกทันทีต้องเปลี่ยน `SESSION_SECRET`

> ตั้งรหัสยาวสุ่มเหมือนรหัสผ่าน (เช่น `openssl rand -hex 24`) — รหัสสั้นถูกเดาได้ และ rate limit นับตาม IP ซึ่งอาจถูกใช้ร่วมกันหลัง proxy

<!-- VERIFY: โปรเจกต์ Vercel `line-backend` ตั้ง `OWNER_ACCESS_CODE` ไว้หรือยัง (ถ้าไม่ตั้ง หน้า `/owner` ล็อกอินไม่ได้) — เห็นได้จาก Project → Settings → Environment Variables เท่านั้น -->
<!-- VERIFY: บน Vercel `request.client.host` เป็น IP ของผู้เรียกจริงหรือ IP ของ edge/proxy (ถ้าเป็นตัวหลัง ทุกคนใช้โควตากัน 10 ครั้ง/ชั่วโมง) — ต้องวัดจาก runtime จริง ไม่มีในเรพ -->

---

## 2. line-app (serverless JS)

โค้ดอ่าน `process.env` **24 ตัว** ใน `line-app/api/*.js` (นับจาก `api/config.js`, `api/cron.js`, `api/dev.js`, `api/bill.js`, `api/me.js`, `api/owner.js`, `api/qr.js`, `api/rooms.js`, `api/run.js`, `api/slip.js`, `api/webhook.js`, `api/_auth.js`, `api/_gemini.js`, `api/_line.js`, `api/_pay.js`, `api/_prepay.js`, `api/_remind.js`, `api/_rooms.js`, `api/_store.js`, `api/_verify.js`) บวกตัวแปรที่ `@vercel/blob` อ่านเอง (โค้ดไม่อ่าน) และ credential อีกสามตัวของ R2 ที่ `api/_store-r2.js` รับผ่านพารามิเตอร์ `env` (default = `process.env`) — รวม `R2_*` ทั้งสี่ที่ตารางด้านล่าง

**เพดาน 12 functions ของ Vercel Hobby:** `api/` มีไฟล์ที่ไม่ขึ้นต้นด้วย `_` **12 ไฟล์พอดี** — `bill.js`, `config.js`, `cron.js`, `dev.js`, `me.js`, `owner.js`, `qr.js`, `rooms.js`, `run.js`, `slip.js`, `slip-image.js`, `webhook.js` (helper ที่ขึ้นต้นด้วย `_` อีก 16 ไฟล์ไม่นับเป็น function) การเพิ่ม endpoint ที่ 13 จะทำให้ deploy ล้มด้วย `exceeded_serverless_functions_per_deployment` — ต้องรวมหรือลบไฟล์เดิมก่อน และ helper ใหม่ต้องตั้งชื่อขึ้นต้นด้วย `_` เสมอ

| Variable | Prod | Local | Default | ผลเมื่อไม่มี / ผิด |
|---|---|---|---|---|
| `LINE_CHANNEL_SECRET` | **จำเป็น** | ต้องตั้งเอง | — | `verify()` คืน `false` → webhook ตอบ `401 bad signature` ทุก request (อาการ "Verify ไม่ผ่าน") |
| `LINE_CHANNEL_ACCESS_TOKEN` | **จำเป็น** | ต้องตั้งเอง | — | `call()` throw; `webhook`/`run`/`slip`/`cron` ดักไว้จึงยัง 200 แต่ไม่มีข้อความออก; `api/dev.js` ไม่ดัก → **500** |
| `CRON_SECRET` | **จำเป็น ถ้าจะให้มีการทวงอัตโนมัติ** | ไม่ใส่ก็ได้ | `""` | `/api/cron` ตอบ `503 NOT_CONFIGURED` (ว่างหรือสั้นกว่า 16 ตัว) → ไม่มีใครถูกทวง แต่ระบบอื่นทำงานปกติ |
| `LIFF_ID` | **จำเป็นถ้าใช้ LIFF** | ไม่ใส่ก็ได้ | `null` (จาก `api/config.js`) | `/api/config` คืน `liffId: null` → หน้าเว็บขึ้น "เปิดหน้านี้จากปุ่มในแชท LINE เท่านั้น"; ปุ่มในการ์ดเป็น URL ตรง (`<baseUrl>/liff/bill.html`); ถ้าไม่มี `LOGIN_CHANNEL_ID` ด้วย ทุก endpoint ที่ต้องล็อกอินตอบ 401 |
| `LOGIN_CHANNEL_ID` | ไม่บังคับ | ไม่บังคับ | อนุมานจากส่วนหน้า `-` ของ `LIFF_ID` | ถ้า LIFF อยู่คนละ provider กับ LINE Login ต้องตั้ง ไม่งั้นตรวจ idToken ไม่ผ่าน (403) |
| `OWNER_USER_ID` | **จำเป็น** | ไม่ใส่ก็ได้ | — | ไม่มี root owner → `/api/rooms`, `/api/run` ตอบ 403 และไม่มีการ์ด "ยืนยันการชำระ" ส่งถึงใคร · cron ก็ไม่ส่งสรุปทวงให้เจ้าของ |
| `SEED_TOKEN` | **ไม่ควรตั้ง** | ตั้งได้ | — | ถ้าไม่ตั้งหรือสั้นกว่า 16 ตัว → `/api/dev` ตอบ 403 และ bypass ปิด (ปลอดภัยกว่า) |
| `ALLOW_SEED_BYPASS` | **ต้องไม่ตั้ง / `false`** | `true` ได้ | — (ปิด) | ไม่มีผลบน production; บน preview เปิด bypass + `/api/dev` ได้ — แต่ preview ไม่มี `R2_*` จึงเขียนไม่ลง และถ้าไปเพิ่ม `R2_*` ให้ preview จะเขียนลง bucket จริงทันที (ห้าม) |
| `RICHMENU_OWNER_ID` | ไม่บังคับ | ไม่บังคับ | — | ไม่สลับ rich menu ให้เจ้าของที่ถูกเชิญ (`api/owner.js`) |
| `RICHMENU_TENANT_ID` | ไม่บังคับ | ไม่บังคับ | — | ไม่สลับ rich menu ให้ผู้เช่าที่ผูกห้อง (`api/qr.js`) |
| `PUBLIC_BASE_URL` | แนะนำ | ไม่บังคับ | `` `https://${req.headers.host}` `` | ใช้ host ของ request — บน Vercel ปกติถูกต้อง · `api/cron.js` ใช้ค่านี้ทำลิงก์ในข้อความทวง |
| `ROOMS` | **ควรตั้งให้ตรงหอ** | ไม่บังคับ | `201`…`212` (12 ห้อง) | ใช้ห้อง 201–212; อ่านครั้งเดียวตอน module load · cron ก็วนเฉพาะห้องในลิสต์นี้ |
| `DEFAULT_RENT` | ไม่บังคับ | ไม่บังคับ | `3500` | ค่าเช่าเริ่มต้น/ห้อง |
| `WATER_RATE` | ไม่บังคับ | ไม่บังคับ | `25` | ค่าน้ำ/หน่วย |
| `ELEC_RATE` | ไม่บังคับ | ไม่บังคับ | `7` | ค่าไฟ/หน่วย |
| `SLIPOK_API_KEY` | ไม่บังคับ | ไม่บังคับ | — | ใช้คู่กับ `SLIPOK_BRANCH_ID`; ตั้งไม่ครบทั้งคู่ = ตรวจสลิปไม่ทำงาน (`ok: null`, `reason: "not_configured"`) แต่สลิปยังถูกบันทึก (§2.5) |
| `SLIPOK_BRANCH_ID` | ไม่บังคับ | ไม่บังคับ | — | branch ของหอนี้ใน SlipOK — ต้องผูกบัญชีรับเงินของหอไว้ ไม่งั้นสลิปทุกใบได้ `1014` (บัญชีผู้รับไม่ใช่บัญชีของหอ) |
| `SLIP_AUTO_CONFIRM` | **ควรตั้ง `0` บน Preview** | ไม่บังคับ | ไม่ตั้ง (= ให้ `dorm.autoConfirm` ตัดสิน) | kill switch ของทั้ง deployment: `0`/`off`/`false` (ไม่สนตัวพิมพ์/ช่องว่าง) → `autoConfirmOn()` ใน `api/_pay.js` คืน `false` ทันที **ชนะ `dorm.autoConfirm`** · ค่าอื่นหรือไม่ตั้ง = เปิด/ปิดตาม `dorm.autoConfirm` (ค่าเริ่มต้น = ปิด) · อ่านทุกครั้งที่เรียก ไม่ต้อง redeploy |
| `GEMINI_API_KEY` | ไม่บังคับ | ไม่บังคับ | — | เปิด "อ่านมิเตอร์จากรูป" (`POST /api/run {action:"read"}`, `api/_gemini.js`) — ไม่ตั้ง = `503 METERS_OFF` และปุ่มถ่ายรูปยังขึ้นแต่กดแล้วได้ข้อความให้พิมพ์เอง · ส่งรูปไป Google (PDPA) |
| `GEMINI_MODEL` | ไม่บังคับ | ไม่บังคับ | `gemini-2.5-flash` | เปลี่ยนโมเดลที่อ่านมิเตอร์ (ต้องรองรับ `responseSchema`) |
| `BILL_PERIOD` | ไม่บังคับ | ไม่บังคับ | `""` (seed ใช้ `2026-11`) | `/api/run` ถ้า body ไม่ส่ง `period` และ env ว่าง → `400 VALIDATION`; `/api/rooms` คืน `period: null` |
| `BILL_DUE` | ไม่บังคับ | ไม่บังคับ | `""` (seed ใช้ `2026-11-16`) | บิลเก็บ `due: ""`/`null` → การ์ดแสดงค่าว่าง และ **cron จะข้ามบิลนั้น** (`candidateBills` ต้องมี `due`) |
| `VERCEL_ENV` | platform ฉีดให้ | `vercel dev` ตั้งเป็น `development` | `""` | ใช้ปิด bypass บน production (`IS_PRODUCTION`) |

ตัวแปรที่ **โค้ดไม่เคยอ่านเอง** แต่ platform/library ต้องใช้:

> **สถานะจริง 18 พ.ย. 2026 (จาก `docs/DEPLOYMENT.md` §3.2.1):** production ของ `line-app` รันบน **R2** (`R2_BUCKET=domplus-pcat` + credential ครบสี่ตัวบน Production) เพราะ Blob ใช้โควต้าฟรีครบและถูก pause 30 วัน · **Preview ไม่มี `R2_*`** (token จำกัดที่ bucket เดียว) จึงอ่าน storage ไม่ได้ — ตั้งใจให้เป็นแบบนั้น · ถอยกลับ Blob ทำไม่ได้ในช่วงที่ store ยังถูก pause

| Variable | ใครอ่าน | ต้องสร้างเองไหม |
|---|---|---|
| `BLOB_STORE_ID` | `@vercel/blob` | ไม่ต้อง — `vercel storage connect` ใส่ให้ · **ถูกเมินทั้งหมดเมื่อตั้ง `R2_BUCKET`** (กรณี production ปัจจุบัน) |
| `VERCEL_OIDC_TOKEN` | `@vercel/blob` (คู่กับ `BLOB_STORE_ID`) | ไม่ต้อง — Vercel ฉีดตอน runtime · **ถูกเมินเมื่อตั้ง `R2_BUCKET`** |
| `BLOB_READ_WRITE_TOKEN` | **ไม่มีใน runtime** — ทุก call ใช้ `access: "private"` + OIDC | **ไม่ต้องตั้งบน deployment** (และห้ามตั้ง) · **แต่ต้องใช้ตอนรัน `scripts/migrate-blob-to-r2.js` / `check-r2-copy.js` ด้วยมือ** (สคริปต์เรียก `list()`/`get()` ตรง ๆ นอก Vercel จึงไม่มี OIDC) |
| `R2_BUCKET` | `api/_store.js` (บรรทัดที่ 8, ตอน module load) | **ตั้งบน production แล้ว** — มีค่านี้เมื่อไร **ทุกอย่าง** (JSON key + รูปสลิป + list) ไป R2 และตัวแปร Blob ทั้งสามถูกเมิน · บน Preview ไม่ตั้ง |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | `api/_store-r2.js` | ต้องมี **ครบทั้งสาม** คู่กับ `R2_BUCKET` (S3 API token ของ bucket) — ขาดตัวใดตัวหนึ่ง `createStore()` โยน error ทุก request จนกว่าจะแก้ env |

- R2 ใช้ endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/<R2_BUCKET>` ด้วย `region: "auto"` และเซ็นด้วย `aws4fetch` (ไม่ใช้ `@aws-sdk/client-s3`)
- path เดียวกันทั้งสอง backend (`kv/<key>.json`, `slips/…`) — bucket ที่คัดลอกแล้วจึงอ่านได้ทันทีโดยไม่ต้องแปลง key

<!-- VERIFY: ชื่อ bucket จริงบน Cloudflare, account id และว่า R2 token ที่ใช้เป็นของ bucket เดียวกันหรือไม่ — อยู่บน dashboard Cloudflare ไม่มีในเรพ -->
<!-- VERIFY: ชื่อ/region ของ Blob store (`domplus-bills`, `sin1`) มาจาก README และ `vercel storage connect` ใส่ `BLOB_STORE_ID` จริงหรือไม่ — ตรวจ Project → Settings → Environment Variables -->
<!-- VERIFY: Vercel ฉีด `VERCEL_OIDC_TOKEN` ทุก deployment รวม Preview หรือไม่ — ไม่มีไฟล์ในเรพยืนยัน -->

### 2.1 `ROOMS` / `DEFAULT_RENT` / `WATER_RATE` / `ELEC_RATE` และการตั้งค่าหอ (`dorm`)

`api/_rooms.js` อ่าน `ROOMS`, `DEFAULT_RENT`, `WATER_RATE`, `ELEC_RATE` **ครั้งเดียวตอน module load** แล้วใส่ `const` ระดับบนสุด

- `ROOMS` เป็น comma-separated; เปลี่ยนแล้วข้อมูล Blob ของห้องเดิม (`room:<room>`, `bill:<room>`, `meter:<room>`) ไม่ถูกลบ
- ค่าเช่า/เรตถูก wrap ด้วย `Number()` — ใส่ค่าที่แปลงไม่ได้ (เช่น `25 บาท`) จะได้ `NaN` แล้วยอดบิลกลายเป็น `NaN` โดยไม่ error
- **ลำดับความสำคัญ (ตรวจจาก `api/_rooms.js`):** env → ค่าที่เจ้าของบันทึกจากหน้าตั้งค่าหอ (`dorm` ใน Blob) → ค่าเฉพาะห้อง (`room:<room>`)
  - `baseDefaults()` รับ `rent`/`waterRate`/`elecRate` จาก `dorm` **เฉพาะเมื่อเป็นจำนวนเต็ม ≥ 0** (`Number.isInteger`) ค่าอื่น (สตริง, ทศนิยม, ค่าลบ) ถูกเมินแล้วตกกลับไปใช้ env
  - `configFor(room)` เอา `room:<room>` ทับค่าจาก `dorm`/env แบบ spread ตรง ๆ (ไม่ตรวจชนิดข้อมูล)
- **หน้าตั้งค่าหอในแอป** — `GET /api/rooms?settings=1` อ่าน (เจ้าของและ viewer) · `POST /api/rooms` เขียน (เจ้าของเท่านั้น) · เก็บที่ Blob key `dorm` = `{ name, rent, waterRate, elecRate, dueDay, promptpay }`
  - ฟิลด์ที่ **ไม่ส่งมา** = คงค่าเดิม · ฟิลด์ที่ส่ง `null` (หรือ `promptpay: ""`) = **ลบค่านั้นออก** จาก object → กลับไปใช้ env/default · ถ้าไม่เหลือฟิลด์ใด ระบบเขียน `dorm` เป็น `null`
  - `name` ยาว ≤ 60 ตัวอักษร · `dueDay` จำนวนเต็ม 1–28 · `rent` 0–100000 · `waterRate`/`elecRate` 0–10000
  - `promptpay` รับเบอร์มือถือ 10 หลัก, เลขบัตรประชาชน 13 หลัก หรือ e-Wallet 15 หลัก แล้วเก็บเป็นตัวเลขล้วน (`normalizeId()` ใน `api/_promptpay.js`); รูปแบบอื่นได้ `400 VALIDATION`
- **`dueDay` ใช้สร้างวันครบกำหนดของบิล** — `api/run.js` เรียงลำดับ `due` ใน body → env `BILL_DUE` → `dorm.dueDay` (วันที่ `dueDay` ของเดือนที่ออกบิล) → `""` ดังนั้นถ้าตั้ง `BILL_DUE` ไว้ ค่านั้น **ชนะ** `dueDay`; บิลที่ `due` ว่างจะถูก cron ข้าม
- **`promptpay` ใช้สร้าง QR พร้อมเพย์ในบิล** (`api/bill.js` + `api/_promptpay.js`) — ไม่ตั้ง = `/api/bill` ไม่มี QR แต่บิลยังออกและบันทึกการชำระได้ตามปกติ
- **ผลกับบิลที่ออกไปแล้ว: ไม่ย้อนหลัง** — ค่าใหม่มีผลกับบิลที่ออกครั้งถัดไป; บิลที่ออกแล้วต้อง void + ออกใหม่ (`POST /api/run`)

`POST /api/rooms` รับสองรูปแบบ (ทั้งคู่เจ้าของเท่านั้น):

| Body | ผล |
|---|---|
| `{ "dorm": { ... } }` | แก้ค่าหอตามด้านบน; ตอบ `{ dorm, defaults }` |
| `{ "room": "201", "rent"?: n, "waterRate"?: n, "elecRate"?: n }` | ต้องมีอย่างน้อยหนึ่งค่า; ห้องต้องอยู่ใน `ROOMS` ไม่งั้น `404`; ตอบ `{ room, config }` |

- ค่าที่ระดับห้องต้องเป็นจำนวนเต็ม ≥ 0 และไม่เกินเพดาน (`rent` 100000, อัตรา 10000) ไม่งั้น `400 VALIDATION`
- ⚠️ **ที่ระดับห้อง `null` ไม่ได้แปลว่า "ล้างค่า"** — `Number(null)` = 0 จึงกลายเป็น 0 บาท (ต่างจาก `{dorm}` ที่ `null` = ล้างค่ากลับไปใช้ env)
- ⚠️ การบันทึกห้องหนึ่งครั้งเขียน **config ที่ merge แล้วทั้งชุด** ลง `room:<room>` (rent/waterRate/elecRate) — หลังจากนั้นห้องนั้น **ไม่ตาม** ค่า `dorm`/env ที่เปลี่ยนอีกจนกว่าจะกดบันทึกห้องนั้นใหม่ และไม่มี endpoint สำหรับลบ override ของห้อง (ต้องแก้ Blob เอง)
- env ยังเป็น **fallback** ของห้องที่ยังไม่เคยตั้งค่า — เปลี่ยน env แล้วต้อง Redeploy และมีผลเฉพาะห้องที่ยังไม่มี `room:<room>`

### 2.2 `SEED_TOKEN` / `ALLOW_SEED_BYPASS`

`SEED_TOKEN` ต้องยาว **≥ 16 ตัว** ไม่งั้นไม่นับว่าตั้งแล้ว (`MIN_SEED_TOKEN_LENGTH` ใน `api/_auth.js`) ส่งทาง header `x-seed-token` เท่านั้น (ไม่รับใน URL) ใช้กับ:

- `POST /api/dev?do=seed` — สร้างบิลตัวอย่างทุกห้อง
- `POST /api/dev?do=sendbill` — ยิงการ์ดบิลหาหนึ่ง userId
- bypass การตรวจ idToken แล้วคืน `OWNER_USER_ID` (หรือ `"dev"` ถ้าไม่ได้ตั้ง)

`BYPASS_ALLOWED` เป็นจริงเมื่อ **ไม่ใช่ production** และ (`ALLOW_SEED_BYPASS=true` หรือ `VERCEL_ENV=development`) — บน production ปิดเสมอไม่ว่าตั้งอะไร และ `/api/dev` ตอบ 404

### 2.3 `OWNER_USER_ID` / `RICHMENU_*`

- `OWNER_USER_ID` = LINE userId ของเจ้าของหอคนแรก ("root") ตัดสินสิทธิ์ใน `roleOf()`/`isRoot()` และเป็นปลายทางการ์ดยืนยันการชำระ; root คนเดียวที่เชิญ/ถอนเจ้าของคนอื่นได้ (เจ้าของเพิ่มเติมเก็บใน Blob key `owner:<userId>`) · cron ใช้ค่านี้ส่งสรุปทวงให้เจ้าของ (`_remind.js`)
- `RICHMENU_OWNER_ID` ใช้ตอนรับสิทธิ์เจ้าของ (`api/owner.js`), `RICHMENU_TENANT_ID` ใช้ตอนผู้เช่าผูกห้องด้วย QR (`api/qr.js`) — ไม่ตั้งก็แค่ไม่สลับเมนู

### 2.4 `CRON_SECRET` (line-app) — ตัวที่ทำให้มีการทวงจริง

`GET /api/cron` ถูกเรียกโดย Vercel Cron วันละครั้ง (`line-app/vercel.json`: `0 2 * * *` = 02:00 UTC = 09:00 เวลาไทย)

- ต้องยาว **≥ 16 ตัว** (`MIN_SECRET_LENGTH` ใน `api/cron.js`) สุ่มเอา เช่น `openssl rand -hex 24`; สั้นกว่านั้นถือว่ายังไม่ตั้ง
- เมื่อตั้ง env นี้บนโปรเจกต์ Vercel จะแนบ `Authorization: Bearer <CRON_SECRET>` ให้เอง — ไม่ต้องตั้ง header ที่ไหน
- รับเฉพาะ `GET`: ไม่ใช่ GET → `405 METHOD_NOT_ALLOWED` · ไม่ได้ตั้ง/สั้นไป → `503 NOT_CONFIGURED` · header ไม่ตรง → `401 UNAUTHORIZED`
- ไม่ใช่ `DUNNING_TOKEN` — ชื่อเก่านั้นเป็น alias ของ backend เท่านั้น
- วันที่คิดตามเวลาไทย (`Asia/Bangkok`) ไม่ใช่ UTC ของเซิร์ฟเวอร์
- กันรันซ้อนด้วย Blob key `cron-lock` (15 นาที): ถ้ารอบก่อนยังไม่จบ รอบใหม่ตอบ `200 {"skipped":"another run is in progress"}` — Vercel retry จึงไม่ทำให้ส่งซ้ำ
- ตั้งแล้ว **ต้อง Redeploy** — env ของ Vercel มีผลกับ deployment ใหม่ · `cron.js` อ่าน `CRON_SECRET` ทุก request แต่ `_line.js` / `_auth.js` / `_rooms.js` อ่านตอน module load (ดู §6 ข้อ 3) · `SLIP_AUTO_CONFIRM` และ `SEED_TOKEN` อ่านทุกครั้งที่เรียก จึงมีผลทันทีหลัง redeploy

<!-- VERIFY: มีการตั้ง `CRON_SECRET` (≥ 16 ตัว) บนโปรเจกต์ `line-app` แล้วหรือยัง และค่าเดียวกับที่ Vercel ใช้แนบ header — เห็นได้ที่ Project → Settings → Environment Variables -->

### 2.5 `SLIPOK_API_KEY` / `SLIPOK_BRANCH_ID` — ตรวจสลิปกับธนาคาร

`api/_verify.js` ส่งรูปสลิปไปที่ SlipOK (`POST https://api.slipok.com/api/line/apikey/<SLIPOK_BRANCH_ID>`, header `x-authorization: <SLIPOK_API_KEY>`, timeout 10 วินาที) — หนึ่ง branch ต่อหนึ่งหอ

- **ตั้งทั้งคู่หรือไม่ตั้งเลย** — `askSlipok()` คืน `null` ทันทีถ้าขาดตัวใดตัวหนึ่ง แล้ว `verifySlip()` คืน `{ok: null, reason: "not_configured"}` · สลิปยังถูกบันทึกและส่งการ์ดให้เจ้าของตามปกติ แค่ไม่มีผลตรวจ
- **branch ต้องผูกบัญชีรับเงินของหอไว้ก่อน** — ถ้าไม่ผูก (หรือผูกบัญชีอื่น) สลิปทุกใบจะได้ code `1014` = "บัญชีผู้รับไม่ใช่บัญชีของหอ" → `ok: false` ทั้งที่ผู้เช่าโอนจริง — ตรวจ branch ใน SlipOK dashboard ก่อนเปิดใช้
- โค้ดส่ง `log: true` เสมอ — ถ้าไม่มี flag นี้ SlipOK แค่อ่านสลิป ไม่ตรวจบัญชีผู้รับและไม่จำสลิปไว้กันสลิปซ้ำ
- ผลตรวจ `ok === true` ของสลิปบิลรายเดือน (รูปใหม่) **ปิดบิลเอง** เป็น `paid` + ใบเสร็จ (`autoConfirmed: true`) **เมื่อหอเปิดสวิตช์เท่านั้น** (`dorm.autoConfirm`, ค่าเริ่มต้น = ปิด) — `SLIP_AUTO_CONFIRM=0|off|false` เป็น kill switch ปิดทั้ง deployment (Preview ใช้ Blob store เดียวกับ production ให้ตั้ง `SLIP_AUTO_CONFIRM=0` ตอนทดสอบ) · ผลอื่นทุกแบบ สลิปโอนก่อนบิลออก/prepay และการแก้หมายเหตุ เป็น **หลักฐานให้เจ้าของ** บิลยังเป็น `pending` จนเจ้าของกดยืนยัน · `ok: null` = ตรวจไม่ได้ (ผู้ให้บริการล่ม/สลิปใหม่เกินไป/อ่าน QR ไม่ได้) ไม่ใช่ "สลิปปลอม" · code `1012` = สลิปซ้ำ, `1013` = ยอดไม่ตรงบิล, `1014` = บัญชีผู้รับผิด
- ระบบยังกันสลิปซ้ำด้วย key ของตัวเอง (`slip-ref:<transRef>` ใน Blob) เพราะ SlipOK จำได้เฉพาะภายใน branch
- "ตรวจไม่ได้" (500/502/timeout/ไม่ตั้งค่า) ไม่ทำให้สลิปหาย — `slip.js` บันทึกและ push ต่อเสมอ

<!-- VERIFY: `SLIPOK_API_KEY` / `SLIPOK_BRANCH_ID` ถูกตั้งบนโปรเจกต์ `line-app` แล้วหรือยัง และ branch ผูกบัญชีรับเงินของหอจริง — เห็นได้ที่ Vercel env + SlipOK dashboard เท่านั้น -->
<!-- VERIFY: แผน SlipOK ที่ใช้อยู่และ quota ต่อเดือน — อยู่นอกเรพ -->

### 2.6 `Cache-Control` ของแต่ละ endpoint

| Endpoint | Header | เหตุผล |
|---|---|---|
| `/api/config` | `public, max-age=300, s-maxage=300, stale-while-revalidate=600` | คำตอบเหมือนกันทุกคนและเปลี่ยนเฉพาะเมื่อ `LIFF_ID` เปลี่ยน → ให้ CDN cache 5 นาที ลด cold start ก่อน `liff.init()` |
| `/api/bill`, `/api/me`, `/api/owner`, `/api/rooms`, `/api/qr`, `/api/dev` | `no-store` | ข้อมูลรายผู้ใช้/สถานะบิลเปลี่ยนได้ทุกเมื่อ |
| `/api/slip-image` | `private, no-store` | รูปสลิปเป็นข้อมูลส่วนตัว ต้องไม่ถูก cache ที่ CDN |
| `/api/cron` | ไม่ตั้ง header | เรียกโดย Vercel Cron พร้อม secret และตอบ JSON สั้น ๆ |
| `/liff/*` และ `/` (หน้า LIFF) | `public, max-age=0, s-maxage=300, stale-while-revalidate=86400` | หน้าเป็น shell 110 KB ที่อ่านข้อมูลผ่าน `/api` ทั้งหมด → ให้ edge เก็บ 5 นาที เปิดจากแชทซ้ำจึงไม่ต้องโหลดใหม่ (deploy purge edge เอง) |

- `/api/config` เป็น public จริง: **ห้ามใส่ข้อมูลรายผู้ใช้หรือ secret ลงไป** ไม่งั้นจะติด CDN ไปหาทุกคนภายใน 5 นาที
- อย่าเปลี่ยน `/api/config` เป็น `no-store` — หน้า LIFF จะช้าลงโดยไม่จำเป็น (เป็น request แรกก่อน `liff.init()`)
- Header ของหน้า LIFF อยู่ใน `line-app/vercel.json` (`headers`) ไม่ใช่ในโค้ดหน้า — หน้าไม่มีข้อมูลผู้ใช้อยู่ในตัว จึง cache ได้ปลอดภัย

---

## 3. รูปแบบไฟล์ config

### 3.1 `backend/.env`

`pydantic-settings` อ่าน `env_file=".env"` จาก **current working directory** และ `extra="ignore"`

```bash
# คัดลอกจาก .env.example แล้วแก้ค่า (ไฟล์นี้มีครบ 13 key ตามตัวอย่างล่าง)
DATABASE_URL=postgresql+psycopg://user:pass@host:5432/domplus
DEV_AUTH=false
LINE_CHANNEL_ID=
LIFF_ID=
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
SECRET_ENC_KEY=
SESSION_SECRET=change-me-to-a-long-random-value
COOKIE_SECURE=true
OWNER_ACCESS_CODE=
TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test
CRON_SECRET=
PROPERTY_ID=p_1
```

- ไม่ต้องใส่ quote; คอมเมนต์ขึ้นต้นด้วย `#`
- env ของ process ชนะไฟล์ `.env`
- ต้องรันคำสั่งจากโฟลเดอร์ `backend/` ไม่งั้นหา `.env` ไม่เจอ (ค่า default จะถูกใช้)
- `.gitignore` ของ backend คือ `.env*` — ไฟล์ `backend/.env.local` ที่มีอยู่เป็น artifact ของ Vercel CLI (`VERCEL_OIDC_TOKEN`) **ห้าม commit และห้ามคัดลอก token ลงเอกสาร**
- ถ้าใช้ role `dormplus_app` ในเครื่องด้วย ต้องสร้าง role นั้นใน Postgres local และให้สิทธิ์ DML ก่อน ไม่งั้น connection แรกจะ error — หรือใช้ superuser ในเครื่องแล้วรู้ไว้ว่า RLS จะถูกข้าม (test จึงต้องมี `tests/test_rls.py` แยก)
- ไม่มี `config.json` / `config.yaml`; `alembic.ini` เก็บแค่ `script_location` กับ logger ไม่มี connection string

### 3.2 `line-app` — `.env.example` มีไว้ให้สคริปต์ ไม่ใช่ให้ runtime

- **มี `line-app/.env.example`** (tracked ใน git) — `.gitignore` เป็น `.env*` แต่มี `!.env.example` ยกเว้นไว้ · ไฟล์นี้จดเฉพาะของงาน offline: `BLOB_READ_WRITE_TOKEN` + `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_BUCKET`
- **runtime บน Vercel ไม่อ่านไฟล์นี้** — ไม่มี dotenv ใน dependency (`package.json` มีแค่ `@vercel/blob`, `aws4fetch`, `qrcode-svg`) และไม่มี `--env-file` ในสคริปต์ที่รันเซิร์ฟเวอร์ (ทั้งไฟล์ `scripts` และ `test`)
- สคริปต์ offline ต้องโหลดเองด้วย `node --env-file=.env …` (รูปแบบที่ `.env.example` เขียนไว้) หรือส่ง env ทาง shell:
  - `scripts/migrate-blob-to-r2.js` — `BLOB_READ_WRITE_TOKEN` + (`R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_BUCKET`) · โหมด `--dry` ไม่ต้องมี credential R2 แต่ยังต้องมี token ของ Blob เพื่ออ่าน
  - `scripts/check-r2-copy.js` — ครบทั้งห้าตัว (เทียบ Blob กับ R2), `scripts/backup-r2.js` — `R2_*` ทั้งสี่
  - `scripts/setup-richmenu.js` / `scripts/set-richmenu-image.js` — `LINE_CHANNEL_ACCESS_TOKEN` + `LIFF_ID`
- `line-app/.env` (gitignored) **มีอยู่ในเครื่อง dev** และชี้ R2 ของ production — `POST /api/dev?do=seed` จากเครื่องจะเขียนทับข้อมูลจริง (ดู `docs/DEPLOYMENT.md` §3.2.1)
- **การใส่ `.env` เฉย ๆ ไม่มีผลกับ deployment** — ต้องตั้งที่ Vercel → Project → Settings → Environment Variables หรือส่งทาง shell ตอนรันสคริปต์
- `line-app/vercel.json` เก็บ `git.deploymentEnabled`, **`crons` (`/api/cron`, `0 2 * * *`)**, `rewrites` (`/` → `/liff/bill.html`) และ security headers
- `backend/vercel.json` เก็บเฉพาะ `git.deploymentEnabled` — ไม่มี `crons`
- ค่าทั้งหมดมาจาก Vercel → Project → Settings → Environment Variables หรือจาก shell ตอน `vercel dev` / รันสคริปต์

---

## 4. Required vs optional — สรุปตาม environment

### Production

**Backend (`line-backend`)** ต้องตั้ง:

- `DATABASE_URL` (pooled + `sslmode=require`, role `dormplus_app` ที่ไม่มี `BYPASSRLS`)
- `SESSION_SECRET` (ค่าสุ่มยาว ไม่ใช่ `dev-only-change-me`)
- `COOKIE_SECURE=true`
- `DEV_AUTH=false`
- `OWNER_ACCESS_CODE` (ถ้าใช้หน้าจอเจ้าของหอ `/owner` — ไม่ตั้ง = `POST /v1/auth/owner` ตอบ `503 OWNER_LOGIN_OFF`)
- `LINE_CHANNEL_ID` และ `LIFF_ID` (ถ้าเปิด LINE Login/LIFF)
- `LINE_CHANNEL_ACCESS_TOKEN` (ถ้าจะให้ backend ส่งข้อความ — cron ฝั่งนี้ปิดอยู่)
- `PROPERTY_ID` (ถ้าไม่ใช่ `p_1` — ค่านี้คุม RLS ไม่ใช่แค่ cron)
- `CRON_SECRET` **เฉพาะเมื่อ** จะยิง `/v1/cron/daily` หรือ `POST /v1/dunning/run` ด้วย header เอง / เปิด cron กลับมา

**line-app** ต้องตั้ง:

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LIFF_ID`
- `OWNER_USER_ID`
- `CRON_SECRET` (≥ 16 ตัว — ถ้าไม่ตั้ง การทวงอัตโนมัติรายวันไม่ทำงานเลย)

ไม่บังคับ: `SLIPOK_API_KEY` + `SLIPOK_BRANCH_ID` (ตั้งคู่กัน และ branch ต้องผูกบัญชีรับเงินของหอ), `RICHMENU_OWNER_ID` / `RICHMENU_TENANT_ID`, `ROOMS` / `DEFAULT_RENT` / `WATER_RATE` / `ELEC_RATE` (มี default ในโค้ด), `PUBLIC_BASE_URL` (ไม่ตั้ง = ใช้ host ของ request)

**สถานะ storage ตอนนี้ (จาก `docs/DEPLOYMENT.md` §3.2.1):** production ตั้ง `R2_BUCKET` + credential ครบสี่ตัวแล้ว จึงรันบน R2 · **Preview ไม่มี `R2_*`** → แตะ storage ไม่ได้ (ตั้งใจ) · การถอยกลับ Blob ทำไม่ได้จนกว่า store จะพ้นช่วง pause

ถ้าติดตั้งใหม่ตั้งแต่ต้น: **ไม่ตั้ง R2 เลย = Vercel Blob (OIDC, ไม่ต้องมี token)** · ถ้าจะย้ายไป R2 ต้องตั้ง `R2_BUCKET` + `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` **ครบทั้งสี่ตัวในรอบ deploy เดียวกัน** — ขาดตัวใดตัวหนึ่ง `api/_store-r2.js` โยน error ทุก request ที่แตะ storage (ไม่ fallback กลับ Blob) · คัดลอกข้อมูลก่อนด้วย `scripts/migrate-blob-to-r2.js` (ต้องมี `BLOB_READ_WRITE_TOKEN` ตอนรันมือ)

ค่าหอ (`rent`, `waterRate`, `elecRate`, `dueDay`, `promptpay`, `name`) **ตั้งจากหน้า settings ในแอป** (`POST /api/rooms {dorm}`) ไม่ใช่ env — env เป็นเพียงค่า fallback ของห้องที่ยังไม่เคยบันทึก และไม่มีผลกับห้องที่มี `room:<room>` แล้ว (ดู §2.1)

ไม่ตั้งใน production: `SEED_TOKEN`, `ALLOW_SEED_BYPASS`, `DEV_AUTH=true`

### Local

- backend: `cp .env.example .env` แล้วตั้ง `COOKIE_SECURE=false`; `DEV_AUTH=true` ได้; `SESSION_SECRET` อะไรก็ได้ที่ไม่ใช่ placeholder (test ใช้ `test-secret`); `LINE_*`/`CRON_SECRET` ไม่ใส่ก็รันได้แต่ฟีเจอร์นั้นจะปิด
- line-app: ไม่มี HTTP server ในเรพ — smoke test ตั้ง env เองในโปรเซส (`smoke.js`, `smoke-handlers.js`, `smoke-reads.js`, `smoke-usecases.js`, `smoke-cron.js`) ถ้าจะยิง API จริงต้องตั้ง env ใน shell เองหรือใช้ `vercel dev`

---

## 5. ค่า default ทั้งหมดในโค้ด

| ค่า | Default | ที่มา |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://postgres:postgres@localhost:5432/domplus` | `backend/app/config.py` |
| `SESSION_SECRET` | `dev-only-change-me` (ถูกปฏิเสธ) | `backend/app/config.py`, `backend/app/session.py` |
| `COOKIE_SECURE` | `true` | `backend/app/config.py` |
| `DEV_AUTH` | `false` | `backend/app/config.py` |
| `OWNER_ACCESS_CODE` | `""` (ว่าง = หน้าจอเจ้าของหอปิด) | `backend/app/config.py`, `backend/app/routes/auth.py` |
| เพดานเดารหัสผิด (ทุก scope: `owner-login`, `line.link`) | 10 ครั้ง / 1 ชั่วโมง / actor → `429 TOO_MANY_ATTEMPTS` | `backend/app/attempts.py` |
| `PROPERTY_ID` | `p_1` (ถูกตั้งเป็น `app.property_id` ทุก connection) | `backend/app/config.py`, `backend/app/db.py` |
| `LINE_CHANNEL_ID` / `LIFF_ID` / `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` / `CRON_SECRET` | `""` | `backend/app/config.py` |
| `VERCEL_ENV` / `RAILWAY_ENV` / `K_SERVICE` (`CLOUD_RUN_SERVICE`) | `""` | `backend/app/config.py` |
| `is_production` | `VERCEL_ENV=="production"` หรือ `RAILWAY_ENV` ไม่ว่าง หรือ `K_SERVICE`/`CLOUD_RUN_SERVICE` ไม่ว่าง | `backend/app/config.py` |
| `PORT` | `8000` | `Dockerfile` |
| `CRON_SECRET` (line-app) | `""` (ใช้ได้เมื่อ ≥ 16 ตัว) | `line-app/api/cron.js` |
| ความยาวต่ำสุดของ cron secret (line-app) | `16` | `line-app/api/cron.js` |
| อายุ lock ของ cron | 15 นาที (`cron-lock`) | `line-app/api/cron.js` |
| `ROOMS` | `201`–`212` | `line-app/api/_rooms.js` |
| `DEFAULT_RENT` | `3500` | `line-app/api/_rooms.js` |
| `WATER_RATE` | `25` | `line-app/api/_rooms.js` |
| `ELEC_RATE` | `7` | `line-app/api/_rooms.js` |
| `dorm` (Blob key) | ไม่มี (`null`) — `rent`/`waterRate`/`elecRate` ตกไปใช้ env; `dueDay`/`promptpay`/`name` ไม่ตั้ง | `line-app/api/_rooms.js`, `line-app/api/rooms.js` |
| เพดานค่าที่ตั้งได้ | `rent` 100000 · `waterRate`/`elecRate` 10000 · `name` 60 ตัวอักษร | `line-app/api/rooms.js` |
| `dueDay` | ไม่ตั้ง (`null`) → ไม่มีวันครบกำหนดอัตโนมัติ (ใช้ `BILL_DUE`) | `line-app/api/rooms.js`, `line-app/api/run.js` |
| `promptpay` | ไม่ตั้ง → `/api/bill` ไม่มี QR พร้อมเพย์ | `line-app/api/_promptpay.js`, `line-app/api/bill.js` |
| จำนวน endpoint ใน `api/` | 12 (เท่าเพดาน Vercel Hobby) | `line-app/api/` |
| `GEMINI_MODEL` | `gemini-2.5-flash` | `line-app/api/_gemini.js` (บรรทัด 10) |
| `BILL_PERIOD` / `BILL_DUE` (จาก env) | `""` — seed ใช้ `2026-11` / `2026-11-16` | `line-app/api/dev.js`, `line-app/api/run.js` |
| `SLIP_AUTO_CONFIRM` | ไม่ตั้ง = เปิด/ปิดตาม `dorm.autoConfirm` (default ปิด) · `0`/`off`/`false` = ปิดทั้ง deployment | `line-app/api/_pay.js` |
| `SLIPOK_API_KEY` / `SLIPOK_BRANCH_ID` (line-app) | ไม่ตั้ง (undefined = ไม่ตรวจสลิป) | `line-app/api/_verify.js` |
| `R2_BUCKET` / `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (line-app) | ไม่ตั้งทั้งชุด = ใช้ Vercel Blob; ตั้ง `R2_BUCKET` = ต้องมีครบสี่ตัว (**production ตั้งครบแล้ว — ดู §2**) | `line-app/api/_store.js`, `line-app/api/_store-r2.js` |
| migration head (backend) | `0006` (index FK ของ `invoice_items`/`payments`; `0005` = `line_events`) | `backend/migrations/versions/0006_invoice_child_indexes.py` |
| `PUBLIC_BASE_URL` | `https://<host ของ request>` | `line-app/api/run.js`, `dev.js`, `webhook.js`, `cron.js` |
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
| `DATABASE_URL` | pooled, role `dormplus_app` | ควรใช้ Neon branch แยก (role เดียวกัน) | local Postgres หรือ unpooled |
| Blob store / R2 (line-app) | **R2** (`R2_BUCKET` + credential ครบสี่ตัว) — Blob ถูก pause | **ไม่มี `R2_*`** → แตะ storage ไม่ได้ (ตั้งใจ กันเขียนทับข้อมูลจริง) | ต้องมี credential เอง (`.env` + `node --env-file`) |
| cron ที่ส่งข้อความทวง | `line-app` `/api/cron` (backend ไม่มี cron) | ไม่รัน (Vercel cron ผูกกับ Production) | ยิงมือด้วย curl ถ้าตั้ง `CRON_SECRET` |

ข้อควรระวัง:

1. **Preview ของ `line-app` ใช้ env อื่น ๆ ชุดเดียวกับ production แต่ไม่มี `R2_*`** — storage ใช้งานไม่ได้จาก preview จึงไม่ทับข้อมูลจริง · ที่ยังอันตรายคือ **เครื่อง local ที่มี `.env` ชี้ R2 ของ production**: `POST /api/dev?do=seed` จะเขียนทับข้อมูลจริง และสคริปต์ที่ยิง bucket จริง (`scripts/migrate-blob-to-r2.js`, `check-r2-copy.js`, `backup-r2.js`) จะอ่าน/เขียนของจริงด้วย · ชุด smoke ไม่แตะ bucket — `smoke.js` ใช้ fake S3 (`fakeFetch`) และชุดอื่นใช้ `Map` แทน store · อย่าเปิด `ALLOW_SEED_BYPASS` และตั้ง `SLIP_AUTO_CONFIRM=0` เมื่อทดสอบ
2. **Preview ของ backend ใช้ DB ชุดเดียวกับ production ถ้าไม่ได้แยก env** — ควรตั้ง `DATABASE_URL` ของ Preview เป็น Neon branch
3. **แก้ env แล้วต้อง Redeploy** — line-app จับค่าใส่ `const` ตอน module load (`api/_line.js`, `api/_auth.js`, `api/_rooms.js`, และ `api/_store.js` ที่เลือก R2/Blob จาก `R2_BUCKET`) และ instance ที่ warm อยู่จะใช้ค่าเดิมจนกว่าจะ deploy ใหม่ · backend ก็อ่าน `Settings` ผ่าน `lru_cache` ต่อโปรเซส
4. `PUBLIC_BASE_URL` บน Preview ถ้าตั้งเป็นโดเมน production ลิงก์ในการ์ดจะชี้ไป production

<!-- VERIFY: env ของ Preview ถูกตั้งแยกจาก Production หรือใช้ร่วมในโปรเจกต์ Vercel ทั้งสอง — ไม่มีในเรพ -->
<!-- VERIFY: Node.js runtime จริงบน Vercel (20.x หรือ 22.x) — `engines` ระบุ `>=20` แต่ dashboard เป็นตัวตัดสิน -->
---

## 7. Checklist ตั้งค่าครั้งแรก

**Backend**

1. ตั้ง `DATABASE_URL` (pooled, role `dormplus_app` ที่ไม่มี `BYPASSRLS`) + `SESSION_SECRET` + `COOKIE_SECURE=true` + `DEV_AUTH=false`
2. ตั้ง `OWNER_ACCESS_CODE` เป็นรหัสสุ่มยาว (ไม่ตั้ง = หน้า `/owner` ล็อกอินไม่ได้) — ใช้ร่วมทั้งหอ ไม่ใช่บัญชีรายคน
3. ตั้ง `LINE_CHANNEL_ID` + `LIFF_ID` (+ `LINE_CHANNEL_ACCESS_TOKEN` ถ้าส่งข้อความ)
4. ตั้ง `PROPERTY_ID` ให้ตรงหอ (ค่านี้คุม RLS ไม่ใช่แค่ cron)
5. ตั้ง `CRON_SECRET` เฉพาะถ้าจะยิง `/v1/cron/daily` ด้วยมือ หรือเปิด cron ฝั่งนี้กลับมา
6. รัน `python -m alembic upgrade head` ด้วย role ที่มี DDL (unpooled) และ `python -m app.queue` ครั้งเดียวต่อฐาน
7. Redeploy

**line-app**

1. ตั้ง `LINE_CHANNEL_SECRET` + `LINE_CHANNEL_ACCESS_TOKEN` จาก LINE Developers Console
2. ตั้ง `LIFF_ID` + `OWNER_USER_ID`
3. ตั้ง `CRON_SECRET` (≥ 16 ตัว) เพื่อให้ `/api/cron` ทำงาน — Vercel จะแนบ header ให้เอง
4. ตั้ง `ROOMS` ให้ตรงจำนวนห้อง (ไม่ตั้ง = 201–212) — ส่วนค่าเช่า/เรต/`dueDay`/`promptpay` ตั้งจากหน้า settings ในแอป (`POST /api/rooms {dorm}`); `DEFAULT_RENT`/`WATER_RATE`/`ELEC_RATE` เป็นเพียง fallback ของห้องที่ยังไม่เคยบันทึก
5. (ถ้าเปิดตรวจสลิป) สร้าง branch ใน SlipOK → ผูกบัญชีรับเงินของหอ → ตั้ง `SLIPOK_API_KEY` + `SLIPOK_BRANCH_ID` **คู่กัน** ไม่งั้นระบบทำงานเหมือนไม่ได้ตั้ง (สลิปไม่ถูกตรวจ)
6. ตั้ง `PUBLIC_BASE_URL` เป็นโดเมน production
7. Redeploy แล้วยิง webhook Verify จาก LINE Developers Console · ตรวจ cron ที่ Vercel → Project → Cron Jobs
