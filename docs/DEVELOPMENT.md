<!-- generated-by: gsd-doc-writer -->
# DormPlus — Development

เอกสารสำหรับคนที่มาแก้โค้ด prototype นี้ต่อ — โครงไฟล์, สไตล์โค้ดที่ใช้อยู่จริง, วิธีเพิ่ม endpoint
ตั้งแต่ต้นจนจบ, วิธีจัดการฐานข้อมูล, การแบ่งงานกับคนทำ backend และ workflow ของ git

**ข้อสำคัญที่สุดก่อนอ่านอย่างอื่น:** โปรเจกต์นี้ไม่มี build step, ไม่มี dependency, ไม่มี linter,
ไม่มีชุดทดสอบ และไม่มี CI — ทุกอย่างคือ `python server.py` แล้วเปิดเบราว์เซอร์
อย่าเพิ่ม tooling ที่ไม่ได้ขอ เพราะทั้งทีมยึดหลัก "standard library เท่านั้น" ตาม `docs/HANDOFF.md`

---

## 1. โครงไฟล์

```
server.py              HTTP server + SQLite + schema + seed + business logic (/api/*)
api_v1.py              adapter ของ /v1/* ตามสัญญา docs/API.md (อ่าน/เขียน DB ก้อนเดียวกัน)
prototype.html         หน้าสาธิต LINE-style หน้าเดียว (ใช้ /api/*, มี offline fallback)
start-prototype.bat    ดับเบิลคลิกเพื่อรัน server + เปิดเบราว์เซอร์ (Windows)
web/
  api.js               API client ตัวเดียวของฝั่งเว็บ — ทุกหน้าคุย API ผ่านไฟล์นี้
  app.css              design tokens + สไตล์ของเว็บแอป (เจ้าของ/ผู้เช่า)
  owner.html           หน้าเจ้าของหอ → /owner
  tenant.html          หน้าผู้เช่า → /tenant
db/schema.sql          DDL Postgres สำหรับ backend จริง (ไม่มีอะไรในรีโปนี้รันไฟล์นี้)
docs/
  API.md               สัญญา API + error code + state machine
  HANDOFF.md           งานที่เหลือของ backend + เกณฑ์ "เสร็จ"
  *.png                ภาพหน้าจอ + rich menu ที่ commit ไว้ (ไม่ใช่ asset ที่เว็บโหลด)
domplus.db             ฐานข้อมูลจริง — สร้างเองตอนสตาร์ท, อยู่ใน .gitignore
```

`pakdee.db` และ `__pycache__/` ถูก ignore ไว้ที่ `.gitignore` — `pakdee.db` เป็นไฟล์ตกค้างจากชื่อเก่า
ไม่มีโค้ดไหนอ้างถึงแล้ว ลบทิ้งได้

### แก้งานอะไร → ไปที่ไฟล์ไหน

| งาน | ไฟล์ |
|---|---|
| เพิ่ม/แก้ endpoint `/v1/*` | `api_v1.py` (และ `docs/API.md` คู่กันเสมอ) |
| เพิ่ม/แก้ endpoint `/api/*` (เดโมเก่า) | `server.py` — `do_POST` + ฟังก์ชัน business logic |
| กติกาการคำนวณบิล / สถานะบิล | `server.py` (`make_bills`, `pay`, `confirm`) — ไฟล์นี้คือ reference |
| เพิ่มหน้าเว็บใหม่ | `web/*.html` + branch ใน `server.py` `do_GET` |
| เปลี่ยนหน้าตา / สี / ระยะ | `web/app.css` (`:root` tokens) |
| เปลี่ยนวิธีเรียก API จากฝั่งเว็บ | `web/api.js` ที่เดียว |
| ค่าคงที่ของเดโม (รอบบิล, เรต, วันนี้) | หัวไฟล์ `server.py` |
| โครง DB ปลายทาง (Postgres) | `db/schema.sql` + สำเนา SQLite ที่ `SCHEMA` ใน `server.py` |

---

## 2. วงจรการพัฒนา

```bash
python server.py
```

เปิด `http://127.0.0.1:8777/owner` และ `/tenant` (เว็บแอป) หรือ `/` (เดโม LINE-style)
รีสตาร์ทเมื่อแก้ `.py` — ไม่มี auto-reload แก้ `.html` / `.css` / `.js` แค่ refresh
(ถ้าหน้าดูไม่เปลี่ยน ให้ hard refresh เพราะ server ไม่ได้ส่ง cache header อะไรเลย)

**ไม่มีชุดทดสอบ** — การตรวจงานคือกดดูในเบราว์เซอร์ตามลำดับนี้ (จาก `README.md`):

1. `/owner` → "เริ่มจากห้อง … (ยังไม่จด)" → กรอกเลขน้ำ/ไฟ → ยอดคำนวณสด
2. "บันทึก แล้วไปห้องถัดไป" → ต้องเด้งไปห้องถัดไปเอง
3. "ออกบิลทั้งหอ" → ต้องขึ้นจำนวนห้องที่ออกบิล
4. `/tenant` → "แนบสลิป & แจ้งชำระ" → สถานะเป็น `pending`
5. กลับ `/owner` → ยอดในหน้ารายรับต้องเปลี่ยน (รอตรวจ/ยังไม่ชำระ)

ถ้าแก้ logic ให้ตรวจฝั่ง API ตรง ๆ ด้วย (ดูหัวข้อ 4.6)

---

## 3. สไตล์โค้ดที่ใช้อยู่จริง

กฎพวกนี้ไม่ได้เขียนไว้ที่ไหน — สังเกตจากโค้ดเดิมแล้วทำตาม อย่าเปลี่ยนสไตล์กลางทาง

### 3.1 Python (`server.py`, `api_v1.py`)

- ขึ้นต้นไฟล์ด้วย `# -*- coding: utf-8 -*-` แล้วตามด้วย module docstring ที่บอกว่าไฟล์นี้ทำอะไร
  และรันยังไง (`server.py:1-5`)
- **standard library เท่านั้น** — `json`, `os`, `sqlite3`, `datetime`, `http.server`, `urllib.parse`, `re`
  ไม่มี `requirements.txt` / `pyproject.toml` และไม่ต้อง `pip install` อะไรเลย
- ค่าที่ปรับได้เป็น **ค่าคงที่ระดับโมดูลตัวพิมพ์ใหญ่** ที่หัวไฟล์ (`PERIOD`, `TODAY`, `WATER_RATE`,
  `ELEC_RATE`, `MOCK_ARREARS`) ไม่มี config loader และไม่มี `os.environ` ในโปรเจกต์นี้
- ฟังก์ชันเป็น `snake_case` และ **หนึ่งชื่อ = หนึ่งการกระทำทางธุรกิจ** (`save_reading`, `make_bills`,
  `pay`, `confirm`, `seed`, `seed_overdue`) — ไม่มี layer ของ service/repository
- ทุกฟังก์ชันเปิด connection เองด้วย `db()` แล้ว `commit()` + `close()` เอง (ไม่มี context manager,
  ไม่มี connection ที่แชร์กัน) — เพราะ `ThreadingHTTPServer` ยิงพร้อมกันได้ ไฟล์ SQLite จึงเป็น state เดียว
- SQL ใช้ placeholder `?` เสมอ ห้าม format ค่าลงไปในสตริง SQL
- `con.row_factory = sqlite3.Row` → อ่านคอลัมน์ด้วยชื่อ (`row["total"]`) ไม่ใช่ index
- เขียนซ้ำแบบ idempotent ด้วย `INSERT ... ON CONFLICT(room_id, period) DO UPDATE / DO NOTHING`
  ไม่ใช่ `SELECT` เช็คก่อนแล้วค่อย `INSERT`
- **ไม่ใช้ type hint, ไม่ใช้ dataclass** — dict คือรูปแบบข้อมูลทั้งภายในและตอนส่งออก JSON
  (คีย์ใน dict ที่คืนจาก `state()` / `rooms_payload()` คือ shape ของ response จริง ๆ)
- `except Exception` กว้าง ๆ มีที่เดียวคือ `server.py:350` พร้อมคอมเมนต์ `# noqa: BLE001 - demo server`
  — เป็นข้อยกเว้นของเดโม ไม่ใช่แบบอย่างให้ลอก (และไม่มี linter ตัวไหนอ่าน `# noqa` นี้จริง)
- `log_message` ถูก override ให้เงียบ (`server.py:353`) — ไม่ต้องเปิด log request
- docstring/คอมเมนต์เป็น **อังกฤษ** ส่วนข้อความที่ผู้ใช้เห็นและ error message เป็น **ไทย**

`api_v1.py` มี convention เพิ่มอีกชั้น:

- ฟังก์ชัน helper (`rooms_payload`, `save_reading`, `slip`, `confirm`, …) คืน **dict เปล่า ๆ**
  หรือ `(status, body)` เมื่อต้องคุม HTTP status
- `handle()` เป็นที่เดียวที่แปลง `(method, path, query, payload)` → `(status, body)` และเป็นที่เดียว
  ที่รู้จัก route ทั้งหมด
- path parameter จับด้วย regex ที่ compile ไว้ระดับโมดูล (`ROOM_READING`, `INV_SLIP`, `INV_CONFIRM`)
  แล้ว `.group(1)` + `int(...)` — ไม่มี router framework
- error body หน้าตาเดียวเสมอ: `{"error": {"code": "...", "message": "<ไทย>"}}`

### 3.2 JavaScript (`web/api.js`, หน้าเว็บ)

- `web/api.js` เป็น IIFE เดียวที่คืน object ชื่อ `API` — **ทุก HTTP concern อยู่ในไฟล์นี้**
  (`fetch`, header, `credentials`, การแปลง error) หน้าเว็บไม่เรียก `fetch` เอง
- หนึ่ง method ต่อหนึ่ง endpoint และเป็น wrapper บาง ๆ ของ `call()`:
  `rooms: (period) => call("GET", "/v1/rooms" + ...)`
- error ถูกแปลงเป็น `Error` ที่มี `.code` และ `.status` ติดมาด้วย (`api.js:13-18`) — หน้าเว็บจึง
  `catch` แล้วเอา `e.message` ไปโชว์ได้ตรง ๆ
- หน้าเว็บเป็น **vanilla DOM ล้วน**: ไม่มี framework, ไม่มี bundler, ไม่มี ES module
  (`<script src="/web/api.js">` แล้วตามด้วย `<script>` inline)
- state อยู่ในตัวแปรระดับ script (`let S`, `cur`, `inv`) แล้ว render ด้วยการประกอบสตริงใส่ `innerHTML`
  — pattern นี้ใช้ทั้ง `owner.html`, `tenant.html` และ `prototype.html`
- event ใช้ `element.onclick = ...` หรือ attribute `onclick="..."` ใน markup (ดู `owner.html:38-50`)
- เงินเป็น **จำนวนเต็มบาท** แสดงผลด้วย `toLocaleString("th-TH")` ผ่าน `fmt()` (`api.js:33`)
  หรือ `money()` ใน `prototype.html:268` — ห้ามมีทศนิยม
- ข้อความ UI เป็นไทยฝังใน markup โดยตรง ไม่มีไฟล์ strings/i18n
  วันที่แบบไทย (พ.ศ.) มี helper `TH_MON` / `thMonth` / `thDate` ใน `prototype.html:269-275`
- สถานะบิลแสดงด้วย class: ปกติ = `pill`, ค้าง/รอตรวจ = `pill warn` (ดู `tenant.html:57-72`)

### 3.3 CSS (`web/app.css`)

- ไฟล์เดียว ใช้ทั้งสองหน้า ขึ้นต้นด้วย design tokens ใน `:root`: `--bg` `#0B0F14`, `--card`, `--card2`,
  `--line`, `--text`, `--muted`, `--accent` `#4FD8D2`, `--warn` `#F59E0B`, `--ok` `#22C55E`, `--font`
- เปลี่ยนสี/ระยะ = แก้ token ไม่ใช่แก้ค่าซ้ำในแต่ละ selector
- layout เป็นคอลัมน์มือถือ `max-width:430px` คลาสสั้น ๆ แบบ utility: `.card`, `.card2`, `.row`, `.m`,
  `.big`, `.btn` / `.btn.ghost`, `.pill`, `.dot`, `.field`, `.hint`
- ฟอนต์ `IBM Plex Sans Thai` โหลดจาก Google Fonts ใน `<head>` ของแต่ละหน้า (ไม่ได้ self-host)

### 3.4 ภาษา

- โค้ด/ตัวแปร/คอมเมนต์: อังกฤษ
- ข้อความที่ผู้ใช้เห็น, error message, เอกสาร: ไทย
- เอกสารใน `docs/` เขียนไทยเป็นหลัก (ยกเว้น `ARCHITECTURE.md` ที่เขียนอังกฤษ)

---

## 4. เพิ่ม endpoint `/v1/*` ตั้งแต่ต้นจนจบ

ตัวอย่างจริง: `POST /v1/invoices/:id/reject` — มีในสัญญา `docs/API.md:145-148` แต่ยังไม่ implement
(`HANDOFF.md` ระบุว่าเป็นงาน backend แต่ adapter ทำได้เลยถ้าต้องการให้ frontend กดได้)

### 4.1 รู้ก่อนว่า HTTP method ไหนถูกส่งเข้า `api_v1` แล้ว

`server.py` เป็นคนรับ request ก่อน แล้วส่งต่อให้ `api_v1.handle()` เฉพาะ path ที่ขึ้นต้นด้วย `/v1/`:

| Method | handler ใน `server.py` | ส่งเข้า `api_v1` ไหม |
|---|---|---|
| GET | `do_GET` (`server.py:286`) | ใช่ — payload เป็น `{}` เสมอ, query ส่งมาเป็น `parse_qs` |
| PUT | `do_PUT` (`server.py:327`) | ใช่ — body ถูก `json.loads` แล้ว |
| POST | `do_POST` (`server.py:335`) | ใช่ — body ถูก `json.loads` แล้ว |
| DELETE / PATCH | — | **ไม่มี handler** ต้องเพิ่ม `do_DELETE` / `do_PATCH` ใน `server.py` ก่อน |

ถ้า endpoint ใหม่ใช้ GET/PUT/POST บน path `/v1/...` **ไม่ต้องแก้ `server.py` เลย** — ไปแก้ `api_v1.py` อย่างเดียว

### 4.2 เพิ่ม handler ใน `api_v1.py`

วางถัดจาก `slip()` / `confirm()` และใช้ pattern เดียวกัน: เปิด connection → หา row → เช็คสถานะ →
คืน `(status, body)` ถ้าผิดเงื่อนไข, คืน dict ถ้าปกติ

```python
def reject(invoice_id, payload):
    con = server.db()
    inv = con.execute("SELECT * FROM invoices WHERE id=?", (invoice_id,)).fetchone()
    if not inv:
        con.close()
        return 404, {"error": {"code": "NOT_FOUND", "message": "ไม่พบบิล"}}
    if inv["status"] != "pending":
        con.close()
        return 409, {"error": {"code": "INVALID_STATE",
                               "message": f"บิลนี้อยู่สถานะ {inv['status']} ตีกลับไม่ได้"}}
    con.execute("UPDATE invoices SET status='unpaid' WHERE id=?", (invoice_id,))
    con.commit()
    con.close()
    return 200, {"status": "unpaid", "reason": payload.get("reason")}
```

จุดที่คนลืมบ่อย: `con.close()` **ทุก** ทางออก รวมทางที่ return error

### 4.3 ลงทะเบียน route ใน `handle()`

path ที่มี `:id` ต้องเพิ่ม regex ระดับโมดูลก่อน (กลุ่มที่ 1 คือ id):

```python
INV_REJECT = re.compile(r"^/v1/invoices/(\d+)/reject$")
```

แล้วเพิ่ม branch ใน `handle()` — เรียงตามลำดับเดิม (GET rooms → PUT reading → billing → invoices →
slip → confirm → summary → 404):

```python
    if method == "POST" and INV_REJECT.match(path):
        return reject(int(INV_REJECT.match(path).group(1)), payload)
```

`return 404, {"error": {"code": "NOT_FOUND", "message": path}}` บรรทัดสุดท้ายคือ fallback — อย่าลบ

### 4.4 อัปเดตสัญญา `docs/API.md`

- เปลี่ยนสถานะในตารางหัวไฟล์จาก ⬜ เป็น ✅ (หรือเพิ่มแถวใหม่)
- เพิ่มหัวข้อ endpoint พร้อม req/res ตัวอย่างจริง — ถ้า response ต่างจากที่เขียนไว้ ให้แก้เอกสาร
  ไม่ใช่แก้โค้ดให้ตรงเอกสาร (สัญญาคือสิ่งที่ frontend/backend ยึด)

### 4.5 เพิ่ม method ใน `web/api.js`

```js
reject: (invoiceId, reason) => call("POST", "/v1/invoices/" + invoiceId + "/reject", { reason }),
```

วางใน object ที่ `return` (เรียงตาม endpoint ใน `docs/API.md`) — แค่นี้หน้าเว็บทุกหน้าเรียกใช้ได้
ไม่ต้องแก้ `fetch` เองที่ไหนอีก และ error จะถูกแปลงเป็น `Error` ที่มี `.code` ให้แล้ว

### 4.6 ต่อกับหน้าเว็บ

`owner.html` / `tenant.html` เรียกผ่าน `API.*` ในฟังก์ชัน `load()` หรือ handler ของปุ่ม
ใช้ pattern นี้ (เหมือน `owner.html:143-148`):

```js
document.getElementById('rejectBtn').onclick = async () => {
  const res = await API.reject(inv.id, 'ยอดไม่ตรง').catch(e => ({ error: e.message }));
  if (res.error) { alert(res.error); return; }
  await load();          // โหลดใหม่ทั้งหน้าเพื่อให้สถานะตรงกับ DB
};
```

หลังเขียนสำเร็จให้ `await load()` เสมอ — หน้าเว็บไม่มี state store ของตัวเอง

### 4.7 ตรวจว่าใช้งานได้

```bash
curl http://127.0.0.1:8777/v1/invoices?status=pending
curl -X POST http://127.0.0.1:8777/v1/invoices/1/reject -H "Content-Type: application/json" -d "{\"reason\":\"ยอดไม่ตรง\"}"
```

บน PowerShell 5.1 `curl` เป็น alias ของ `Invoke-WebRequest` (quoting ต่างจาก bash) — ใช้ `curl.exe`
หรือเขียนแบบนี้:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8777/v1/invoices/1/reject `
  -ContentType 'application/json' -Body '{"reason":"ยอดไม่ตรง"}'
```

เช็คเคสพังด้วย: id ที่ไม่มี → 404 `NOT_FOUND`, บิลที่สถานะผิด → 409 `INVALID_STATE`
(ข้อความ error เป็นไทยและต้องไม่ใช่ traceback)

### 4.8 เช็กลิสต์ก่อนถือว่าเสร็จ

| # | ต้องทำ | ไฟล์ |
|---|---|---|
| 1 | handler + `con.close()` ครบทุกทางออก | `api_v1.py` |
| 2 | regex (ถ้ามี `:id`) + branch ใน `handle()` | `api_v1.py` |
| 3 | เปลี่ยน ✅ / เพิ่มหัวข้อ endpoint | `docs/API.md` |
| 4 | method ใหม่ใน object `API` | `web/api.js` |
| 5 | ปุ่ม/หน้าจอที่เรียกใช้ + `await load()` | `web/*.html` |
| 6 | ถ้าเก็บข้อมูลใหม่ → แก้ `SCHEMA` **และ** `db/schema.sql` | `server.py`, `db/schema.sql` |
| 7 | ถ้าเป็นงานที่ backend ต้องทำต่อ → อัปเดตสถานะในตาราง | `docs/HANDOFF.md` |
| 8 | ยิง curl 2 เคส (สำเร็จ / พัง) | — |

### 4.9 เพิ่มหน้าเว็บใหม่

1. สร้าง `web/foo.html` โดยลอกโครง `<head>` จาก `owner.html` (charset, viewport, ฟอนต์, `/web/app.css`)
2. ใส่ `<script src="/web/api.js"></script>` ก่อน inline script
3. เพิ่ม branch ใน `server.py` `do_GET`:

```python
        elif path == "/foo":
            self._serve_static("/web/foo.html")
```

ไฟล์ใต้ `/web/` ถูกเสิร์ฟอัตโนมัติผ่าน `_serve_static` แต่ Content-Type รู้จักแค่ `.html`, `.css`, `.js`
(`server.py:313-317`) — ไฟล์ชนิดอื่นจะถูกส่งเป็น `text/html` ถ้าต้องใช้รูป/ฟอนต์ ให้เพิ่ม mapping ก่อน

---

## 5. ฐานข้อมูล: seed และ "migration"

### 5.1 ตอนสตาร์ทเกิดอะไรขึ้น

`python server.py` เรียกสองฟังก์ชันก่อนเปิดพอร์ต (`server.py:357-360`):

| ฟังก์ชัน | ทำอะไร | รันซ้ำแล้ว |
|---|---|---|
| `seed()` | `executescript(SCHEMA)` สร้าง 4 ตาราง (`IF NOT EXISTS`) แล้วถ้าตาราง `rooms` ว่าง จึง seed 42 ห้อง + มิเตอร์รอบ `2026-10` ทุกห้อง + รอบ `2026-11` 12 ห้องแรก | ไม่ทำอะไร (guard `SELECT COUNT(*) FROM rooms`) |
| `seed_overdue()` | ใส่บิลค้างจาก `MOCK_ARREARS` / `MOCK_UNITS` เป็นสถานะ `unpaid` | ไม่เพิ่มแถว (`INSERT OR IGNORE` + `UNIQUE(room_id, period)`) |

ผลที่ต้องจำ: **`seed()` ไม่ใช่ migration** — ถ้าแก้ `SCHEMA` (เพิ่มคอลัมน์/ตาราง) ฐานข้อมูลเดิมจะไม่เปลี่ยน
เพราะ `CREATE TABLE IF NOT EXISTS` ข้ามไป และ guard ของ `rooms` ก็กันไม่ให้ seed ใหม่

### 5.2 ไม่มี migration tool

รีโปนี้ไม่มี Alembic ไม่มี `migrations/` ไม่มีเลข version อะไรทั้งสิ้น (`HANDOFF.md:24` ระบุ Alembic
เป็นงานของ backend จริง) การเปลี่ยนโครง DB ทำได้สองทาง:

**ทางที่แนะนำระหว่างพัฒนา — ลบแล้ว seed ใหม่** (ข้อมูลทดสอบหายทั้งหมด แต่ได้ schema ใหม่สะอาด):

```powershell
# หยุด server ก่อน (Ctrl+C หรือปิดหน้าต่าง "PAKDEE server")
Remove-Item domplus.db
python server.py
```

**ทางที่เก็บข้อมูลเดิม — `ALTER TABLE` ตรง ๆ ด้วย stdlib** (ไม่มี `sqlite3` CLI ก็ทำได้):

```powershell
python -c "import sqlite3;c=sqlite3.connect('domplus.db');c.execute('ALTER TABLE rooms ADD COLUMN note TEXT');c.commit()"
```

ไม่ว่าทางไหน **ต้องแก้สองที่คู่กันเสมอ**: `SCHEMA` ใน `server.py:30-68` (SQLite ที่รันจริง) และ
`db/schema.sql` (Postgres ปลายทางที่ยังไม่มีใครรัน) — ทั้งสองไฟล์เป็นสำเนาของกันและกันโดยเจตนา
ถ้าแก้ข้างเดียว backend จะได้โครงที่ไม่ตรงกับ prototype

### 5.3 ข้อมูลเดโมถูกเขียนไว้สามที่

ตัวเลขชุดเดียวกัน (42 ห้อง, ค่าเช่า 3220, มิเตอร์ตั้งต้น, หนี้ค้าง 5 ห้อง) ปรากฏที่:

1. `seed()` + `MOCK_ARREARS` / `MOCK_UNITS` — `server.py`
2. `demoState()` / `demoPast()` — `prototype.html:278-338` (fallback ตอนเปิดหน้าโดยไม่มี server)
3. `README.md` / `docs/HANDOFF.md` (คำอธิบาย)

แก้ข้อมูลเดโมแล้วต้องตามให้ครบ ไม่งั้นหน้าเดโมจะโชว์คนละเลขกับ API

---

## 6. การแบ่งงานกับคนทำ backend

`server.py` คือ **reference implementation** — พฤติกรรมที่ถูกต้อง (คำนวณบิล, ลำดับสถานะ, กันบิลซ้ำ)
ดูจากไฟล์นี้ ไม่ใช่จาก UI หรือจาก `api_v1.py` ข้อนี้เขียนไว้ชัดใน `docs/HANDOFF.md:19`

| ฝั่งนี้ (prototype + frontend) | ฝั่ง backend |
|---|---|
| `server.py`, `api_v1.py`, `web/`, `prototype.html` | FastAPI ตาม `docs/API.md` |
| นิยามพฤติกรรม + ตัวเลขตั้งต้น | Postgres ตาม `db/schema.sql` + Alembic |
| `docs/API.md` (สัญญา) | worker/cron: `billing.run`, `notify.invoice`, `dunning`, `slip.verify` |
| หน้าเจ้าของ/ผู้เช่า + rich menu | auth LINE Login, webhook, ตรวจสลิป |

**กติกาการประสานงาน:**

- เปลี่ยนสัญญา → แก้ `docs/API.md` ก่อน แล้วค่อยแก้สองฝั่ง อย่าให้ frontend ต่อกับ endpoint
  ที่ไม่มีในเอกสาร
- ห้ามใส่ business rule ใหม่ลงใน UI (`owner.html:110-124` คำนวณยอดซ้ำเพื่อ preview เท่านั้น
  ยอดจริงมาจาก server) — ถ้า preview กับ server ไม่ตรง ถือว่า preview ผิด
- กติกาที่ `HANDOFF.md:33-42` ห้ามละเมิด: `UNIQUE(room_id, period)` ที่ DB, กรอง `property_id`
  จาก session ทุก query, งานในคิวต้อง idempotent, `paid` แก้ไม่ได้, **ไม่คิดค่าปรับ**
- เกณฑ์ "เสร็จ" 7 ข้ออยู่ที่ `HANDOFF.md:51-59` — ใช้เป็น acceptance test แทนชุดทดสอบที่ยังไม่มี
- ของที่ต้องขอจากเจ้าของโปรเจกต์ (LINE channel, SlipOK, โดเมน LIFF, สิทธิ์ hosting) อยู่ที่
  `HANDOFF.md:73-78`

---

## 7. Git workflow

- **remote:** `origin` = `https://github.com/WinTuner/domplus-prototype.git`
- **branch หลัก:** `master` (local track `origin/master`) — บน remote ยังมี `origin/main` ค้างอยู่
  จากชื่อเดิม อย่าใช้เป็นฐานงานใหม่
- ทำงานบน `master` ตรง ๆ ตามที่ผ่านมา ไม่มี branching model ที่ประกาศไว้; ถ้าจะทำ branch เอง
  ตั้งชื่อสั้น ๆ ตามสิ่งที่ทำ (เช่น `fix/reject-endpoint`) แล้ว merge กลับ
- **ข้อความ commit:** อังกฤษ, ขึ้นต้นด้วยคำกริยา (imperative), ตัวแรก capital, ไม่มี prefix
  แบบ conventional commits และไม่มีเลข issue ตัวอย่างจากประวัติจริง:

```
Add frontend web app (owner + tenant) and v1 API adapter
Add API contract, backend handoff doc and Postgres schema
Rename to DormPlus; refresh README and database file name
```

- หนึ่ง commit = หนึ่งเรื่องที่ปิดจบได้ (feature + เอกสารของมันอยู่ด้วยกัน) — ประวัติมี 7 commit
  สำหรับงานทั้งโปรเจกต์ จึงค่อนข้างหยาบ ไม่ต้องย่อยกว่านี้ถ้าไม่จำเป็น
- **ห้าม commit:** `domplus.db`, `pakdee.db`, `__pycache__/`, `*.pyc` (อยู่ใน `.gitignore` แล้ว
  แต่เช็ค `git status` ก่อน `git add` ทุกครั้ง — ไฟล์ DB หลุดเข้าไปแล้วจะ revert ยาก)
- **commit ได้:** เอกสารและภาพหน้าจอใน `docs/` (`.png` ถูก track อยู่จริง) และ `start-prototype.bat`
- รีโปไม่มี `.gitattributes` — บน Windows จะเห็น warning `LF will be replaced by CRLF` ตอน `git add`
  เป็นเรื่องปกติของรีโปนี้ ไม่ต้องแก้
- ไม่มี PR template, ไม่มี CI, ไม่มี `CODEOWNERS` — การรีวิวเป็นเรื่องตกลงกันเองในทีม
  <!-- VERIFY: ไม่มี branch protection หรือกฎรีวิวในรีโป (ตรวจจากไฟล์ใน repo ไม่ได้) — ต้องถามเจ้าของ repo บน GitHub -->
- อย่าแก้ `docs/HANDOFF.md` แบบลบงานที่ยังไม่เสร็จ ให้เปลี่ยนสถานะ/เพิ่มหมายเหตุแทน
  เพราะเอกสารนี้เป็นสิ่งที่ใช้ส่งมอบ

---

## 8. Shortcuts ที่รู้อยู่แล้ว (อย่าเผลอไปพึ่ง)

ทั้งหมดนี้เป็นข้อจำกัดที่ตั้งใจไว้ของเดโม ไม่ใช่ bug ที่ต้องรีบแก้ — แต่ต้องรู้ก่อนต่อยอด

| # | เรื่อง | ที่อยู่ | ผลกระทบ |
|---|---|---|---|
| 1 | รอบก่อนหน้าฮาร์ดโค้ดเป็น `'2026-10'` | `server.py:194`, `api_v1.py:48` | ขึ้นเดือนใหม่แล้วค่า "ครั้งก่อน" จะผิด ต้องแก้ทั้งสองที่ |
| 2 | `PERIOD` = `"2026-11"`, `TODAY` = `2026-11-04` | `server.py:15-16` | ไม่ใช่เวลาจริง `due_date` จึงคงที่ |
| 3 | `days_overdue` ใช้ `date.today()` ไม่ใช้ `TODAY` | `api_v1.py:79` | สอง surface ให้เลขค้างวันไม่ตรงกัน |
| 4 | `POST /v1/billing/run` ไม่สนใจ `period` ใน body และตอบ `200 {ok, billed}` | `api_v1.py:146-147` | สัญญาเขียน `202 {job_id, rooms_to_bill, skipped_no_reading}` — `owner.html:147` รองรับทั้งสองแบบไว้แล้ว |
| 5 | `GET /v1/invoices?period=` ถูกละเลย (ใช้แค่ `status`) | `api_v1.py:149` | ดึงย้อนหลังไม่ได้ |
| 6 | `GET /v1/reports/summary?period=` ถูกละเลย | `api_v1.py:154` | ใช้ `PERIOD` เสมอ |
| 7 | logic ซ้ำสองชุด: `server.save_reading/pay/confirm` กับ `api_v1.save_reading/slip/confirm` | ทั้งสองไฟล์ | แก้ข้างเดียวแล้วพฤติกรรมสอง surface จะต่างกัน (เช่น guard สถานะมีเฉพาะ `api_v1`) |
| 8 | `import server` จากใน `api_v1` ทำให้มีสอง module object ในโปรเซสเดียว | `api_v1.py:11`, `server.py:293` | แชร์ state กันได้ทางไฟล์ DB เท่านั้น อย่าหวังให้ตัวแปร global ตรงกัน |
| 9 | ข้อมูลเดโมซ้ำสามที่ | `server.py`, `prototype.html:278-338` | แก้ไม่ครบแล้วตัวเลขไม่ตรงกัน |
| 10 | `RENT_FLAT` ประกาศแต่ไม่ถูกใช้ | `server.py:17` | ห้องเหมายังไม่มีใน seed |
| 11 | ไม่มี auth/session ใด ๆ, id จาก URL ไม่ถูกตรวจเจ้าของ | ทั้งโปรเจกต์ | ใครเรียกก็แก้บิลใครก็ได้; `/tenant` เลือกบิลแรกที่ยังไม่จ่ายของทุกห้อง |
| 12 | ไม่มี handler สำหรับ DELETE/PATCH | `server.py` | endpoint ที่ต้องใช้ method พวกนี้ต้องเพิ่ม method handler เอง |
| 13 | `_serve_static` เช็ค path ด้วย `startswith(BASE)` และรู้จัก Content-Type แค่ `.html/.css/.js` | `server.py:307-319` | ไม่ใช่ path guard ที่แข็ง และไฟล์อื่นจะถูกส่งเป็น `text/html` |
| 14 | GET `/v1/*` ส่ง payload `{}` เสมอ | `server.py:294` | endpoint GET ที่ต้องใช้ body ต้องเปลี่ยนวิธี route |
| 15 | ไม่มี linter/test/CI แม้จะมีคอมเมนต์ `# noqa` | `server.py:350` | `# noqa` ไม่มีผลกับอะไร เป็นแค่บันทึกความตั้งใจ |
| 16 | `start-prototype.bat` ยังใช้ชื่อ "PAKDEE" ในข้อความ | `start-prototype.bat` | แค่ข้อความ ไม่กระทบการทำงาน |

---

## 9. เอกสารที่เกี่ยวข้อง

- [`../README.md`](../README.md) — ภาพรวม, วิธีรัน, แก้ปัญหาเบื้องต้น
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — องค์ประกอบระบบ, data flow, data model, trust boundary
- [`CONFIGURATION.md`](CONFIGURATION.md) — ค่าคงที่ทุกตัวอยู่บรรทัดไหน และต้องเปลี่ยนอะไรที่ไหน
- [`API.md`](API.md) — สัญญา API, error code, state machine
- [`HANDOFF.md`](HANDOFF.md) — งานที่เหลือของ backend, กติกาที่ห้ามพลาด, เกณฑ์เสร็จ
- [`../db/schema.sql`](../db/schema.sql) — โครง Postgres ปลายทาง
