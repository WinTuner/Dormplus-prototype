<!-- generated-by: gsd-doc-writer -->

# เริ่มต้นใช้งาน (GETTING-STARTED)

เรพนี้มีสองครึ่งที่แยกกัน deploy และแยกกันรัน: `backend/` (FastAPI + Postgres) และ `line-app/` (Vercel serverless + Vercel Blob + LINE)
เอกสารนี้พาไปถึง "ของที่รันได้จริง" สั้นที่สุดในสองเส้นทาง

- **Track A — local-only:** ไม่ต้องมี LINE ไม่ต้องมี Vercel · backend บน Docker Postgres + smoke suite ของ `line-app` ที่ไม่ต่อเน็ต
- **Track B — LINE app ตัวจริง:** ต้องมี LINE OA / LIFF / Vercel project / Blob store ก่อน — รายละเอียดเชิงลึกอยู่ที่ [`line-app/docs/GETTING-STARTED.md`](../line-app/docs/GETTING-STARTED.md) ไม่ทำซ้ำที่นี่

อ่านภาพรวมระบบที่ [`ARCHITECTURE.md`](./ARCHITECTURE.md) และตัวแปรทั้งหมดที่ [`CONFIGURATION.md`](./CONFIGURATION.md)

## 1. สิ่งที่ต้องมี

| สิ่งที่ต้องมี | เวอร์ชัน | ใช้กับ | ตรวจจาก |
|---|---|---|---|
| Python | `>=3.11` (`pyproject.toml` → `requires-python`) | `backend/` | `python --version` |
| Docker Desktop (หรือ Postgres 17 ตัวไหนก็ได้) | — | `backend/docker-compose.yml` | `docker --version` + ต้องเปิด daemon อยู่ |
| Node.js | `>=20` (`line-app/package.json` → `engines.node`) | `line-app/` smoke suite | `node -v` |
| npm | มากับ Node | `line-app/` (เฉพาะตอน deploy) | `npm -v` |

Track B เพิ่ม: บัญชี LINE (Messaging API channel + LINE Login channel/LIFF), บัญชี Vercel + Vercel Blob store — ดูข้อ 4

## 2. โคลนเรพ

```bash
git clone https://github.com/WinTuner/Dormplus-prototype.git
cd Dormplus-prototype
```

ทุกคำสั่งข้างล่างรันจาก root ของเรพ แล้ว `cd` เข้าโฟลเดอร์ครึ่งที่ต้องการ

## 3. Track A — local-only (ไม่ต้องมี LINE, ไม่ต้องมี Vercel)

### 3.1 backend: Postgres + migration + seed + uvicorn

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1        # macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
Copy-Item .env.example .env          # bash: cp .env.example .env
```

เปิด `backend/.env` แล้วแก้สองบรรทัดนี้ (ค่าอื่นปล่อยไว้ได้):

```dotenv
DEV_AUTH=true
SESSION_SECRET=<ค่าสุ่มยาว ๆ ของคุณ>
```

- `DEV_AUTH=true` เปิดทางให้เลือก session ด้วย header `X-Dev-Property` / `X-Dev-Role` แทน LINE Login (`app/auth.py`) — **ห้ามเปิดบน server จริง** และระบบไม่สนใจค่านี้เมื่อ `VERCEL_ENV=production`
- `SESSION_SECRET` ต้องไม่ใช่ค่า default (`dev-only-change-me`) เพราะ `app/session.py` จะ `raise RuntimeError` ทันทีที่ต้องเซ็น/ตรวจ cookie
- `CRON_SECRET` และ `PROPERTY_ID` ปล่อยว่าง/`p_1` ไว้ได้ในเครื่อง — สองตัวนี้มีไว้สำหรับ `/v1/cron/daily` (งานทวงหนี้รายวันของครึ่ง backend) และการเลือกหอที่ deploy หนึ่งหอต่อหนึ่ง deployment ถ้า `CRON_SECRET` ว่าง endpoint นั้นจะตอบ `401 UNAUTHORIZED` เสมอ
- `LINE_CHANNEL_SECRET` มีไว้ตรวจ `X-Line-Signature` ของ `POST /v1/webhooks/line/:property_id` — ว่างแล้ว endpoint นั้นตอบ `503 NOT_CONFIGURED` (webhook ของ OA ยังชี้ที่ `line-app` จึงไม่กระทบของที่ใช้งานจริง)

```powershell
docker compose up -d                 # Postgres 17 พอร์ต 5432 + ฐาน domplus และ domplus_test
alembic upgrade head                 # ต้องรันจาก backend/ เพราะ env.py อ่าน .env จาก cwd
python -m app.seed                   # พิมพ์: seeded p_1: 42 rooms
uvicorn app.main:app --reload        # http://127.0.0.1:8000
```

ตรวจว่าขึ้นจริง (อีกหน้าต่างหนึ่ง):

```powershell
curl.exe -s http://127.0.0.1:8000/healthz
# {"status":"ok"}

curl.exe -s -H "X-Dev-Property: p_1" "http://127.0.0.1:8000/v1/rooms?period=2026-11"
```

- `/docs` เปิดเฉพาะตอนไม่ใช่ production (`app/main.py`) — ใช้ดู route ทั้งหมดได้เลยในเครื่อง
- seed ใส่ข้อมูลรอบ `2026-10` (มิเตอร์ครบทุกห้อง) และ `2026-11` (มิเตอร์ 12 ห้องแรก) · **บิลค้าง 9 ใบ** ที่ seed ไว้อยู่รอบ `2026-08/09/10` ไม่ใช่ `2026-11` · รันซ้ำได้ไม่สร้างข้อมูลซ้ำ
- ถ้าไม่ส่ง `period` API จะใช้เดือนปัจจุบันตามเวลาไทย ซึ่งอาจไม่มีข้อมูลถ้าไม่ได้รันตอน พ.ย. 2026

### 3.2 line-app: smoke suite ที่ไม่ต่อเน็ต

ไม่ต้องมี env, ไม่ต้องมี Blob, ไม่ต้องมี LINE — และ **ไม่ต้อง `npm install` ก็รันได้** เพราะทุก suite แทน `_store` ด้วย Map ในหน่วยความจำ, stub `fetch` ของ LINE และ stub dependency เองผ่าน `require.cache` / `Module._load`

มีห้าชุด แยกตามสิ่งที่ครอบ:

```bash
cd line-app
node smoke.js              # signature + Flex card + auth guards (QR ต้องมี qrcode-svg)
node smoke-handlers.js     # dev gate, QR binding, rate limit, payment, bill issuing, roles
node smoke-reads.js        # bounded concurrency, ordering, legacy history
node smoke-cron.js         # งานเตือนบิลค้างรายวัน (api/cron.js + api/_remind.js)
node smoke-usecases.js     # 156 use case ตั้งแต่ต้นจนจบ (UC-01 … UC-18)
```

ผลที่ต้องเห็น (ยืนยันบน Node v26.13.0) — บรรทัด QR ต้องมี `node_modules` (`qrcode-svg`) ถ้าไม่มีจะขึ้น `smoke: qrcode-svg not installed, QR check skipped` แทน (ชุดอื่นไม่ต้องใช้ dependency เลย):

```text
smoke OK — QR renders and scales
smoke OK — signature + flex card + confirm card + auth guards
handlers OK — dev gate, QR binding + move confirm, rate limit, payment confirm, bill issuing, idToken cache, roles + revoke, slip limits, transfer before the bill, a new tenant does not see the previous tenant's bills, receipts, void + re-issue, one slip for several periods, void archive, no-due card, missing units, spent invite codes, seed token
reads OK — bounded concurrency, ordering, legacy history, binding and auth
cron OK — auth, 6 reminder windows, dedup, catch-up, skips, tenancy, retry, owner summary, one push per room
156/156 use case tests passed
```

`npm test` (`package.json` → `scripts.test`) รันแค่ **สามชุดแรก** (`smoke.js && smoke-handlers.js && smoke-reads.js`) — `smoke-cron.js` และ `smoke-usecases.js` ต้องสั่งเองหรือพึ่ง CI ส่วน `smoke-usecases.js` ใช้เวลานานที่สุด (หลายนาที) และพิมพ์สรุปเป็น `<passed>/<total> use case tests passed` โดย exit code 0 เมื่อผ่านครบ

> `line-app/docs/GETTING-STARTED.md` เขียนไว้ว่า `package.json` "ไม่มี scripts" — ตอนนี้มี `scripts.test` แล้ว เอกสารนั้นล้าสมัยในจุดนี้

**ข้อจำกัดที่ต้องรู้:** `line-app/` ไม่มี dev server และไม่มี `.env` loader — หน้า `liff/bill.html` เรียก `/api/*` แบบ path สัมพัทธ์ จึงต้องถูกเสิร์ฟจาก origin เดียวกับ API บน Vercel เท่านั้น
ในเครื่องจึงทดสอบได้แค่ตรรกะที่ไม่แตะ I/O (signature, รูปการ์ด, handler ที่ stub แล้ว) — ที่เหลือต้องไป Track B

### 3.3 test ของ backend

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
# 23 passed, 108 skipped  (collect ได้ 131 test)
```

test ที่ต้องใช้ฐานข้อมูลจะถูก **skip** เมื่อไม่ได้ตั้ง `TEST_DATABASE_URL` (ดู `tests/conftest.py`) ถ้าอยากรันครบ 131 ตัว:

```powershell
$env:TEST_DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test"
.\.venv\Scripts\python.exe -m pytest -q
```

ฐานข้อมูลที่ชี้ไป **ถูกล้างทุกครั้งที่รัน test** (downgrade → upgrade → truncate) ห้ามชี้ไปที่ฐานจริง ไม่ว่า Neon หรือ Supabase
`domplus_test` ถูกสร้างโดย `backend/docker/init-test-db.sql` ตอนที่ volume ถูกสร้างครั้งแรกเท่านั้น

`tests/test_rls.py` ต้องสร้าง role ชั่วคราว (`rls_probe`) เพื่อทดสอบ policy ของ migration `0004` — role ที่ใช้ต่อใน test ต้องมีสิทธิ์ `CREATEROLE`/superuser ซึ่ง `postgres` ของ Docker มีให้ (role ของ production อย่าง `dormplus_app` ไม่มี จึงรันชุดนี้กับ production ไม่ได้)

## 4. Track B — LINE app ตัวจริง

ต้องมีของพวกนี้ **ก่อน** เริ่ม ไม่งั้นทุก endpoint ที่อ่าน/เขียนข้อมูลจะได้ 401/500:

| ต้องมี | ใช้ทำอะไร | ที่มา |
|---|---|---|
| LINE Official Account + Messaging API channel | `LINE_CHANNEL_SECRET` (ตรวจ webhook signature), `LINE_CHANNEL_ACCESS_TOKEN` (ตอบ/ส่งการ์ด) | LINE Developers Console |
| LINE Login channel + LIFF app | `LIFF_ID` ให้หน้า `liff/bill.html` เรียก `liff.init()` | LINE Developers Console |
| Vercel project ที่ชี้ root directory = `line-app` | ทุก `/api/*` เป็น serverless function | Vercel dashboard |
| Vercel Blob store ที่ผูกกับโปรเจกต์ | ข้อมูลบิล/สลิปทั้งหมดอยู่ใน Blob (`kv/*.json`, `slips/*`) | Vercel dashboard / CLI |
| Postgres จริง (Neon หรือเทียบเท่า) สำหรับ `backend/` | ครึ่ง backend ไม่ใช้ Blob | backend/README.md |

<!-- VERIFY: การสร้าง Messaging API channel / LINE Login channel / LIFF app / Blob store ทั้งหมดทำบน dashboard (LINE Developers Console, Vercel) ซึ่งยืนยันจาก repo ไม่ได้ — ทำตามขั้นตอนใน line-app/README.md ข้อ 2–6 -->

ลำดับย่อ (รายละเอียดทุกขั้นอยู่ที่ [`line-app/docs/GETTING-STARTED.md`](../line-app/docs/GETTING-STARTED.md) และ [`line-app/README.md`](../line-app/README.md)):

1. `cd line-app && npm install` — dependency มี 2 ตัว: `@vercel/blob` และ `qrcode-svg` (smoke suite ทำงานได้แม้ไม่ติดตั้ง — QR check จะถูกข้าม)
2. `vercel link` แล้ว `vercel --prod` — <!-- VERIFY: ต้องมี Vercel CLI และสิทธิ์เข้าถึงโปรเจกต์ line-app ของทีม ซึ่งขึ้นกับบัญชีของคุณ ไม่ได้อยู่ใน repo -->
3. ใส่ env บน Vercel (ทั้ง Production และ Preview แล้ว Redeploy — โค้ดอ่าน env ตอน module load) รายการเต็มที่ [`CONFIGURATION.md`](./CONFIGURATION.md)
4. ตรวจคำขอแรกที่ไม่ต้องใช้ credential: `curl.exe -s https://<โดเมนของคุณ>/api/config` ต้องได้ `200`
5. ตั้ง webhook URL เป็น `https://<โดเมนของคุณ>/api/webhook` แล้วกด Verify ใน LINE Developers
6. (ถ้าต้องการ rich menu) `LINE_CHANNEL_ACCESS_TOKEN=... LIFF_ID=... node scripts/setup-richmenu.js` จาก `line-app/` — รูป default คือ `docs/richmenu-owner.png` และ `docs/richmenu-tenant.png` (มีอยู่จริง) แล้วเก็บ id ที่พิมพ์ออกมาเป็น `RICHMENU_OWNER_ID` / `RICHMENU_TENANT_ID`
7. ตั้ง `CRON_SECRET` (สุ่ม ≥ 16 ตัวอักษร เช่น `openssl rand -hex 24`) บน Production แล้ว Redeploy — `vercel.json` ตั้ง `crons: [{ "path": "/api/cron", "schedule": "0 2 * * *" }]` ไว้แล้ว (02:00 UTC = 09:00 เวลาไทย) Vercel จะแนบ `Authorization: Bearer <CRON_SECRET>` ให้เองและเรียกเฉพาะ Production · ไม่ตั้ง/สั้นกว่า 16 = `503 NOT_CONFIGURED` (ไม่มีการเตือน แต่ระบบอื่นทำงานปกติ) · สั่งรันมือ: `curl -H "Authorization: Bearer <CRON_SECRET>" https://<โดเมนของคุณ>/api/cron`

<!-- VERIFY: การที่ Vercel แนบ header ให้เองและการรันเฉพาะ Production deployment ยืนยันจาก repo ไม่ได้ (โค้ดอ่าน CRON_SECRET ใน api/cron.js เท่านั้น) — ดู line-app/docs/DEPLOYMENT.md ข้อ 5A -->

<!-- VERIFY: โดเมน production ที่ทีมใช้อยู่ (https://line-app-iota.vercel.app ตาม README) ยืนยันจาก Vercel ไม่ได้ -->

ครึ่ง backend บน production ใช้ Vercel + Neon (project `line-backend`, root directory = `backend`) — ขั้นตอนและรายการ env อยู่ที่ [`backend/README.md`](../backend/README.md) หัวข้อ "Deploy บน Vercel" ไม่ทำซ้ำที่นี่

**กับดักที่ทำให้ข้อมูลรั่วหรือหายเงียบ ๆ บน production:** RLS ของ migration `0004` ทำงานก็ต่อเมื่อ role ใน `DATABASE_URL` **ไม่มี `BYPASSRLS`** — `neondb_owner` ของ Neon มีค่านี้ (policy ทั้งหมดถูกข้าม = เห็นทุกหอ) จึงต้องใช้ role `dormplus_app` ตรวจด้วย `select rolbypassrls from pg_roles where rolname = current_user` ส่วน alembic ยังรันด้วย owner ได้ตามปกติ · ฝั่ง `line-app` มี cron อีกงาน (`GET /api/cron` ตามข้อ 7) และฝั่ง backend มี `GET /v1/cron/daily` (ต้องมี `CRON_SECRET` ใน env ของโปรเจกต์ backend ด้วย ไม่ใช่แค่ฝั่ง line-app)

## 5. ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ | ทางแก้ |
|---|---|---|
| `docker compose up -d` → `failed to connect to the docker API ... dockerDesktopLinuxEngine` | Docker Desktop ยังไม่เปิด (เจอจริงตอนเขียนเอกสารนี้) | เปิด Docker Desktop แล้วรอจนขึ้น Running |
| `pytest` ได้ `23 passed, 108 skipped` | ไม่ได้ตั้ง `TEST_DATABASE_URL` — เป็นพฤติกรรมปกติ (เก็บได้ 131 test แต่ **108 ตัวต้องมี Postgres**; อีก 23 ตัวรันได้เปล่า ๆ) | ตั้ง `TEST_DATABASE_URL` ชี้ `domplus_test` ตามข้อ 3.3 |
| `GET /api/cron` ได้ `503 NOT_CONFIGURED` | ไม่ได้ตั้ง `CRON_SECRET` บนโปรเจกต์ หรือค่าสั้นกว่า 16 ตัวอักษร | ตั้งค่าใหม่แล้ว Redeploy (Vercel แนบ header ให้เอง) — รันมือด้วย `curl -H "Authorization: Bearer <CRON_SECRET>" ...` |
| ข้อมูลข้ามหอโผล่ หรือ query ตรง ๆ ได้ `0` แถว | role ที่ต่อมี `BYPASSRLS` (เช่น `neondb_owner` ของ Neon) หรือ `app.property_id` ไม่ถูกตั้งบน connection | ใช้ role ที่ไม่มี `BYPASSRLS` (`dormplus_app`) — `app/db.py` เป็นคนตั้ง `app.property_id` ให้ทุก connection |
| `alembic upgrade head` → `connection refused` หรือต่อผิดฐาน | รันจากโฟลเดอร์อื่น (`.env` ไม่ถูกโหลด) หรือ `DATABASE_URL` ผิด | `cd backend` ก่อน แล้วเช็ก `DATABASE_URL` ใน `.env` |
| `/v1/rooms` ตอบ `401 UNAUTHORIZED` | `DEV_AUTH=false` (ค่า default) จึงไม่มี session | ตั้ง `DEV_AUTH=true` **ในเครื่อง** แล้วรีสตาร์ต uvicorn |
| เรียก `/v1/rooms` ได้ `[]` หรือไม่มีบิล | ยังไม่รัน `python -m app.seed` หรือส่ง `period` ไม่ตรงกับที่ seed ไว้ | รัน seed แล้วใช้ `?period=2026-10` (บิลค้างที่ seed อยู่รอบ 2026-08/09/10) |
| `RuntimeError: SESSION_SECRET ... default` | ยังใช้ค่า `dev-only-change-me` จาก `.env.example` | เปลี่ยนเป็นค่าสุ่มยาว ๆ |
| ตั้ง `$env:VAR=...` แล้วไม่ติด / `VAR=value pytest` ใช้ไม่ได้ | PowerShell ไม่รองรับ prefix แบบ bash | ใช้ `$env:VAR="..."` แล้วค่อยเรียกคำสั่ง หรือ `$env:VAR="..."; pytest` |
| เข้า LIFF บน `http://127.0.0.1` แล้ว cookie ไม่ติด | `COOKIE_SECURE=true` (ค่า default) — cookie Secure ไม่ถูกส่งผ่าน http | ตั้ง `COOKIE_SECURE=false` เฉพาะเครื่องตัวเอง |
| `line-app` เรียก API แล้วได้ `500` บน Vercel | Blob ยังไม่เชื่อม หรือยังไม่ Redeploy หลังใส่ env | ผูก Blob store แล้ว Redeploy (รายละเอียดใน `line-app/docs/GETTING-STARTED.md` ข้อ 7) |

## 6. ขั้นต่อไป

| เอกสาร | อ่านเมื่อ |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | อยากรู้ว่าสองครึ่งคุยกันอย่างไรและอะไรอยู่ที่ไหน |
| [`CONFIGURATION.md`](./CONFIGURATION.md) | ต้องรู้ว่า env ตัวไหนจำเป็น มี default อะไร |
| [`API.md`](./API.md) | ต้องยิง endpoint ของ backend เอง (auth, error code, ตัวอย่าง request) |
| [`HANDOFF.md`](./HANDOFF.md) | จะรับงานต่อ — มีกับดักที่เจอมาแล้วและงานที่ยังเหลือ |
| [`TESTING.md`](./TESTING.md) | อยากรู้ว่า smoke ทั้งห้าชุดและ pytest แต่ละชุดครอบอะไร |
| [`backend/README.md`](../backend/README.md) | endpoint ทั้งหมด, dev headers, deploy Vercel + Neon, Procrastinate/cron |
| [`line-app/docs/GETTING-STARTED.md`](../line-app/docs/GETTING-STARTED.md) | ต้องพา LINE app ขึ้น Vercel จริงตั้งแต่ต้น |
| [`line-app/docs/TESTING.md`](../line-app/docs/TESTING.md) | อยากรู้ว่า smoke แต่ละตัวครอบอะไร และอะไรต้องทดสอบมือ |
| [`line-app/docs/DEPLOYMENT.md`](../line-app/docs/DEPLOYMENT.md) | ต้อง deploy หรือ rollback ครึ่ง `line-app` |

CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) รันสิ่งที่ทำได้แบบไม่ต้องมี credential: `npm ci` + `node --check` ทุก handler + smoke **ทั้งห้าชุด** (รวม `smoke-cron.js` และ `smoke-usecases.js` ที่ `npm test` ไม่ได้รัน) + ตรวจว่า inline script ของ `liff/bill.html` parse ผ่าน และ job `backend` รัน `pytest -q` บน Postgres 16 ใน service container พร้อม `TEST_DATABASE_URL` ชี้ `domplus_test`
