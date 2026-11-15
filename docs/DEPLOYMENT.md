<!-- generated-by: gsd-doc-writer -->

# การ deploy (DEPLOYMENT)

เอกสารนี้เป็น **runbook เดียวสำหรับทั้งสองโปรเจกต์ Vercel** ของ repo นี้ (`line-app` และ `line-backend`)
เขียนจากไฟล์จริง: `line-app/vercel.json`, `backend/vercel.json`, `backend/api/index.py`, `backend/app/queue.py`,
`backend/app/routes/cron.py`, `backend/migrations/versions/`, `scripts/prod-smoke.mjs`, `Dockerfile`,
`line-app/scripts/setup-richmenu.js`, `.github/workflows/ci.yml` และ `.vercel/project.json` ของทั้งสองโฟลเดอร์

รายละเอียดเชิงลึกของครึ่ง LINE app (Blob store, rich menu, LINE Console, ตาราง error string) อยู่ใน
[`line-app/docs/DEPLOYMENT.md`](../line-app/docs/DEPLOYMENT.md) — เอกสารนี้ไม่เขียนซ้ำ
ส่วนรายการ env ทั้งหมดพร้อมค่า default อยู่ที่ [`CONFIGURATION.md`](./CONFIGURATION.md)

> ทุกอย่างที่ยืนยันจากเรพไม่ได้ (plan ของทีม, การผูก env กับ environment, สถานะการลงทะเบียน cron, alias ของโดเมน)
> ถูกกำกับด้วย `<!-- VERIFY: ... -->` — ต้องเปิด Vercel dashboard ดูเอง

---

## 1. ปลายทางการ deploy

| stack | โปรเจกต์ Vercel | Root Directory | production URL | ไฟล์ config ในเรพ |
|---|---|---|---|---|
| LINE app | `line-app` (`.vercel/project.json` → `projectName: "line-app"`) | `line-app/` | https://line-app-iota.vercel.app | `line-app/vercel.json` |
| backend (FastAPI) | `line-backend` (`.vercel/project.json` → `projectName: "line-backend"`) | `backend/` | https://line-backend-ten.vercel.app | `backend/vercel.json` |

- ทั้งสองโปรเจกต์ผูก GitHub repo เดียวกัน และ **push เข้า `master` = deploy production อัตโนมัติ**
  <!-- VERIFY: การผูก Git integration, Branch Tracking = `master` และ Root Directory (`line-app/` / `backend/`) — ทั้งสามค่าอยู่ใน settings ของโปรเจกต์ ไม่มีฟิลด์ใดใน `vercel.json` ระบุไว้ (ข้อความนี้มาจาก README/docs/HANDOFF) -->
- `line-app/` ไม่มีขั้นตอน build — ทั้งระบบคือ static 1 หน้า (`liff/bill.html`) + serverless function ใน `api/*.js`
  `package.json` มีแค่ `test` (รัน smoke 3 ชุด) ไม่มี `build`
- `backend/` ใช้ Vercel Python runtime: entrypoint คือ `backend/api/index.py` (`from app.main import app`)
  dependency มาจาก `backend/requirements.txt`
- **ทางเลือกที่ไม่ใช่ Vercel:** `Dockerfile` ที่ root ของ repo สร้าง image ของ backend (`COPY backend/ /app/`,
  `uvicorn` ฟัง `${PORT:-8000}`) สำหรับ Railway/Cloud Run — ไม่มี CI ไหน build image นี้ และ **image ไม่รัน migration
  ให้เอง** ต้อง `alembic upgrade head` ก่อน start หรือทำเป็น release command ของผู้ให้บริการ

---

## 2. Pipeline

CI (`.github/workflows/ci.yml`, workflow `ci`) **ไม่ได้ deploy** — มันแค่กันของเสีย:

| job | รันเมื่อ | ทำอะไร |
|---|---|---|
| `line-app` | push `master` · ทุก PR | `npm ci` → `node --check` ทุก `api/*.js` → `smoke.js` → `smoke-handlers.js` → `smoke-reads.js` → ตรวจ inline script ของ `liff/bill.html` |
| `backend` | push `master` · ทุก PR (ข้ามตัวเองถ้ากิ่งนั้นยังไม่มี `backend/pyproject.toml`) | ยก Postgres 16 ขึ้นมา → `pip install -e "backend[dev]"` → `pytest -q` |

deploy มาจาก **Vercel Git integration** ไม่ใช่จาก Actions ทั้งสอง `vercel.json` ตั้งกฎไว้เหมือนกัน:

```json
"git": {
  "deploymentEnabled": { "*": false, "**": false, "master": true, "preview-*": true }
}
```

| กิ่งที่ push | ผล |
|---|---|
| `master` | deploy production ทั้งสองโปรเจกต์ (2 deployments) |
| `preview-*` (เช่น `preview-liff-redesign`) | ได้ preview deployment |
| กิ่งอื่นทั้งหมด | **ไม่** deploy — ไม่กินโควต้า |

`*` อย่างเดียวไม่พอ: glob ของ Vercel (`minimatch`) หยุดที่ `/` ดังนั้น `chore/foo` ไม่ match `*`
จึงต้องมี `**` ด้วย — สองบรรทัดนี้คือสิ่งที่กันไม่ให้ push ระหว่างวันกินโควต้า (ประวัติใน commit `4226e87`)

deploy ด้วยมือ (ใช้เมื่อไม่ได้มาจาก git):

```bash
cd line-app
vercel --prod
```

```bash
cd backend
vercel --prod
```

> **อ้างอิง:** `line-app/vercel.json` ยังมี `rewrites` (`/` → `/liff/bill.html`) และ `headers`
> (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` ทั้ง site · `X-Frame-Options: DENY` เฉพาะ `/api/*`
> เพราะ LIFF ต้องถูก embed ใน LINE ได้) · `backend/vercel.json` มี `crons` (ข้อ 6)

---

## 3. Environment setup (สรุป)

รายการเต็มพร้อม default อยู่ที่ [`CONFIGURATION.md`](./CONFIGURATION.md) — ที่ต้องรู้ตอน deploy:

| โปรเจกต์ | env ที่ต้องมีบน Vercel | หมายเหตุ |
|---|---|---|
| `line-app` | `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `LIFF_ID`, `OWNER_USER_ID`, `PUBLIC_BASE_URL` (+ `RICHMENU_OWNER_ID` / `RICHMENU_TENANT_ID` ถ้าใช้ rich menu) | `BLOB_STORE_ID` มาจาก `vercel storage connect` ไม่ต้องตั้งเอง · `SEED_TOKEN` / `ALLOW_SEED_BYPASS` **ปิดบน production เสมอ** |
| `line-backend` | `DATABASE_URL` (pooled + `?sslmode=require`), `SESSION_SECRET`, `LINE_CHANNEL_ID`, `LIFF_ID`, `COOKIE_SECURE=true`, `DEV_AUTH=false`, `CRON_SECRET`, `PROPERTY_ID`, `LINE_CHANNEL_ACCESS_TOKEN` (ถ้าจะให้ cron ส่งข้อความจริง) | `DEV_AUTH=true` ถูกเพิกเฉยเมื่อ `VERCEL_ENV=production` |

**แก้ env แล้วต้อง Redeploy เสมอ** — ทั้งสองฝั่งอ่าน `process.env` / settings ตอน module load
(`line-app/api/*.js` ใส่ `const` ระดับบนสุด · `backend/app/config.py` ใช้ `@lru_cache`)
instance ที่ warm อยู่จะยังใช้ค่าเก่า

- CLI: `vercel --prod` หรือ dashboard → Deployments → ⋯ → **Redeploy**
- หรือแก้จาก CLI: `vercel env rm <NAME> production --yes` แล้ว `"<value>" | vercel env add <NAME> production`
  (รูปแบบนี้ทีมใช้อยู่ตอนสลับ rich menu — ดู [`line-app/docs/DEPLOYMENT.md`](../line-app/docs/DEPLOYMENT.md))

<!-- VERIFY: env ถูกตั้งแยก Production/Preview หรือใช้ค่าร่วมกัน — ต้องดู Project → Settings → Environment Variables · preview ของ line-app ใช้ Blob store เดียวกับ production หรือไม่ก็ยืนยันจากเรพไม่ได้ -->

---

## 4. backend: ลำดับงานเมื่อแก้ schema (สำคัญที่สุด)

`backend/migrations/versions/` คือ **schema of record** — `db/schema.sql` เป็น snapshot อ่านอย่างเดียว (ปัจจุบันอัปเดตถึง `0003` แล้ว แต่ตัวที่รันจริงคือ alembic)
ฐานข้อมูล Neon จริงอยู่ที่ **`0003`** (0001 initial · 0002 `link_codes` · 0003 `auth_failures`)

เพราะ merge เข้า `master` = deploy ทันที **migration ต้องขึ้นก่อน merge ไม่ใช่หลัง** ไม่งั้นช่วงสั้น ๆ
โค้ดใหม่จะวิ่งชน schema เก่า (500 ทั้งหน้า และ cron ก็ล้มด้วย)

```text
1. เขียน migration + โค้ด บนกิ่ง feature        → ยังไม่ deploy (กิ่งไม่ใช่ master/preview-*)
2. docker compose up -d && alembic upgrade head → ทดสอบในเครื่อง + pytest -q
3. รัน alembic upgrade head กับ Neon (unpooled) → schema ใหม่ขึ้นจริงก่อน merge
4. python -m app.queue                          → เฉพาะเมื่อฐานข้อมูลนั้นยังไม่เคยสร้างตารางคิว
5. merge เข้า master                            → Vercel deploy อัตโนมัติ
6. node scripts/prod-smoke.mjs                  → ยืนยันว่า production ยังตอบถูก
```

### 4.1 รัน migration กับ Neon ด้วย endpoint unpooled

`migrations/env.py` อ่าน URL จาก `get_settings().database_url` (ไม่ใช่ `sqlalchemy.url` ใน `alembic.ini`)
จึงสั่งทับด้วย env var ตอนรันได้:

```bash
cd backend
DATABASE_URL="postgresql+psycopg://<user>:<pass>@<host-without-pooler>/<db>?sslmode=require" \
  alembic upgrade head
```

PowerShell (Windows):

```powershell
cd backend
$env:DATABASE_URL = "postgresql+psycopg://<user>:<pass>@<host-without-pooler>/<db>?sslmode=require"
alembic upgrade head
```

- ใช้ host **unpooled** (ไม่มี `-pooler`) เพราะ alembic รัน DDL หลายคำสั่งใน transaction เดียว —
  pooled endpoint (pgbouncer) ไม่เหมาะกับงานนี้ · ค่าใน `DATABASE_URL` ของ production บน Vercel เป็น pooled
- scheme ต้องเป็น `postgresql+psycopg://` ไม่ใช่ `postgresql://`
- ค่า connection string จริงอยู่ใน `backend/.env` (gitignored) — **ห้าม commit และห้ามคัดลอกลงเอกสาร**
- ตรวจสถานะปัจจุบันก่อน/หลัง: `alembic current` / `alembic history`

> ⚠️ อย่าตั้ง `TEST_DATABASE_URL` ชี้มาที่ Neon ตัวจริง — `pytest` truncate ทุกตารางทิ้ง
> ถ้าต้องรัน test กับ schema จริง ให้สร้าง Neon branch แยก

### 4.2 เพิ่ม migration ใหม่

```bash
cd backend
alembic revision -m "add xyz"     # แล้วเขียน op.execute(...) เอง — ไม่มี autogenerate เพราะไม่ใช้ ORM model
alembic upgrade head
```

ทุก revision ต้องมีฟังก์ชัน `downgrade()` (ทั้งสามไฟล์ที่มีอยู่มีครบ) เพราะ rollback ทำทีละ revision (ข้อ 8)

### 4.3 อย่ารอให้ deploy รัน migration ให้

Vercel serverless ไม่รัน migration ตอน deploy และไม่มี release hook ในเรพนี้ — `backend/README.md`
ระบุตรง ๆ ว่า "ไม่ต้องรัน migration ตอน deploy · ให้รัน `alembic upgrade head` จากเครื่องเมื่อมี migration ใหม่"
ถ้าลืม: route ที่แตะคอลัมน์/ตารางใหม่จะ 500 และ `/v1/cron/daily` จะตอบ `503 QUEUE_UNAVAILABLE` ถ้าตารางคิวหาย

---

## 5. คิว (Procrastinate) — ขั้นตอนที่ลืมแล้วเจ็บ

API ไม่ได้ส่งข้อความเอง มัน **enqueue** แล้วให้ `/v1/cron/daily` drain ใน invocation เดียวกัน (`run_worker_async(wait=False)`)
ตารางของ procrastinate ไม่ได้มาจาก alembic — ต้องสร้างแยก **ครั้งเดียวต่อฐานข้อมูล**:

```bash
cd backend
DATABASE_URL="postgresql+psycopg://…unpooled…" python -m app.queue
# → procrastinate schema applied
```

ทำไมไม่ใช้ CLI ของ procrastinate: `procrastinate schema --apply` **บังคับ async connector**
แต่แอปนี้ใช้ `SyncPsycopgConnector` (สิ่งที่ serverless ต้องการ) CLI จึงปฏิเสธ —
`python -m app.queue` (`app/queue.py` → `apply_schema()`) รัน migration ชุดเดียวกัน (4 ตาราง)
และพิมพ์ `procrastinate schema applied`

อาการถ้ายังไม่สร้าง: cron ตอบ `503` code `QUEUE_UNAVAILABLE` พร้อมข้อความ "ตรวจว่าสร้างตาราง procrastinate แล้วหรือยัง"
(ทุก exception ระหว่าง enqueue/drain ถูกแปลงเป็น 503 นี้)

ทางเลือกเมื่ออยากส่งถี่กว่ารายวัน: `procrastinate -a app.queue.app worker` บน host ที่ค้างได้ ชี้ Postgres ตัวเดียวกัน
— ไม่ต้องมี host นี้สำหรับ cron รายวัน

---

## 6. CRON_SECRET และ cron รายวัน

`backend/vercel.json`:

```json
{ "crons": [{ "path": "/v1/cron/daily", "schedule": "0 2 * * *" }] }
```

02:00 UTC = 09:00 เวลาไทย · Vercel ยิง `GET /v1/cron/daily` และ — **ถ้าตั้ง env `CRON_SECRET` ไว้บนโปรเจกต์** —
ใส่ `Authorization: Bearer <CRON_SECRET>` ให้เอง

`backend/app/routes/cron.py` เทียบด้วย `hmac.compare_digest` และ **fail closed**:
ถ้าไม่ได้ตั้ง `CRON_SECRET` หรือ token ไม่ตรง → `401 UNAUTHORIZED` (token ทาง query string ถูกปฏิเสธ —
`presented_token()` อ่านเฉพาะ header `Authorization`)

**env ถูกจับตอน build** → ตั้ง `CRON_SECRET` แล้ว **ต้อง redeploy** ไม่งั้น deployment ที่รันอยู่ยังไม่รู้จักค่าใหม่
และ endpoint จะตอบ 401 ต่อไป (รวมถึง cron ของ Vercel เอง) จนกว่าจะ redeploy

`CRON_SECRET` มีชื่อเก่า `DUNNING_TOKEN` ที่ยังใช้ได้ (`AliasChoices` ใน `app/config.py`)
· `PROPERTY_ID` ค่าเริ่มต้น `p_1` · ถ้าไม่มี `LINE_CHANNEL_ACCESS_TOKEN` task จะ log `skipped` แทนการส่ง

### 6.1 ยิง cron หนึ่งครั้งด้วยมือ แล้วอ่านผล

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://line-backend-ten.vercel.app/v1/cron/daily
```

ผลที่ถูก:

```json
{ "queued": 3, "drained": true }
```

| ที่เห็น | แปลว่า |
|---|---|
| `401 UNAUTHORIZED` | `CRON_SECRET` บนโปรเจกต์ไม่ตรง / ยังไม่ redeploy / ไม่ได้ตั้งค่า |
| `200 {"queued":0,"drained":true}` | ต่อได้ แต่ไม่มีบิลที่ถึงรอบทวง (1/5/10 วันหลังเลยกำหนด) |
| `503 QUEUE_UNAVAILABLE` | ยังไม่สร้างตาราง procrastinate (ข้อ 5) หรือต่อ DB ไม่ได้ |
| `500` | ดู log ของ function ก่อน — มักเป็น schema ไม่ตรง (ข้อ 4) |

`queued: 0` ไม่ได้แปลว่า cron ไม่ทำงาน — ต้องดูว่า Vercel ยังลงทะเบียน cron ไว้จริงไหม

<!-- VERIFY: สถานะการลงทะเบียน cron (`0 2 * * *` → `/v1/cron/daily`) และประวัติการยิงจริง — เห็นได้ที่ Vercel → Project → Cron Jobs เท่านั้น · Hobby รันได้วันละ 1 ครั้ง คลาดได้ถึง ±59 นาที -->
<!-- VERIFY: plan ของทีมบน Vercel (Hobby vs Pro) เป็นตัวกำหนดเพดาน cron/function timeout — ยืนยันจากเรพไม่ได้ -->

`scripts/prod-smoke.mjs` ตรวจแค่ว่า endpoint มีอยู่และ **ต้องมี secret** (`GET` ไม่มี header → 401)
ไม่ได้ตรวจว่า cron ทำงาน — การยืนยันรอบจริงต้องดูจาก dashboard หรือผลของ `queued`

---

## 7. หลัง deploy — ตรวจของจริง

```bash
node scripts/prod-smoke.mjs
LINE_APP=https://... BACKEND=https://... node scripts/prod-smoke.mjs
```

สคริปต์ไม่มี dependency (ใช้ `fetch` ของ Node 20+) และตรวจเฉพาะสิ่งที่ไม่ต้องล็อกอิน:

- หน้า LIFF ตอบ 200 และเป็น build ปัจจุบัน (`qr-ph` อยู่ในหน้า)
- `/api/config` 200 · API มี `nosniff` + `X-Frame-Options: DENY` · หน้า LIFF **ไม่** ถูก frame-deny
- `/api/me` ไม่มี token → 401 · `/api/dev` บน production → 404
- backend `/healthz` = `{"status":"ok"}` · `/docs` และ `/openapi.json` → 404
- `/v1/rooms` ไม่มี session → 401 · `/v1/dunning/run?token=` → 401 · `/v1/cron/daily` ไม่มี secret → 401

exit code 1 ถ้ามีข้อไหนตก — ใช้เป็น gate หลัง merge ได้เลย

**line-app เพิ่มเติม (เฉพาะครั้งแรกหรือหลังเปลี่ยนรูปเมนู):**

```bash
cd line-app
LINE_CHANNEL_ACCESS_TOKEN=... LIFF_ID=... node scripts/setup-richmenu.js
```

สคริปต์พิมพ์ id ที่ต้องไปใส่ `RICHMENU_OWNER_ID` / `RICHMENU_TENANT_ID` (ค่าเริ่มต้นรูปคือ
`docs/richmenu-owner.png` และ `docs/richmenu-tenant.png`) แล้ว redeploy · เปลี่ยนแค่รูปภายหลังใช้
`scripts/set-richmenu-image.js` (LINE ไม่ให้เปลี่ยนรูปเมนูเดิม) — ขั้นตอนเต็มอยู่ที่
[`line-app/docs/DEPLOYMENT.md`](../line-app/docs/DEPLOYMENT.md)

---

## 8. Rollback

### 8.1 ย้อนโค้ด (เร็วที่สุด)

1. Vercel → โปรเจกต์ (`line-app` หรือ `line-backend`) → **Deployments**
2. เลือก deployment ที่ยังดี → ⋯ → **Promote to Production** / **Rollback**
3. ตรวจว่า alias ของโดเมนชี้ deployment นั้นแล้ว → รัน `node scripts/prod-smoke.mjs`

```bash
vercel rollback
```

<!-- VERIFY: `vercel rollback` ย้อนแค่ alias หรือ redeploy ใหม่ และชื่อคำสั่งตามเวอร์ชัน CLI ที่ติดตั้ง — ถ้าไม่ได้ผลให้ใช้ dashboard -->

ย้อนที่ source (`git revert` แล้ว push `master`) ก็ได้ แต่จะกิน deployment เพิ่ม 2 ตัวจากโควต้าวันละ 100

### 8.2 ย้อน schema (alembic) — ทีละ revision

`alembic downgrade` ไม่ได้ย้อนกลับทั้งก้อน และ **ต้องย้อนโค้ดให้ตรงกับ schema ก่อน** ไม่งั้นแอปพังหนักกว่าเดิม

```bash
cd backend
DATABASE_URL="postgresql+psycopg://…unpooled…" alembic downgrade 0002   # ถอยจาก 0003 ไป 0002
DATABASE_URL="postgresql+psycopg://…unpooled…" alembic current          # ยืนยัน
```

- ระบุ revision ปลายทางเสมอ (`alembic downgrade 0002`) — `-1` ก็ใช้ได้แต่ต้องรู้ว่าปัจจุบันอยู่ไหน
- `downgrade()` ใน 0002/0003 จะ drop ตาราง `link_codes` / `auth_failures` — **ข้อมูลในนั้นหายถาวร**
- อย่า downgrade ฐานข้อมูล Neon แล้วทิ้ง deployment ใหม่ไว้: rollback deployment (ข้อ 8.1) **ก่อน** หรือพร้อมกัน

### 8.3 ย้อน env

แก้ค่ากลับที่ Settings → Environment Variables แล้ว **Redeploy** (ข้อ 3) — รวมถึง `CRON_SECRET`
ที่ถ้าเปลี่ยนแล้วไม่ redeploy จะได้ 401 ทั้งจาก cron และจาก curl ของคุณ

### 8.4 ย้อนข้อมูล — ไม่มีให้ย้อน

- **line-app:** state อยู่ใน Vercel Blob แบบ key-value เขียนทับทันที (`allowOverwrite: true`) ไม่มี versioning ในโค้ด
  บิลผิด = ออกรอบใหม่ด้วยมิเตอร์ที่ถูก · ห้ามรัน `POST /api/dev?do=seed` บนหอจริง (เขียนทับทุกห้อง)
- **backend:** คืนข้อมูลได้เฉพาะที่มี backup ของ Neon — ไม่มีสคริปต์ backup ในเรพ
  <!-- VERIFY: Neon เปิด point-in-time restore / branch อะไรไว้ และเก็บกี่วัน — ต้องดูที่ Neon console -->

### 8.5 ตารางคิว

ตาราง procrastinate ไม่ผูกกับ alembic — `alembic downgrade` ไม่แตะ · ถ้าต้องล้างคิวให้ใช้เครื่องมือของ procrastinate
ไม่ใช่ SQL มือ (`app/queue.py` เป็นเจ้าของ schema นั้น)

---

## 9. Monitoring

ไม่มี library monitoring ในเรพนี้ (ไม่มี Sentry / Datadog / OpenTelemetry ใน `backend/requirements.txt`
หรือ `line-app/package.json`) — สิ่งที่ใช้ได้จริงคือ:

| ชั้น | ดูอะไร |
|---|---|
| backend | `GET /healthz` (ตรวจ DB ด้วย — ตอบ 503 `DB_UNAVAILABLE` ถ้าต่อไม่ได้) · Vercel → Deployments → Functions → log ของ `api/index` |
| cron | ผลของ `/v1/cron/daily` (`queued` / `drained`) · log ของ `line.push_text` (`skipped` = ไม่มี token) · Vercel → Cron Jobs |
| line-app | log `event failed ...`, `line message/push 4xx`, `owner push failed` · LINE Developers → Webhook event log |
| ทั้งคู่ | `node scripts/prod-smoke.mjs` (exit 1 = มีข้อตก) |

<!-- VERIFY: มี alert/notification rule ตั้งไว้บน Vercel หรือ Neon หรือไม่ และแจ้งไปที่ช่องทางไหน — ไม่มีในเรพ -->

---

## 10. ความล้มเหลวที่เจอมาแล้ว (อ่านก่อน deploy)

| อาการ | สาเหตุ | ทางแก้ |
|---|---|---|
| deploy ล้ม/ถูกบล็อก หลัง push หลายรอบในวันเดียว | Hobby ให้ **100 deployments/วัน ทั้งทีม** และ repo นี้มี 2 โปรเจกต์ → เดิมทุก push ทุกกิ่ง = 2 deployments | ใช้กฎใน `vercel.json`: deploy เฉพาะ `master` และ `preview-*` (ต้องมีทั้ง `"*"` และ `"**"` — `*` ไม่ข้าม `/`) · Ignored Build Step ไม่ช่วย เพราะ build ที่ถูกยกเลิกก็ยังนับ |
| กิ่ง `chore/foo` ยัง deploy อยู่ทั้งที่ตั้งกฎแล้ว | มีแค่ `"*": false` ซึ่งไม่ match ชื่อกิ่งที่มี `/` | ใส่ `"**": false` ด้วย (มีแล้วในทั้งสอง `vercel.json`) |
| deploy ล้มด้วย `exceeded_serverless_functions_per_deployment` | เพดาน Hobby 12 serverless functions ต่อ deployment · `line-app` ใช้ **ครบ 12** (`api/*.js` ที่ไม่ขึ้นต้นด้วย `_`) | รวม endpoint เดิมก่อนเพิ่มใหม่ (helper ที่ขึ้นต้นด้วย `_` ไม่นับ) |
| deploy จาก Git ถูกปฏิเสธ / ไม่ขึ้นในรายการ | Vercel ผูก deployment กับ **author ของ commit** — ถ้า author ไม่ใช่สมาชิกทีม จะไม่ถูกนับเป็น deployment ของทีม | ตั้ง `git config user.email` ให้ตรงกับบัญชีที่อยู่ในทีม Vercel และอย่าใช้ email ปลอม/`noreply` ของคนอื่น |
| `vercel --prod` จาก `line-app/` หรือ `backend/` ขึ้นผิดโปรเจกต์ / ได้ 404 ทั้ง site | CLI ใช้โปรเจกต์ที่ผูกไว้ใน `.vercel/project.json` ของโฟลเดอร์นั้น — ถ้าโฟลเดอร์ยังไม่ผูก หรือผูกโปรเจกต์ที่ Root Directory ไม่ตรงกับโฟลเดอร์นี้ CLI จะสร้าง/ใช้โปรเจกต์ที่ root ต่างจาก Git integration | เช็ก `.vercel/project.json` ว่า `projectName` ตรง (`line-app` / `line-backend`) ก่อนสั่ง · ถ้าไม่แน่ใจให้ใช้ dashboard หรือให้ Git integration deploy |
| ตั้ง `CRON_SECRET` แล้ว cron ยัง 401 | env ถูกอ่านตอน module load และ Vercel จับค่าตอน build | redeploy หลังตั้ง env (ข้อ 6) |
| cron ตอบ 503 `QUEUE_UNAVAILABLE` | ยังไม่รัน `python -m app.queue` บนฐานข้อมูลนั้น | รันด้วย unpooled URL (ข้อ 5) |
| หน้า LIFF ยังเป็น build เก่า / `qr-ph` หาย | deploy ไม่ขึ้น (กิ่งไม่ใช่ `master`/`preview-*`) หรือ alias ยังชี้ deployment เก่า | ดู Deployments ล่าสุด + `node scripts/prod-smoke.mjs` |

<!-- VERIFY: ข้อ "Git author ต้องเป็นสมาชิกทีม" เป็นพฤติกรรมฝั่ง Vercel account ไม่ใช่สิ่งที่เรพพิสูจน์ได้ — ถ้า deploy จาก Git ไม่ขึ้น ให้ดูที่ Project → Settings → Git ว่า author ของ commit ถูกมองเป็นสมาชิกทีมหรือไม่ -->
<!-- VERIFY: อาการ "Root Directory ไม่ตรง" ขึ้นกับสถานะการผูก `.vercel/project.json` ในเครื่องที่สั่ง — ตัวไฟล์ถูก gitignore จึงยืนยันจากเรพไม่ได้ว่าค่าปัจจุบันถูกต้อง -->

---

## 11. เอกสารที่เกี่ยวข้อง

| ไฟล์ | เนื้อหา |
|---|---|
| [`CONFIGURATION.md`](./CONFIGURATION.md) | env ทุกตัวของทั้งสองโปรเจกต์, default, required vs optional, pooled vs unpooled |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | โครงระบบและเหตุผลที่สอง stack แยกกัน |
| [`../line-app/docs/DEPLOYMENT.md`](../line-app/docs/DEPLOYMENT.md) | Blob store, LINE Console (webhook/LIFF), rich menu, ตาราง error string ของ line-app |
| [`../backend/README.md`](../backend/README.md) | endpoint, session, migration, queue, deploy บน Vercel |
| [`HANDOFF.md`](./HANDOFF.md) | งานที่เหลือและเกณฑ์ "เสร็จ" |
