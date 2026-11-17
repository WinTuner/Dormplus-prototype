<!-- generated-by: gsd-doc-writer -->

# การ deploy (DEPLOYMENT)

เอกสารนี้เป็น **runbook เดียวสำหรับทั้งสองโปรเจกต์ Vercel** ของ repo นี้ (`line-app` และ `line-backend`)
เขียนจากไฟล์จริง: `line-app/vercel.json`, `backend/vercel.json`, `backend/api/index.py`, `backend/app/db.py`,
`backend/app/queue.py`, `backend/app/routes/cron.py`, `line-app/api/cron.js`, `line-app/api/_remind.js`,
`backend/migrations/versions/`, `line-app/api/_verify.js`, `scripts/prod-smoke.mjs`, `Dockerfile`,
`line-app/scripts/setup-richmenu.js`, `.github/workflows/ci.yml` และ `.vercel/project.json` ของทั้งสองโฟลเดอร์
· หน้า owner: `backend/app/main.py`, `backend/app/routes/auth.py`, `backend/owner/index.html`
· storage/R2: `line-app/api/_store.js`, `line-app/api/_store-r2.js`, `line-app/scripts/migrate-blob-to-r2.js`
· index บิล: `line-app/api/_bills.js`, `line-app/api/_ledger.js`

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
- **1 deploy = 1 หอ** — ทั้งสองโปรเจกต์เป็น single-tenant ต่อ deployment: `line-app` ผูกหอด้วย `ROOMS`/`OWNER_USER_ID`,
  `backend` ผูกหอด้วย `PROPERTY_ID` (ค่าเริ่มต้น `p_1`) ซึ่งถูกตั้งเป็น `app.property_id` ทุก connection และ RLS
  กรองทุกตารางให้เห็นเฉพาะหอนั้น · เปิดหอที่สอง = สร้าง deployment/โปรเจกต์ชุดใหม่ ไม่ใช่เพิ่ม env ในชุดเดิม
  (ดู [`CONFIGURATION.md`](./CONFIGURATION.md) §1.6)
- **ฐานข้อมูล: มีเฉพาะฝั่ง `backend`** — Neon Postgres + RLS (`backend/app/db.py`, migrations `0004`/`0005`)
  ส่วน `line-app` **ไม่มีฐานข้อมูล** เก็บ state ลง Vercel Blob (`kv/*.json`, `slips/*`) ทั้งสองจึงไม่แชร์ข้อมูลกัน
  และไม่แชร์ connection string
- `line-app/` ไม่มีขั้นตอน build — ทั้งระบบคือ static 1 หน้า (`liff/bill.html`) + serverless function ใน `api/*.js`
  `package.json` มีแค่ `test` (รัน smoke 3 ชุด) ไม่มี `build`
- `backend/` ใช้ Vercel Python runtime: entrypoint คือ `backend/api/index.py` (`from app.main import app`)
  dependency มาจาก `backend/requirements.txt` (รวม `procrastinate` และ `httpx` — LINE push/verify ใช้ `httpx.Client` ตัวเดียวแบบ keep-alive)
- **cron อยู่ที่ `line-app` เท่านั้น** — `line-app/vercel.json` มี `crons` (`/api/cron`, `0 2 * * *`)
  ส่วน `backend/vercel.json` **ไม่มี `crons` แล้ว** เหลือแค่ `git.deploymentEnabled` (ดูข้อ 6)
- **ทางเลือกที่ไม่ใช่ Vercel:** `Dockerfile` ที่ root ของ repo สร้าง image ของ backend (`COPY backend/ /app/`,
  `uvicorn` ฟัง `${PORT:-8000}`) สำหรับ Railway/Cloud Run — ไม่มี CI ไหน build image นี้ และ **image ไม่รัน migration
  ให้เอง** ต้อง `alembic upgrade head` ก่อน start หรือทำเป็น release command ของผู้ให้บริการ
- **หน้าเจ้าของหอ `/owner` อยู่ใน deployment ของ `backend`** — `backend/app/main.py` mount
  `backend/owner/index.html` ไว้ที่ `/owner` (StaticFiles, `html=True`) และล็อกอินด้วย `POST /v1/auth/owner`
  ที่เทียบรหัสกับ env `OWNER_ACCESS_CODE` · ไม่มี owner account/ตาราง owner เพราะหนึ่ง deployment = หนึ่งหอ
  · **ไม่ตั้ง `OWNER_ACCESS_CODE` = ล็อกอินตอบ `503 OWNER_LOGIN_OFF`** (หน้าเปิดได้ แต่เข้าไม่ได้) — ข้อ 3.1

---

## 2. Pipeline

CI (`.github/workflows/ci.yml`, workflow `ci`) **ไม่ได้ deploy** — มันแค่กันของเสีย:

| job | รันเมื่อ | ทำอะไร |
|---|---|---|
| `line-app` | push `master` · ทุก PR | `npm ci` → `node --check` ทุก `api/*.js` → `smoke.js` → `smoke-handlers.js` → `smoke-reads.js` → `smoke-usecases.js` → `smoke-cron.js` → ตรวจ inline script ของ `liff/bill.html` |
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

### 2.1 `master` ถูกป้องกัน — production เปลี่ยนทาง merge เท่านั้น

ทุกอย่างที่ขึ้น production ต้องผ่าน PR ที่ merge เข้า `master` (ไม่มีใคร push ตรง) และ required check คือ job
`backend` ของ workflow `ci` — PR ที่ `backend` แดง merge ไม่ได้ จึงไม่มีทางที่โค้ด backend จะขึ้น production
โดยไม่ผ่าน `pytest -q` · การบังคับใช้ครอบ **admins ด้วย** (แม้แต่เจ้าของ repo ก็เลี่ยงไม่ได้)

ผลต่อลำดับงาน: "apply migration ก่อน" ในข้อ 4 ต้องทำ **ก่อนกด merge** ไม่ใช่หลัง เพราะ merge = deploy ทันที
และถ้าต้อง hotfix ให้เปิด PR เหมือนเดิม ไม่ใช่ `vercel --prod` ตรงจากเครื่อง (ข้อ 2)

<!-- VERIFY: branch protection ของ repo `WinTuner/Dormplus-prototype` (required PR + required check `backend` + enforce admins) ตั้งอยู่บน GitHub org ไม่ใช่ไฟล์ในเรพ — ดูได้ที่ Settings → Branches เท่านั้น -->

deploy ด้วยมือ (ใช้เมื่อไม่ได้มาจาก git):

```bash
cd line-app
vercel --prod
```

```bash
cd backend
vercel --prod
```

> **อ้างอิง:** `line-app/vercel.json` มี `crons` (`/api/cron`, ข้อ 6), `rewrites` (`/` → `/liff/bill.html`) และ
> `headers` (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` ทั้ง site ·
> `X-Frame-Options: DENY` เฉพาะ `/api/*` เพราะ LIFF ต้องถูก embed ใน LINE ได้) ·
> `backend/vercel.json` มีแค่กฎ `git` ไม่มี `crons` และไม่มี `rewrites`/`headers`

---

## 3. Environment setup (สรุป)

รายการเต็มพร้อม default อยู่ที่ [`CONFIGURATION.md`](./CONFIGURATION.md) — ที่ต้องรู้ตอน deploy:

| โปรเจกต์ | env ที่ต้องมีบน Vercel | หมายเหตุ |
|---|---|---|
| `line-app` | `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `LIFF_ID`, `OWNER_USER_ID`, `CRON_SECRET` (≥ 16 ตัว) (+ `SLIPOK_API_KEY` + `SLIPOK_BRANCH_ID` ถ้าเปิดตรวจสลิป · `RICHMENU_OWNER_ID` / `RICHMENU_TENANT_ID` ถ้าใช้ rich menu · `PUBLIC_BASE_URL` ไม่บังคับ — ถ้าไม่ตั้ง โค้ดใช้ `https://${req.headers.host}`) | `BLOB_STORE_ID` มาจาก `vercel storage connect` ไม่ต้องตั้งเอง · `SEED_TOKEN` / `ALLOW_SEED_BYPASS` **ปิดบน production เสมอ** · ไม่มี `CRON_SECRET` = ไม่มีการทวงบิลอัตโนมัติเลย · `ROOMS` / `DEFAULT_RENT` / `WATER_RATE` / `ELEC_RATE` ควรตั้งให้ตรงหอ (ค่าในแอปทับ env ได้ — §2.1 ของ `CONFIGURATION.md`) |
| `line-backend` | `DATABASE_URL` (pooled + `?sslmode=require`, **role ที่ไม่มี `BYPASSRLS`**), `SESSION_SECRET`, `LINE_CHANNEL_ID`, `LIFF_ID`, `COOKIE_SECURE=true`, `DEV_AUTH=false`, `PROPERTY_ID`, `OWNER_ACCESS_CODE` (ถ้าใช้หน้า `/owner`) · `CRON_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` เฉพาะเมื่อจะยิง cron/dunning ของฝั่งนี้ด้วยมือ | `DEV_AUTH=true` ถูกเพิกเฉยเมื่อ `VERCEL_ENV=production` · backend ไม่มี cron ที่ลงทะเบียนแล้ว จึงไม่ต้องมี `CRON_SECRET` เพื่อให้ระบบทำงานปกติ · ไม่ตั้ง `OWNER_ACCESS_CODE` = หน้า `/owner` ล็อกอินไม่ได้ (`503 OWNER_LOGIN_OFF`) |

- **`DATABASE_URL` ของ runtime ต้องเป็น role อย่าง `dormplus_app`** — DML บนทุกตาราง + sequences แต่ **ไม่มี
  `BYPASSRLS`** ไม่งั้น policy ของ migration `0004` ถูกข้ามทั้งหมด · alembic ใช้ role ที่มีสิทธิ์ DDL (owner) แยกกัน
  (ตรวจด้วย `select rolbypassrls from pg_roles where rolname = current_user`)
  <!-- VERIFY: role ที่ผูกกับ `DATABASE_URL` บน production คือ `dormplus_app` จริง (ไม่ใช่ `neondb_owner`) — ดูได้จาก dashboard/psql เท่านั้น -->
- **`CRON_SECRET` ของสองโปรเจกต์เป็นคนละค่าได้** และต้องตั้งแยกกัน — มีแต่ของ `line-app` ที่ถูกใช้โดย cron
  ที่ลงทะเบียนไว้ (ข้อ 6)
- **`SLIPOK_API_KEY` + `SLIPOK_BRANCH_ID` ต้องตั้งคู่กัน** — `line-app/api/_verify.js` เรียก
  `POST https://api.slipok.com/api/line/apikey/<SLIPOK_BRANCH_ID>` ด้วย header `x-authorization: <SLIPOK_API_KEY>`
  ขาดตัวใดตัวหนึ่ง = `askSlipok()` คืน `null` → สลิปถูกบันทึกด้วย `slipVerify.ok = null`, reason
  `not_configured` (**"ตรวจไม่ได้" ไม่ใช่ "ปลอม"** และไม่มีอะไรพัง) · branch ต้องผูกบัญชีรับเงินของหอไว้
  ไม่งั้นทุกสลิปได้ `1014` · ค่าจริงอยู่ใน Vercel env / SlipOK dashboard เท่านั้น ไม่มีในเรพ
  (ชื่อตัวแปรและพฤติกรรมอยู่ที่ [`CONFIGURATION.md`](./CONFIGURATION.md) §2.5)
  <!-- VERIFY: `SLIPOK_API_KEY` / `SLIPOK_BRANCH_ID` ถูกตั้งครบทั้งคู่บนโปรเจกต์ `line-app` แล้วหรือยัง และ `SLIPOK_BRANCH_ID` = branch 81129 ที่ผูกบัญชีรับเงินของหอ — เห็นได้ที่ Vercel env + SlipOK merchant console เท่านั้น -->
- **Blob ใช้ OIDC ไม่ใช่ token** — `@vercel/blob` รับ `BLOB_STORE_ID` + `VERCEL_OIDC_TOKEN` ที่ platform ฉีดให้
  (`vercel storage connect` ใส่ `BLOB_STORE_ID` ไว้ให้แล้ว) · **`BLOB_READ_WRITE_TOKEN` ไม่ถูกอ่านโดยโค้ด**
  เพราะทุก call ใช้ `access: "private"` — ถ้าเห็นตัวแปรนี้ค้างอยู่ ลบได้ ไม่มีผล
  <!-- VERIFY: Blob store ที่ผูกกับโปรเจกต์ `line-app` (ชื่อ/region) — ดูที่ Project → Storage -->
- **ย้ายที่เก็บไป Cloudflare R2 (`line-app`) — ทางเลือกเมื่อโควตา Blob ไม่พอ** — Vercel Blob free tier ให้
  **10,000 simple operations/เดือน** <!-- VERIFY: โควตา Blob free tier = 10,000 operations/เดือน เป็นข้อจำกัดของแพลตฟอร์ม อ้างจากคอมเมนต์ใน `line-app/api/_store.js` / `_store-r2.js` ไม่ใช่ค่าที่ตรวจได้จากเรพ --> และหนึ่งรอบของ
  หน้าจอเจ้าของ (`?overdue=1`, `?income=`) หรือ cron รายวัน **เคยอ่าน ~168 คีย์** — `ROOMS` เริ่มต้น 12 ห้อง ×
  (`bill:<room>` + `bills:<room>` + 12 รอบล่าสุดจาก `_ledger.OLDER_PERIODS`) — หลังมี `bill-state:<room>`
  เส้นทางเดิมอ่าน **1 คีย์ต่อห้อง** (12 reads/รอบ) · ขั้นตอนย้ายแบบเต็มอยู่ข้อ 3.2
  <!-- VERIFY: ชื่อ bucket / region / สถานะ R2 บน Cloudflare dashboard และโควตาจริงที่ใช้อยู่ — อยู่นอกเรพ -->
- **ขั้นตอนที่ทำได้จาก dashboard เท่านั้น** (ไม่มีคำสั่งในเรพ):
  - Vercel → Project → Settings → **Environment Variables** (ผูกกับ Production/Preview) และ **Root Directory**
  - LINE Developers → LIFF app → **Endpoint URL** ต้องชี้โดเมน production และเปิด **friend option** ตามที่หอต้องการ
  - SlipOK merchant console → ผูก **บัญชีรับเงินของหอ** เข้ากับ branch `81129`
  <!-- VERIFY: ค่า Endpoint URL ของ LIFF และสถานะ friend option ใน LINE Developers console — อยู่นอกเรพ -->
- **⚠️ ค่า demo `DEFAULT_RENT=1` ต้องถูกลบก่อนใช้จริง** — ถ้าโปรเจกต์ `line-app` ยังมี `DEFAULT_RENT=1`
  (ตั้งไว้ตอนเดโมให้บิลออกถูก ๆ) ห้องที่ยังไม่มี `room:<room>` จะออกบิลค่าเช่า 1 บาท **เงียบ ๆ ไม่มี error**
  ลบค่าออก (หรือตั้งให้ตรงหอจริง) แล้ว **redeploy** · ค่าที่เจ้าของบันทึกจากหน้าตั้งค่าหอจะทับ env อยู่แล้ว
  แต่ห้องที่ยังไม่เคยตั้งจะใช้ค่านี้
  <!-- VERIFY: `DEFAULT_RENT=1` ยังค้างอยู่บนโปรเจกต์ `line-app` หรือไม่ — ค่า env เห็นได้ที่ Project → Settings → Environment Variables เท่านั้น (ไม่มีในเรพ) -->

**แก้ env แล้วต้อง Redeploy เสมอ** — Vercel ผูก env กับ deployment: instance ที่ warm อยู่จะยังใช้ค่าเก่า
จนกว่าจะมี deployment ใหม่ (ไม่ใช่เพราะทุกไฟล์อ่านตอน module load — `cron.js` อ่าน `CRON_SECRET` ต่อ request,
`_line.js`/`_auth.js` จับ `LIFF_ID` ใส่ `const` ตอนโหลด, `backend/app/config.py` ใช้ `@lru_cache`)

- CLI: `vercel --prod` หรือ dashboard → Deployments → ⋯ → **Redeploy**
- หรือแก้จาก CLI: `vercel env rm <NAME> production --yes` แล้ว `"<value>" | vercel env add <NAME> production`
  (รูปแบบนี้ทีมใช้อยู่ตอนสลับ rich menu — ดู [`line-app/docs/DEPLOYMENT.md`](../line-app/docs/DEPLOYMENT.md))

### 3.1 หน้าเจ้าของหอ `/owner` — ต้องมี `OWNER_ACCESS_CODE`

- หน้า `/owner` มาจาก deployment ของ `backend` — `backend/app/main.py` mount
  `app.mount("/owner", StaticFiles(directory=BACKEND_DIR / "owner", html=True))` ชี้ไปที่ `backend/owner/index.html`
  **ไม่ต้องมีโปรเจกต์/static site แยก** และ `backend/vercel.json` ไม่มี `rewrites` สำหรับมัน
- ล็อกอิน: `POST /v1/auth/owner` (`backend/app/routes/auth.py` → `login_owner`) เทียบรหัสกับ
  `Settings.owner_access_code` (env `OWNER_ACCESS_CODE`, default `""` — `backend/app/config.py`) ด้วย
  `hmac.compare_digest` แล้วออก cookie ที่เซ็นด้วย `SESSION_SECRET` · ผิด 10 ครั้ง/ชม./IP → `429 TOO_MANY_ATTEMPTS`
- **ไม่ตั้ง `OWNER_ACCESS_CODE` → `503 OWNER_LOGIN_OFF`** ("ยังไม่ได้ตั้ง OWNER_ACCESS_CODE บนเซิร์ฟเวอร์")
  หน้าเว็บยังเปิดได้ แต่ทุกโค้ดถูกปฏิเสธ — ไม่มีรหัส default ให้เดา
- checklist: ตั้ง `OWNER_ACCESS_CODE` (รหัสสุ่มยาว ใช้ร่วมทั้งหอ) **และ** `SESSION_SECRET` ที่ไม่ใช่ placeholder
  `dev-only-change-me` บนโปรเจกต์ `line-backend` (Production) แล้ว redeploy ตามข้อ 3
- env นี้ไม่ปรากฏใน `/healthz` และ `scripts/prod-smoke.mjs` ไม่ตรวจ `/owner` — ต้องเปิดหน้าและล็อกอินเองหนึ่งครั้ง (ข้อ 7)
  <!-- VERIFY: โปรเจกต์ `line-backend` ตั้ง `OWNER_ACCESS_CODE` ไว้แล้วหรือยัง และรหัสคืออะไร — เห็นได้ที่ Project → Settings → Environment Variables เท่านั้น -->

### 3.2 ย้าย Blob → Cloudflare R2 (`line-app`) — runbook

ทำตามลำดับนี้เท่านั้น ลำดับผิด = โค้ดชี้ R2 ที่ยังไม่มีข้อมูล (อ่านได้ `null` ทุก key)

1. **Cloudflare:** สร้าง bucket + S3 API token (สิทธิ์ Object Read & Write เฉพาะ bucket นั้น) → ได้
   `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
2. **Vercel:** สร้าง **read/write token ของ Blob store** (Project `line-app` → Storage → Blob store → Tokens)
   — token นี้ใช้แค่ใน shell ตอนคัดลอกเท่านั้น · **runtime ไม่ใช้ token**: `_store.js` ใช้ `BLOB_STORE_ID` +
   `VERCEL_OIDC_TOKEN` ที่ platform ฉีดให้ ดังนั้นห้ามตั้ง `BLOB_READ_WRITE_TOKEN` บน deployment
3. **dry run ก่อนเสมอ** (อ่าน Blob ได้ แต่ไม่เขียน R2 · ไม่ต้องมี credential R2):
   ```bash
   cd line-app
   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_… node scripts/migrate-blob-to-r2.js --dry
   ```
   ดูจำนวนไฟล์/ขนาดของ `kv/` และ `slips/` แล้วเทียบกับที่คาด (`--only=kv` / `--only=slips` แยกได้)
4. **รันจริง** ด้วย env ครบห้าตัว (Blob token + R2 ทั้งสี่):
   ```bash
   cd line-app
   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_… \
   R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=… \
   node scripts/migrate-blob-to-r2.js
   ```
   รันซ้ำได้ปลอดภัย (เขียนทับด้วยไบต์เดิม) · path คงเดิม (`kv/<key>.json`, `slips/…`) จึงไม่ต้อง rewrite อะไร
5. **ตั้ง env บน Vercel (Production) หลังคัดลอกเสร็จ** — `R2_BUCKET` + `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` +
   `R2_SECRET_ACCESS_KEY` **ครบทั้งสี่ตัวในรอบ deploy เดียวกัน** · มี `R2_BUCKET` เมื่อไร `_store.js`
   (`process.env.R2_BUCKET ? createStore() : null`, ตอน module load) เปลี่ยนไป R2 ทั้งระบบทันที; ขาดตัวใดตัวหนึ่ง
   `createStore()` โยน error ทุก request ที่แตะ storage และ **ไม่ fallback กลับ Blob**
6. **redeploy** แล้วตรวจ `/api/config` + 1 บิล + 1 สลิป (รูปสลิปต้องเปิดได้) + `bill-state:` ของห้องที่เพิ่งบันทึกบิล

**Rollback:** ลบ `R2_BUCKET` (และ credential R2) แล้ว redeploy — `_store.js` กลับไปใช้ Blob ทันที
⚠️ **ข้อมูลที่เขียนลง R2 ในช่วงนั้นจะไม่ย้ายกลับเอง** — Blob จะยังเป็นสำเนาก่อนการย้าย ถ้าต้องการข้อมูลช่วงนั้นคืน
ต้องคัดลอกกลับเองก่อน (ยังไม่มีสคริปต์ทิศทางย้อนกลับในเรพ)

<!-- VERIFY: ชื่อ bucket, region, สถานะ R2 และว่า token ที่สร้างเป็น read/write ของ bucket เดียว — ดูได้ที่ Cloudflare dashboard เท่านั้น -->

### 3.3 `bill-state:<room>` — ไม่มี migration และไม่ต้อง block deploy

key ใหม่นี้ **ถูกสร้างเองแบบ lazy** โดย `saveBills()` ครั้งถัดไปของแต่ละห้อง (`_ledger.indexState()` ถูกเรียกใน
`saveBills()` ทุกครั้ง — `line-app/api/_bills.js`) ดังนั้น:

- **ไม่มี migration script และไม่มีข้อมูลต้อง rewrite** — อย่าถือว่านี่เป็นงานที่ต้องทำก่อน merge/deploy
- ห้องที่ยังไม่มี key: `stateBills()` (`_ledger.js`) fallback ไป `recentBills()` (อ่านบิลจริง) **โดยไม่เขียนอะไร**
  คำตอบจึงถูกทุกกรณี แค่จ่าย read แบบเดิม (หลายคีย์ต่อห้อง) จนกว่าห้องนั้นจะถูกเขียนบิลครั้งแรก
- การอ่านไม่สร้าง key โดยตั้งใจ (read ต้องไม่ freeze รายการเก่าลงใน index) · หลังบิลใหม่ของห้องหนึ่งถูกบันทึก
  เส้นทาง overdue/income/cron ของห้องนั้นเหลือ **1 read**
- ถ้าจะย้ายข้อมูลไป R2 (ข้อ 3.2) `kv/bill-state-*.json` ถูกคัดลอกไปเหมือน key อื่น — ไม่มีขั้นตอนพิเศษ

<!-- VERIFY: env ถูกตั้งแยก Production/Preview หรือใช้ค่าร่วมกัน — ต้องดู Project → Settings → Environment Variables · preview ของ line-app ใช้ Blob store เดียวกับ production หรือไม่ก็ยืนยันจากเรพไม่ได้ -->

---

## 4. backend: ลำดับงานเมื่อแก้ schema (สำคัญที่สุด)

`backend/migrations/versions/` คือ **schema of record** — `db/schema.sql` เป็น snapshot อ่านอย่างเดียว
(**มีถึง `0004`** — มี policy RLS ครบ แต่ยังไม่มีตาราง `line_events` ของ `0005` อย่าใช้ตัดสินว่า DB จริงอยู่ revision ไหน
ให้ดู `alembic current`)

มี 6 revision: `0001` initial · `0002` `link_codes` · `0003` `auth_failures` · `0004` **RLS (`force row level security`)** ·
`0005` `line_events` (`event_id` เป็น PK · `property_id` · `received_at` · **`force row level security`** ·
grant ให้ `dormplus_app` แบบมีเงื่อนไข) — กัน LINE ส่ง event ซ้ำแล้วเขียน `audit_log` สองแถว · `0006` index FK ของ `invoice_items`/`payments` (`invoice_items_invoice_id_idx`, `payments_invoice_id_idx`)

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

> ⚠️ **`0004` เป็นข้อยกเว้นของลำดับนี้** — ต้อง deploy โค้ดที่ตั้ง `app.property_id` **ก่อน** apply migration
> อ่านข้อ 4.4 ก่อนรัน `alembic upgrade head` ครั้งแรกหลังมี `0004`
>
> ✅ **`0005` ไม่ใช่ข้อยกเว้น** — เป็น migration แบบเพิ่มอย่างเดียว (สร้างตาราง `line_events` + policy + grant)
> จึงใช้ลำดับปกติ: `alembic upgrade head` ก่อน merge (ข้อ 3) ได้เลย · ยกเว้นของ `0004` ยังมีผลแยกกันอยู่
> อย่าอ่านสองข้อนี้ปนกัน
>
> ✅ **`0006` เป็น migration แบบเพิ่มอย่างเดียวเช่นกัน** (สร้างแค่ index สองตัว ไม่มีตาราง/policy/grant) — apply ก่อนหรือหลัง deploy โค้ดก็ได้ · `downgrade()` drop แค่สอง index **ข้อมูลไม่หาย**

grant ใน `0005` มีเงื่อนไข (`if exists (select 1 from pg_roles where rolname = 'dormplus_app')`) เพราะ
CI/ฐานข้อมูลใหม่ยังไม่มี role นั้นและต้อง migrate ผ่าน — บน production role มีอยู่แล้วจึงได้ grant ครบ
ถ้าสร้าง `dormplus_app` **หลัง** apply `0005` ต้อง grant เอง (`grant select, insert, update, delete on line_events to dormplus_app;`)
ไม่งั้น webhook เขียนตารางนี้ไม่ได้

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
- **role ที่รัน alembic ต้องมีสิทธิ์ DDL** — ใช้ owner (`neondb_owner`) ไม่ใช่ `dormplus_app`
  (role ของ runtime มีแค่ DML + sequences) · สลับ URL ไปมาระหว่างสอง role อย่าใช้ค่าเดียวกันทั้งสองงาน
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

ทุก revision มีฟังก์ชัน `downgrade()` (ครบทั้งหกไฟล์) แต่ **ให้ถือว่า migration เป็น forward-only ตอนวางแผน** —
`downgrade()` มีไว้เป็นทางหนีตอน apply ผิดเท่านั้น ไม่ใช่ขั้นตอน rollback ปกติ เพราะ `0002`/`0003`
ย้อนแล้ว **drop ตารางทิ้ง** (`link_codes`, `auth_failures`) ข้อมูลหายถาวร · ถ้าต้องถอย ให้ถอย **โค้ด**
(redeploy deployment เก่า — ข้อ 8.1) แล้วปล่อย schema ใหม่ไว้ ซึ่งปลอดภัยกว่าเมื่อ migration เป็นแบบเพิ่มอย่างเดียว

ก่อน merge ทุกครั้งที่ PR มีไฟล์ใน `backend/migrations/versions/`:

```bash
cd backend
alembic current                                    # ต้องรู้ว่าปัจจุบันอยู่ revision ไหน
DATABASE_URL="postgresql+psycopg://…unpooled…" alembic upgrade head   # กับฐาน production
```

ถ้าลืมขั้นนี้แล้ว merge: โค้ดใหม่ขึ้น production ทันทีและวิ่งชน schema เก่า (500 ทั้งหน้า, cron ล้ม) เพราะ
**ไม่มีอะไรใน Vercel รัน migration ให้** (ข้อ 4.3) — ทางแก้คือ apply migration ย้อนหลังให้เร็วที่สุด
ไม่ใช่ rollback โค้ดก่อน

### 4.3 อย่ารอให้ deploy รัน migration ให้

Vercel serverless ไม่รัน migration ตอน deploy และไม่มี release hook ในเรพนี้ — `backend/README.md`
ระบุตรง ๆ ว่า "ไม่ต้องรัน migration ตอน deploy · ให้รัน `alembic upgrade head` จากเครื่องเมื่อมี migration ใหม่"
ถ้าลืม: route ที่แตะคอลัมน์/ตารางใหม่จะ 500 และ `/v1/cron/daily` จะตอบ `503 QUEUE_UNAVAILABLE` ถ้าตารางคิวหาย

### 4.4 ข้อยกเว้น: `0004` (RLS) ต้อง deploy **โค้ดก่อน** migration

ปกติ schema มาก่อนโค้ด แต่ `0004` กลับกัน เพราะมันเปิด `force row level security` ทุกตารางที่ผูกหอ:

- policy เทียบ `property_id` กับ `current_setting('app.property_id', true)`
- แอปตั้งค่านี้ต่อ transaction (`set_config(..., true)` ตอน `begin`) ที่ `app/db.py` → `attach_property()` (`select set_config('app.property_id', …)`)
  โดยอ่านจาก env `PROPERTY_ID` ของ deployment
- **setting ที่ไม่ถูกตั้ง = `NULL` = predicate ไม่ match อะไรเลย → อ่านได้ 0 แถว (fail closed)**
  ไม่ใช่ "เห็นทุกหอ"

ดังนั้นถ้า apply `0004` ในขณะที่ deployment ที่รันอยู่ยังเป็น build เก่าที่ไม่มี `attach_property()`
แอปจะยังตอบ 200 แต่ **ทุกหน้าว่าง** (`/v1/rooms` = `[]`, บิล/ผู้เช่าไม่ขึ้น) และดูเหมือนข้อมูลหาย

ลำดับที่ถูกสำหรับ `0004`:

```text
1. merge โค้ดที่มี app/db.py (attach_property) + tests/test_rls.py → Vercel deploy
2. ตรวจว่า PROPERTY_ID บนโปรเจกต์ line-backend ตั้งแล้วและตรงกับ properties.id จริง (default คือ p_1)
3. ตรวจว่า DATABASE_URL ของ runtime เป็น role ที่ไม่มี BYPASSRLS
4. alembic upgrade head (0004) ด้วย role ที่มี DDL และ endpoint unpooled
5. ยืนยันทันที: select current_setting('app.property_id', true); select count(*) from rooms;
6. node scripts/prod-smoke.mjs + เปิดหน้า owner ดูว่ามีข้อมูล
```

- ถ้าฐานข้อมูลยังอยู่ `0003` แต่โค้ดใหม่รันอยู่ ไม่มีอะไรพัง — โค้ดตั้ง setting ไว้เฉย ๆ policy ยังไม่ทำงาน
  (ลำดับนี้ปลอดภัยกว่าการสลับ เพราะการ apply ก่อนคือทางที่พัง)
- ถ้าพลาดลำดับ (apply ก่อน): rollback deployment (ข้อ 8.1) **หรือ** `alembic downgrade 0003` (ข้อ 8.2) แล้วเริ่มใหม่
  — `downgrade()` ของ `0004` แค่ drop policy + `no force row level security` **ข้อมูลไม่หาย**
- `auth_failures` ไม่อยู่ใน policy โดยตั้งใจ (ผูกกับ LINE user ไม่ใช่หอ) จึงยังอ่านได้แม้ setting หาย
- หลัง `0004` แล้ว ถ้า role ไหนไม่เคยตั้ง `app.property_id` role นั้นอ่านตารางพวกนี้ไม่ได้เลย — รวมถึง `psql`
  ที่ต่อด้วย `dormplus_app` ให้ `select set_config('app.property_id','p_1',false);` ก่อนคิวรี

---

## 5. คิว (Procrastinate) — จำเป็นเฉพาะเมื่อใช้ endpoint ฝั่ง backend

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

**ตอนนี้ cron ที่ลงทะเบียนไว้อยู่ที่ `line-app` (ข้อ 6) และไม่ใช้คิวนี** — `line-app/api/_remind.js` ส่งข้อความเอง
ดังนั้นฐานข้อมูล production **ไม่จำเป็นต้องมีตาราง procrastinate** ถ้าไม่ได้ใช้ endpoint ฝั่ง backend

ถ้าใช้ `POST /v1/dunning/run` (หรือ `GET /v1/cron/daily` ด้วยมือ) ต้องมีตารางนี้ และต้องรู้ว่า:
`/v1/dunning/run` **แค่ enqueue** ไม่ได้ drain — ตัว drain คือ `/v1/cron/daily` เท่านั้น
ถ้า backend ไม่มี cron แล้ว job ที่ค้างจะไม่ถูกส่งจนกว่าจะยิง `/v1/cron/daily` ด้วยมือ

อาการถ้ายังไม่สร้าง: `/v1/cron/daily` ตอบ `503` code `QUEUE_UNAVAILABLE` พร้อมข้อความ "ตรวจว่าสร้างตาราง procrastinate แล้วหรือยัง"
(ทุก exception ระหว่าง enqueue/drain ถูกแปลงเป็น 503 นี้)

ทางเลือกเมื่ออยากส่งถี่กว่ารายวัน: `procrastinate -a app.queue.app worker` บน host ที่ค้างได้ ชี้ Postgres ตัวเดียวกัน

---

## 6. cron รายวัน — รันที่ `line-app` (backend ไม่มี schedule)

`line-app/vercel.json`:

```json
{ "crons": [{ "path": "/api/cron", "schedule": "0 2 * * *" }] }
```

`backend/vercel.json` **ไม่มี `crons`** — ถ้าเปิดของ backend ด้วย จะมีการทวงซ้อนสองชุด
endpoint ฝั่ง backend (`GET /v1/cron/daily`) ยังอยู่และยังทำงานเหมือนเดิม แต่ไม่มีใครยิงตามเวลา

02:00 UTC = 09:00 เวลาไทย · Vercel ยิง `GET /api/cron` และ — **ถ้าตั้ง env `CRON_SECRET` ไว้บนโปรเจกต์** —
ใส่ `Authorization: Bearer <CRON_SECRET>` ให้เอง

`line-app/api/cron.js` (`api/_remind.js` คือตัวส่งจริง):

- รับเฉพาะ `GET` — อย่างอื่น `405 METHOD_NOT_ALLOWED`
- `CRON_SECRET` ต้องยาว **≥ 16 ตัว** ไม่งั้น `503 NOT_CONFIGURED` (แยกจาก 401 เพื่อบอกว่า "ยังไม่ได้ตั้ง")
- เทียบ secret ด้วย `sameSecret` (`crypto.timingSafeEqual` ใน `api/_auth.js`) — ไม่ตรง → `401 UNAUTHORIZED`
  (secret ใน query string ไม่ถูกอ่าน)
- กันรอบซ้อนด้วย lock key `cron-lock` ใน Vercel Blob อายุ 15 นาที — ถ้ามี lock อยู่จะตอบ `200` พร้อม `skipped`
  แทนการส่งซ้ำ
- วันที่คิดด้วย `Asia/Bangkok` ไม่ใช่ UTC ของ server
- ส่งเตือนก่อนครบกำหนด / วันครบกำหนด / เลย 1-5-10 วัน + สรุปให้เจ้าของ ผ่าน LINE push ของ line-app เอง
  (ต้องมี `LINE_CHANNEL_ACCESS_TOKEN` เท่านั้น · `PUBLIC_BASE_URL` ไม่บังคับ)

ยิงมือหนึ่งครั้ง:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://line-app-iota.vercel.app/api/cron
```

ผลที่ถูก:

```json
{ "ok": true, "today": "2026-11-15", "sent": [{ "room": "203", "period": "2026-11", "kind": "due_0" }], "failed": 0 }
```

| ที่เห็น | แปลว่า |
|---|---|
| `503 NOT_CONFIGURED` | ไม่ได้ตั้ง `CRON_SECRET` หรือสั้นกว่า 16 ตัว |
| `401 UNAUTHORIZED` | secret ไม่ตรง / แก้ env แล้วยังไม่ redeploy |
| `405 METHOD_NOT_ALLOWED` | ยิงด้วย `POST` (เช่นจาก dashboard/Postman) |
| `200 {"skipped":"another run is in progress"}` | มีรอบอื่นถือ lock อยู่ — รอรอบถัดไป |
| `200 {"sent":[],"failed":0}` | ต่อได้ แต่ไม่มีบิลที่ถึงรอบวันนี้ |

**`CRON_SECRET` อ่านจาก `process.env` ตอน request** (ไม่ได้ฝังลง bundle ตอน build) แต่ Vercel ผูก env ไว้กับ deployment — แก้ค่าใน dashboard แล้ว deployment ที่รันอยู่ยังใช้ค่าเดิม **ต้อง redeploy** ค่าใหม่จึงมีผล

### 6.1 `CRON_SECRET` สองโปรเจกต์ — คนละค่าได้ ตั้งแยกกัน

| โปรเจกต์ | ใช้เมื่อ | ต้องมี |
|---|---|---|
| `line-app` | cron ที่ลงทะเบียนไว้ (`0 2 * * *`) | **จำเป็นถ้าจะให้มีการทวงอัตโนมัติ** · ≥ 16 ตัว |
| `line-backend` | ยิง `/v1/cron/daily` หรือ `POST /v1/dunning/run` ด้วย header เอง | ไม่บังคับ (ไม่มี cron แล้ว) · ฝั่งนี้ยังรับชื่อเก่า `DUNNING_TOKEN` (`AliasChoices`) แต่ `line-app` ไม่รับ alias |

ใส่ค่าเดียวกันทั้งสองที่จะง่ายกว่า แต่ไม่จำเป็น — Vercel แนบ secret ของโปรเจกต์นั้นให้ cron ของโปรเจกต์นั้น

### 6.2 endpoint ฝั่ง backend (ยังอยู่ แต่ไม่ได้ตั้งเวลา)

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://line-backend-ten.vercel.app/v1/cron/daily
```

```json
{ "queued": 3, "drained": true }
```

`backend/app/routes/cron.py` เทียบด้วย `hmac.compare_digest` และ **fail closed**:
ถ้าไม่ได้ตั้ง `CRON_SECRET` หรือ token ไม่ตรง → `401 UNAUTHORIZED` (token ทาง query string ถูกปฏิเสธ —
`presented_token()` อ่านเฉพาะ header `Authorization`) · `PROPERTY_ID` ค่าเริ่มต้น `p_1`

| ที่เห็น | แปลว่า |
|---|---|
| `401 UNAUTHORIZED` | `CRON_SECRET` บนโปรเจกต์ไม่ตรง / ยังไม่ redeploy / ไม่ได้ตั้งค่า |
| `200 {"queued":0,"drained":true}` | ต่อได้ แต่ไม่มีบิลที่ถึงรอบทวง |
| `503 QUEUE_UNAVAILABLE` | ยังไม่สร้างตาราง procrastinate (ข้อ 5) หรือต่อ DB ไม่ได้ |
| `500` | ดู log ของ function ก่อน — มักเป็น schema ไม่ตรง (ข้อ 4) |

<!-- ตรวจแล้ว 2026-11-16: `vercel crons list` บนโปรเจกต์ line-app คืน `/api/cron  0 2 * * *` และโปรเจกต์ line-backend ไม่มี cron job เลย · ประวัติการยิงจริงยังดูได้แค่ที่ Vercel → Project (line-app) → Cron Jobs · Hobby รันได้วันละ 1 ครั้ง คลาดได้ถึง ±59 นาที -->
<!-- VERIFY: plan ของทีมบน Vercel (Hobby vs Pro) เป็นตัวกำหนดเพดาน cron/function timeout — ยืนยันจากเรพไม่ได้ -->

`scripts/prod-smoke.mjs` ตรวจแค่ว่า `/v1/cron/daily` ของ backend มีอยู่และ **ต้องมี secret** (`GET` ไม่มี header → 401)
ไม่ได้ตรวจ `/api/cron` ของ line-app และไม่ได้ตรวจว่า cron ทำงาน — การยืนยันรอบจริงต้องดูจาก dashboard หรือผลของ `sent`

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

**หลัง deploy ที่แตะ RLS (ข้อ 4.4) ต้องเพิ่มการเช็คด้วยตา:** เปิดหน้า owner แล้วดูว่ามีห้อง/บิลขึ้น
(`/healthz` ผ่านไม่ได้แปลว่าเห็นข้อมูล — มันแค่ `select 1`)

**หน้า `/owner` (ฝั่ง backend):** `curl -I https://line-backend-ten.vercel.app/owner` ต้องได้ `200` + HTML
แล้วเปิดในเบราว์เซอร์ ล็อกอินด้วย `OWNER_ACCESS_CODE` หนึ่งครั้ง — prod-smoke ไม่ครอบส่วนนี้ และถ้าได้
`503 OWNER_LOGIN_OFF` แปลว่ายังไม่ได้ตั้ง env (ข้อ 3.1)

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
(ยกเว้น `0004` — ดูหมายเหตุท้ายข้อนี้)

> **แนวปฏิบัติ: ถือว่า migration เป็น forward-only** — rollback มาตรฐานคือ redeploy deployment เก่า (ข้อ 8.1)
> แล้วปล่อย schema ที่เพิ่มไปแล้วไว้ เพราะ schema ใหม่ที่เพิ่มอย่างเดียวไม่ทำให้โค้ดเก่าพัง · ใช้ `alembic downgrade`
> เฉพาะเมื่อ schema นั้นทำให้ระบบใช้ไม่ได้จริง ๆ และรู้ว่าข้อมูลส่วนไหนจะหาย (ข้อ 4.2)

```bash
cd backend
DATABASE_URL="postgresql+psycopg://…unpooled…" alembic downgrade 0003   # ถอยจาก 0004 ไป 0003
DATABASE_URL="postgresql+psycopg://…unpooled…" alembic current          # ยืนยัน
```

- ระบุ revision ปลายทางเสมอ (`alembic downgrade 0003`) — `-1` ก็ใช้ได้แต่ต้องรู้ว่าปัจจุบันอยู่ไหน
- `downgrade()` ของ `0002`/`0003` จะ drop ตาราง `link_codes` / `auth_failures` — **ข้อมูลในนั้นหายถาวร**
- `downgrade()` ของ `0005` drop ตาราง `line_events` — **ข้อมูล event id หายถาวร** · ผลคือ LINE ที่ retry
  ข้อความเดิมจะถูกนับเป็น event ใหม่ (เขียน `audit_log` ซ้ำ) ไม่มีอะไร crash · ถ้าจะถอยแค่โค้ดไม่ต้องถอย revision นี้
- `downgrade()` ของ `0006` drop แค่ index สองตัว — **ข้อมูลไม่หาย** (ช้าลงเฉพาะ `GET /v1/invoices/:id`)
- `downgrade()` ของ `0004` แค่ drop policy และ `no force row level security` — **ข้อมูลไม่หาย** แต่ **RLS ยังเปิดอยู่**
  (ไม่มีการ `disable row level security`) ดังนั้น role ที่ไม่ใช่ owner และไม่มี policy (`dormplus_app`) จะอ่านได้ **0 แถว**
  → ถ้าจะถอย `0004` ต้องถอยโค้ด/role ไปใช้ owner ด้วย หรือ `alter table … disable row level security` เอง ไม่งั้นแอปจะเห็นข้อมูลว่าง
- อย่า downgrade ฐานข้อมูล Neon แล้วทิ้ง deployment ใหม่ไว้: rollback deployment (ข้อ 8.1) **ก่อน** หรือพร้อมกัน

### 8.3 ย้อน env

แก้ค่ากลับที่ Settings → Environment Variables แล้ว **Redeploy** (ข้อ 3) — รวมถึง `CRON_SECRET`
ที่ถ้าเปลี่ยนแล้วไม่ redeploy จะได้ 401 (หรือ `503 NOT_CONFIGURED`) จาก cron และจาก curl ของคุณ

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
| cron (line-app) | ผลของ `/api/cron` (`sent` / `failed` / `skipped`) · Vercel → โปรเจกต์ `line-app` → **Cron Jobs** · log `event failed ...`, `line message/push 4xx` |
| cron (backend, ไม่ได้ตั้งเวลา) | ผลของ `/v1/cron/daily` (`queued` / `drained`) · log ของ `line.push_text` (`skipped` = ไม่มี token) — ใช้เมื่อยิงมือ |
| line-app | log `event failed ...`, `line message/push 4xx`, `owner push failed`, `slip verify failed ...` · LINE Developers → Webhook event log |
| ทั้งคู่ | `node scripts/prod-smoke.mjs` (exit 1 = มีข้อตก) |

`/healthz` ผ่านไม่ได้ยืนยันว่าแอปอ่านข้อมูลได้ — ถ้า RLS ตั้งผิดจะได้ 200 จาก `/healthz` แต่หน้าเว็บว่าง
(ข้อ 4.4 และข้อ 10)

<!-- VERIFY: มี alert/notification rule ตั้งไว้บน Vercel หรือ Neon หรือไม่ และแจ้งไปที่ช่องทางไหน — ไม่มีในเรพ -->

---

## 10. ความล้มเหลวที่เจอมาแล้ว (อ่านก่อน deploy)

| อาการ | สาเหตุ | ทางแก้ |
|---|---|---|
| deploy ล้ม/ถูกบล็อก หลัง push หลายรอบในวันเดียว | Hobby ให้ **100 deployments/วัน ทั้งทีม** และ repo นี้มี 2 โปรเจกต์ → เดิมทุก push ทุกกิ่ง = 2 deployments | ใช้กฎใน `vercel.json`: deploy เฉพาะ `master` และ `preview-*` (ต้องมีทั้ง `"*"` และ `"**"` — `*` ไม่ข้าม `/`) · Ignored Build Step ไม่ช่วย เพราะ build ที่ถูกยกเลิกก็ยังนับ |
| กิ่ง `chore/foo` ยัง deploy อยู่ทั้งที่ตั้งกฎแล้ว | มีแค่ `"*": false` ซึ่งไม่ match ชื่อกิ่งที่มี `/` | ใส่ `"**": false` ด้วย (มีแล้วในทั้งสอง `vercel.json`) |
| deploy ล้มด้วย `exceeded_serverless_functions_per_deployment` | เพดาน Hobby 12 serverless functions ต่อ deployment · `line-app` ใช้ **ครบ 12** (`api/*.js` ที่ไม่ขึ้นต้นด้วย `_` — รวม `cron.js`) | รวม endpoint เดิมก่อนเพิ่มใหม่ (helper ที่ขึ้นต้นด้วย `_` ไม่นับ) |
| deploy จาก Git ถูกปฏิเสธ / ไม่ขึ้นในรายการ | Vercel ผูก deployment กับ **author ของ commit** — ถ้า author ไม่ใช่สมาชิกทีม จะไม่ถูกนับเป็น deployment ของทีม | ตั้ง `git config user.email` ให้ตรงกับบัญชีที่อยู่ในทีม Vercel และอย่าใช้ email ปลอม/`noreply` ของคนอื่น |
| `vercel --prod` จาก `line-app/` หรือ `backend/` ขึ้นผิดโปรเจกต์ / ได้ 404 ทั้ง site | CLI ใช้โปรเจกต์ที่ผูกไว้ใน `.vercel/project.json` ของโฟลเดอร์นั้น — ถ้าโฟลเดอร์ยังไม่ผูก หรือผูกโปรเจกต์ที่ Root Directory ไม่ตรงกับโฟลเดอร์นี้ CLI จะสร้าง/ใช้โปรเจกต์ที่ root ต่างจาก Git integration | เช็ก `.vercel/project.json` ว่า `projectName` ตรง (`line-app` / `line-backend`) ก่อนสั่ง · ถ้าไม่แน่ใจให้ใช้ dashboard หรือให้ Git integration deploy |
| **หน้า owner/tenant ว่างเปล่า, `/v1/rooms` ตอบ 200 แต่ `[]`, บิล/ผู้เช่าไม่ขึ้น** | apply `0004` ก่อน deploy โค้ดที่มี `attach_property()` → connection ไม่มี `app.property_id` → policy fail closed อ่าน 0 แถว (ข้อ 4.4) | rollback deployment หรือ `alembic downgrade 0003` แล้วทำตามลำดับในข้อ 4.4 · เช็คด้วย `select current_setting('app.property_id', true);` |
| `PROPERTY_ID` ไม่ตรงกับ `properties.id` ในฐานข้อมูล | policy เทียบกับค่านี้ตรง ๆ (default `p_1`) — ค่าผิด = อ่าน 0 แถวเหมือนกัน | ตั้ง `PROPERTY_ID` ให้ตรง แล้ว redeploy · `select id from properties;` |
| เห็นข้อมูลข้ามหอ / policy ดูไม่มีผล | `DATABASE_URL` ของ runtime ใช้ role ที่มี `BYPASSRLS` (`neondb_owner`) จึงข้าม policy ทั้งหมด | เปลี่ยน runtime ไปใช้ `dormplus_app` · ตรวจ `select rolbypassrls from pg_roles where rolname = current_user` |
| `psql`/สคริปต์ตอบ 0 แถวทั้งที่ข้อมูลอยู่ | ต่อด้วย role ที่ไม่ตั้ง `app.property_id` (fail closed ตามดีไซน์) | `select set_config('app.property_id','p_1',false);` ก่อนคิวรี |
| สลิปขึ้น **"ตรวจไม่ได้"** (`slipVerify.ok = null`, reason `not_configured`) | ไม่ได้ตั้ง `SLIPOK_API_KEY` / `SLIPOK_BRANCH_ID` ครบทั้งคู่ → `_verify.js` ไม่เรียกผู้ให้บริการเลย (ไม่ได้ล้มเหลว แค่ไม่ได้ตรวจ) | ตั้งทั้งคู่บนโปรเจกต์ `line-app` แล้ว redeploy (ข้อ 3) · สลิปยังถูกบันทึกครบ ไม่ต้องให้ผู้เช่าส่งใหม่ |
| สลิปขึ้น "ตรวจไม่ได้" ทั้งที่ตั้งครบ | ผู้ให้บริการไม่ตอบ/อ่านรูปไม่ได้/สลิปใหม่เกินไป — โค้ดคืน `ok: null` พร้อม reason ไทย เช่น `ธนาคารขัดข้องชั่วคราว — ลองอีกครั้งใน 15 นาที`, `สลิปใหม่เกินไป` ตั้งใจไม่เรียกว่า "ปลอม" | ตรวจ log `slip verify failed ...` แล้วตรวจซ้ำภายหลัง · อย่าลบบิล/หาว่าผู้เช่าโกงจากผลนี้ (`ok: false` เท่านั้นที่หมายถึงสลิปมีปัญหา: `1012` ซ้ำ, `1013` ยอดไม่ตรง, `1014` บัญชีผู้รับ) |
| **สลิปทุกใบได้ `1014` "บัญชีผู้รับไม่ใช่บัญชีของหอ"** | branch ใน `SLIPOK_BRANCH_ID` ยังไม่ผูกบัญชีรับเงินของหอ (หรือสลิปโอนเข้าบัญชีคนละใบจริง ๆ) | ผูกบัญชีรับเงินของหอใน branch นั้นที่ SlipOK dashboard — **ไม่ต้อง redeploy** (env ไม่เปลี่ยน) · ตรวจว่า `SLIPOK_BRANCH_ID` ชี้ branch ของหอนี้ ไม่ใช่ของหออื่น |
| LINE webhook ของ backend ตอบ `503 LINE_NOT_CONFIGURED` | ไม่ได้ตั้ง `LINE_CHANNEL_SECRET` บนโปรเจกต์ `line-backend` (ชื่อ code นี้ใช้ทั้ง `/v1/auth/line` และ webhook) | ตั้งค่าแล้ว redeploy · OA ที่ใช้งานจริงยังชี้ webhook ที่ `line-app` จึงไม่กระทบการทวงบิล |
| line-app cron ตอบ `503 NOT_CONFIGURED` | ไม่ได้ตั้ง `CRON_SECRET` หรือสั้นกว่า 16 ตัว | ตั้งค่า ≥ 16 ตัวบนโปรเจกต์ `line-app` แล้ว redeploy (ข้อ 6) |
| ตั้ง `CRON_SECRET` แล้ว cron ยัง 401 | ค่าที่ตั้งไม่ตรงกับที่ deployment เห็น (ตั้งแล้วยังไม่ redeploy) หรือตั้งที่โปรเจกต์ผิด (คนละโปรเจกต์) — `cron.js` อ่าน env ต่อ request แต่ Vercel ผูก env กับ deployment | redeploy หลังตั้ง env บนโปรเจกต์ที่ถูก (ข้อ 3, 6.1) |
| cron ทวงซ้อนสองรอบ / ส่งข้อความซ้ำ | เปิด `crons` ทั้ง `line-app` และ backend | ให้ `line-app/vercel.json` เป็นที่เดียว · backend ต้องไม่มี `crons` (ข้อ 6) |
| cron ของ backend ตอบ 503 `QUEUE_UNAVAILABLE` | ยังไม่รัน `python -m app.queue` บนฐานข้อมูลนั้น | รันด้วย unpooled URL (ข้อ 5) — หรือไม่ต้องใช้ endpoint นี้เลยถ้าทวงที่ line-app |
| หน้า LIFF ยังเป็น build เก่า / `qr-ph` หาย | deploy ไม่ขึ้น (กิ่งไม่ใช่ `master`/`preview-*`) หรือ alias ยังชี้ deployment เก่า | ดู Deployments ล่าสุด + `node scripts/prod-smoke.mjs` |
| **`/owner` เปิดได้แต่ล็อกอินไม่ผ่าน — `503 OWNER_LOGIN_OFF`** | ไม่ได้ตั้ง `OWNER_ACCESS_CODE` บนโปรเจกต์ `line-backend` (หรือตั้งแล้วยังไม่ redeploy) | ตั้งรหัสแล้ว redeploy (ข้อ 3.1) — ตัวหน้าเว็บยัง serve ปกติ ไม่ใช่ deploy ล้ม |
| หลังย้าย R2 แล้วบิล/สลิปหายทั้งหมด | ตั้ง `R2_BUCKET` ก่อนคัดลอกข้อมูล หรือ bucket ว่าง/credential ไม่ครบ (`createStore()` throw ทุก request และไม่ fallback Blob) | คัดลอกด้วย `scripts/migrate-blob-to-r2.js` ตามข้อ 3.2 · ถอยกลับชั่วคราว: ลบ `R2_BUCKET` แล้ว redeploy (ข้อมูลช่วง R2 ไม่กลับเอง) |

<!-- VERIFY: ข้อ "Git author ต้องเป็นสมาชิกทีม" เป็นพฤติกรรมฝั่ง Vercel account ไม่ใช่สิ่งที่เรพพิสูจน์ได้ — ถ้า deploy จาก Git ไม่ขึ้น ให้ดูที่ Project → Settings → Git ว่า author ของ commit ถูกมองเป็นสมาชิกทีมหรือไม่ -->
<!-- VERIFY: อาการ "Root Directory ไม่ตรง" ขึ้นกับสถานะการผูก `.vercel/project.json` ในเครื่องที่สั่ง — ตัวไฟล์ถูก gitignore จึงยืนยันจากเรพไม่ได้ว่าค่าปัจจุบันถูกต้อง -->

---

## 11. เอกสารที่เกี่ยวข้อง

| ไฟล์ | เนื้อหา |
|---|---|
| [`CONFIGURATION.md`](./CONFIGURATION.md) | env ทุกตัวของทั้งสองโปรเจกต์, default, required vs optional, pooled vs unpooled, role ของ DB |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | โครงระบบ, RLS, และเหตุผลที่ cron อยู่ที่ line-app |
| [`../line-app/docs/DEPLOYMENT.md`](../line-app/docs/DEPLOYMENT.md) | Blob store, LINE Console (webhook/LIFF), rich menu, ตาราง error string ของ line-app |
| [`../backend/README.md`](../backend/README.md) | endpoint, session, migration, RLS + role, queue, deploy บน Vercel |
| [`HANDOFF.md`](./HANDOFF.md) | งานที่เหลือและเกณฑ์ "เสร็จ" |
