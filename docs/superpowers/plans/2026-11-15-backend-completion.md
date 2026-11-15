# Backend completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้ `backend/` ครบตามสัญญา `docs/API.md` — อ่านค่าหอ, อ่านบิลเดี่ยว, รับ webhook ที่ตรวจ signature, และส่งบิลเข้า LINE จริงเมื่อออกบิล — แล้วเก็บเอกสารที่ค้างให้ตรงกับของจริง

**Architecture:** เพิ่ม router ใหม่ 2 ตัว (`properties`, `webhooks`) และ continuation ของ `billing` โดยยึด `property_id` จาก session เท่านั้น · การส่ง LINE ใช้คิว Procrastinate ที่มีอยู่ (`line.push_text`) แล้ว drain ในคำขอเดียวแบบ `app/routes/cron.py` เพื่อไม่ต้องเปิด cron ของ backend กลับมา · ไม่เพิ่ม dependency

**Tech Stack:** FastAPI · SQLAlchemy Core (`text()`) · Postgres 17 (RLS 0004) · Procrastinate (sync + async connector) · pytest

**Spec:** `docs/superpowers/specs/2026-11-15-backend-completion-design.md`

## Global Constraints

- Python `>=3.11` · ทุกคำสั่งรันจาก `backend/` (`pytest`, `alembic`)
- ห้ามเพิ่ม dependency — มี `hmac`, `hashlib`, `base64`, `urllib` อยู่แล้ว
- `property_id` มาจาก session (`app/auth.py: Session`) เท่านั้น ห้ามอ่านจาก body/query
- response เดิมห้ามแตก: เพิ่มฟิลด์ได้ ลบ/เปลี่ยนชื่อไม่ได้
- error ใช้ `ApiError(code, message)` จาก `app/errors.py` · ข้อความผู้ใช้เป็นภาษาไทย
- ตัวเลขเงินเป็น `int` บาท · วันที่บิลเป็น `date` · เวลาตอบกลับเป็น ISO (FastAPI ทำให้)
- commit message ภาษาอังกฤษ `feat:` / `test:` / `docs:` แบบ repo นี้

## Review Focus

- **บิลของหออื่น / ห้องอื่น → 404 ไม่ใช่ 403** — ผู้เรียกต้องแยกไม่ออกว่ามีบิลนั้นอยู่จริงไหม (Task 2)
- **ผู้เช่าที่ `moved_out` แล้ว** — การตัดสิทธิ์เกิดใน `current_session` (`SESSION_REVOKED`, เทสต์อยู่แล้วใน
  `test_session_and_line.py`); route ใหม่ต้องไม่อ่าน `room_id` จากที่อื่นจนข้ามการตัดนั้น (Task 2)
- **ห้องที่มีผู้เช่า 2 คน (รูมเมท)** — มีคนเดียวได้ข้อความ (ใหม่สุดตาม `moved_in`); อีกคนไม่ได้รับอะไรเลย (Task 4)
- **ห้องที่ไม่มีผู้เช่าผูก LINE** — บิลต้องยังถูกสร้าง และ `queued` ต้องน้อยกว่า `rooms_to_bill` (Task 4)
- **คิวไม่พร้อม (ยังไม่ apply schema)** — เจ้าของต้องได้ 200 พร้อม `queued: 0` ไม่ใช่ 500 หลังบิลถูกบันทึกไปแล้ว (Task 4)
- **webhook ที่ signature ถูกแต่ `property_id` ไม่ใช่หอของ deployment** — 404 ไม่ใช่ 200 (Task 3)

---

### Task 1: `GET /v1/properties/{id}`

**Files:**
- Create: `backend/app/routes/properties.py`
- Modify: `backend/app/main.py` (register router, ต่อจาก `rooms.router`)
- Test: `backend/tests/test_properties.py`

**Interfaces:**
- Consumes: `owner_session` (`app.auth`), `get_engine` (`app.db`), `ApiError` (`app.errors`)
- Produces: `GET /v1/properties/{id}` → `PropertyOut{id,name,billing_mode,water_rate,elec_rate,due_days,rooms}`

- [ ] **Step 1: Write the failing test** — `backend/tests/test_properties.py`

เทสต์ในเรโปนี้ override dependency ไม่ใช้ header: ดู `conftest.py` (`seeded`, `client_for`) และสร้าง session ตรง ๆ

```python
from app.auth import Session

OWNER = Session(user_id="u_owner", role="owner", property_id="p_1")
TENANT = Session(user_id="u_tenant", role="tenant", property_id="p_1", room_id="r_201")

def test_owner_reads_own_property(seeded, client_for):
    r = client_for(seeded, OWNER).get("/v1/properties/p_1")
    assert r.status_code == 200
    body = r.json()
    assert (body["id"], body["rooms"], body["due_days"]) == ("p_1", 42, 5)

def test_other_property_is_404(seeded, client_for):
    assert client_for(seeded, OWNER).get("/v1/properties/p_2").status_code == 404

def test_tenant_is_403(seeded, client_for):
    assert client_for(seeded, TENANT).get("/v1/properties/p_1").status_code == 403

def test_anonymous_is_401(seeded, client_for):
    assert client_for(seeded).get("/v1/properties/p_1").status_code == 401
```

`42` และ `5` มาจาก `seed()` (`backend/app/seed.py`) — ถ้า seed เปลี่ยน ให้ใช้ค่าที่ seed จริง

- [ ] **Step 2: Run test to verify it fails** — `pytest tests/test_properties.py -v` → FAIL (404 เพราะยังไม่มี route)

- [ ] **Step 3: Implement** — `backend/app/routes/properties.py`

`router = APIRouter(prefix="/v1", tags=["properties"])` · `PropertyOut(BaseModel)` ตาม Interfaces ·
route ใช้ `owner_session`, อ่านด้วย query เดียว:

```sql
select p.id, p.name, p.billing_mode, p.water_rate, p.elec_rate, p.due_days,
       (select count(*) from rooms r where r.property_id = p.id) as rooms
from properties p where p.id = :id
```

`id != session.property_id` หรือไม่พบ → `ApiError(404, "NOT_FOUND", "ไม่พบหอนี้")`

- [ ] **Step 4: Run tests** — `pytest tests/test_properties.py -v` → PASS ทั้ง 4

- [ ] **Step 5: Commit**

```bash
git add backend/app/routes/properties.py backend/app/main.py backend/tests/test_properties.py
git commit -m "feat: add GET /v1/properties/:id for the owning dorm"
```

---

### Task 2: `GET /v1/invoices/{id}`

**Files:**
- Modify: `backend/app/routes/billing.py` (โมเดลใหม่ + route ต่อจาก `list_invoices`)
- Test: `backend/tests/test_billing.py` (ต่อท้ายไฟล์)

**Interfaces:**
- Consumes: `current_session`, `Session`, `get_engine`
- Produces: `InvoiceDetailOut{id,period,room_no,items:[InvoiceItemOut{label,qty,unit_price,amount}],total,status,due_date,payment:PaymentOut|None}` · `PaymentOut{amount,slip_key,verify_ok,verified_at}`

- [ ] **Step 1: Write the failing tests** — ต่อท้าย `backend/tests/test_billing.py`

ใช้ `seeded` + `client_for` เหมือน Task 1 · สร้างบิลด้วย `POST /v1/billing/run` ของ route เดิม (ไม่ต้อง insert เอง)
แล้วอ่าน id จาก `GET /v1/invoices?period=2026-11`

```python
def test_owner_reads_any_invoice_of_the_dorm(seeded, client_for):
    owner = client_for(seeded, OWNER)
    owner.post("/v1/billing/run", json={"period": "2026-11"})
    inv = owner.get("/v1/invoices?period=2026-11").json()["items"][0]["id"]
    body = owner.get(f"/v1/invoices/{inv}").json()
    assert [i["label"] for i in body["items"]] == ["ค่าเช่า", "ค่าน้ำ", "ค่าไฟ"]
    assert body["payment"] is None

def test_tenant_reads_only_own_room_invoice(seeded, client_for):
    # ผู้เช่าห้อง r_201 เห็นบิลห้องตัวเอง แต่บิลห้องอื่นในหอเดียวกันต้อง 404
    ...

def test_payment_appears_after_slip(seeded, client_for):
    # ผู้เช่า POST /v1/invoices/:id/slip → status "pending", payment.verify_ok is None
    ...

def test_invoice_of_another_dorm_is_404(seeded, client_for):
    # สร้างแถว invoices ที่ room_id ของ property อื่น (insert ตรง) → 404
    ...
```

- [ ] **Step 2: Run to verify it fails** — `pytest tests/test_billing.py -k "reads_any_invoice or reads_only_own or payment_appears or another_dorm" -v` → FAIL

- [ ] **Step 3: Implement** — `billing.py`

```python
@router.get("/invoices/{invoice_id}", response_model=InvoiceDetailOut)
def get_invoice(invoice_id: str, session: Session = Depends(current_session),
                engine: Engine = Depends(get_engine)) -> InvoiceDetailOut:
```

- scope ตาม role ใน SQL เดียว: `join rooms r on r.id = i.room_id` + `where i.id = :id and r.property_id = :property_id` และถ้า `session.role == "tenant"` เพิ่ม `and i.room_id = :room_id`
- ไม่พบ → `ApiError(404, "NOT_FOUND", "ไม่พบบิลนี้")`
- `items`: `select label, qty, unit_price, amount from invoice_items where invoice_id = :id order by id`
- `payment`: `select amount, slip_key, verify_ok, verified_at from payments where invoice_id = :id order by created_at desc, id desc limit 1` → `None` ถ้าไม่มี
- `due_date` เป็น `date` อยู่แล้ว — ส่งตรง ไม่ต้อง format

- [ ] **Step 4: Run tests** — `pytest tests/test_billing.py -v` → PASS ทั้งไฟล์ (ของเดิมต้องไม่แตก)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routes/billing.py backend/tests/test_billing.py
git commit -m "feat: add GET /v1/invoices/:id scoped by role"
```

---

### Task 3: `POST /v1/webhooks/line/{property_id}`

**Files:**
- Create: `backend/app/routes/webhooks.py`
- Modify: `backend/app/main.py`, `backend/app/config.py` (`line_channel_secret: str = ""`), `backend/.env.example`
- Test: `backend/tests/test_webhook.py`

**Interfaces:**
- Consumes: `get_settings`, `get_engine`, `ApiError`
- Produces: `POST /v1/webhooks/line/{property_id}` → `{"ok": true}` · audit_log row action `webhook.line`

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_webhook.py`

ใช้ `monkeypatch.setenv("LINE_CHANNEL_SECRET", "s3cret")` + `get_settings.cache_clear()` ตามที่
`test_session_and_line.py` ทำอยู่ · webhook ไม่ใช้ session จึงเรียกผ่าน `client_for(seeded)` ได้ตรง ๆ

```python
def sign(secret: str, body: bytes) -> str:
    return base64.b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).decode()

def test_valid_signature_is_200_and_logged(seeded, client_for, line_secret):
    raw = b'{"events":[{"type":"follow"},{"type":"message"}]}'
    r = client_for(seeded).post("/v1/webhooks/line/p_1", content=raw,
                                headers={"X-Line-Signature": sign(line_secret, raw),
                                         "Content-Type": "application/json"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    # audit_log มีแถว action='webhook.line' payload {"count": 2, "types": ["follow", "message"]}

def test_bad_signature_is_401(...): ...       # signature ของ secret อื่น
def test_other_property_is_404(...): ...      # path p_2 ทั้งที่ signature ถูก
def test_non_json_body_is_400(...): ...       # body ขยะ + signature ของ body นั้น
def test_missing_secret_is_503(...): ...      # ไม่ตั้ง env (LINE_CHANNEL_SECRET="")
```

- [ ] **Step 2: Run to verify it fails** — `pytest tests/test_webhook.py -v` → FAIL

- [ ] **Step 3: Implement**

- `config.py`: เพิ่ม `line_channel_secret: str = ""` (ชื่อ env ตรงตัวอัตโนมัติของ pydantic-settings)
- `webhooks.py`: `router = APIRouter(prefix="/v1", tags=["webhooks"])` · route เป็น `async def` เพื่ออ่าน `await request.body()`
- ลำดับตรวจ: secret ว่าง → `503 NOT_CONFIGURED` · `property_id != settings.property_id` → `404 NOT_FOUND` · signature ไม่ตรง (constant-time ด้วย `hmac.compare_digest`) → `401 UNAUTHORIZED` · JSON พัง → `400 VALIDATION`
- ผ่าน: insert `audit_log (property_id, actor, action, payload)` = (`property_id`, null, `'webhook.line'`, `json.dumps({"count": n, "types": [...]})`) · ตอบ `{"ok": True}`
- ไม่แตะ `line-app` และไม่แก้ webhook URL ของ OA

- [ ] **Step 4: Run tests** — `pytest tests/test_webhook.py -v` → PASS 5

- [ ] **Step 5: Commit**

```bash
git add backend/app/routes/webhooks.py backend/app/main.py backend/app/config.py backend/.env.example backend/tests/test_webhook.py
git commit -m "feat: verify LINE webhook signatures and log the events"
```

---

### Task 4: ส่งบิลเข้า LINE เมื่อออกบิล (`notify.invoice` + drain)

**Files:**
- Create: `backend/app/notify.py`
- Modify: `backend/app/routes/billing.py` (`run_billing` → `async def`, `BillingRunOut` + `queued`/`drained`)
- Test: `backend/tests/test_billing.py` (เพิ่ม), `backend/tests/test_notify.py` (ใหม่)

**Interfaces:**
- Consumes: `app.queue.app`, `app.tasks.invoice_text`, `app.routes.cron.drain_queue`
- Produces: `notify_invoices(rows: list[dict]) -> tuple[int, str | None]` (count, first job id) · `BillingRunOut` มี `queued: int`, `drained: bool`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_notify.py` — stub `app.notify.app` แบบ `FakeApp` ใน `test_dunning.py` (บันทึก kwargs ของ `defer`):

```python
def test_one_job_per_invoice_with_tenant(fake_queue):
    count, first = notify_invoices([row(line_user_id="U1"), row(line_user_id="U2")])
    assert count == 2 and first is not None
    assert [k["kind"] for k in fake_queue.deferred] == ["invoice", "invoice"]

def test_room_without_tenant_is_not_queued(fake_queue):
    assert notify_invoices([row(line_user_id=None)])[0] == 0   # แถวที่ไม่มีผู้เช่าต้องไม่ถูกส่งเข้ามาเลย
```

`test_billing.py` — เพิ่ม (ใช้ `seeded` + `client_for` เหมือน Task 1):

```python
def test_run_queues_and_drains(seeded, client_for, fake_queue, monkeypatch):
    # monkeypatch app.routes.billing.drain_queue ด้วย async stub ที่บันทึกว่าถูกเรียก
    body = client_for(seeded, OWNER).post("/v1/billing/run", json={"period": "2026-11"}).json()
    assert (body["queued"], body["drained"]) == (3, True)   # 3 ห้องที่มีผู้เช่าผูก LINE

def test_queue_down_still_returns_the_bills(seeded, client_for, exploding_queue, monkeypatch):
    r = client_for(seeded, OWNER).post("/v1/billing/run", json={"period": "2026-11"})
    assert r.status_code == 200
    assert (r.json()["queued"], r.json()["drained"]) == (0, False)
    # และบิลยังอยู่ใน DB (GET /v1/invoices?period=2026-11 ยังคืนรายการ)
```

จำนวน 3 มาจาก seed: ผูก `line_user_id` ให้ผู้เช่า 3 ห้องใน fixture ของเทสต์ก่อนเรียก (seed เองไม่มี LINE id)

- [ ] **Step 2: Run to verify it fails** — `pytest tests/test_notify.py tests/test_billing.py -v` → FAIL

- [ ] **Step 3: Implement**

`app/notify.py`:

```python
def notify_invoices(rows: list[dict]) -> tuple[int, str | None]:
```

- ข้ามแถวที่ `line_user_id` ว่าง · `with app.open():` แล้ว `app.configure_task("line.push_text").defer(to_user_id=..., body=invoice_text(room_no, period, total, due_date), invoice_id=..., kind="invoice")` · เก็บ id ของงานแรกไว้คืน

`billing.py`:

- `run_billing` เปลี่ยนเป็น `async def` (engine ยังใช้แบบ sync ได้)
- import แบบชื่อตรง: `from app.routes.cron import drain_queue` (เพื่อให้เทสต์ monkeypatch ที่ `app.routes.billing.drain_queue` ได้)
- หลัง commit: query แถวสำหรับ notify ด้วยสูตรผู้เช่าคนเดียวเหมือน `dunning.py` (lateral `line_user_id is not null`, `moved_in` ใหม่สุด, ยังไม่ `moved_out` — ใช้ `day` ที่ route ได้มาแล้ว) เฉพาะ `i.id = any(:ids)`
- `try: queued, first = notify_invoices(rows); await drain_queue(); drained = True except Exception: queued, first, drained = 0, None, False` + `logger.exception`
- คืน `job_id=str(first) if first else None`

- [ ] **Step 4: Run tests** — `pytest tests/test_billing.py tests/test_notify.py -v` → PASS · เติม 2 ฟิลด์ใหม่ใน assert JSON เดิมของ `test_billing.py`

- [ ] **Step 5: Commit**

```bash
git add backend/app/notify.py backend/app/routes/billing.py backend/tests/test_notify.py backend/tests/test_billing.py
git commit -m "feat: queue and send the invoice message when a billing run creates bills"
```

---

### Task 5: เอกสารสัญญา + HANDOFF

**Files:**
- Modify: `docs/API.md`, `backend/README.md`, `docs/HANDOFF.md`, `docs/TEST-CASES.md`, `docs/ARCHITECTURE.md`, `README.md`

**Interfaces:**
- Consumes: ของจริงจาก Task 1–4 (ชื่อฟิลด์ต้องตรงกับ response ที่รันได้)

- [ ] **Step 1: แก้ `docs/API.md`** — เติม response จริงของ 2 GET (auth, error codes), webhook (header, body, 401/404/503/400, audit), `/billing/run` (`queued`, `drained`, drain ในคำขอ)
- [ ] **Step 2: แก้ `backend/README.md`** — ตาราง route + webhook/notify + หมายเหตุ `python -m app.queue` จำเป็นถ้าจะส่ง LINE
- [ ] **Step 3: แก้ `docs/HANDOFF.md`** — §2.1: ติ๊ก 3 ข้อที่ปิดในชุดนี้ (`/properties/:id`, `/invoices/:id`, webhook) และเขียนให้ชัดว่าเหลือ `GET /reports/summary` (มีใน `docs/API.md` แต่ยังไม่มี route — ไม่อยู่ในขอบเขตนี้) · §2.5 ติ๊กพร้อมหมายเหตุ "endpoint พร้อม แต่ OA ยังชี้ที่ `line-app`" · §5 ติ๊ก "ส่ง LINE ครบ 42 ห้อง" โดยระบุว่าพิสูจน์ด้วยเทสต์ ไม่ได้ส่งข้อความจริง
- [ ] **Step 4: แก้ `docs/TEST-CASES.md`** — เพิ่มเคสของ 4 ของนี้ (อ้าง `backend/tests/test_*.py`) และปรับยอดรวมให้บวกได้
- [ ] **Step 5: แก้ `docs/ARCHITECTURE.md` + `README.md`** — จุดที่บอกว่า backend "ไม่มี webhook" → "มี endpoint แต่ OA ยังชี้ที่ line-app"
- [ ] **Step 6: ตรวจว่าไม่มีข้อความขัดกัน** — `git grep -n "ไม่มี webhook\|webhooks/line" -- docs README.md backend/README.md` แล้วอ่านผลทุกบรรทัด
- [ ] **Step 7: Commit**

```bash
git add docs README.md backend/README.md
git commit -m "docs: document the new endpoints, the webhook endpoint and the notify path"
```

---

### Task 6: เก็บ `line-app/docs` ที่ผิด + ปิด `<!-- VERIFY -->` ที่ตรวจได้

**Files:**
- Modify: `line-app/docs/*.md`, `docs/*.md` (เฉพาะบรรทัด `<!-- VERIFY -->` ที่ปิดได้)

**Interfaces:**
- Consumes: CLI/DB จริง (read-only), โค้ด `line-app/`

- [ ] **Step 1: หา VERIFY ทั้งหมด** — `git grep -n "VERIFY" -- docs line-app/docs`
- [ ] **Step 2: ปิดที่พิสูจน์ได้ (read-only)** — `cd backend; alembic current` (head ต้องเป็น `0004`) · `vercel crons list` ทั้งสองโปรเจกต์ · query `select rolname, rolbypassrls from pg_roles where rolname in ('dormplus_app','neondb_owner')` ด้วย `app/config.py` (ห้ามเขียนข้อมูล) แล้วแก้ข้อความให้เป็นข้อเท็จจริงพร้อมลบ marker
- [ ] **Step 3: ตรวจ `line-app/docs` ทีละไฟล์เทียบโค้ด** — เริ่มจาก `TESTING.md` (ยังบอกว่ามีแค่ `smoke.js`) และ `GETTING-STARTED.md`; แก้เฉพาะบรรทัดที่พิสูจน์ได้ว่าผิด
- [ ] **Step 4: ตรวจซ้ำด้วย sub-agent** — dispatch `gsd-doc-verifier` ต่อไฟล์ที่แก้ แล้วแก้ตามผล
- [ ] **Step 5: Commit**

```bash
git add line-app/docs docs
git commit -m "docs: close the verifiable VERIFY markers and fix stale line-app docs"
```

---

## Verification (ทั้งชุด)

```bash
cd backend
pytest -q                       # ต้องผ่านทั้งหมด (ของเดิม 111 + ใหม่)
cd ../line-app
node smoke.js && node smoke-handlers.js && node smoke-reads.js && node smoke-cron.js && node smoke-usecases.js
```

จากนั้นเปิด PR — branch protection บังคับ check `backend` และ `line-app`
