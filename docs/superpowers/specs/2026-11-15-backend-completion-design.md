# Design — ปิดสเปก backend (properties/invoice detail/webhook/notify) + เก็บเอกสารที่ค้าง

วันที่: 2026-11-15 · สถานะ: รออนุมัติ · ขอบเขตที่เลือก: **A**

## ทำไม

`docs/API.md` เป็นสัญญาที่ `line-app` ยึดอยู่แล้ว และ `backend/` deploy อยู่จริง (Vercel + Neon, RLS 0004)
แต่ยังขาด 4 อย่างจากสัญญา ทำให้ backend ยังเรียกได้ไม่ครบตามที่เขียนไว้ และเกณฑ์ "เสร็จ" ใน
`docs/HANDOFF.md` §5 ยังติ๊กไม่ได้ (ส่ง LINE ครบ 42 ห้อง + `message_log` 42 แถว)

พร้อมกันนั้น `line-app/docs/*` ยังมีข้อความที่ล้าสมัย และเครื่องหมาย `<!-- VERIFY -->` บางตัว
ตรวจได้จริงจาก CLI/DB ไม่ต้องรอเปิด dashboard

## เป้าหมาย

1. `GET /v1/properties/:id` — เจ้าของอ่านค่าตั้งของหอตัวเอง
2. `GET /v1/invoices/:id` — เจ้าของ (ทุกบิลในหอ) และผู้เช่า (เฉพาะบิลห้องตัวเอง)
3. `POST /v1/webhooks/line/:property_id` — ตรวจ `X-Line-Signature` แล้วตอบ 200
4. `/v1/billing/run` ส่ง LINE จริง: enqueue 1 งานต่อบิลที่เพิ่งสร้าง แล้ว drain ในคำขอเดียวกัน
   (`message_log` ได้แถว `kind='invoice'`)
5. เทสต์ backend ครอบทั้ง 4 ข้อ (DB-backed ตามสไตล์เดิม)
6. เอกสาร: `docs/API.md`, `backend/README.md`, `docs/HANDOFF.md` §2/§5, `docs/TEST-CASES.md`
7. เก็บ `line-app/docs/*` ที่ผิด + ปิด `<!-- VERIFY -->` ที่ตรวจได้จาก CLI/DB

## ไม่ทำ (และเหตุผล)

- **`slip.verify`** — บล็อกที่การเลือกผู้ให้บริการ (กอง 1) ไม่ใช่งานโค้ด
- **`billing.run` เป็น background job** — ขัดกับของที่ใช้จริง: คิวต้องมี worker/cron มา drain
  แต่ backend ไม่ถูกตั้งเวลาแล้ว (ตั้งใจ) การออกบิลเองเร็วพอใน request; ที่ต้องเข้าคิวคือ **การส่ง LINE**
- **backfill ประวัติบิลเก่าของ `line-app`** — ข้อมูลเก่าไม่มี key ต่อรอบ กู้ไม่ได้
- **ปิดช่อง Blob ไม่มี transaction** — สถาปัตยกรรม ไม่ใช่ backlog
- **หน้าจอทวงหนี้ใหม่** — `review/overdue` มีอยู่แล้ว

## ข้อจำกัดที่ยึด

- `property_id` มาจาก session เท่านั้น (ห้ามรับจาก client) — RLS 0004 เป็นชั้นสำรอง
- response เดิมห้ามแตก: เพิ่มฟิลด์ได้ ลบ/เปลี่ยนชื่อไม่ได้
- 1 deploy = 1 หอ (env `ROOMS`/`PROPERTY_ID`) — ใช้ตัดสินเรื่อง secret ของ webhook
- ไม่เพิ่ม dependency ใหม่ (มี `urllib`, `hashlib`, `hmac` อยู่แล้ว)

## ทางที่พิจารณา

### 1) การส่งบิลเข้า LINE — เลือก A

| ทาง | แลกอะไร |
|---|---|
| **A. 1 งานต่อบิล** (`line.push_text` แบบเดียวกับ `dunning`) | retry แยกใบ พังใบเดียวไม่ลากทั้งหอ · `job_id` เป็นได้แค่ id แรก |
| B. งานเดียววนทุกใบ | `job_id` สวย แต่ retry = ส่งซ้ำทั้งหอ (at-least-once ทวีคูณ) |
| C. ยิง LINE ใน request เลย | 42 ห้อง ≈ 8 วิ และ owner รอ; บนหอใหญ่เสี่ยงชนเพดาน 300 วิ |

**เลือก A** — ใช้โค้ดที่มีอยู่ (`queue_reminders` เป็นแม่แบบ), retry แคบที่สุด

**และ `/billing/run` ต้อง drain คิวเองในคำขอเดียว** (`await drain_queue()` แบบเดียวกับ
`app/routes/cron.py`) — เพราะ backend ไม่มี cron แล้ว ถ้า enqueue แล้วจบ บิลจะค้างในคิวจนไม่มีใครส่ง
· ทางนี้ทำให้ route ต้องเป็น `async def` และเจ้าของรอเพิ่ม ~10–20 วิที่ 42 ห้อง (concurrency 4,
เพดานฟังก์ชัน 300 วิ) แลกกับการที่ข้อความออกทันทีโดยไม่ต้องเปิด cron กลับมา

`BillingRunOut` เพิ่ม `queued: int` และ `drained: bool` (additive) · `job_id` = id ของงานแรก หรือ `null`
ถ้า enqueue/drain ไม่ได้ (ยังไม่ apply schema) → **ไม่ล้ม request**: บิลถูกบันทึกแล้ว คืน `queued: 0,
drained: false` พร้อม log (กติกา: ห้ามทำให้ข้อมูลที่บันทึกแล้วกลายเป็น error ของเจ้าของ)

### 2) secret ของ webhook — เลือก A

| ทาง | แลกอะไร |
|---|---|
| **A. env `LINE_CHANNEL_SECRET`** + บังคับ `:property_id` = หอของ deployment | ตรงกับ "1 deploy = 1 หอ" · รองรับหลาย OA ต่อ deploy ไม่ได้ |
| B. ถอดรหัส `properties.line_secret_enc` | ต้องมี KMS/pgcrypto ที่ยังไม่มี (ทั้งโปรเจกต์ใหม่) |
| C. ไม่ตรวจ signature | ไม่มีทางเลือกนี้ |

**เลือก A** — `properties.line_secret_enc` มีคอลัมน์อยู่แต่ยังไม่มีกุญแจ; env คือของที่ deploy ใช้จริง
· `:property_id` ที่ไม่ใช่หอของ deployment → `404 NOT_FOUND` (กัน signature ของหอหนึ่ง replay ใส่อีกหอ)

### 3) การอ่านบิลเดี่ยว — เลือก A

| ทาง | แลกอะไร |
|---|---|
| **A. route เดียว + `current_session` แล้ว scope ตาม role** | โค้ดเดียว ตรงกับ `me.py` ที่ผู้เช่าเห็นเฉพาะห้องตัวเอง |
| B. แยก route owner/tenant | สองทางสำหรับข้อมูลเดียวกัน |

**เลือก A** · เจ้าของเห็นทุกบิลในหอ · ผู้เช่าเห็นเฉพาะ `room_id` ของ session · นอกนั้น `404` (ไม่ใช่ 403 — ไม่บอกว่ามีบิลนี้อยู่)

## สิ่งที่ตัดสินใจแล้ว (เป็นข้อเท็จจริงของงานนี้)

- `GET /v1/properties/:id` — `owner_session`; `id` ต้องเท่ากับ `session.property_id` ไม่งั้น `404`
  คืน `id, name, billing_mode, water_rate, elec_rate, due_days, rooms` (`rooms` = จำนวนห้องของหอ)
- `GET /v1/invoices/:id` — คืน `id, period, room_no, items[], total, status, due_date, payment`
  `payment` = แถวล่าสุดจาก `payments` (`amount, slip_key, verify_ok, verified_at`) หรือ `null`
  `items` เรียงตามลำดับที่บันทึก (`invoice_items` มี `id` bigserial ให้เรียง)
- `POST /v1/webhooks/line/:property_id` — HMAC-SHA256 (base64) ของ **raw body** เทียบกับ header
  แบบ constant-time · ผิด → `401 UNAUTHORIZED` · ถูก → บันทึก `audit_log` action `webhook.line`
  (นับ event ต่อ type) แล้ว `200 {"ok":true}` · **ไม่มีคิวในรอบนี้** เพราะงานเดียวคือ insert 1 แถว
- `notify.invoice` — โมดูลใหม่ `app/notify.py` (บาง ๆ) รับ list ของ
  `{invoice_id, room_no, period, total, due_date, line_user_id}` แล้ว `defer` ทีละใบ
  ด้วย `line.push_text` kind `invoice` + `invoice_text()` ที่มีอยู่แล้ว (วันนี้ยังไม่มีใครเรียก)
  · ไม่ยัดเข้า `app/tasks.py` เพราะที่นั่นมีแต่ task ที่ worker รัน; ตัว fan-out คือโค้ดของ API
- **ผู้รับข้อความ** — ใช้สูตรเดียวกับ `dunning.py` (lateral: ผู้เช่าที่ `line_user_id is not null`,
  `moved_in` ใหม่สุด, ยังไม่ `moved_out`): 1 ห้อง = 1 ข้อความ แม้มีรูมเมท · ห้องที่ไม่มีผู้เช่าผูก LINE
  = ข้ามเงียบ ๆ ไม่ถือเป็น error
- **`queued`** = จำนวนงานที่ `defer` สำเร็จจริง (≤ `rooms_to_bill`) ไม่ใช่จำนวนบิล — บิลที่ไม่มีผู้เช่า
  ผูก LINE ยังถูกสร้างและยังขึ้นใน `rooms_to_bill`
- **webhook เป็น endpoint ที่ทำงานได้แต่ยังไม่ผูกช่องทาง** — ไม่สลับ webhook URL ของ OA
  (สลับเมื่อไหร่บอทของ `line-app` ที่ใช้งานจริงจะดับ) · เอกสารต้องเขียนแบบนี้ ห้ามติ๊กเป็น "ใช้งานจริง"
- **เทสต์คิวใช้ stub** — `defer` ถูกแทนด้วย `FakeApp` แบบ `test_dunning.py` (ไม่เขียนลง DB)
  เพราะ `app/queue.py` สร้าง conninfo จาก `settings.database_url` ไม่ใช่ `TEST_DATABASE_URL`
  การ `defer` จริงในเทสต์จะไปเขียนคิวลง dev DB · เคส "คิวไม่พร้อม" = ให้ stub โยน exception
- **`<!-- VERIFY -->`** ปิดด้วยคำสั่ง read-only: `vercel crons list`, `alembic current`,
  `select rolname, rolbypassrls from pg_roles` · ส่วน "42 ห้อง" พิสูจน์ในเทสต์ ไม่ส่งข้อความจริงหา
  ผู้เช่า
- `message_log.kind` = `invoice` (ตรงกับ comment ใน `db/schema.sql`)

## แผนเทสต์

| ของ | เทสต์ |
|---|---|
| properties | เจ้าของอ่านหอตัวเองได้ · หออื่น → 404 · ผู้เช่า → 403 · ไม่ล็อกอิน → 401 |
| invoice detail | เจ้าของเห็นบิลห้องอื่นในหอได้ · ผู้เช่าห้องเดียวกันเห็น · ผู้เช่าห้องอื่น → 404 · `items` ครบ + `payment` null ก่อนจ่าย / มีค่าหลังแนบสลิป |
| webhook | signature ถูก → 200 + audit row · ผิด → 401 · property อื่น → 404 · body ไม่ใช่ JSON → 400 · ไม่ตั้ง env → 503 |
| billing + notify | `/billing/run` สร้าง 3 ห้องที่ผูก LINE ครบ → `queued=3`, `drained=true`, `defer` ถูกเรียก 3 ครั้งด้วย `kind='invoice'` · ห้องไม่มี LINE → `queued < rooms_to_bill` แต่บิลยังสร้าง · stub โยน exception → บิลยังถูกสร้าง, `queued=0, drained=false`, ยังตอบ 200 · `test_billing.py` ที่ assert JSON ตรง ๆ ต้องเติม 2 ฟิลด์ใหม่ |

ทุกเทสต์ใช้ `DEV_AUTH` header + Postgres แบบเดิม (`backend/tests/conftest.py`)

## เอกสารที่จะแก้

- `docs/API.md` — เติม response ของ 2 GET, ระบุ auth/error, webhook body/behavior, `queued`/`drained`
  ใน `/billing/run`
- `backend/README.md` — ตาราง route + ส่วน webhook/notify + ต้องรัน `python -m app.queue`
- `docs/HANDOFF.md` — ติ๊ก §2.1 (เหลือเท่าที่จริง), §2.5 (พร้อมหมายเหตุว่ายังไม่ผูก OA), §5
  "ส่ง LINE ครบ 42 ห้อง" (พิสูจน์ด้วยเทสต์ ไม่ใช่ส่งจริง)
- `docs/TEST-CASES.md` — เพิ่มเคสของ 4 ของนี้ + ปรับยอด
- `docs/ARCHITECTURE.md` / `README.md` — จุดที่เขียนว่า backend "ไม่มี webhook เลย" ต้องเปลี่ยนเป็น
  "มี endpoint แต่ OA ยังชี้ที่ `line-app`" (ไม่ใช่สลับช่องทาง)
- `line-app/docs/*` — แก้เฉพาะข้อความที่พิสูจน์ได้ว่าผิด (ไม่รื้อ)
- `<!-- VERIFY -->` — ปิดด้วย read-only: `vercel crons list`, `alembic current`,
  `select rolname, rolbypassrls from pg_roles`

## ความเสี่ยงที่ต้องรู้

- งานนี้ทำให้ `/billing/run` **ต้องมีตารางคิว** ถ้าจะส่ง LINE จริง — `python -m app.queue` ครั้งเดียวต่อ DB
  (ถ้าไม่มี: บิลยังออกได้ แต่ `queued=0` — ไม่มีข้อความถึงผู้เช่า)
- drain ในคำขอทำให้ route ต้องเป็น `async def` และบล็อก event loop ระหว่างรอ LINE — บน Vercel
  หนึ่งคำขอต่อหนึ่ง process จึงยอมรับได้ แต่ต้องไม่เพิ่มงานหนักลงใน route นี้
- webhook รับ event แล้วยังไม่ตอบผู้ใช้ (ไม่มี handler เชิงธุรกิจ) และ **ยังไม่ผูกกับ OA** —
  เป็นการพิสูจน์ signature + wiring ไม่ใช่ chatbot ฝั่ง backend
- push เป็น at-least-once: retry ของคิวอาจส่งซ้ำได้ (เหมือน dunning) — ไม่ปิดช่องนี้ในรอบนี้
