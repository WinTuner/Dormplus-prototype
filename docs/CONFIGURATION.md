<!-- generated-by: gsd-doc-writer -->
# DormPlus — Configuration

ทุกค่าตั้งต้นของ prototype เป็น **ค่าคงที่ระดับโมดูล (module-level constants)** ใน `server.py`
ไม่มีไฟล์ `.env`, ไม่มี config loader, และไม่มี `os.environ` / `getenv` อยู่เลยในโปรเจกต์นี้
การเปลี่ยนค่า = แก้โค้ดแล้วรีสตาร์ท server

โปรดักชันตั้งใจให้ค่าพวกนี้ย้ายไปเป็น **ข้อมูลต่อหอ (per-property rows)** ตาม `db/schema.sql` ไม่ใช่ env var

---

## 1. ค่าที่ตั้งไว้ที่ไหนตอนนี้ (prototype)

| ค่า | ค่าปัจจุบัน | ตำแหน่ง | หมายเหตุ |
|---|---|---|---|
| `BASE` (root ของโปรเจกต์) | ไดเรกทอรีของ `server.py` | `server.py:13` | ใช้ resolve path ของ static file และ DB |
| `DB` (ไฟล์ฐานข้อมูล) | `BASE/domplus.db` | `server.py:14` | ดูหัวข้อ 4 |
| `PERIOD` (รอบบิล) | `"2026-11"` | `server.py:15` | `api_v1.py:13` import ค่านี้ต่อ |
| `TODAY` ("วันนี้" ของเดโม) | `2026-11-04` | `server.py:16` | ใช้ออกบิล/นับค้างชำระ ไม่ใช่วันจริง |
| `RENT_METER` | `3220` | `server.py:17` | ค่าเช่าโหมดมิเตอร์ (ใช้ตอน seed) |
| `RENT_FLAT` | `3500` | `server.py:17` | ค่าเช่าโหมดเหมา — **ประกาศไว้แต่ไม่ได้ถูกใช้ที่ไหน** (seed ใช้ `RENT_METER` ทั้งหมดที่ `server.py:88`) |
| `WATER_RATE` | `25` บาท/หน่วย | `server.py:18` | ใช้คำนวณบิลที่ `server.py:124`, `server.py:226`, `server.py:232` |
| `ELEC_RATE` | `7` บาท/หน่วย | `server.py:18` | เช่นเดียวกัน |
| จำนวนวันถึงกำหนดชำระ | `+5` วัน | `server.py:212` (`timedelta(days=5)`) | **ไม่มีชื่อ constant** — ฝังในฟังก์ชัน `make_bills()` |
| ค่า default ของ `water_rate` / `elec_rate` ในตาราง `invoices` | `25` / `7` | `server.py:54-55` | DDL ในตัว `server.py` (สำเนาของ `db/schema.sql`) |
| รอบก่อนหน้า (hardcode) | `'2026-10'` | `server.py:194`, `api_v1.py:48` | ใช้หาค่ามิเตอร์ครั้งก่อน — ต้องแก้ทุกต้นเดือนถ้าไม่ generalize |
| Host / Port | `127.0.0.1:8777` | `server.py:361` | ดูหัวข้อ 5 |
| API base URL (frontend) | `""` (same origin) | `web/api.js:3` | คอมเมนต์ในไฟล์ระบุ `https://api.domplus.app/v1` สำหรับโปรดักชัน |
| Prefix เลขใบเสร็จ | `REC-{PERIOD}-{id:04d}` | `api_v1.py:123` | |
| ข้อมูลค้างชำระจำลอง | `MOCK_ARREARS` | `server.py:21-27` | ใช้โดย `seed_overdue()` เท่านั้น |
| หน่วยมิเตอร์จำลอง | `MOCK_UNITS` | `server.py:28` | `(water, elec)` ต่อ period |

ข้อสังเกตที่กระทบความถูกต้องของตัวเลข: `api_v1.py:79` คำนวณ `days_overdue` จาก `date.today()`
(วันจริงของเครื่อง) ขณะที่ `server.py` ใช้ `TODAY` ค่าคงที่ — สองฝั่งจึงไม่ตรงกันเมื่อรันคนละวัน

---

## 2. สิ่งที่ต้องกลายเป็น config ต่อหอในโปรดักชัน

`schema.sql` วางตาราง `properties` ไว้เป็นที่เก็บค่าพวกนี้แล้ว (`db/schema.sql:4-15`)
ไม่ต้องอ่านจาก env var และไม่ต้อง deploy ใหม่เมื่อเจ้าของหอเปลี่ยนเรต

| คอลัมน์ | ชนิด | Default | ใช้แทนค่าใน prototype |
|---|---|---|---|
| `billing_mode` | `text` (`meter` \| `flat`) | `'meter'` | โหมดออกบิลระดับหอ (prototype เก็บที่ `rooms.billing_mode`) |
| `water_rate` | `int` | `25` | `WATER_RATE` (`server.py:18`) |
| `elec_rate` | `int` | `7` | `ELEC_RATE` (`server.py:18`) |
| `due_days` | `int` | `5` | `timedelta(days=5)` (`server.py:212`) |
| `line_channel_id` | `text` | `null` | ยังไม่มีใน prototype |
| `line_secret_enc` | `bytea` | `null` | channel secret ของหอนั้น (เข้ารหัสด้วย KMS/pgcrypto ตามคอมเมนต์ `db/schema.sql:12`) |
| `line_token_enc` | `bytea` | `null` | access token ของ OA หอนั้น (เข้ารหัสเช่นกัน) |

ค่าที่เป็นของห้องอยู่แล้วและ **ไม่ควร** ย้ายไป `properties`: `rooms.rent`, `rooms.mode`, `rooms.status`
(`db/schema.sql:17-25`) — prototype ก็เก็บที่ระดับห้องอยู่แล้ว (`server.py:31-39`)

ข้อควรระวังเวลาเปลี่ยนเรต: ใบแจ้งหนี้เก็บ `water_rate` / `elec_rate` ไว้ในแถวของตัวเองแล้ว
(`server.py:54-55`) ดังนั้นการแก้เรตจะมีผลกับบิลใหม่เท่านั้น บิลเก่าไม่เปลี่ยนย้อนหลัง

---

## 3. Environment variables ที่ backend จริงจะต้องใช้

อ่านจาก `backend/app/config.py` (pydantic-settings, โหลด `backend/.env`) — ตัวอย่างครบชุดอยู่ใน
`backend/.env.example`

| ชื่อ | ใช้ทำอะไร | สถานะ |
|---|---|---|
| `DATABASE_URL` | เชื่อม Postgres | ใช้งานแล้ว |
| `DEV_AUTH` | เปิด session ผ่าน header `X-Dev-*` สำหรับ dev (ห้ามเปิดบนเซิร์ฟเวอร์จริง) | ใช้งานแล้ว |
| `LINE_CHANNEL_ID` | ตรวจ idToken ตอน `POST /v1/auth/line` (ว่าง = 503 `LINE_NOT_CONFIGURED`) | ใช้งานแล้ว |
| `LIFF_ID` | ให้หน้า LIFF init ผ่าน `GET /v1/liff-config` | ใช้งานแล้ว |
| `SESSION_SECRET` | เซ็น cookie `dp_session` (เปลี่ยนแล้วผู้ใช้ต้อง login ใหม่) | ใช้งานแล้ว |
| `COOKIE_SECURE` | `true` เมื่อเสิร์ฟผ่าน HTTPS | ใช้งานแล้ว |
| `TEST_DATABASE_URL` | ฐานข้อมูลสำหรับ pytest (ถูกล้างทุกครั้ง) | ใช้งานแล้ว |
| `LINE_CHANNEL_SECRET` | ตรวจ `X-Line-Signature` ของ webhook | ยังไม่มีโค้ด |
| `LINE_CHANNEL_ACCESS_TOKEN` | ส่งข้อความ OA | ยังไม่มีโค้ด |
| `ENCRYPTION_KEY` | เข้ารหัส `line_secret_enc` / `line_token_enc` ในตาราง `properties` | ยังไม่มีโค้ด |
| `SLIPOK_API_KEY` | ตรวจสลิปอัตโนมัติ | ยังไม่มีโค้ด |
| `APP_BASE_URL` | สร้างลิงก์ LIFF / redirect หลัง login | ยังไม่มีโค้ด |
| `PORT` / `HOST` | bind ของ ASGI server (Dockerfile ใช้ `${PORT:-8000}`) | ใช้งานแล้ว |

<!-- VERIFY: provider hosting ยังไม่ถูกเลือก (Supabase/Railway ถูกเอ่ยใน docs/HANDOFF.md:78 แต่ยังไม่มีการตัดสิน) และยังไม่มี secret manager -->
<!-- VERIFY: env ที่ระบุ "ยังไม่มีโค้ด" ยังไม่มีจุดอ่านใน backend/app — ตรวจซ้ำเมื่อทำ webhook/slip OCR -->

หมายเหตุ: `LINE_CHANNEL_ID` / secret / token **ไม่ควร** เป็น env var ระดับโปรเซส
เพราะระบบรองรับหลายหอ — ค่าเหล่านี้เก็บต่อแถวใน `properties` (หัวข้อ 2) แล้วถอดรหัสตอนใช้
> สถานะปัจจุบัน: `LINE_CHANNEL_ID` เป็น env ระดับโปรเซส (1 deploy = 1 OA) ซึ่งเป็นข้อจำกัดที่รู้อยู่ —
> ต้องย้ายไปตาราง `properties` ก่อนรองรับหลายหอใน deploy เดียว

---

## 4. ไฟล์ฐานข้อมูล: ตำแหน่งและวิธีรีเซ็ต

- **ตำแหน่ง:** `<project>/domplus.db` — คำนวณจาก `os.path.dirname(os.path.abspath(__file__))` (`server.py:13-14`)
  ไม่ขึ้นกับ current working directory จึงรัน `python server.py` จากที่ไหนก็ใช้ไฟล์เดียวกัน
- **สร้างอัตโนมัติ:** `seed()` (`server.py:78-112`) สร้างตารางจาก `SCHEMA` แล้ว seed 42 ห้อง
  (ชั้น 2 = 12, 3 = 12, 4 = 10, 5 = 8) พร้อมมิเตอร์รอบ `2026-10` และ 12 ห้องที่จดรอบ `2026-11` แล้ว
- **ข้อมูลค้างชำระจำลอง:** `seed_overdue()` (`server.py:115-132`) ใส่บิลค้างจาก `MOCK_ARREARS`
  โดยพึ่ง `UNIQUE(room_id, period)` ให้รันซ้ำแล้วไม่เพิ่มแถว
- **ไม่ถูก commit:** `domplus.db` อยู่ใน `.gitignore:1`
- **`pakdee.db` เป็นไฟล์ตกค้าง:** `server.py` ไม่ได้อ้างถึงเลย — มีแต่ข้อความใน `prototype.html:255`
  ที่ยังบอกผู้ใช้ว่าข้อมูลอยู่ใน `pakdee.db` (ข้อความล้าสมัย) ไฟล์นี้อยู่ใน `.gitignore:2` เช่นกัน
  ลบทิ้งได้โดยไม่กระทบการทำงาน

**รีเซ็ตฐานข้อมูล (เริ่มจากศูนย์):**

```powershell
# 1. หยุด server ก่อน (ปิดหน้าต่าง "PAKDEE server" หรือ Ctrl+C)
# 2. ลบไฟล์
Remove-Item domplus.db
# 3. รันใหม่ — seed() จะสร้างและเติมข้อมูลให้เอง
python server.py
```

บน bash/WSL ใช้ `rm domplus.db` แทน
หลังรีเซ็ต บิล/การชำระเงิน/สลิปทั้งหมดหายไป และ `MOCK_ARREARS` ถูกใส่กลับมาที่สถานะ `unpaid` เหมือนเดิม

---

## 5. Host และ Port

ทั้งสองค่าฝังอยู่ในบรรทัดเดียว:

```python
ThreadingHTTPServer(("127.0.0.1", 8777), Handler).serve_forever()   # server.py:361
```

- ผูกกับ `127.0.0.1` เท่านั้น — เครื่องอื่นในวง LAN เปิดไม่ได้ ต้องแก้เป็น `0.0.0.0` ถ้าต้องการเข้าจากข้างนอก
- ไม่มี env var, ไม่มี CLI flag, ไม่มี config file — แก้ที่ `server.py:361` ตรง ๆ
- ค่าเดียวกันนี้ถูกอ้างถึงอีก 2 ที่ซึ่งต้องแก้ตามกัน: `start-prototype.bat:8` (URL ที่เปิด browser)
  และข้อความ print ที่ `server.py:360`
- URL ที่ใช้บ่อย: `/` และ `/prototype.html` (เดโม LINE-style), `/owner`, `/tenant`, `/api/state`, `/v1/*`

<!-- VERIFY: host/port ของโปรดักชัน (โดเมนจริง, TLS termination, reverse proxy) ไม่มีใน repo — docs/API.md:25 ระบุ base ไว้ที่ https://api.domplus.app/v1 แต่ยังยืนยันไม่ได้ว่าโดเมนนี้ถูกตั้งค่าแล้ว -->

---

## 6. เปลี่ยน X ต้องแก้ที่ไหน

| ต้องการเปลี่ยน | แก้ที่ | หมายเหตุ |
|---|---|---|
| ค่าน้ำต่อหน่วย | `server.py:18` (`WATER_RATE`) | บิลที่ออกแล้วเก็บเรตเดิมไว้ |
| ค่าไฟต่อหน่วย | `server.py:18` (`ELEC_RATE`) | เช่นเดียวกัน |
| ค่าเช่ามิเตอร์ / เหมา | `server.py:17` | มีผลกับ seed เท่านั้น; ห้องที่มีอยู่แล้วแก้ที่ `rooms.rent` |
| จำนวนวันถึงกำหนดชำระ | `server.py:212` | ไม่มี constant ให้แก้ — ต้องแก้ในนิพจน์ `timedelta` |
| รอบบิล | `server.py:15` (`PERIOD`) | `api_v1.py` รับค่าต่ออัตโนมัติ; แต่ `'2026-10'` ที่ `server.py:194` และ `api_v1.py:48` ต้องแก้แยก |
| "วันนี้" ของเดโม | `server.py:16` (`TODAY`) | `api_v1.py:79` ยังใช้ `date.today()` ไม่ตามค่านี้ |
| Port / Host | `server.py:361` (+ `start-prototype.bat:8`) | ดูหัวข้อ 5 |
| Base URL ของ API ฝั่ง frontend | `web/api.js:3` | ค่า `""` = same origin; ใส่ URL โปรดักชันที่นี่ |
| ข้อมูลค้างชำระ / หน่วยมิเตอร์จำลอง | `server.py:21-28` | ต้องลบ DB แล้ว seed ใหม่จึงเห็นผล |
| เรต/กำหนดชำระต่อหอ (โปรดักชัน) | แถวในตาราง `properties` (`db/schema.sql:4-15`) | ไม่ใช่การแก้โค้ด |
| โครงตาราง Postgres | `db/schema.sql` | `server.py:30-68` มีสำเนา DDL ของ SQLite — แก้คู่กันเสมอ |

---

## เอกสารที่เกี่ยวข้อง

- [`../README.md`](../README.md) — ภาพรวมและวิธีรัน
- [`API.md`](API.md) — สัญญา API, error code, state machine
- [`HANDOFF.md`](HANDOFF.md) — งานที่เหลือของ back-end และรายการค่าที่ต้องขอจากเจ้าของโปรเจกต์
- [`../db/schema.sql`](../db/schema.sql) — DDL จริงที่ค่า config ต่อหอจะไปอยู่
