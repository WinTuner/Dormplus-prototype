<!-- generated-by: gsd-doc-writer -->

# การพัฒนาต่อ (DEVELOPMENT) — DormPlus ทั้งเรพ

เอกสารนี้เป็นคู่มือสำหรับคนที่แก้โค้ด **ทั้ง repo** ซึ่งมีสองสแตกอิสระที่ไม่แชร์โค้ด แชร์ฐานข้อมูล หรือเรียก HTTP หากัน:

| ส่วน | stack | deploy จริง | เอกสารเชิงลึก |
|---|---|---|---|
| [`line-app/`](../line-app/) | Node 20 · Vercel serverless · Vercel Blob · LINE Messaging API + LIFF | https://line-app-iota.vercel.app | [`line-app/docs/DEVELOPMENT.md`](../line-app/docs/DEVELOPMENT.md) ← **อ่านต่อถ้าทำงานฝั่งนี้** |
| [`backend/`](../backend/) | Python 3.11+ · FastAPI · SQLAlchemy · Postgres (Neon) · Procrastinate | https://line-backend-ten.vercel.app | [`backend/README.md`](../backend/README.md) |

เอกสารนี้ตั้งใจ **ไม่เขียนซ้ำ** รายละเอียดของ `line-app` (handler contract ทีละไฟล์, key map, checklist รีวิว) — ส่วนนั้นอยู่ใน [`line-app/docs/DEVELOPMENT.md`](../line-app/docs/DEVELOPMENT.md) แล้ว · ที่นี่เน้นสิ่งที่ใช้ร่วมกันทั้งเรพ: วิธีรัน, convention, branch/PR/CI, และลำดับงาน "เพิ่มของใหม่" แบบ end to end ทั้งสองฝั่ง

## 1. อ่านอะไรก่อนลงมือ

| เอกสาร | อ่านเมื่อ |
|---|---|
| [`README.md`](../README.md) | ภาพรวมว่าอะไรใช้จริง อะไรยังไม่ทำ |
| [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) | เส้นทาง request ของทั้งสองสแตก, ที่เก็บข้อมูล, ข้อจำกัด |
| [`docs/CONFIGURATION.md`](./CONFIGURATION.md) | env ทุกตัวของทั้งสองฝั่ง + ค่า default |
| [`docs/API.md`](./API.md) | สัญญา v1 (เป้าหมายที่ `backend/` ยึด) |
| [`docs/TEST-CASES.md`](./TEST-CASES.md) | จะเพิ่ม/แก้พฤติกรรมที่ผู้ใช้เห็น — id ของ case อยู่ที่นี่ และ `smoke-usecases.js` ใช้ id เดียวกัน |
| [`line-app/docs/DEVELOPMENT.md`](../line-app/docs/DEVELOPMENT.md) | แก้ `line-app/api/*.js` หรือ `liff/bill.html` |
| [`line-app/HANDOFF.md`](../line-app/HANDOFF.md) | กับดักที่เจอมาแล้ว + งานที่เหลือของ LINE app |
| [`docs/HANDOFF.md`](./HANDOFF.md) | กับดักฝั่ง backend + เกณฑ์ว่า "เสร็จ" |

## 2. Local setup

### 2.1 สิ่งที่ต้องมี

- **Node.js `>=20`** — `line-app/package.json` `engines`, และ CI ใช้ Node 20
- **Python `>=3.11`** — `backend/pyproject.toml` `requires-python` (CI ใช้ 3.12)
- **Docker** — สำหรับ Postgres 17 ของ `backend/docker-compose.yml` (ถ้าไม่มี Docker ให้ใช้ Postgres ตัวอื่นแล้วแก้ `DATABASE_URL`)
- **git** — remote: `https://github.com/WinTuner/Dormplus-prototype.git` (remote เดิมที่ชื่อ `domplus-prototype` ยังใช้ได้ผ่าน redirect ของ GitHub)

### 2.2 line-app

```bash
git clone https://github.com/WinTuner/Dormplus-prototype.git
cd Dormplus-prototype/line-app
npm install                    # ให้ @vercel/blob, aws4fetch, qrcode-svg
npm test                       # = node smoke.js && node smoke-handlers.js && node smoke-reads.js
node smoke-usecases.js         # 177 use case (docs/TEST-CASES.md มี 292 แถว: ✅ 266 · 🖐 26 · ⏳ 0)
node smoke-cron.js             # /api/cron + ตัวเตือนรายวัน + cron-lock
```

- ไม่มีขั้นตอน build, ไม่มี dev server, ไม่มี bundler — ทุกอย่างที่ deploy คือ `api/*.js` (CommonJS) กับไฟล์ static ไฟล์เดียว `liff/bill.html`
- `npm test` **ยังรันแค่สามชุด** (ตาม `package.json` `scripts.test`) — ชุด use case กับ cron ต้องสั่งเองหรือปล่อยให้ CI รัน อย่าถือว่า `npm test` เขียวแล้วแปลว่าครบ
- **smoke suite**: `smoke-handlers.js`, `smoke-usecases.js`, `smoke-cron.js` แทน `_store` ด้วย `Map` ในหน่วยความจำ (`require.cache`) และแทน `qrcode-svg` ผ่าน `Module._load` — แต่ **ทั้งห้าชุดต้องมี `node_modules`** (`npm ci`) เพราะ `smoke.js` เรียก `api/_auth` / `api/_qr` / `api/_store-r2` และตัวหลัง `require("aws4fetch")` ทันทีที่โหลด · CI รันหลัง `npm ci` เสมอ
- ไม่มี `.env.example` — env ใส่ใน Vercel project (ดู [`docs/CONFIGURATION.md`](./CONFIGURATION.md)) · การทดสอบ endpoint จริงใช้ deployment + `x-seed-token` (เปิดได้เฉพาะ `vercel dev` หรือ preview ที่ตั้ง `ALLOW_SEED_BYPASS=true`) · cron ต้องมี `CRON_SECRET` ยาว ≥ 16 ตัวอักษร ไม่งั้น `/api/cron` ตอบ `503 NOT_CONFIGURED`

### 2.3 backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate           # macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env             # PowerShell: Copy-Item .env.example .env
docker compose up -d             # Postgres 17 พอร์ต 5432 + ฐาน domplus และ domplus_test
alembic upgrade head             # 0001–0006 (0004 = RLS policy, 0005 = line_events, 0006 = index FK ของ invoice_items/payments)
python -m app.seed               # หอ p_1 · 42 ห้อง
uvicorn app.main:app --reload    # http://127.0.0.1:8000/docs
```

- `backend/.env` **ไม่ถูก commit** (อยู่ใน `.gitignore`) — เครื่องใหม่ต้องสร้างเองจาก `.env.example`
- หน้าเจ้าของหอเปิดที่ `http://127.0.0.1:8000/owner` — เป็น `backend/owner/index.html` ไฟล์เดียวจบ (HTML + inline JS, **ไม่มี build/bundler**) ที่ `app/main.py` mount เป็น static ที่ `/owner` · ทางเข้าเดียวคือ `POST /v1/auth/owner` (`app/routes/auth.py` `login_owner()`) เทียบรหัสกับ env `OWNER_ACCESS_CODE` — ว่าง = ปิด (503 `OWNER_LOGIN_OFF`) · แก้ UI แล้วแค่ refresh ไม่ต้อง build
- test ที่ต้องใช้ DB จะถูก **ข้าม** ถ้าไม่ได้ตั้ง `TEST_DATABASE_URL`:

```bash
TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test pytest -q
```

> ⚠️ ฐานข้อมูลใน `TEST_DATABASE_URL` **ถูกล้างทุกครั้ง** (`conftest.py` สั่ง `downgrade base` → `upgrade head` แล้ว `truncate ... restart identity cascade`) — ห้ามชี้ไปที่ Neon ตัวจริง

- ชุดเต็มวันนี้คือ **167 test ใน 18 ไฟล์** (`backend/tests/test_*.py` — `pytest --collect-only` นับได้ 167) — ไฟล์ล่าสุดคือ `tests/test_owner_ui.py` (ล็อกอิน `/owner`, รหัสผิด/ไม่ตั้งรหัส, cookie ผู้เช่าเข้าไม่ได้) · ถ้าจำนวนไม่ตรง แปลว่า collection พังหรือ import ค้าง ไม่ใช่ "test หาย"

### 2.4 หมายเหตุบน Windows / PowerShell

- repo นี้ถูกพัฒนาบน Windows เป็นหลัก — `backend/.venv/Scripts/activate`, `curl.exe` (ไม่ใช่ alias `curl`), ไม่มี `&&` ใน Windows PowerShell 5.1 ให้ใช้ `;` หรือรันแยก
- ตั้ง env ชั่วคราว: `$env:TEST_DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test"`
- psycopg โหมด async ไม่รับ ProactorEventLoop ของ Windows — ถ้าจะ drain คิวด้วยมือบน Windows ต้องสร้าง loop เอง (หมายเหตุใน [`backend/app/queue.py`](../backend/app/queue.py))

## 3. คำสั่งที่ใช้จริง

ไม่มี target ใน Makefile และไม่มี build step ทั้งสองฝั่ง — นี่คือคำสั่งทั้งหมดที่เอกสาร/CI ใช้:

| คำสั่ง | ที่รัน | ทำอะไร | นิยามที่ไหน |
|---|---|---|---|
| `npm install` / `npm ci` | `line-app/` | ติดตั้ง `@vercel/blob`, `aws4fetch`, `qrcode-svg` (สามตัวเท่านั้น) | `package.json`, CI |
| `npm test` | `line-app/` | รัน smoke สามชุดแรกตามลำดับ (ไม่รวม use case/cron) | `package.json` `scripts.test` |
| `node smoke.js` | `line-app/` | signature ของ webhook + รูปร่าง Flex card + การ์ดยืนยัน | `smoke.js` |
| `node smoke-handlers.js` | `line-app/` | handler ระดับเงิน/สิทธิ์: dev gate, QR binding, rate limit, สลิป, confirm, ออกบิล, void | `smoke-handlers.js` |
| `node smoke-reads.js` | `line-app/` | read พร้อมกัน, ประวัติบิล, สิทธิ์ในการอ่าน | `smoke-reads.js` |
| `node smoke-usecases.js` | `line-app/` | use case ทั้ง 177 กรณี — ชื่อ `TC-xx-n` ตรงกับตารางใน [`docs/TEST-CASES.md`](./TEST-CASES.md) | `smoke-usecases.js` |
| `node smoke-cron.js` | `line-app/` | `/api/cron`: secret, cron-lock, หน้าต่าง 1–3 วัน/เลยกำหนด 1·5·10 วัน, dedup ตาม `rev`, push ล้ม | `smoke-cron.js` |
| `vercel --prod` | `line-app/`, `backend/` | deploy จากเครื่อง (ปกติไม่ต้อง — push `master` แล้ว auto) | `line-app/docs/DEPLOYMENT.md`, `backend/README.md` |
| `node scripts/prod-smoke.mjs` | root | ตรวจ deployment จริงหลัง merge (ไม่ต้องล็อกอิน) | `scripts/prod-smoke.mjs` |
| `pytest -q` | `backend/` | test ทั้งหมด (167 test ใน 18 ไฟล์; DB test ข้ามถ้าไม่มี `TEST_DATABASE_URL`) | `pyproject.toml` `testpaths` |
| `alembic upgrade head` | `backend/` | apply migration | `migrations/` |
| `alembic revision -m "..."` | `backend/` | สร้าง migration ใหม่ (เขียน `op.execute()` เอง) | `migrations/env.py` (`target_metadata = None`) |
| `python -m app.seed` | `backend/` | seed หอ 42 ห้อง (รันซ้ำได้ ไม่สร้างซ้ำ) | `app/seed.py` |
| `python -m app.queue` | `backend/` | **ครั้งเดียวต่อฐานข้อมูล** — สร้างตารางของ Procrastinate | `app/queue.py` |
| `procrastinate -a app.queue.app worker` | ที่มี host ค้าง | worker ทางเลือก ถ้าอยากส่งถี่กว่ารายวัน | `backend/README.md` |

> `procrastinate schema --apply` **ใช้ไม่ได้** กับ app นี้ (CLI บังคับ async connector) — `python -m app.queue` ทำ migration ชุดเดียวกัน
> `GET /v1/cron/daily` ยัง drain คิวเองใน invocation เดียว (จึงไม่ต้องมี worker ค้าง) แต่ **ไม่ได้ถูกตั้งเวลา** — `backend/vercel.json` ไม่มี `crons` แล้ว ใช้ยิงมือ/ทดสอบเท่านั้น
> `line-app` มี cron ของตัวเอง (`GET /api/cron`, `0 2 * * *`) สำหรับทวงบิล — ตัวเตือนอยู่ใน `api/_remind.js` ไม่ใช่ handler

## 4. Code style และ convention

### 4.1 ไม่มี linter/formatter ในเรพ

ตรวจแล้วว่า **ไม่มี** `eslint.config.*`, `.eslintrc*`, `.prettierrc*`, `biome.json`, `.editorconfig`, ruff/black/flake8 ใน `pyproject.toml`, `setup.cfg`, `tox.ini`, `.nvmrc` — และ CI **ไม่มี** ขั้นตอน lint/format/typecheck สไตล์จึงมาจากโค้ดเดิมอย่างเดียว

### 4.2 line-app

รายละเอียดเต็มอยู่ใน [`line-app/docs/DEVELOPMENT.md`](../line-app/docs/DEVELOPMENT.md) ข้อ 2–9 · สรุปที่ต้องจำ:

- **CommonJS เท่านั้น** — `require()` / `module.exports`; handler เป็น `async (req, res)` (ยกเว้น `api/config.js` ที่ sync)
- helper ใช้ร่วมกันต้องขึ้นต้นด้วย `_` — วันนี้มี **15 ไฟล์**: `api/_store.js`, `api/_store-r2.js`, `api/_auth.js`, `api/_bills.js`, `api/_ledger.js`, `api/_line.js`, `api/_rooms.js`, `api/_async.js`, `api/_limit.js`, `api/_qr.js`, `api/_remind.js`, `api/_verify.js`, `api/_prepay.js`, `api/_promptpay.js`, `api/_gemini.js` · logic ใหม่ที่ไม่ได้เป็น route ต้องไปอยู่ในไฟล์กลุ่มนี้ ไม่งั้นมันจะกลายเป็น serverless function นับเข้าเพดาน 12 (ข้อ 7.1) · route ที่ไม่ขึ้นต้น `_` ยังมี **12 ไฟล์เท่าเดิม** (`bill`, `config`, `cron`, `dev`, `me`, `owner`, `qr`, `rooms`, `run`, `slip-image`, `slip`, `webhook`) — helper ใหม่จึงไม่ขยับเพดาน เว้นแต่ไปสร้าง route ใหม่
- 2 spaces, double quotes, semicolons, `const`; คอมเมนต์เป็น **อังกฤษและอธิบาย "ทำไม"** ไม่ใช่ทวนโค้ด (ใส่คำไทยในวงเล็บเมื่อคำนั้นคือถ้อยคำที่ผู้ใช้เห็น เช่น `(ยกเลิกบิล)`) · บรรทัดแรกของไฟล์บอก route + หน้าที่
- `liff/bill.html` เป็น **ไฟล์เดียวจบ** — HTML + CSS + JS inline ไม่มี build/bundler และไม่มีไฟล์แยกให้ import อะไรทั้งสิ้น
- error เป็น `{ "error": { "code": "SCREAMING_SNAKE", "message": "ข้อความไทย" } }` — `message` ไทยเสมอ (ผู้ใช้เห็น) `code` อังกฤษ · 405 ของทุก handler วันนี้ใช้รูป object (`METHOD_NOT_ALLOWED`)
- `Cache-Control: no-store` **ก่อน** `requireUser` สำหรับ GET ที่คืนสถานะที่เปลี่ยนได้ (`bill.js`, `me.js`, `rooms.js`) · `config.js` เป็นข้อยกเว้น: ไม่มี auth และตั้ง `public, max-age=300` ให้ CDN แคชได้
- ข้อความ UI ไทย, ชื่อตัวแปร/ฟิลด์อังกฤษ, เงินปัดด้วย `Math.round()` และแสดงด้วย `toLocaleString("th-TH")`
- `_auth.isOwner()` / `canView()` / `roleOf()` เป็น **async** — ต้อง `await` (บทบาทมี 3 แบบ: `owner`, `viewer`, และ `null` = ผู้เช่า/ไม่รู้จัก; `isRoot()` เทียบ `OWNER_USER_ID` แบบ sync)
- งานที่ยิง LINE หรือเขียนหลาย key ให้ขนานด้วย `Promise.all` / `mapLimit` จาก `_async.js` และ side effect ที่ล้มได้ต้องอยู่ใน `try/catch` (ดู `_remind.js`: push ล้ม = ไม่เขียน mark แล้วลองใหม่รอบหน้า)

### 4.3 storage adapter — ทุกการอ่าน/เขียนผ่าน `_store.js`

- `line-app/api/_store.js` เป็นประตูเดียว: `get`, `set`, `keysWith`, `putFile`, `getFile`, `delFile` · โมดูลใหม่ **ห้าม `require("@vercel/blob")` เอง และห้ามคุยกับ R2 ตรง ๆ** — ต้องมี operation ใหม่ให้เพิ่มใน `_store.js` (และ `_store-r2.js` ถ้าเป็นฝั่ง R2) ไม่งั้น tests ที่แทน store ด้วย `Map` จะพังและ backend จะสลับไม่ได้อีก
- สอง backend เลือกตอนโหลดไฟล์ครั้งเดียว: ตั้ง `R2_BUCKET` → Cloudflare R2 (S3 API) · ไม่ตั้ง → Vercel Blob (fallback ที่ทำให้ย้ายทีละ env var ได้)
- `_store-r2.js` เซ็น S3 request ด้วย **`aws4fetch`** (ไม่กี่ kB) ไม่ใช่ `@aws-sdk/client-s3` (หลาย MB) เพราะทุก Vercel function จ่าย bundle size ตอน cold start — ที่ใช้มีแค่ GET/PUT/DELETE/LIST · **อย่าเพิ่ม AWS SDK** สำหรับงานที่ `aws4fetch` ทำได้
- cache 10 วินาทีในหน่วยความจำของ instance เฉพาะ key ที่ขึ้นต้น `dorm`, `room:`, `bills:`, `bill-state:` (regex ยังครอบ `rooms:` ไว้ด้วย) · key ที่เกี่ยวกับเงิน (`bill:`, `slip-ref:`, `qr-code:`) **ไม่ถูก cache** และทุก `set` ล้าง entry ทันที · จะเพิ่ม prefix เข้า allow-list ต้องเป็นของที่อ่านซ้ำใน request เดียวและยอมให้เก่า 10 วินาทีได้
- key ทุกตัวผ่าน `pathOf()` → `kv/<key>.json` (ที่เดียวที่รู้ว่า key กลายเป็น pathname อย่างไร — ข้อ 8) และ `_store.js` ไม่มี `del(key)` สำหรับ JSON: ลบได้เฉพาะไฟล์ผ่าน `delFile`

### 4.4 backend

- จัดกลุ่มเป็น router ใน `app/routes/<area>.py` ด้วย `APIRouter(prefix="/v1", tags=[...])` แล้วลงทะเบียนใน `app/main.py` `create_app()`
- **SQL ใช้ `sqlalchemy.text()` + named bound parameter เท่านั้น** (`:room`, `:property_id`) — ไม่ต่อสตริงเข้า SQL · หลายคำสั่งที่ต้อง atomic ใช้ `engine.begin()`, ล็อกแถวด้วย `for update` เมื่อมีตัวเขียนแข่งกัน
- `property_id` มาจาก session (`Depends(owner_session)` / `tenant_session`) **ไม่รับจาก client** — เป็นกติกาข้อแรกใน [`docs/HANDOFF.md`](./HANDOFF.md) ข้อ 3 · RLS (migration `0004`) เป็นตาข่ายชั้นสอง ไม่ใช่ข้ออ้างให้ละ `where property_id = ...`
- error: `raise ApiError(status, "CODE", "ข้อความไทย")` — `app/errors.py` แปลงเป็น `{"error":{"code","message"}}` ให้ทุกกรณี (รวม 404 ของ path ที่ไม่มี, 405, 422 validation)
- รับ engine/วันผ่าน `Depends(get_engine)` และ `Depends(today)` เพื่อให้ test สลับได้ (ห้ามเรียก `get_settings()`/`datetime.now()` ตรง ๆ ใน route ที่ต้องเทสต์)
- type hint + Pydantic model ทุก request/response (`Field(pattern=..., ge=...)` สำหรับ validation) · ไม่มี ORM model — SQL เขียนมือ
- คอมเมนต์/docstring อังกฤษ, ข้อความที่ผู้ใช้เห็น (`ApiError.message`, เนื้อหา LIFF) ไทย

## 5. Branch, commit, PR และ CI

### 5.1 Branch

- default branch คือ **`master`** (ทั้งสองโปรเจกต์ Vercel track `master`)
- ชื่อ branch ที่ใช้จริงในประวัติ: `<type>/<slug>` โดย `type` ∈ `feat`, `fix`, `chore`, `docs`, `ui`, `perf`, `security`, `test`, `ci`, `revert` เช่น `feat/receipts-reminders`, `ui/unslop`, `fix/overdue-and-voids`, `docs/rls-role`, `security/harden-auth`
- **branch ที่จะได้ preview deploy ต้องขึ้นต้นด้วย `preview-`** — `line-app/vercel.json` และ `backend/vercel.json` ตั้ง `deploymentEnabled` เป็น `master: true`, `preview-*: true`, ที่เหลือ `false` (glob ดาวเดียวไม่ข้าม `/` ในชื่อ branch — ดู commit `fix(deploy): a single-star glob does not cross the slash in a branch name`) · branch `feat/...` จึงได้ CI แต่ไม่ได้ deployment

### 5.2 Commit message

ประวัติใช้ Conventional Commits โดยมี scope เป็นโฟลเดอร์/หัวข้อ:

```
feat(line-app): daily LINE reminders before and after the due date
fix(line-app): overdue months stay payable, voids archive at once, reminders follow the revision
feat(backend): one daily cron that drains the queue, so no worker needs a host
docs(line-app): the README endpoint table predates roles, move-confirm and revoke
test: use-case test cases for receipts, void, group slips and reminders
```

ข้อความอธิบาย "ทำไม" ไม่ใช่ "ทำอะไร" — ตรงกับสไตล์คอมเมนต์ในโค้ด

### 5.3 PR

merge เข้า `master` ด้วย merge commit ปกติ (`Merge pull request #48 from WinTuner/fix/cron-async-app`) · เทมเพลตอยู่ที่ [`.github/pull_request_template.md`](../.github/pull_request_template.md) และบังคับให้ตอบ 4 เรื่อง:

1. **ทำอะไร** — สรุป 1–2 บรรทัด
2. **เกี่ยวกับ** — ติ๊กขอบเขต: frontend (`web/`), API (`backend/`, `/v1/*`), docs, data/schema (`db/schema.sql`, `backend/app/seed.py`), repo/CI (`.github/`)
3. **ทดสอบแล้วอย่างไร** — คำสั่งที่รัน หรือหน้าที่กดดู + ผลที่เห็น
4. **กระทบข้อมูลหรือไม่** — ต้อง migrate/reseed ไหม, เปลี่ยนสัญญา API แล้วอัปเดต `docs/API.md` หรือยัง

> หมายเหตุ: checkbox `frontend (web/)` ในเทมเพลตอ้างโฟลเดอร์ที่ **ถูกลบไปแล้ว** (prototype เก่า `server.py` + `web/` + `prototype.html` ถูกเอาออกจาก `master`) — อย่าตามหามัน

### 5.4 CI: workflow `ci` ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml))

trigger: `push` เข้า `master` และ **ทุก** `pull_request` · สอง job ขนานกัน:

| job | สภาพแวดล้อม | ขั้นตอน |
|---|---|---|
| `line-app` | `ubuntu-latest`, Node 20 | `npm ci --no-audit --no-fund` → `node --check` ทุก `api/*.js` → `node smoke.js` → `node smoke-handlers.js` → `node smoke-reads.js` → `node smoke-usecases.js` (step "Use case tests") → `node smoke-cron.js` (step "Reminder cron tests") → แยก inline `<script>` จาก `liff/bill.html` ออกมาแล้ว `node --check` |
| `backend` | `ubuntu-latest` + service `postgres:16` (DB `domplus_test`), Python 3.12 | probe ว่า `backend/pyproject.toml` มีบน branch ไหม (ไม่มี = skip ทั้ง job) → `pip install -e "backend[dev]"` → `pytest -q` (150 test ใน 15 ไฟล์) ด้วย `TEST_DATABASE_URL` + `DEV_AUTH=true` |

สิ่งที่ CI **บังคับ**ได้จริงคือ: syntax ทุก handler, พฤติกรรมที่ smoke **ทั้งห้าชุด**ครอบ (รวม use case 177 กรณีที่ id ตรงกับ [`docs/TEST-CASES.md`](./TEST-CASES.md) และ cron/ตัวเตือน), inline script ของหน้า LIFF parse ได้, และ `pytest` ผ่านบน Postgres สด

สิ่งที่ CI **ไม่ได้**ทำ (verified จากไฟล์ workflow): lint/format, typecheck, coverage, build, deploy, ยิง production

> เหตุผลที่มี step ตรวจ inline script: หน้า `liff/bill.html` มี JS ~600 บรรทัดอยู่ในไฟล์เดียว ไม่มี bundler/typecheck — syntax ผิดหลุดขึ้น production ได้ทันทีและเห็นเป็นหน้าจาว่างใน LINE เท่านั้น

### 5.5 Review gates ที่มีจริง

1. **PR template** — checklist ขอบเขต + คำสั่งที่ทดสอบ + ผลกระทบข้อมูล/สัญญา API
2. **CI `ci`** — ควรมองให้เขียวทั้งสอง job (แต่ required check จริงมีแค่ `backend` — ดูกล่อง branch protection ด้านล่าง; job `backend` จะเขียวทันทีถ้า branch ยังไม่มี `backend/`)
3. **กฎ offline ก่อน deploy** — `node smoke.js`, `node smoke-handlers.js`, `node smoke-reads.js`, `node smoke-usecases.js`, `node smoke-cron.js` ต้องผ่าน (ทั้งห้าชุดคือสิ่งที่ CI รัน — ดู [`.github/workflows/ci.yml`](../.github/workflows/ci.yml))
4. **`scripts/prod-smoke.mjs` หลัง merge** — exit code 1 ถ้ามีข้อตก ใช้เป็น gate หลัง deploy ได้ (ตรวจ LIFF 200 + build ปัจจุบัน, header, 401/404 ที่ควรเป็น, `/docs` ปิดบน production, cron ต้องมี secret)
5. **ทดสอบใน LINE 1 ครั้ง** สำหรับ path ที่แตะ (line-app)

สิ่งที่ **ไม่มี** ในเรพ: `CODEOWNERS`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, coverage threshold

**Branch protection บน `master` (ยืนยันจาก GitHub API)** — merge ตรงเข้า `master` ไม่ได้ ต้องผ่าน PR และ required status check คือ **`backend`** เท่านั้น (`strict: true` = branch ต้อง rebase ขึ้นกับ `master` ล่าสุดก่อน merge, `enforce_admins: true` ใช้กับแอดมินด้วย, ปิด force push/ลบ branch, ต้อง resolve conversation ก่อน merge)

> ⚠️ job `line-app` **ไม่ใช่** required check — เขียวหรือแดงก็ยัง merge ได้ถ้า `backend` เขียว · ความปลอดภัยของฝั่ง LINE app จึงพึ่งกฎ "รัน smoke ห้าชุดเองก่อน push" (ข้อ 3) ไม่ใช่ CI · อย่าถือว่า branch protection กัน regression ฝั่ง `line-app` ให้

<!-- VERIFY: ค่า branch protection มาจาก `gh api repos/WinTuner/Dormplus-prototype/branches/master/protection` (ก.ย. 2026) — เปลี่ยนได้ใน GitHub settings นอกเรพ รีวิวซ้ำเมื่อ gate ไม่ตรงกับที่เห็น -->

> ข้อสังเกต (อ่านจากประวัติ ไม่ได้เขียนเป็นกฎ): งานที่มีความเสี่ยงมักแยก branch `security/...` หรือ `perf/...` แล้วรีวิวก่อน merge — เช่น `fix(line-app): close the four holes the review found in this security pass`

## 6. เพิ่ม endpoint ฝั่ง backend (route → test → `docs/API.md`)

ลำดับนี้ตรงกับสิ่งที่ endpoint ที่มีอยู่ทำจริง (`app/routes/rooms.py`, `billing.py`, `reports.py`):

1. **เลือกที่วาง** — ต่อจาก router เดิมถ้าเป็นเรื่องเดียวกัน (`app/routes/<area>.py`) ไม่งั้นสร้างไฟล์ใหม่ `router = APIRouter(prefix="/v1", tags=["<area>"])`
2. **ประกาศ model** — Pydantic `…In` / `…Out` พร้อม constraint (`Field(pattern=PERIOD_PATTERN, ge=0, max_length=...)`) เพื่อให้ validation กลายเป็น `422 VALIDATION` ตามสัญญา
3. **เลือก session** — `owner_session` สำหรับของเจ้าของ, `tenant_session` สำหรับของผู้เช่า (ห้องมาจาก cookie ไม่ใช่ request) · endpoint ที่ไม่ใช้ session (cron, ops) ต้องมี shared secret ของตัวเอง ดูกติกาใน `app/routes/cron.py`
4. **เขียน SQL** — `text()` + bound parameter, กรอง `property_id` จาก session เสมอ; ถ้าเขียนหลายตารางให้อยู่ใน `engine.begin()` ก้อนเดียว
5. **error** — `raise ApiError(409, "CONFLICT", "…")`; ถ้าเพิ่ม code ใหม่ ต้องเพิ่มในตาราง error ของ [`docs/API.md`](./API.md) ด้วย
6. **ลงทะเบียน** — `app.include_router(<area>.router)` ใน `app/main.py`
7. **schema change?** — สร้าง `backend/migrations/versions/000N_<slug>.py` ต่อจาก head (`revision`/`down_revision` เป็นสตริง `"0006"`…) เขียน `op.execute()` และ **ต้องมี `downgrade()`**; ห้าม autogenerate (ไม่มี ORM metadata) · `db/schema.sql` เป็น snapshot อ่านอย่างเดียว ไม่ใช่ที่แก้ · **ไม่มี `db/migrations` ในเรพนี้** — SQL ใหม่ทุกตัวต้องเป็น Alembic revision เท่านั้น แล้ว apply ตามลำดับ (`alembic upgrade head`, ไม่มีคำสั่งแยกสำหรับรัน SQL ตรง)
8. **ตารางใหม่ที่ผูกกับหอ = ต้องมี RLS policy** — ลอกแบบ `0004_rls_property.py` (หรือ `0005_line_events.py` ซึ่งเป็นตารางใหม่ล่าสุด): `enable` **และ `force` row level security** แล้วสร้าง policy `for all using (…) with check (…)` ที่เทียบกับ `current_setting('app.property_id', true)` (ตารางที่มี `property_id` ตรง ๆ ใช้ค่านั้น; ตารางที่ผูกทาง FK ใช้ `exists (select 1 from rooms r where …)`) — ถ้าลืมข้อนี้ ตารางใหม่จะอ่านข้ามหอได้ และถ้า `enable` แต่ไม่ `force` policy จะไม่มีผลกับเจ้าของตาราง · **role ที่ app ใช้ connect ต้องไม่มี `BYPASSRLS`**: `select rolbypassrls from pg_roles where rolname = current_user` ต้องได้ `false` (เจ้าของ Neon อย่าง `neondb_owner` bypass ได้ — ต้องมี role เฉพาะอย่าง `dormplus_app` สำหรับ production, alembic ยังใช้ owner) · **grant ให้ role นั้นแบบมีการ์ด** — `dormplus_app` สร้างนอก migration ดังนั้น `0005` จึง `grant` ภายใน `do $$ begin if exists (select 1 from pg_roles where rolname='dormplus_app') then … end if; end $$` เพื่อให้ DB สด (CI) migrate ผ่านได้โดยไม่มี role นี้
9. **test** — `backend/tests/test_<area>.py`, **หนึ่ง test ต่อหนึ่งพฤติกรรม** ใช้ชื่ออ่านรู้เรื่อง (`test_a_billed_period_cannot_be_changed`) และ fixture จาก `conftest.py`: `engine` (skip ถ้าไม่มี `TEST_DATABASE_URL`), `seeded`, `client_for(engine, session, day)` · ถ้าเป็นเรื่องข้ามหอ ให้ทำ fixture แบบ `second_dorm` ใน `test_rooms.py` แล้วยืนยัน 403/ไม่เห็นข้อมูล · ตารางใหม่ควรมีกรณีใน `backend/tests/test_rls.py` ด้วย (test รันด้วย `set local role` เพราะ role ใน CI เป็น superuser ที่ bypass RLS) · ถ้าแตะหน้าเจ้าของหอ (`backend/owner/index.html`) หรือ `POST /v1/auth/owner` ให้ต่อใน `backend/tests/test_owner_ui.py` (หน้ามี string `เจ้าของหอ` และ `/v1/auth/owner` อยู่ — test ตรวจสองอย่างนี้)
10. **เอกสาร** — [`docs/API.md`](./API.md): อัปเดตตารางสถานะด้านบน (✅), เพิ่มหัวข้อ `### \`METHOD /path\`` พร้อม req/res JSON และรหัส error, และเพิ่มตัวอย่างในบล็อก `## ตัวอย่าง curl (\`backend/\` บนเครื่อง)` · จากนั้นอัปเดตตาราง endpoint ใน [`backend/README.md`](../backend/README.md) · ถ้าเพิ่ม env ต้องอัปเดต [`docs/CONFIGURATION.md`](./CONFIGURATION.md)

หลัง schema/คิวเปลี่ยน: `alembic upgrade head` และ (ถ้าเพิ่งมีตาราง Procrastinate) `python -m app.queue`

ตัวอย่าง read-only ที่เพิ่มมาทีหลัง: `app/routes/reports.py` — `GET /v1/reports/summary` (owner session, `period` default เป็นเดือนนี้ผ่าน `Depends(today)`) คืน `billed`/`paid`/`pending`/`unpaid` + `rooms_total`/`rooms_paid`/`rooms_overdue` · **`billed = paid + pending + unpaid`** (บิล void ไม่ใช่เงินที่ใครติด) เพื่อให้ยอดตรงกับ `GET /v1/invoices` เสมอ และ `rooms_overdue` = ห้องที่มีบิล `unpaid` และ `due_date < วันนี้` · กติกา: ตัวเลขสรุปต้องบวกจาก status ชุดเดียวกับที่รายการบิลใช้ อย่าเขียนสูตรที่สอง

ตัวอย่างโครง (ย่อจากของจริง — ไม่ใช่ไฟล์ที่มีอยู่):

```python
"""Widgets: GET /v1/widgets (docs/API.md)."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import Engine, text

from app.auth import Session, owner_session
from app.db import get_engine
from app.errors import ApiError

router = APIRouter(prefix="/v1", tags=["widgets"])


class WidgetOut(BaseModel):
    id: str
    total: int


class WidgetsOut(BaseModel):
    items: list[WidgetOut]


@router.get("/widgets", response_model=WidgetsOut)
def list_widgets(
    session: Session = Depends(owner_session),
    engine: Engine = Depends(get_engine),
) -> WidgetsOut:
    with engine.connect() as conn:
        rows = conn.execute(
            text("select id, total from widgets where property_id = :property_id"),
            {"property_id": session.property_id},
        ).all()
    if not rows:
        raise ApiError(404, "NOT_FOUND", "ไม่พบข้อมูล")
    return WidgetsOut(items=[WidgetOut(id=r.id, total=r.total) for r in rows])
```

## 7. เพิ่มของฝั่ง line-app (endpoint หรือหน้าจอ LIFF)

### 7.1 endpoint ใหม่

ก่อนเขียน: **นับฟังก์ชันก่อน** — `api/*.js` ที่ไม่ขึ้นต้นด้วย `_` ถูกนับเป็น serverless function และ Vercel Hobby จำกัด **12 ต่อ deployment** · วันนี้ใช้ **ครบ 12/12** (`bill`, `config`, `cron`, `dev`, `me`, `owner`, `qr`, `rooms`, `run`, `slip-image`, `slip`, `webhook` — `cron.js` คือตัวที่สิบสอง) — ฟีเจอร์ใหม่จึงต้อง **รวมเข้าไฟล์เดิม** (query param หรือ action ใน body) หรือย้าย logic ไปเป็น helper ที่ขึ้นต้นด้วย `_` ไม่มีช่องให้เพิ่มไฟล์ใหม่

<!-- VERIFY: เพดาน 12 serverless functions/deployment ของ Vercel Hobby มาจาก line-app/HANDOFF.md ข้อ 5 ไม่ได้ยืนยันกับบัญชี Vercel จริง -->

1. ถ้าเป็น "อีกมุมของข้อมูลเดิม" **ต่อ endpoint เดิมด้วย query param** ดีกว่าเพิ่มไฟล์ (`bill.js` รับ `?period=`/`?history=1`/`?voided=1` และ POST `{action:"void"}` แทนที่จะมี `/api/history` หรือ `/api/void`)
2. สร้าง `api/<route>.js` — ถ้าเป็น helper ให้ขึ้นต้น `_` (ไฟล์ที่ขึ้นต้น `_` **ไม่ถูกนับ** เข้าเพดาน 12 จึงเป็นที่เดียวที่ควรใส่ logic ใหม่ได้ · ตัวอย่างล่าสุด: `_store-r2.js` (backend R2 ของ `_store.js`), `_promptpay.js` (สร้าง QR พร้อมเพย์), `_ledger.js` (ยอดค้าง/ยอดรับตามเดือน + `bill-state:`), `_prepay.js` (สลิปที่โอนมาก่อนบิล, writer สองตัวแข่งกัน), `_remind.js` (handler `cron.js` เหลือแค่ตรวจ secret/lock แล้วเรียก `runReminders()`) — ทั้งหมด 14 ไฟล์ตามข้อ 4.2)
3. ลำดับใน handler (ทำตาม `bill.js` / `run.js` / `slip.js`): เช็ก `req.method` → `res.setHeader("Cache-Control","no-store")` ถ้าเป็น GET ที่คืนสถานะที่เปลี่ยนได้ → `await requireUser(req, res)` แล้ว `if (!userId) return;` → เช็กสิทธิ์ (`await isOwner(userId)`, `await canView(userId)`, หรือเทียบ `user-room:<userId>` กับห้อง) → validate → อ่าน/เขียนผ่าน `_store` (บิลผ่าน `saveBill`/`saveBills` เท่านั้น, การยกเลิกผ่าน `archiveVoid`) → side effect ที่ล้มได้ (push LINE) ครอบ `try/catch` → ตอบ JSON
4. **test** — เพิ่ม assert ในชุดที่ตรงชนิด: พฤติกรรม handler/สิทธิ์/เงิน → `smoke-handlers.js`; การอ่านพร้อมกัน/ลำดับ/ประวัติ → `smoke-reads.js`; ฟังก์ชันบริสุทธิ์ (verify, Flex card) → `smoke.js`; **พฤติกรรมที่ผู้ใช้เห็นเป็น use case → `smoke-usecases.js` โดยใช้ id `TC-xx-n` ตรงกับแถวใน [`docs/TEST-CASES.md`](./TEST-CASES.md)** (CI รันห้าชุดนี้) · suite ต้องผ่านทั้งตอนมีและไม่มี `node_modules`
5. **เอกสาร** — [`line-app/docs/API.md`](../line-app/docs/API.md): เพิ่มแถวในตาราง §1 + หัวข้อเลขถัดไป (§3–§12 คือ endpoint ทีละตัว) · ถ้ารูป request/response เป็นส่วนของสัญญาร่วม ให้แก้ [`docs/API.md`](./API.md) ด้วย
6. **รัน** — `npm test` **และ** `node smoke-usecases.js` + `node smoke-cron.js` และถ้าแตะ path ที่ผู้ใช้จริงใช้ ให้ทดสอบบน deployment 1 ครั้งด้วย `x-seed-token` แล้วทดสอบใน LINE 1 ครั้ง

### 7.2 หน้าจอ LIFF ใหม่

หน้า LIFF มีใบเดียวคือ `line-app/liff/bill.html` (HTML + inline JS) — "หน้าจอ" จึงหมายถึง view ใหม่ในไฟล์นี้ ไม่ใช่ไฟล์ใหม่:

1. เขียนฟังก์ชัน `render…()` / `start…()` ตามแบบ `ownerHome()`, `ownerReport()`, `tenantSlip()`
2. ใช้ helper ที่มีอยู่: `header(kick, title, backTo)`, `bottom(html)`, `toast(msg, isError)`, `notice(...)`, `fail(msg)`, `esc()` สำหรับ interpolate, `fmt()` สำหรับเงิน, `periodTh()/dateTh()` สำหรับวันที่ไทย
3. เสียบเข้า router: hash route ผ่าน `go()`/`route()` หรือ tab map ใน `boot()` (`ownerTabs = { meter, rooms, slips, unpaid, report }`) — tab ที่ไม่รู้จักตกไปที่หน้าหลักตั้งใจ
4. เรียก API ผ่าน `api(path, opts)` — มันแนบ `Authorization: Bearer <idToken>` ให้เอง และโยน error ที่มี `status`/`code` จาก `data.error`
5. **ทดสอบ** — CI parse inline script ให้แล้ว; เพิ่ม assert ฝั่ง handler ถ้ามี endpoint ใหม่; เปิดจริงใน LINE 1 ครั้ง (หน้าจาว่าง = syntax error หรือ scope `openid` ไม่ได้เปิด)
6. ถ้าเป็นเมนูใหม่ใน rich menu ต้องแก้ `line-app/scripts/setup-richmenu.js` + `_richmenu-defs.js` และอัปเดต [`line-app/docs/DEPLOYMENT.md`](../line-app/docs/DEPLOYMENT.md)

> อย่าสับสนหน้าเว็บสามใบ: `line-app/liff/bill.html` คือหน้า LIFF ที่ OA ใช้จริง · `backend/liff/index.html` คือ LIFF ของสแตก backend (เรียก `/v1/*` ด้วย cookie) ที่ยังไม่ผูกกับ OA · `backend/owner/index.html` คือหน้าเจ้าของหอที่เสิร์ฟที่ `/owner` (ไม่ใช้ LIFF SDK) — แก้ UI ให้ผู้ใช้จริงทางการ์ด LINE ต้องแก้ใบแรก แก้หน้าจอเจ้าของต้องแก้ใบที่สาม

## 8. เปลี่ยนโครง key ของ Blob อย่างปลอดภัย

ข้อมูลของ `line-app` อยู่ใน object storage — Vercel Blob หรือ Cloudflare R2 (เลือกด้วย `R2_BUCKET`, ข้อ 4.3) — โดย `_store.js` แปลง key เป็น pathname เดียว:

```js
const pathOf = (key) => `kv/${String(key).replace(/[^a-zA-Z0-9._-]/g, "-")}.json`;
```

ผลที่ต้องรู้ก่อนแตะ: `:` กลายเป็น `-` (ดังนั้น `bill:203` กับ `bill-203` ชี้ไฟล์เดียวกัน) · `pathOf` **ย้อนกลับไม่ได้** (key ที่มีอักขระอื่นจะชนกัน) · `set` เขียนทับทั้งไฟล์ ไม่มี partial update/transaction · `_store` **ไม่มี `del(key)` สำหรับ JSON** — ลบได้เฉพาะไฟล์ผ่าน `delFile`

### 8.1 คีย์และฟิลด์ที่มีอยู่จริง

| key | เก็บอะไร | เขียนที่ |
|---|---|---|
| `bill:<period>:<room>` | บิลรายงวด (ประวัติ) | `saveBills()` |
| `bills:<room>` | index period ใหม่→เก่า (เก็บ 60) | `indexBills()` (เรียกโดย `saveBills`) |
| `bill-state:<room>` | สถานะย่อของแต่ละบิล (room/period/status/total/due/rev/issuedAt/paidAt/receiptNo/refundDue/refundedAt) เก็บ 24 งวด — ตัวเตือน/`?overdue=1`/`?income=` อ่านคีย์เดียวต่อห้องแทนการอ่านทีละงวด | `saveBills()` ผ่าน `_ledger.indexState()` |
| `bill:<room>` | บิลล่าสุด (เขียนเฉพาะเมื่อ period ไม่เก่ากว่าเดิม) | `saveBills()` |
| `bill-void:<period>:<room>:<rev>` | สำเนาบิลที่ถูกยกเลิก (เหตุผล, `receiptNo`, สลิป) | `archiveVoid()` |
| `bill-voids:<room>` | index `"<period>:<rev>"` — `archiveVoid()` ต่อท้ายแล้วเก็บ 200 รายการล่าสุด (เก่า→ใหม่) · `bill.js` (`?voided=1`) เรียงใหม่→เก่าเอง | `archiveVoid()` |
| `prepay:<room>` | สลิปที่ผู้เช่าโอนมาก่อนบิลออก | `slip.js`, ล้างโดย `run.js` |
| `slip-ref:<transRef>` | ห้องที่จอง `transRef` ของสลิปไว้ (กันสลิปใบเดียวจ่ายสองบิล) | `slip.js` (`rememberRef`) |
| `room:<room>` | ค่าเช่า/เรตน้ำ-ไฟที่เจ้าของแก้เอง (ทับ `DEFAULTS` ใน `_rooms.js`) | `rooms.js` (`POST`, owner เท่านั้น) |
| `prepay-old:<room>` / `prepay-old:<room>:<ISO>` | สลิป advance ของผู้เช่าก่อน (รูปยังอยู่) | `qr.js` (`endTenancy`) |
| `tenancy:<room>` | `{ since: ISO }` เวลาที่ผู้เช่าคนก่อนออก | `qr.js` (`endTenancy`) |
| `reminded:<room>:<period>:<kind>:<rev>` | mark ว่าส่งเตือน kind นี้ของบิล rev นี้แล้ว | `_remind.js` |
| `cron-lock` | `{ at }` กัน Vercel ยิงซ้ำระหว่างรัน | `cron.js` |

ฟิลด์ของบิลที่โค้ดอ่าน/เขียนวันนี้: `rev` (1 → +1 เมื่อออกบิลใหม่ทับบิลที่ถูก void), `issuedAt` (ใช้เทียบ `tenancy:<room>` ว่าบิลเป็นของผู้เช่าคนปัจจุบันไหม), `receiptNo` (คำนวณจาก period/room/rev ด้วย `receiptNoOf()` ไม่เก็บเป็นตัวนับ), `slipGroup` (สลิปใบเดียวครอบหลายงวด), `prepaid` (บิลที่ออกมาพร้อม `prepay` ที่มีอยู่), `slipVerify` (ผลตรวจสลิปจาก `_verify.js` — เก็บเป็นการ์ดหลักฐานให้เจ้าของ ไม่เปลี่ยนสถานะบิลเอง), `refundDue` (ยอดที่ต้องคืนเมื่อ void บิลที่ paid แล้ว)

### 8.2 Writer มีที่เดียว: `saveBill()` / `saveBills()` / `archiveVoid()`

`line-app/api/_bills.js` เป็นที่เดียวที่เขียน `bill:*`, `bill-state:*`, `bills:*` และ `bill-void*`:

- `saveBills()` เขียน `bill:<period>:<room>` ทุกงวด + `bills:<room>` + `bill-state:<room>` (ผ่าน `_ledger.indexState()`) และแตะ `bill:<room>` ครั้งเดียวด้วยงวดใหม่สุด · ผู้เรียกที่เพิ่งอ่าน `bill:<room>` ส่ง `{ latest }` เข้ามาเพื่อลด read หนึ่งครั้ง
- `archiveVoid()` เขียน `bill-void:<period>:<room>:<rev>` + `bill-voids:<room>` (idempotent — `run.js` เรียกซ้ำได้)

> ⚠️ `bill-state:<room>` เป็น **สำเนาที่ย่อแล้ว** ของบิล (อ่านโดย `_ledger.stateBills()` ใน `bill.js` `?overdue=1`/`?income=` และ `_remind.js`) · ทางเขียนบิลใหม่ **ทุกทางต้องผ่าน `saveBills()`** ไม่งั้นคีย์นี้ค้างค่าเก่า แล้วตัวเตือน/ยอดค้าง/ยอดรับจะไม่เห็นบิลนั้น · `stateBills()` ตั้งใจ **ไม่เขียน** คีย์ตอนอ่าน (ห้องที่เขียนก่อนมีคีย์นี้จะประกอบจากบิลจริงทุกครั้ง) เพื่อไม่ให้ read แช่รายการที่เก่าไว้

ผู้เขียนทุกคนเรียกผ่านมัน: `run.js` (ออกรอบบิล, `archiveVoid` บิลที่ถูก void ก่อนออกใหม่), `slip.js` (แนบสลิป → `pending`, หลายงวด → `saveBills([...])`), `webhook.js` (postback ยืนยัน → `paid`), `dev.js` (seed), `bill.js` (POST void → `saveBill(voided)` แล้ว `archiveVoid`) — **อย่าเขียน `store.set("bill:…")` ตรง ๆ**

ข้อยกเว้นเดียว: `slip-ref:<transRef>` เขียนตรงใน `slip.js` (`rememberRef`) เพราะไม่ใช่ข้อมูลบิล — เป็นการจอง `transRef` ของสลิป (อ่านก่อนเขียน: ถ้ามีแล้วคืน `ok:false` "สลิปนี้ถูกใช้ไปแล้ว") · คีย์นี้ **ไม่มีวันถูกลบ** โดยตั้งใจ: transRef ของธนาคารไม่ซ้ำตลอดกาล การลบทิ้งจึงเปิดช่องให้สลิปเก่ากลับมาจ่ายบิลใหม่ได้

### 8.3 Reader ที่ต้องแก้ให้ครบ (grep `bill:` ก่อนเสมอ)

| ไฟล์ | อ่านอะไร |
|---|---|
| `api/bill.js` | `bill:<period>:<room>` / `bill:<room>` + `bills:<room>` (history) + `bill-state:<room>` (`stateBills()` สำหรับ `?overdue=1`/`?income=`) + `bill-voids:<room>` → `bill-void:…` (`?voided=1`) |
| `api/rooms.js` | `bill:<room>` + `prepay:<room>` + `meter:<room>` + `room-user:<room>` + `room-users:<room>` + `configFor()` (`dorm` → `room:<room>`) ต่อห้อง; `POST` (owner เท่านั้น) เขียน `room:<room>` หรือ `dorm`; `?settings=1` อ่าน `dorm` |
| `api/run.js` | `bill:<room>` + `bill:<period>:<room>` + `prepay:<room>` + config/ผู้เช่า (กันออกซ้ำ/ทับบิลที่จ่ายแล้ว, แนบ prepay) |
| `api/slip.js` | `bill:<room>`, `bills:<room>`, `bill:<period>:<room>`, `tenancy:<room>`, `prepay:<room>` + เขียน `slip-ref:<transRef>` หลังตรวจผ่าน |
| `api/slip-image.js` | `bill:<room>`, `prepay:<room>` (`advance=1`), `prepay-old:<room>` (`archived=1`) |
| `api/webhook.js` | `bill:<room>` และ `bill:<period>:<room>` (การ์ดเก่าต้องหากันเจอ) + `tenancy:<room>` |
| `api/_remind.js` | `bill-state:<room>` (ผ่าน `stateBills()`), `bill:<room>`, `bills:<room>`, `bill:<period>:<room>`, `reminded:…`, `tenancy:<room>`, `room-user:<room>` |
| `api/_verify.js` | ไม่แตะ Blob — เรียก SlipOK แล้วคืน `{ok, reason, amount, transRef}` ให้ `slip.js` |
| `api/cron.js` | `cron-lock` |
| `api/dev.js` | `bill:<room>` |
| `api/qr.js` | เขียน `tenancy:<room>`, `prepay-old:*` (ไม่ใช่ reader ของบิล) |
| `smoke-handlers.js`, `smoke-reads.js`, `smoke-usecases.js`, `smoke-cron.js` | เขียน/อ่าน key ตรง ๆ ใน Map |

### 8.4 ลำดับที่ปลอดภัย

1. **เพิ่ม key ใหม่ก่อน ลบของเก่าทีหลัง** — ระบบไม่มี transaction และ deployment เก่าที่ warm อยู่อาจยังอ่าน key เก่า
2. **เขียนสองที่ (dual write)** ใน `saveBill()` ระหว่างช่วงเปลี่ยนผ่าน และให้ reader ทุกตัว **fallback ไป key เก่า** — โค้ดวันนี้ทำแบบนี้อยู่แล้วกับการเปลี่ยนผ่านครั้งก่อน (`bill.js` กับ `run.js` มี fallback จาก `bill:<room>` มาเป็น `bill:<period>:<room>`; `webhook.js` ไม่ fallback — อ่าน key รายงวดเท่านั้นแล้วตอบ "ไม่พบบิล"; `_remind.js` อ่าน mark แบบมี `rev` ก่อนแล้ว fallback ไป key ที่ไม่มี `rev`)
3. **`rev` ต้องถูก bump ก่อน archive** — key ของ `bill-void` มี `rev` อยู่ท้าย และ mark ของ `reminded` ก็มี `rev` · ถ้า bump ไม่ตรง บิลที่ออกใหม่จะทับสำเนาเดิมหรือไม่ได้เตือนซ้ำ
4. **ห้ามเปลี่ยน `pathOf` แบบ breaking** — มันไม่ใช่ mapping ที่ย้อนกลับได้; ถ้าจำเป็นต้องเปลี่ยน ให้ถือว่าเป็น key ใหม่ทั้งชุด (dual write + dual read) แล้วค่อยย้ายข้อมูล
5. **การ์ด Flex ที่ส่งไปแล้วแก้ไม่ได้** — postback ของการ์ดเก่าอ้าง `period`/`room` ตามรูปแบบเดิม ถ้าเปลี่ยน semantics ต้องยอมให้การ์ดเก่าถูกปฏิเสธ (แบบที่ `webhook.js` ทำ: การ์ดที่ระบุบิลไม่ได้ → ปฏิเสธ) อย่าเดา
6. **เพิ่ม assert ใน smoke** ให้ครอบทั้ง key ใหม่และ key เก่า ก่อนแก้ docs
7. **อัปเดตเอกสาร 3 ที่**: key map ใน [`line-app/docs/ARCHITECTURE.md`](../line-app/docs/ARCHITECTURE.md), ตาราง "โครงข้อมูลใน Blob" ใน [`line-app/HANDOFF.md`](../line-app/HANDOFF.md) ข้อ 5, และ [`docs/CONFIGURATION.md`](./CONFIGURATION.md) ถ้าเกี่ยวกับ env
8. **ลบของเก่า** ทำได้เฉพาะไฟล์ (`delFile`) — JSON ต้องลบผ่าน `@vercel/blob` `del` เอง (ข้อยกเว้นเดียวที่อนุญาตให้เรียกตรง) และควรทำหลัง deploy ที่อ่าน key ใหม่ครบแล้วเท่านั้น

> ข้อสังเกต (อ่านจากโค้ด ไม่ได้เขียนไว้ในเอกสาร): ใน `saveBills()` การอ่าน `bill:<room>` เกิดขึ้นพร้อมกับ `set` ของ key อื่นใน `Promise.all` เดียวกัน ถ้าสองรอบบิลถูกยิงพร้อมกันสำหรับ period ต่างกัน การกัน "period เก่าทับของใหม่" ยังแข่งกันได้ · `archiveVoid()` ก็ไม่มี compare-and-set เช่นกัน (เขียนทับ key เดิมถ้า `rev` ซ้ำ) · ยอมรับได้ในบริบทนี้ แต่ถ้าจะทำให้แน่นขึ้นต้องมี lock/compare-and-set ซึ่ง Blob ไม่มี

## 9. กับดักที่บันทึกไว้ — อ่านก่อนแก้

### 9.1 จาก [`line-app/HANDOFF.md`](../line-app/HANDOFF.md) ข้อ 6 + บทเรียนจากโค้ดสลิป (`_verify.js` / `slip.js`)

| กับดัก | สิ่งที่ต้องทำ |
|---|---|
| Blob cache | `_store.js` ต้องอ่านผ่าน `blobStore.get(..., { useCache: false })` ทุกครั้ง ไม่งั้นอ่านค่าเก่าได้ถึง ~30 วัน (เคยทำให้ออกรอบบิลแล้วยังเห็นบิลเก่า) · ชั้นนอกมี cache ในหน่วยความจำ 10 วินาทีเฉพาะ key ที่อนุญาต (ข้อ 4.3) — อย่าเรียก `@vercel/blob` เองในโมดูลใหม่ |
| LIFF ใน Messaging API channel สร้างไม่ได้ | ต้องสร้าง **LINE Login channel** แยก แล้วเพิ่ม LIFF ที่นั่น (API จะตอบ `Channel must have ... WEB, NATIVE_APP, LIFF`) · ต้องติ๊ก scope `openid` ไม่งั้น `getIDToken()` คืน null |
| "Use webhook" เปิดผ่าน API ไม่ได้ | ตั้ง URL ได้ แต่ `active` ต้องกดใน console |
| Flex message แก้ย้อนหลังไม่ได้ | เปลี่ยนลิงก์/ปุ่มแล้วต้องส่งการ์ดใหม่ |
| ข้อความที่ส่งแล้ว + ชื่อ OA | ผู้เช่าเห็นถาวร เปลี่ยนชื่อ OA ภายหลังไม่ย้อนไปแก้แชทเก่า |
| SlipOK ต้องส่ง `log: "true"` | ไม่ส่ง = ผู้ให้บริการแค่อ่านสลิป ไม่เช็กบัญชีผู้รับและไม่จำสลิปไว้กันซ้ำ — สลิปโอนเข้าบัญชีอื่นจะผ่าน ถ้าจะเรียก SlipOK ที่อื่นต้องส่งฟิลด์นี้เสมอ |
| body error ของ SlipOK ไม่มี `success` | รูปเป็น `{ code, message, data }` — ไม่มี `success:false` ให้เทสต์ · ต้องถือ "ไม่ใช่ success ที่ระบุชัด" = ไม่ผ่าน (`body.success === true` หรือ `data.success === true` เท่านั้น) การเช็ก `success === false` เคยทำให้ error body อ่านเป็น "ตรวจผ่าน" |
| รหัส SlipOK สองความหมาย ห้ามรวม | `1012` สลิปซ้ำ · `1013` ยอดไม่ตรง · `1014` บัญชีผู้รับไม่ใช่ของหอ → `ok:false` (บอกผู้ใช้ได้) · `1006`, `1007`, `1009`, `1010`, `1011` และ provider ล่ม/timeout/ไม่ได้ตั้ง env → `ok:null` ("ตรวจไม่ได้" ไม่ใช่ "สลิปปลอม" — กล่าวหาผิดไม่ได้) |
| `ok:true` ต้องมี `transRef` | ไม่มี `transRef` = ไม่มีอะไรให้ dedupe และไม่มีอะไรให้เจ้าของดู → คืน `ok:null` ไม่ใช่ผ่าน |
| สลิปใบเดียวจ่ายได้บิลเดียว | `slip.js` เขียน `slip-ref:<transRef>` หลังตรวจผ่านและปฏิเสธถ้าคีย์มีอยู่ · สลิปที่ครอบหลายงวด (`periods:[...]`) ต้องตรวจเทียบ **ยอดรวม** ของทุกงวด ไม่ใช่ยอดงวดเดียว |
| ราคาใหม่ไม่ย้อนไปแก้บิลเก่า | `POST /api/rooms` เขียน `room:<room>` เท่านั้น; บิลที่ออกแล้วถือยอดเดิม → แก้บิลที่พิมพ์ไปแล้วต้อง void + ออกใหม่ (`POST /api/run`) |
| ชื่อ product คือ `DormPlus` | slug ภายในยังเป็น `domplus-*` (`domplus-line-app`, `domplus-backend`, `domplus_test`) ไม่ต้องแก้ |

### 9.2 กติกาฝั่ง backend (จาก [`docs/HANDOFF.md`](./HANDOFF.md) ข้อ 3 + RLS ที่ลงจริงใน `0004`)

| กติกา | เหตุผล |
|---|---|
| `UNIQUE(room_id, period)` ที่ DB | กันบิลซ้ำ — อย่าเช็คแค่ในโค้ด |
| ทุก query กรอง `property_id` จาก session | กันข้ามหอ ห้ามรับจาก client · RLS (migration `0004`) เป็นชั้นสำรอง ไม่แทนที่ WHERE |
| ตารางใหม่ต้องมี policy + role ต้องไม่ `BYPASSRLS` | `force row level security` ทำให้ owner ก็โดน policy; setting ว่าง/NULL = อ่านไม่เห็นแถว |
| งานในคิวต้อง idempotent | คิว retry, cron อาจยิงซ้ำ (at-least-once) |
| webhook ต้อง dedupe ที่ระดับ event | LINE ส่งซ้ำเมื่อไม่เห็น 200 — `line_events` (migration `0005`, `event_id` เป็น PK) จอง event id ด้วย `on conflict (event_id) do nothing returning event_id`: คืนแถว = ของใหม่, คืนว่าง = redelivery (ยังตอบ 200 แต่ไม่เขียน `audit_log`) · ใช้รูปแบบนี้กับ webhook idempotent ตัวต่อไป |
| `paid` แก้ไม่ได้ | ต้องมี void/ใบเสร็จใหม่ + `audit_log` |
| ไม่คิดค่าปรับล่าช้า | เจ้าของหอไม่เคยใช้ — อย่าเพิ่มโดยไม่ถาม |
| token ของ OA ต้องเก็บเข้ารหัส | หลุด = ส่งข้อความในนามหอคนอื่น |

### 9.3 กับดักจากการตั้งค่า/เครื่องมือ (ตรวจจากไฟล์)

- **`TEST_DATABASE_URL` ล้างฐานทุกครั้ง** — `conftest.py` downgrade/upgrade แล้ว truncate; ห้ามชี้ Neon จริง
- **`SESSION_SECRET` ค่า placeholder ถูกปฏิเสธ** — `app/session.py` ไม่ยอมเซ็น/ตรวจด้วย `dev-only-change-me`; test ตั้ง `SESSION_SECRET=test-secret` และ `COOKIE_SECURE=false` เองใน `conftest.py` (TestClient เป็น http)
- **`DEV_AUTH` ถูกเมินบน production** — `app/config.py` `dev_auth_active` เป็น false เมื่อ `VERCEL_ENV=production` แม้ตั้ง `DEV_AUTH=true`
- **RLS ไม่ทำงานถ้า connection ไม่ได้ตั้ง `app.property_id`** — policy เทียบ `current_setting('app.property_id', true)`; ถ้า setting ว่าง predicate เป็น NULL → **ไม่เห็นแถวเลย** (อาการคือ "ตารางว่าง" ไม่ใช่ error) · `app/db.py` `attach_property()` ตั้งให้ทุก transaction (event `begin`, local) จาก env `PROPERTY_ID`; ถ้า query ด้วย client อื่น (psql, alembic) ต้อง `set_config` เอง
- **role ที่ bypass RLS ทำให้ test หลอกผ่าน** — role ใน CI เป็น superuser; `test_rls.py` จึง `set local role` เพื่อบังคับให้ policy มีผล · ใน production ต้องใช้ role ที่ไม่มี `BYPASSRLS`
- **`/api/cron` ตอบ 200 พร้อม `skipped` ได้** — `cron-lock` (15 นาที) กัน Vercel retry ที่ทับซ้อน; อย่าตีความว่า "ไม่มีอะไรส่ง" = โค้ดพัง
- **ตัวเตือนเป็น at-least-once ไม่ใช่ exactly-once** — mark `reminded:…` เขียนหลัง push สำเร็จ; push ล้ม = รอบหน้าลองใหม่ (ผู้เช่าอาจได้ข้อความซ้ำถ้า mark เขียนไม่สำเร็จ)
- **env ที่อ่านตอน module load ต้อง Redeploy** — `_line.js` / `_auth.js` จับ `LIFF_ID` ใส่ `const` ตอนโหลดไฟล์, `_rooms.js` จับ `ROOMS`/เรต, `_remind.js` อ่าน `LIFF_ID` ตอนเรียก และ `cron.js` อ่าน `CRON_SECRET` ตอน request — ค่าที่จับใส่ `const` ตอนโหลดไฟล์จะค้างจนกว่าจะมี deployment ใหม่; เปลี่ยน env แล้ว redeploy เสมอ
- **`_verify.js` อ่าน `SLIPOK_API_KEY`/`SLIPOK_BRANCH_ID` ตอนเรียก** (ไม่ใช่ตอนโหลดไฟล์) — ตั้ง env แล้วไม่ต้อง redeploy · แต่ถ้าขาดตัวใดตัวหนึ่งผลคือ `ok:null` reason `not_configured` ไม่ใช่ error: สลิปยังถูกบันทึกเป็น `pending` และเจ้าของไม่เห็นผลตรวจ — อย่าตีความว่า "ไม่มีผลตรวจ" = "ตรวจผ่าน"
- **`backend/vercel.json` ไม่รัน migration ตอน deploy** — ต้อง `alembic upgrade head` จากเครื่องเมื่อมี migration ใหม่
- **`/docs`, `/redoc`, `/openapi.json` ปิดบน production** — `create_app()` ตรวจ `VERCEL_ENV`; ถ้าอยากดู schema บน production ต้องใช้ [`docs/API.md`](./API.md)
- **ไฟล์ `domplus.db` / `pakdee.db` ที่ root** เป็นของเหลือจาก prototype เก่าและถูก gitignore — ไม่มีโค้ดใดอ่านแล้ว อย่าเอาไปต่อยอด

## 10. หลัง merge — ตรวจของจริง

```bash
node scripts/prod-smoke.mjs
LINE_APP=https://... BACKEND=https://... node scripts/prod-smoke.mjs
```

ตรวจเฉพาะสิ่งที่ไม่ต้องล็อกอิน: LIFF 200 + เป็น build ปัจจุบัน (`qr-ph` อยู่ในหน้า) · `/api/config` 200 · header `nosniff` / `X-Frame-Options: DENY` บน API และหน้า LIFF **ไม่** ถูก frame-deny · `/api/me` 401 · `/api/dev` 404 · backend `/healthz` = `{"status":"ok"}` · `/docs` + `/openapi.json` 404 · `/v1/rooms` 401 · dunning ปฏิเสธ `?token=` · `/v1/cron/daily` ไม่มี secret → 401 · exit code 1 ถ้ามีข้อตก

> `prod-smoke.mjs` ยังไม่ยิง `/api/cron` ของ `line-app` (เพราะต้องใช้ `CRON_SECRET`) — ตรวจด้วยมือเมื่อแตะ path นั้น:

```bash
curl -i -H "Authorization: Bearer $env:CRON_SECRET" https://line-app-iota.vercel.app/api/cron
```

<!-- VERIFY: URL ของ production ทั้งสองโปรเจกต์ (line-app-iota.vercel.app, line-backend-ten.vercel.app) เป็นค่า default ใน scripts/prod-smoke.mjs และ README — ไม่ได้ยืนยันว่ายังชี้ deployment ปัจจุบัน -->

## เอกสารที่เกี่ยวข้อง

- [`line-app/docs/DEVELOPMENT.md`](../line-app/docs/DEVELOPMENT.md) — handler contract, key map, checklist รีวิวของฝั่ง LINE app (ละเอียดที่สุด)
- [`backend/README.md`](../backend/README.md) — endpoint, session, migration, test, Docker, RLS/role
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — สถาปัตยกรรมทั้งสองสแตก
- [`docs/CONFIGURATION.md`](./CONFIGURATION.md) — env ทั้งหมด
- [`docs/API.md`](./API.md) — สัญญา v1
- [`docs/TEST-CASES.md`](./TEST-CASES.md) — test case ตาม use case (id `TC-xx-n` ที่ `smoke-usecases.js` ใช้)
- [`docs/HANDOFF.md`](./HANDOFF.md) · [`line-app/HANDOFF.md`](../line-app/HANDOFF.md) — งานที่เหลือ + กับดัก
