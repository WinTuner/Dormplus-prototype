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
| [`line-app/docs/DEVELOPMENT.md`](../line-app/docs/DEVELOPMENT.md) | แก้ `line-app/api/*.js` หรือ `liff/bill.html` |
| [`line-app/HANDOFF.md`](../line-app/HANDOFF.md) | กับดักที่เจอมาแล้ว + งานที่เหลือของ LINE app |
| [`docs/HANDOFF.md`](./HANDOFF.md) | กับดักฝั่ง backend + เกณฑ์ว่า "เสร็จ" |

## 2. Local setup

### 2.1 สิ่งที่ต้องมี

- **Node.js `>=20`** — `line-app/package.json` `engines`, และ CI ใช้ Node 20
- **Python `>=3.11`** — `backend/pyproject.toml` `requires-python` (CI ใช้ 3.12)
- **Docker** — สำหรับ Postgres 17 ของ `backend/docker-compose.yml` (ถ้าไม่มี Docker ให้ใช้ Postgres ตัวอื่นแล้วแก้ `DATABASE_URL`)
- **git** — remote: `https://github.com/WinTuner/domplus-prototype.git`

### 2.2 line-app

```bash
git clone https://github.com/WinTuner/domplus-prototype.git
cd domplus-prototype/line-app
npm install                    # ให้ @vercel/blob กับ qrcode-svg
npm test                       # = node smoke.js && node smoke-handlers.js && node smoke-reads.js
```

- ไม่มีขั้นตอน build, ไม่มี dev server, ไม่มี bundler — ทุกอย่างที่ deploy คือ `api/*.js` (CommonJS) กับไฟล์ static ไฟล์เดียว `liff/bill.html`
- **smoke suite รันได้แม้ไม่มี `node_modules`** — `smoke-handlers.js` แทน `_store` ด้วย `Map` ในหน่วยความจำ (`require.cache`) และแทน `qrcode-svg` ผ่าน `Module._load`; `smoke.js` ใช้แค่ `crypto`/`assert` กับ `api/_line` · กติกาคือต้องผ่าน **ทั้งมีและไม่มี `node_modules`** เพราะ CI รันหลัง `npm ci` แต่คนที่เพิ่ง clone ยังไม่ได้ติดตั้งก็ต้องรันได้
- ไม่มี `.env.example` — env ใส่ใน Vercel project (ดู [`docs/CONFIGURATION.md`](./CONFIGURATION.md)) · การทดสอบ endpoint จริงใช้ deployment + `x-seed-token` (เปิดได้เฉพาะ `vercel dev` หรือ preview ที่ตั้ง `ALLOW_SEED_BYPASS=true`)

### 2.3 backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate           # macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env             # PowerShell: Copy-Item .env.example .env
docker compose up -d             # Postgres 17 พอร์ต 5432 + ฐาน domplus และ domplus_test
alembic upgrade head
python -m app.seed               # หอ p_1 · 42 ห้อง
uvicorn app.main:app --reload    # http://127.0.0.1:8000/docs
```

- `backend/.env` **ไม่ถูก commit** (อยู่ใน `.gitignore`) — เครื่องใหม่ต้องสร้างเองจาก `.env.example`
- test ที่ต้องใช้ DB จะถูก **ข้าม** ถ้าไม่ได้ตั้ง `TEST_DATABASE_URL`:

```bash
TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test pytest -q
```

> ⚠️ ฐานข้อมูลใน `TEST_DATABASE_URL` **ถูกล้างทุกครั้ง** (`conftest.py` สั่ง `downgrade base` → `upgrade head` แล้ว `truncate ... restart identity cascade`) — ห้ามชี้ไปที่ Neon ตัวจริง

### 2.4 หมายเหตุบน Windows / PowerShell

- repo นี้ถูกพัฒนาบน Windows เป็นหลัก — `backend/.venv/Scripts/activate`, `curl.exe` (ไม่ใช่ alias `curl`), ไม่มี `&&` ใน Windows PowerShell 5.1 ให้ใช้ `;` หรือรันแยก
- ตั้ง env ชั่วคราว: `$env:TEST_DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test"`
- psycopg โหมด async ไม่รับ ProactorEventLoop ของ Windows — ถ้าจะ drain คิวด้วยมือบน Windows ต้องสร้าง loop เอง (หมายเหตุใน [`backend/app/queue.py`](../backend/app/queue.py))

## 3. คำสั่งที่ใช้จริง

ไม่มี target ใน Makefile และไม่มี build step ทั้งสองฝั่ง — นี่คือคำสั่งทั้งหมดที่เอกสาร/CI ใช้:

| คำสั่ง | ที่รัน | ทำอะไร | นิยามที่ไหน |
|---|---|---|---|
| `npm install` / `npm ci` | `line-app/` | ติดตั้ง `@vercel/blob`, `qrcode-svg` | `package.json`, CI |
| `npm test` | `line-app/` | รัน smoke ทั้งสามชุดตามลำดับ | `package.json` `scripts.test` |
| `node smoke.js` | `line-app/` | signature ของ webhook + รูปร่าง Flex card + การ์ดยืนยัน | `smoke.js` |
| `node smoke-handlers.js` | `line-app/` | handler ระดับเงิน/สิทธิ์: dev gate, QR binding, rate limit, สลิป, confirm, ออกบิล | `smoke-handlers.js` |
| `node smoke-reads.js` | `line-app/` | read พร้อมกัน, ประวัติบิล, สิทธิ์ในการอ่าน | `smoke-reads.js` |
| `vercel --prod` | `line-app/`, `backend/` | deploy จากเครื่อง (ปกติไม่ต้อง — push `master` แล้ว auto) | `line-app/docs/DEPLOYMENT.md`, `backend/README.md` |
| `node scripts/prod-smoke.mjs` | root | ตรวจ deployment จริงหลัง merge (ไม่ต้องล็อกอิน) | `scripts/prod-smoke.mjs` |
| `pytest -q` | `backend/` | test ทั้งหมด (DB test ข้ามถ้าไม่มี `TEST_DATABASE_URL`) | `pyproject.toml` `testpaths` |
| `alembic upgrade head` | `backend/` | apply migration | `migrations/` |
| `alembic revision -m "..."` | `backend/` | สร้าง migration ใหม่ (เขียน `op.execute()` เอง) | `migrations/env.py` (`target_metadata = None`) |
| `python -m app.seed` | `backend/` | seed หอ 42 ห้อง (รันซ้ำได้ ไม่สร้างซ้ำ) | `app/seed.py` |
| `python -m app.queue` | `backend/` | **ครั้งเดียวต่อฐานข้อมูล** — สร้างตารางของ Procrastinate | `app/queue.py` |
| `procrastinate -a app.queue.app worker` | ที่มี host ค้าง | worker ทางเลือก ถ้าอยากส่งถี่กว่ารายวัน | `backend/README.md` |

> `procrastinate schema --apply` **ใช้ไม่ได้** กับ app นี้ (CLI บังคับ async connector) — `python -m app.queue` ทำ migration ชุดเดียวกัน
> Vercel Cron (`GET /v1/cron/daily`, `0 2 * * *`) drain คิวเองใน invocation เดียว จึงไม่ต้องมี worker ค้าง

## 4. Code style และ convention

### 4.1 ไม่มี linter/formatter ในเรพ

ตรวจแล้วว่า **ไม่มี** `eslint.config.*`, `.eslintrc*`, `.prettierrc*`, `biome.json`, `.editorconfig`, ruff/black/flake8 ใน `pyproject.toml`, `setup.cfg`, `tox.ini`, `.nvmrc` — และ CI **ไม่มี** ขั้นตอน lint/format/typecheck สไตล์จึงมาจากโค้ดเดิมอย่างเดียว

### 4.2 line-app

รายละเอียดเต็มอยู่ใน [`line-app/docs/DEVELOPMENT.md`](../line-app/docs/DEVELOPMENT.md) ข้อ 2–9 · สรุปที่ต้องจำ:

- **CommonJS เท่านั้น** — `require()` / `module.exports`; handler เป็น `async (req, res)` (ยกเว้น `api/config.js` ที่ sync)
- helper ใช้ร่วมกันต้องขึ้นต้นด้วย `_` (`api/_store.js`, `api/_auth.js`, `api/_bills.js`, `api/_line.js`, `api/_rooms.js`, `api/_async.js`, `api/_limit.js`, `api/_qr.js`) ไม่งั้นมันจะกลายเป็น route สาธารณะ
- 2 spaces, double quotes, semicolons, `const`; คอมเมนต์บรรทัดแรกของไฟล์บอก route + หน้าที่
- error เป็น `{ "error": { "code": "SCREAMING_SNAKE", "message": "ข้อความไทย" } }` — `message` ไทยเสมอ (ผู้ใช้เห็น) `code` อังกฤษ · 405 ของทุก handler วันนี้ใช้รูป object (`METHOD_NOT_ALLOWED`)
- `Cache-Control: no-store` **ก่อน** `requireUser` สำหรับ GET ที่คืนสถานะที่เปลี่ยนได้ (`bill.js`, `me.js`, `rooms.js`, `config.js`)
- ข้อความ UI ไทย, ชื่อตัวแปร/ฟิลด์อังกฤษ, เงินปัดด้วย `Math.round()` และแสดงด้วย `toLocaleString("th-TH")`
- `_auth.isOwner()` / `canView()` / `roleOf()` เป็น **async** — ต้อง `await` (บทบาทมี 3 แบบ: `owner`, `viewer`, และ `null` = ผู้เช่า/ไม่รู้จัก)

### 4.3 backend

- จัดกลุ่มเป็น router ใน `app/routes/<area>.py` ด้วย `APIRouter(prefix="/v1", tags=[...])` แล้วลงทะเบียนใน `app/main.py` `create_app()`
- **SQL ใช้ `sqlalchemy.text()` + named bound parameter เท่านั้น** (`:room`, `:property_id`) — ไม่ต่อสตริงเข้า SQL · หลายคำสั่งที่ต้อง atomic ใช้ `engine.begin()`, ล็อกแถวด้วย `for update` เมื่อมีตัวเขียนแข่งกัน
- `property_id` มาจาก session (`Depends(owner_session)` / `tenant_session`) **ไม่รับจาก client** — เป็นกติกาข้อแรกใน [`docs/HANDOFF.md`](./HANDOFF.md) ข้อ 3
- error: `raise ApiError(status, "CODE", "ข้อความไทย")` — `app/errors.py` แปลงเป็น `{"error":{"code","message"}}` ให้ทุกกรณี (รวม 404 ของ path ที่ไม่มี, 405, 422 validation)
- รับ engine/วันผ่าน `Depends(get_engine)` และ `Depends(today)` เพื่อให้ test สลับได้ (ห้ามเรียก `get_settings()`/`datetime.now()` ตรง ๆ ใน route ที่ต้องเทสต์)
- type hint + Pydantic model ทุก request/response (`Field(pattern=..., ge=...)` สำหรับ validation) · ไม่มี ORM model — SQL เขียนมือ
- คอมเมนต์/docstring อังกฤษ, ข้อความที่ผู้ใช้เห็น (`ApiError.message`, เนื้อหา LIFF) ไทย

## 5. Branch, commit, PR และ CI

### 5.1 Branch

- default branch คือ **`master`** (ทั้งสองโปรเจกต์ Vercel track `master`)
- ชื่อ branch ที่ใช้จริงในประวัติ: `<type>/<slug>` โดย `type` ∈ `feat`, `fix`, `chore`, `docs`, `perf`, `security`, `test`, `ci`, `revert` เช่น `feat/cron-drain`, `fix/cron-async-app`, `docs/handoff-accuracy`, `security/harden-auth`
- **branch ที่จะได้ preview deploy ต้องขึ้นต้นด้วย `preview-`** — `line-app/vercel.json` และ `backend/vercel.json` ตั้ง `deploymentEnabled` เป็น `master: true`, `preview-*: true`, ที่เหลือ `false` (glob ดาวเดียวไม่ข้าม `/` ในชื่อ branch — ดู commit `fix(deploy): a single-star glob does not cross the slash in a branch name`) · branch `feat/...` จึงได้ CI แต่ไม่ได้ deployment

### 5.2 Commit message

ประวัติใช้ Conventional Commits โดยมี scope เป็นโฟลเดอร์/หัวข้อ:

```
feat(backend): one daily cron that drains the queue, so no worker needs a host
fix(line-app): faster reads, slip limits, owner removal, move confirm
docs(line-app): the README endpoint table predates roles, move-confirm and revoke
chore: prod smoke also checks the daily cron exists and needs its secret
test(backend): give the suite a real session secret
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
| `line-app` | `ubuntu-latest`, Node 20 | `npm ci` → `node --check` ทุก `api/*.js` → `node smoke.js` → `node smoke-handlers.js` → `node smoke-reads.js` → แยก inline `<script>` จาก `liff/bill.html` ออกมาแล้ว `node --check` |
| `backend` | `ubuntu-latest` + service `postgres:16` (DB `domplus_test`), Python 3.12 | probe ว่า `backend/pyproject.toml` มีบน branch ไหม (ไม่มี = skip ทั้ง job) → `pip install -e "backend[dev]"` → `pytest -q` ด้วย `TEST_DATABASE_URL` + `DEV_AUTH=true` |

สิ่งที่ CI **บังคับ**ได้จริงคือ: syntax ทุก handler, พฤติกรรมที่ smoke ทั้งสามชุดครอบ, inline script ของหน้า LIFF parse ได้, และ `pytest` ผ่านบน Postgres สด

สิ่งที่ CI **ไม่ได้**ทำ (verified จากไฟล์ workflow): lint/format, typecheck, coverage, build, deploy, ยิง production

> เหตุผลที่มี step ตรวจ inline script: หน้า `liff/bill.html` มี JS ~600 บรรทัดอยู่ในไฟล์เดียว ไม่มี bundler/typecheck — syntax ผิดหลุดขึ้น production ได้ทันทีและเห็นเป็นหน้าจาว่างใน LINE เท่านั้น

### 5.5 Review gates ที่มีจริง

1. **PR template** — checklist ขอบเขต + คำสั่งที่ทดสอบ + ผลกระทบข้อมูล/สัญญา API
2. **CI `ci`** — ต้องเขียวทั้งสอง job (job `backend` จะเขียวทันทีถ้า branch ยังไม่มี `backend/`)
3. **กฎ offline ก่อน deploy** — `node smoke.js`, `node smoke-handlers.js`, `node smoke-reads.js` ต้องผ่าน ([`line-app/HANDOFF.md`](../line-app/HANDOFF.md) ข้อ 8)
4. **`scripts/prod-smoke.mjs` หลัง merge** — exit code 1 ถ้ามีข้อตก ใช้เป็น gate หลัง deploy ได้ (ตรวจ LIFF 200 + build ปัจจุบัน, header, 401/404 ที่ควรเป็น, `/docs` ปิดบน production, cron ต้องมี secret)
5. **ทดสอบใน LINE 1 ครั้ง** สำหรับ path ที่แตะ (line-app)

สิ่งที่ **ไม่มี** ในเรพ: `CODEOWNERS`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, coverage threshold, การบังคับ branch protection ที่มองเห็นได้จากไฟล์

<!-- VERIFY: branch protection / required status checks ของ GitHub org WinTuner ตั้งไว้นอกเรพ — มองไม่เห็นจาก repo จึงยืนยันไม่ได้ว่า `ci` เป็น required check -->

> ข้อสังเกต (อ่านจากประวัติ ไม่ได้เขียนเป็นกฎ): งานที่มีความเสี่ยงมักแยก branch `security/...` หรือ `perf/...` แล้วรีวิวก่อน merge — เช่น `fix(line-app): close the four holes the review found in this security pass`

## 6. เพิ่ม endpoint ฝั่ง backend (route → test → `docs/API.md`)

ลำดับนี้ตรงกับสิ่งที่ endpoint ที่มีอยู่ทำจริง (`app/routes/rooms.py`, `billing.py`):

1. **เลือกที่วาง** — ต่อจาก router เดิมถ้าเป็นเรื่องเดียวกัน (`app/routes/<area>.py`) ไม่งั้นสร้างไฟล์ใหม่ `router = APIRouter(prefix="/v1", tags=["<area>"])`
2. **ประกาศ model** — Pydantic `…In` / `…Out` พร้อม constraint (`Field(pattern=PERIOD_PATTERN, ge=0, max_length=...)`) เพื่อให้ validation กลายเป็น `422 VALIDATION` ตามสัญญา
3. **เลือก session** — `owner_session` สำหรับของเจ้าของ, `tenant_session` สำหรับของผู้เช่า (ห้องมาจาก cookie ไม่ใช่ request) · endpoint ที่ไม่ใช้ session (cron, ops) ต้องมี shared secret ของตัวเอง ดูกติกาใน `app/routes/cron.py`
4. **เขียน SQL** — `text()` + bound parameter, กรอง `property_id` จาก session เสมอ; ถ้าเขียนหลายตารางให้อยู่ใน `engine.begin()` ก้อนเดียว
5. **error** — `raise ApiError(409, "CONFLICT", "…")`; ถ้าเพิ่ม code ใหม่ ต้องเพิ่มในตาราง error ของ [`docs/API.md`](./API.md) ด้วย
6. **ลงทะเบียน** — `app.include_router(<area>.router)` ใน `app/main.py`
7. **schema change?** — สร้าง `backend/migrations/versions/000N_<slug>.py` ต่อจาก head (`revision`/`down_revision` เป็นสตริง `"0004"`…) เขียน `op.execute()` และ **ต้องมี `downgrade()`**; ห้าม autogenerate (ไม่มี ORM metadata) · `db/schema.sql` เป็น snapshot อ่านอย่างเดียว ไม่ใช่ที่แก้
8. **test** — `backend/tests/test_<area>.py`, **หนึ่ง test ต่อหนึ่งพฤติกรรม** ใช้ชื่ออ่านรู้เรื่อง (`test_a_billed_period_cannot_be_changed`) และ fixture จาก `conftest.py`: `engine` (skip ถ้าไม่มี `TEST_DATABASE_URL`), `seeded`, `client_for(engine, session, day)` · ถ้าเป็นเรื่องข้ามหอ ให้ทำ fixture แบบ `second_dorm` ใน `test_rooms.py` แล้วยืนยัน 403/ไม่เห็นข้อมูล
9. **เอกสาร** — [`docs/API.md`](./API.md): อัปเดตตารางสถานะด้านบน (✅), เพิ่มหัวข้อ `### \`METHOD /path\`` พร้อม req/res JSON และรหัส error, และเพิ่มตัวอย่างในบล็อก `## ตัวอย่าง curl (\`backend/\` บนเครื่อง)` · จากนั้นอัปเดตตาราง endpoint ใน [`backend/README.md`](../backend/README.md) · ถ้าเพิ่ม env ต้องอัปเดต [`docs/CONFIGURATION.md`](./CONFIGURATION.md)

หลัง schema/คิวเปลี่ยน: `alembic upgrade head` และ (ถ้าเพิ่งมีตาราง Procrastinate) `python -m app.queue`

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

ก่อนเขียน: **นับฟังก์ชันก่อน** — `api/*.js` ที่ไม่ขึ้นต้นด้วย `_` ถูกนับเป็น serverless function และ Vercel Hobby จำกัด **12 ต่อ deployment** · วันนี้นับได้ **11 ไฟล์** (`bill`, `config`, `dev`, `me`, `owner`, `qr`, `rooms`, `run`, `slip-image`, `slip`, `webhook`) จึงเหลือช่องเดียว

<!-- VERIFY: เพดาน 12 serverless functions/deployment ของ Vercel Hobby มาจาก line-app/HANDOFF.md ข้อ 5 ไม่ได้ยืนยันกับบัญชี Vercel จริง; HANDOFF ยังเขียนว่า "ใช้ครบ 12" แต่ตอนนี้นับได้ 11 -->

1. ถ้าเป็น "อีกมุมของข้อมูลเดิม" **ต่อ endpoint เดิมด้วย query param** ดีกว่าเพิ่มไฟล์ (`bill.js` รับ `?period=` และ `?history=1` แทนที่จะมี `/api/history`)
2. สร้าง `api/<route>.js` — ถ้าเป็น helper ให้ขึ้นต้น `_`
3. ลำดับใน handler (ทำตาม `bill.js` / `run.js` / `slip.js`): เช็ก `req.method` → `res.setHeader("Cache-Control","no-store")` ถ้าเป็น GET ที่คืนสถานะที่เปลี่ยนได้ → `await requireUser(req, res)` แล้ว `if (!userId) return;` → เช็กสิทธิ์ (`await isOwner(userId)`, `await canView(userId)`, หรือเทียบ `user-room:<userId>` กับห้อง) → validate → อ่าน/เขียนผ่าน `_store` (บิลผ่าน `saveBill` เท่านั้น) → side effect ที่ล้มได้ (push LINE) ครอบ `try/catch` → ตอบ JSON
4. **test** — เพิ่ม assert ในชุดที่ตรงชนิด: พฤติกรรม handler/สิทธิ์/เงิน → `smoke-handlers.js`; การอ่านพร้อมกัน/ลำดับ/ประวัติ → `smoke-reads.js`; ฟังก์ชันบริสุทธิ์ (verify, Flex card) → `smoke.js` · suite ต้องผ่านทั้งตอนมีและไม่มี `node_modules`
5. **เอกสาร** — [`line-app/docs/API.md`](../line-app/docs/API.md): เพิ่มแถวในตาราง §1 + หัวข้อเลขถัดไป (§3–§12 คือ endpoint ทีละตัว) · ถ้ารูป request/response เป็นส่วนของสัญญาร่วม ให้แก้ [`docs/API.md`](./API.md) ด้วย
6. **รัน** — `npm test` และถ้าแตะ path ที่ผู้ใช้จริงใช้ ให้ทดสอบบน deployment 1 ครั้งด้วย `x-seed-token` แล้วทดสอบใน LINE 1 ครั้ง

### 7.2 หน้าจอ LIFF ใหม่

หน้า LIFF มีใบเดียวคือ `line-app/liff/bill.html` (1,070 บรรทัด, HTML + inline JS) — "หน้าจอ" จึงหมายถึง view ใหม่ในไฟล์นี้ ไม่ใช่ไฟล์ใหม่:

1. เขียนฟังก์ชัน `render…()` / `start…()` ตามแบบ `ownerHome()`, `ownerReport()`, `tenantSlip()`
2. ใช้ helper ที่มีอยู่: `header(kick, title, backTo)`, `bottom(html)`, `toast(msg, isError)`, `notice(...)`, `fail(msg)`, `esc()` สำหรับ interpolate, `fmt()` สำหรับเงิน, `periodTh()/dateTh()` สำหรับวันที่ไทย
3. เสียบเข้า router: hash route ผ่าน `go()`/`route()` หรือ tab map ใน `boot()` (`ownerTabs = { meter, rooms, slips, unpaid, report }`) — tab ที่ไม่รู้จักตกไปที่หน้าหลักตั้งใจ
4. เรียก API ผ่าน `api(path, opts)` — มันแนบ `Authorization: Bearer <idToken>` ให้เอง และโยน error ที่มี `status`/`code` จาก `data.error`
5. **ทดสอบ** — CI parse inline script ให้แล้ว; เพิ่ม assert ฝั่ง handler ถ้ามี endpoint ใหม่; เปิดจริงใน LINE 1 ครั้ง (หน้าจาว่าง = syntax error หรือ scope `openid` ไม่ได้เปิด)
6. ถ้าเป็นเมนูใหม่ใน rich menu ต้องแก้ `line-app/scripts/setup-richmenu.js` + `_richmenu-defs.js` และอัปเดต [`line-app/docs/DEPLOYMENT.md`](../line-app/docs/DEPLOYMENT.md)

> อย่าสับสนหน้า LIFF สองใบ: `line-app/liff/bill.html` คือใบที่ OA ใช้จริง · `backend/liff/index.html` คือหน้าของสแตก backend (เรียก `/v1/*` ด้วย cookie) ที่ยังไม่ผูกกับ OA — แก้ UI ให้ผู้ใช้จริงต้องแก้ใบแรก

## 8. เปลี่ยนโครง key ของ Blob อย่างปลอดภัย

ข้อมูลของ `line-app` อยู่ใน Vercel Blob โดย `_store.js` แปลง key เป็น pathname เดียว:

```js
const pathOf = (key) => `kv/${String(key).replace(/[^a-zA-Z0-9._-]/g, "-")}.json`;
```

ผลที่ต้องรู้ก่อนแตะ: `:` กลายเป็น `-` (ดังนั้น `bill:203` กับ `bill-203` ชี้ไฟล์เดียวกัน) · `pathOf` **ย้อนกลับไม่ได้** (key ที่มีอักขระอื่นจะชนกัน) · `set` เขียนทับทั้งไฟล์ ไม่มี partial update/transaction · `_store` **ไม่มี `del(key)` สำหรับ JSON** — ลบได้เฉพาะไฟล์ผ่าน `delFile`

### 8.1 Writer มีที่เดียว: `saveBill()`

`line-app/api/_bills.js` เป็นที่เดียวที่เขียน `bill:*` — เขียน 3 อย่าง: `bill:<period>:<room>` (ประวัติ), `bills:<room>` (index ของ period, เก็บ 60 อันล่าสุด) และ `bill:<room>` (ล่าสุด, เขียนเฉพาะเมื่อ period ไม่เก่ากว่าของเดิม)

ผู้เขียนทุกคนเรียกผ่านมัน: `run.js` (ออกรอบบิล), `slip.js` (แนบสลิป → `pending`), `webhook.js` (postback ยืนยัน → `paid`), `dev.js` (seed) — **อย่าเขียน `store.set("bill:…")` ตรง ๆ**

### 8.2 Reader ที่ต้องแก้ให้ครบ (grep `bill:` ก่อนเสมอ)

| ไฟล์ | อ่านอะไร |
|---|---|
| `api/bill.js` | `bill:<period>:<room>` / `bill:<room>` + `bills:<room>` (history) |
| `api/rooms.js` | `bill:<room>` (สถานะต่อห้อง) |
| `api/run.js` | `bill:<room>` + `bill:<period>:<room>` (กันออกซ้ำ/ทับบิลที่จ่ายแล้ว) |
| `api/slip.js` | `bill:<room>` |
| `api/slip-image.js` | `bill:<room>` (`slipPath`) |
| `api/webhook.js` | `bill:<room>` และ `bill:<period>:<room>` (การ์ดเก่าต้องหากันเจอ) |
| `api/dev.js` | `bill:<room>` |
| `smoke-handlers.js`, `smoke-reads.js` | เขียน/อ่าน key ตรง ๆ ใน Map |

### 8.3 ลำดับที่ปลอดภัย

1. **เพิ่ม key ใหม่ก่อน ลบของเก่าทีหลัง** — ระบบไม่มี transaction และ deployment เก่าที่ warm อยู่อาจยังอ่าน key เก่า
2. **เขียนสองที่ (dual write)** ใน `saveBill()` ระหว่างช่วงเปลี่ยนผ่าน และให้ reader ทุกตัว **fallback ไป key เก่า** — โค้ดวันนี้ทำแบบนี้อยู่แล้วกับการเปลี่ยนผ่านครั้งก่อน (`bill.js`, `run.js`, `webhook.js` มี fallback จาก `bill:<room>` มาเป็น `bill:<period>:<room>`)
3. **ห้ามเปลี่ยน `pathOf` แบบ breaking** — มันไม่ใช่ mapping ที่ย้อนกลับได้; ถ้าจำเป็นต้องเปลี่ยน ให้ถือว่าเป็น key ใหม่ทั้งชุด (dual write + dual read) แล้วค่อยย้ายข้อมูล
4. **การ์ด Flex ที่ส่งไปแล้วแก้ไม่ได้** — postback ของการ์ดเก่าอ้าง `period`/`room` ตามรูปแบบเดิม ถ้าเปลี่ยน semantics ต้องยอมให้การ์ดเก่าถูกปฏิเสธ (แบบที่ `webhook.js` ทำ: การ์ดที่ระบุบิลไม่ได้ → ปฏิเสธ) อย่าเดา
5. **เพิ่ม assert ใน smoke** ให้ครอบทั้ง key ใหม่และ key เก่า ก่อนแก้ docs
6. **อัปเดตเอกสาร 3 ที่**: key map ใน [`line-app/docs/ARCHITECTURE.md`](../line-app/docs/ARCHITECTURE.md), ตาราง "โครงข้อมูลใน Blob" ใน [`line-app/HANDOFF.md`](../line-app/HANDOFF.md) ข้อ 5, และ [`docs/CONFIGURATION.md`](./CONFIGURATION.md) ถ้าเกี่ยวกับ env
7. **ลบของเก่า** ทำได้เฉพาะไฟล์ (`delFile`) — JSON ต้องลบผ่าน `@vercel/blob` `del` เอง (ข้อยกเว้นเดียวที่อนุญาตให้เรียกตรง) และควรทำหลัง deploy ที่อ่าน key ใหม่ครบแล้วเท่านั้น

> ข้อสังเกต (อ่านจากโค้ด ไม่ได้เขียนไว้ในเอกสาร): ใน `saveBill()` การอ่าน `bill:<room>` เกิดขึ้นพร้อมกับ `set` ของ key อื่นใน `Promise.all` เดียวกัน ถ้าสองรอบบิลถูกยิงพร้อมกันสำหรับ period ต่างกัน การกัน "period เก่าทับของใหม่" ยังแข่งกันได้ · ยอมรับได้ในบริบทนี้ แต่ถ้าจะทำให้แน่นขึ้นต้องมี lock/compare-and-set ซึ่ง Blob ไม่มี

## 9. กับดักที่บันทึกไว้ — อ่านก่อนแก้

### 9.1 จาก [`line-app/HANDOFF.md`](../line-app/HANDOFF.md) ข้อ 6

| กับดัก | สิ่งที่ต้องทำ |
|---|---|
| Blob cache | `get(..., { useCache: false })` ทุกครั้ง ไม่งั้นอ่านค่าเก่าได้ถึง ~30 วัน (เคยทำให้ออกรอบบิลแล้วยังเห็นบิลเก่า) |
| LIFF ใน Messaging API channel สร้างไม่ได้ | ต้องสร้าง **LINE Login channel** แยก แล้วเพิ่ม LIFF ที่นั่น (API จะตอบ `Channel must have ... WEB, NATIVE_APP, LIFF`) · ต้องติ๊ก scope `openid` ไม่งั้น `getIDToken()` คืน null |
| "Use webhook" เปิดผ่าน API ไม่ได้ | ตั้ง URL ได้ แต่ `active` ต้องกดใน console |
| Flex message แก้ย้อนหลังไม่ได้ | เปลี่ยนลิงก์/ปุ่มแล้วต้องส่งการ์ดใหม่ |
| ข้อความที่ส่งแล้ว + ชื่อ OA | ผู้เช่าเห็นถาวร เปลี่ยนชื่อ OA ภายหลังไม่ย้อนไปแก้แชทเก่า |
| ชื่อ product คือ `DormPlus` | slug ภายในยังเป็น `domplus-*` (`domplus-line-app`, `domplus-backend`, `domplus_test`) ไม่ต้องแก้ |

### 9.2 จาก [`docs/HANDOFF.md`](./HANDOFF.md) ข้อ 3 (ฝั่ง backend)

| กติกา | เหตุผล |
|---|---|
| `UNIQUE(room_id, period)` ที่ DB | กันบิลซ้ำ — อย่าเช็คแค่ในโค้ด |
| ทุก query กรอง `property_id` จาก session | กันข้ามหอ ห้ามรับจาก client |
| งานในคิวต้อง idempotent | คิว retry, cron อาจยิงซ้ำ (at-least-once) |
| `paid` แก้ไม่ได้ | ต้องมี void/ใบเสร็จใหม่ + `audit_log` |
| ไม่คิดค่าปรับล่าช้า | เจ้าของหอไม่เคยใช้ — อย่าเพิ่มโดยไม่ถาม |
| token ของ OA ต้องเก็บเข้ารหัส | หลุด = ส่งข้อความในนามหอคนอื่น |

### 9.3 กับดักจากการตั้งค่า/เครื่องมือ (ตรวจจากไฟล์)

- **`TEST_DATABASE_URL` ล้างฐานทุกครั้ง** — `conftest.py` downgrade/upgrade แล้ว truncate; ห้ามชี้ Neon จริง
- **`SESSION_SECRET` ค่า placeholder ถูกปฏิเสธ** — `app/session.py` ไม่ยอมเซ็น/ตรวจด้วย `dev-only-change-me`; test ตั้ง `SESSION_SECRET=test-secret` และ `COOKIE_SECURE=false` เองใน `conftest.py` (TestClient เป็น http)
- **`DEV_AUTH` ถูกเมินบน production** — `app/config.py` `dev_auth_active` เป็น false เมื่อ `VERCEL_ENV=production` แม้ตั้ง `DEV_AUTH=true`
- **env ที่อ่านตอน module load ต้อง Redeploy** — `line-app` (`_line.js`, `_auth.js`, `_rooms.js`) จับค่าใส่ `const` ตอนโหลดไฟล์; อินสแตนซ์ warm ใช้ค่าเก่าจนกว่าจะมี deployment ใหม่
- **`backend/vercel.json` ไม่รัน migration ตอน deploy** — ต้อง `alembic upgrade head` จากเครื่องเมื่อมี migration ใหม่
- **`/docs`, `/redoc`, `/openapi.json` ปิดบน production** — `create_app()` ตรวจ `VERCEL_ENV`; ถ้าอยากดู schema บน production ต้องใช้ [`docs/API.md`](./API.md)
- **ไฟล์ `domplus.db` / `pakdee.db` ที่ root** เป็นของเหลือจาก prototype เก่าและถูก gitignore — ไม่มีโค้ดใดอ่านแล้ว อย่าเอาไปต่อยอด

## 10. หลัง merge — ตรวจของจริง

```bash
node scripts/prod-smoke.mjs
LINE_APP=https://... BACKEND=https://... node scripts/prod-smoke.mjs
```

ตรวจเฉพาะสิ่งที่ไม่ต้องล็อกอิน: LIFF 200 + เป็น build ปัจจุบัน (`qr-ph` อยู่ในหน้า) · `/api/config` 200 · header `nosniff` / `X-Frame-Options: DENY` บน API และหน้า LIFF **ไม่** ถูก frame-deny · `/api/me` 401 · `/api/dev` 404 · backend `/healthz` = `{"status":"ok"}` · `/docs` + `/openapi.json` 404 · `/v1/rooms` 401 · dunning ปฏิเสธ `?token=` · `/v1/cron/daily` ไม่มี secret → 401 · exit code 1 ถ้ามีข้อตก

<!-- VERIFY: URL ของ production ทั้งสองโปรเจกต์ (line-app-iota.vercel.app, line-backend-ten.vercel.app) เป็นค่า default ใน scripts/prod-smoke.mjs และ README — ไม่ได้ยืนยันว่ายังชี้ deployment ปัจจุบัน -->

## เอกสารที่เกี่ยวข้อง

- [`line-app/docs/DEVELOPMENT.md`](../line-app/docs/DEVELOPMENT.md) — handler contract, key map, checklist รีวิวของฝั่ง LINE app (ละเอียดที่สุด)
- [`backend/README.md`](../backend/README.md) — endpoint, session, migration, test, Docker
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — สถาปัตยกรรมทั้งสองสแตก
- [`docs/CONFIGURATION.md`](./CONFIGURATION.md) — env ทั้งหมด
- [`docs/API.md`](./API.md) — สัญญา v1
- [`docs/HANDOFF.md`](./HANDOFF.md) · [`line-app/HANDOFF.md`](../line-app/HANDOFF.md) — งานที่เหลือ + กับดัก
