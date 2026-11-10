<!-- generated-by: gsd-doc-writer -->
# DomPlus — Testing

**สถานะ: ยังไม่มีชุดทดสอบอัตโนมัติแม้แต่ตัวเดียว** ไม่มี `pytest`, ไม่มี `unittest`, ไม่มีไฟล์ `test_*.py`,
ไม่มี `requirements.txt` / `pyproject.toml`, ไม่มี CI (ไม่มีโฟลเดอร์ `.github/`)
และการตรวจสอบทั้งหมดที่ทำได้วันนี้คือ **ยิง request เอง + กดดูหน้าเว็บเอง**

เอกสารนี้จึงแบ่งเป็น 3 ส่วน: สถานะจริง (หัวข้อ 1), ตารางทดสอบด้วยมือที่ควรทำทุกครั้งที่แก้บิล/สถานะ (หัวข้อ 3-4),
และชุดทดสอบอัตโนมัติชุดแรกที่ควรเขียนเมื่อ backend จริงเกิดขึ้น (หัวข้อ 6)

ค่าที่อ้างในเอกสารนี้วัดจาก seed สด ๆ (`python server.py` บน `domplus.db` ที่ลบใหม่) — ถ้าฐานข้อมูลคุณผ่านการกดมาแล้ว
ตัวเลขจะต่างจากนี้ ให้ยึด **สูตรและ invariant** ที่ระบุไว้ ไม่ใช่ตัวเลขดิบ

---

## 1. สถานะปัจจุบัน

| สิ่งที่ควรมี | สถานะ | หลักฐาน |
|---|---|---|
| Test runner (`pytest` / `unittest`) | ❌ ไม่มี | ไม่มีไฟล์ทดสอบและไม่มี config ใด ๆ |
| ติดตั้ง `pytest` ในเครื่อง | ❌ ไม่มี | `python -m pytest --version` → `No module named pytest` |
| FastAPI / httpx (สำหรับ `TestClient`) | ❌ ไม่มี | `find_spec` คืน `False` ทั้งคู่ |
| CI ที่รันเทสต์ | ❌ ไม่มี | ไม่มี `.github/workflows/` |
| Fixture ฐานข้อมูลแยกสำหรับทดสอบ | ❌ ไม่มี | `DB` ฝังใน `server.py` ชี้ `domplus.db` ไฟล์เดียว |
| การตรวจสอบด้วยมือ | ✅ นี่คือสิ่งเดียวที่มี | `curl` / `Invoke-RestMethod` + คลิก `/owner`, `/tenant`, `/` |

ผลที่ตามมา: **ทุกการแก้ `server.py` หรือ `api_v1.py` วันนี้ไม่มีอะไรกัน regression ได้เลย** ยกเว้นคนกดดูเอง
ถ้าจะเปลี่ยนตัวเลขบิล สถานะ หรือกันบิลซ้ำ ต้องไล่ทำหัวข้อ 3 ให้ครบก่อน merge

> `docs/HANDOFF.md` หัวข้อ 5 คือเกณฑ์ "เสร็จ" ของ backend จริง — ในนั้นมีข้อที่ **ยังทดสอบไม่ได้วันนี้** เช่น
> "ออกบิลซ้ำ → 409" และ "หอ A ด้วย session หอ B → 403" เพราะ adapter ตอบ `200` และยังไม่มี auth (ดูหัวข้อ 5.2, 5.6)

---

## 2. เตรียมเครื่องก่อนทดสอบด้วยมือ

```powershell
# 1. หยุดเซิร์ฟเวอร์ที่ค้างอยู่ (ปิดหน้าต่าง "PAKDEE server" หรือ)
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. เริ่มจากฐานข้อมูลสะอาด — seed จะสร้าง 42 ห้องใหม่ให้เอง
Remove-Item domplus.db -ErrorAction SilentlyContinue

# 3. สตาร์ท
python server.py
```

เปิดอีกหน้าต่างหนึ่งสำหรับยิง request:

```powershell
$BASE = "http://127.0.0.1:8777"
```

**ถ้าใช้ bash / macOS / Linux** ใช้ `curl` แทนได้ทุกหัวข้อ (`BASE` ชุดเดียวกัน):

```bash
BASE=http://127.0.0.1:8777
curl -s "$BASE/v1/rooms?period=2026-11"
```

> ⚠️ บน Windows PowerShell 5.1 **อย่าใช้ `curl` กับ `-d '{"...":"..."}'`** — PowerShell จะกินเครื่องหมายคำพูด
> แล้วเซิร์ฟเวอร์ตอบ `400 VALIDATION "invalid JSON body"` ทั้งที่คำสั่งดูถูก ใช้ `Invoke-RestMethod` ตามตัวอย่าง
> หรือ `curl.exe` ใน `cmd.exe`
>
> ถ้าข้อความไทยใน response ขึ้นเป็น `?` — เป็น codepage ของ console ไม่ใช่ response ผิด

### สภาพตั้งต้นของ seed (ใช้เทียบผล)

| อย่าง | ค่า |
|---|---|
| ห้อง | 42 ห้อง (`201`–`212`, `301`–`312`, `401`–`410`, `501`–`508`) — id 1–42 ตามลำดับ `room_no` |
| มิเตอร์รอบ `2026-11` | จดไว้แล้ว **12 ห้องแรก**: ห้อง 201 = น้ำ 113→118 (5 หน่วย), ไฟ 541→572 (31 หน่วย) |
| บิลค้างจำลอง | 9 ใบจาก `MOCK_ARREARS` (ห้อง 203, 305, 312, 407, 502) รอบ `2026-08`/`09`/`10` |
| หลัง `POST /v1/billing/run` ครั้งแรก | เกิดบิลรอบ `2026-11` **12 ใบ** (id 10–21), ใบละ **3562 บาท** |
| บิลค้าง 9 ใบ | `unpaid` ทั้งหมด และ **ไม่ถูกนับใน summary** (คนละ period) |

สูตรที่ต้องจำ: `total = rent + water_units × 25 + elec_units × 7` โดย `*_units = max(0, now − prev)`
ห้อง 201: `3220 + 5×25 + 31×7 = 3220 + 125 + 217 = 3562` · ครบกำหนด = `TODAY + 5 วัน` = `2026-11-09`

---

## 3. ตารางทดสอบด้วยมือ (ทำทุกครั้งที่แตะบิล/สถานะ)

| # | กรณี | คำขอ | ผลที่ต้องได้ | วัดได้วันนี้ |
|---|---|---|---|---|
| T1 | คำนวณบิลถูก | `POST /v1/billing/run` แล้ว `GET /v1/rooms` | total = rent + หน่วย×เรต ตามสูตร | ✅ |
| T2 | จดมิเตอร์ซ้ำทับค่าเดิมได้ | `PUT /v1/rooms/1/reading` สองครั้ง | แถวเดิมถูก overwrite, `prev` ไม่เปลี่ยน, หน่วยคิดใหม่ | ✅ |
| T3 | มิเตอร์ถอยหลัง | `PUT` ด้วยค่าน้อยกว่าครั้งก่อน | `warning = "METER_DECREASED"`, หน่วย clamp 0, **ไม่ block** | ✅ |
| T4 | ออกบิลซ้ำ | `POST /v1/billing/run` สองครั้ง | **ไม่มีบิลเพิ่ม** (จำนวนแถวคงที่) | ✅ แต่ตอบ `200` ไม่ใช่ `409` — ดู 5.2 |
| T5 | แก้มิเตอร์หลังออกบิล | `PUT` reading หลัง billing | บิลที่ออกแล้ว **ไม่เปลี่ยนยอด** | ✅ |
| T6 | แนบสลิป | `POST /v1/invoices/10/slip` | `200`, สถานะ `pending`, `verify.ok = null` | ✅ |
| T7 | แนบสลิปซ้ำ / ยืนยันผิดลำดับ | slip ซ้ำ, confirm ตอน `unpaid` | `409 INVALID_STATE`, ไม่เขียน DB | ✅ |
| T8 | ยืนยันการชำระ | `POST /v1/invoices/10/confirm` | `200`, `paid` + `receipt_no = REC-2026-11-0010` | ✅ |
| T9 | ยอดสรุปสอดคล้อง | `GET /v1/reports/summary` | `paid + pending + unpaid == billed` | ✅ |
| T10 | resource ไม่มีจริง | `POST /v1/invoices/9999/slip` | `404 NOT_FOUND` | ✅ |
| T11 | tenant isolation | ขอข้อมูลหออื่นด้วย session หอตัวเอง | `403 FORBIDDEN` | ❌ **ทดสอบไม่ได้** — ยังไม่มี auth (5.6) |
| T12 | โหมดเหมา (flat) | ห้อง `billing_mode='flat'` | total = rent เท่านั้น, หน่วย = 0 | ❌ **ทดสอบผ่าน API ไม่ได้** — seed ไม่มีห้อง flat (5.4) |

---

## 4. คำขอจริงต่อกรณี (copy-paste ได้)

ทำตามลำดับ T1 → T10 ในหน้าต่างเดียว เพราะสถานะบิลต่อเนื่องกัน (T6-T8 ใช้บิล id 10)

### T1 · ออกบิลทั้งหอ + ตรวจส่วนประกอบบิล

```powershell
Invoke-RestMethod -Method Post -Uri "$BASE/v1/billing/run" -ContentType "application/json" -Body '{}'

# ตรวจว่ายอดตรงสูตร: เอา reading ของห้อง 201 มาคิดเอง
$r = (Invoke-RestMethod "$BASE/v1/rooms?period=2026-11").items[0]
$unitsW = [Math]::Max(0, $r.reading.water_now - $r.reading.water_prev)
$unitsE = [Math]::Max(0, $r.reading.elec_now  - $r.reading.elec_prev)
$expect = $r.rent + $unitsW * 25 + $unitsE * 7
"คาดหวัง $expect / ได้ $($r.invoice.total)"
```

ผลที่ต้องได้: `{"ok": true, "billed": 12}` และ `คาดหวัง 3562 / ได้ 3562`

> `billed` = **จำนวนห้องที่มี reading** ไม่ใช่จำนวนบิลที่สร้างใหม่ — รันซ้ำจะยังได้ `12` (ดู 5.1)

### T2 · จดมิเตอร์ซ้ำ (UPSERT)

```powershell
Invoke-RestMethod -Method Put -Uri "$BASE/v1/rooms/1/reading" -ContentType "application/json" `
  -Body '{"period":"2026-11","water_now":118,"elec_now":572}'   # 5 / 31
Invoke-RestMethod -Method Put -Uri "$BASE/v1/rooms/1/reading" -ContentType "application/json" `
  -Body '{"period":"2026-11","water_now":120,"elec_now":600}'   # 7 / 59
```

ต้องได้ `{"water_units":5,"elec_units":31,...}` แล้ว `{"water_units":7,"elec_units":59,...}`
และ **ไม่มีแถว reading เพิ่ม** (`UNIQUE(room_id, period)` + `ON CONFLICT DO UPDATE`) — `water_prev` ยังเป็น 113

### T3 · มิเตอร์ถอยหลัง

```powershell
Invoke-RestMethod -Method Put -Uri "$BASE/v1/rooms/1/reading" -ContentType "application/json" `
  -Body '{"period":"2026-11","water_now":110,"elec_now":590}'
```

ต้องได้ `{"water_units":0,"elec_units":49,"warning":"METER_DECREASED"}`
— น้ำถอยหลังจึงได้ 0 หน่วย (clamp) แต่ **ยังบันทึกค่า** ระบบไม่บล็อก (ตามดีไซน์: ให้เจ้าของเห็นแล้วตัดสินใจ)

### T4 · ออกบิลซ้ำ (กันบิลซ้ำ)

```powershell
# นับบิลก่อน
$before = (Invoke-RestMethod "$BASE/v1/invoices").items.Count
Invoke-RestMethod -Method Post -Uri "$BASE/v1/billing/run" -ContentType "application/json" -Body '{}'
$after = (Invoke-RestMethod "$BASE/v1/invoices").items.Count
"ก่อน $before / หลัง $after"
```

ต้องได้ `ก่อน 12 / หลัง 12` → **ไม่มีบิลซ้ำ**
ข้อควรรู้: response เป็น `{"ok": true, "billed": 12}` (HTTP `200`) ไม่ใช่ `409` ตามที่ `docs/HANDOFF.md` กำหนด
ดูคำอธิบายที่ 5.2

### T5 · แก้มิเตอร์หลังออกบิลแล้ว

```powershell
Invoke-RestMethod -Method Put -Uri "$BASE/v1/rooms/1/reading" -ContentType "application/json" `
  -Body '{"period":"2026-11","water_now":200,"elec_now":700}'
(Invoke-RestMethod "$BASE/v1/rooms?period=2026-11").items[0].invoice.total
```

ต้องได้ `3562` — บิลเก็บ `rent`/`water_units`/`elec_*_rate` ไว้ในแถวตัวเองแล้ว
การแก้ reading ภายหลัง **ต้องไม่ย้อนไปแก้บิลที่ออกแล้ว** (ถ้าเปลี่ยน แปลว่ามีคนไป join สดแทนการใช้ค่าที่เก็บไว้)

### T6 · แนบสลิป → `pending`

```powershell
Invoke-RestMethod -Method Post -Uri "$BASE/v1/invoices/10/slip" -ContentType "application/json" `
  -Body '{"slip_url":"s3://slips/201-1109.jpg"}'
```

ต้องได้ `{"status":"pending","verify":{"ok":null,"amount":3562,"provider":"manual"}}`
`verify.ok = null` คือค่าที่ถูกต้องของ prototype (ตรวจสลิปเป็น manual) — **อย่าเพิ่งถือว่าเป็น bug**

### T7 · สลิปซ้ำ และยืนยันผิดลำดับ → `409`

```powershell
function Show-Error($block) {
  try { & $block }
  catch { "HTTP " + [int]$_.Exception.Response.StatusCode + " " + $_.ErrorDetails.Message }
}

Show-Error { Invoke-RestMethod -Method Post -Uri "$BASE/v1/invoices/10/slip" -ContentType "application/json" -Body '{}' }
# → 409 {"error":{"code":"INVALID_STATE","message":"บิลนี้อยู่สถานะ pending แนบสลิปซ้ำไม่ได้"}}

Show-Error { Invoke-RestMethod -Method Post -Uri "$BASE/v1/invoices/11/confirm" -ContentType "application/json" -Body '{}' }
# → 409 {"error":{"code":"INVALID_STATE","message":"บิลนี้อยู่สถานะ unpaid ยืนยันไม่ได้"}}
```

ทั้งสองกรณี **ห้ามมีการเขียน DB** — ตรวจซ้ำได้ด้วย `GET /v1/invoices?status=pending` (ต้องมีใบเดียวคือ id 10)
และ `?status=paid` (ต้องว่าง)

### T8 · ยืนยันการชำระ → `paid` + ใบเสร็จ

```powershell
Invoke-RestMethod -Method Post -Uri "$BASE/v1/invoices/10/confirm" -ContentType "application/json" -Body '{}'
# → {"status":"paid","receipt_no":"REC-2026-11-0010"}

Show-Error { Invoke-RestMethod -Method Post -Uri "$BASE/v1/invoices/10/confirm" -ContentType "application/json" -Body '{}' }
# → 409 "บิลนี้อยู่สถานะ paid ยืนยันไม่ได้"
Show-Error { Invoke-RestMethod -Method Post -Uri "$BASE/v1/invoices/10/slip" -ContentType "application/json" -Body '{}' }
# → 409 "บิลนี้อยู่สถานะ paid แนบสลิปซ้ำไม่ได้"
```

`receipt_no` ต้องตรงรูปแบบ `REC-{PERIOD}-{id:04d}` (id 10 → `0010`)

### T9 · ยอดสรุปต้องบวกกันลงตัว

```powershell
$s = Invoke-RestMethod "$BASE/v1/reports/summary"
$s | ConvertTo-Json
"identity: " + ($s.paid + $s.pending + $s.unpaid -eq $s.billed)
```

ต้องได้ `identity: True` และ `invoices == 12` — ตัวเลขจริงหลังทำ T1-T8 ครบ: `billed 42744 / paid 3562 / pending 0 / unpaid 39182`
(บิลค้าง 9 ใบคนละ period จึงไม่ถูกนับ — ถูกต้องตามดีไซน์)

### T10 · 404

```powershell
Show-Error { Invoke-RestMethod -Method Post -Uri "$BASE/v1/invoices/9999/slip" -ContentType "application/json" -Body '{}' }
# → 404 {"error":{"code":"NOT_FOUND","message":"ไม่พบบิล"}}

Show-Error { Invoke-RestMethod "$BASE/v1/nope" }
# → 404 {"error":{"code":"NOT_FOUND","message":"/v1/nope"}}
```

`404` ต้องมาก่อนการตรวจสถานะเสมอ (บิลไม่มีจริง ≠ บิลสถานะผิด)

---

## 5. กับดักที่ทำให้ "ทดสอบผ่าน" ทั้งที่ระบบผิด

ทั้ง 6 ข้อนี้ทดสอบยืนยันแล้วบน seed สด — เป็นจุดที่คนใหม่จะเข้าใจผิดบ่อยที่สุด

### 5.1 `billed` นับเกินเมื่อรันซ้ำ
`make_bills()` เพิ่ม `made` ให้ทุกห้องที่มี reading **ก่อน** ที่ `INSERT ... ON CONFLICT DO NOTHING` จะตัดสินใจ
จึงตอบ `{"billed": 12}` ทุกครั้งแม้สร้างจริง 0 ใบ **ห้ามใช้ `billed` เป็นหลักฐานว่ามีบิลใหม่** — ให้นับแถวจาก `GET /v1/invoices`

### 5.2 ออกบิลซ้ำตอบ `200` ไม่ใช่ `409`
`docs/HANDOFF.md` ข้อ 5 เขียนว่า "กดออกบิลซ้ำ → 409" แต่ adapter วันนี้กลืนเงียบแล้วตอบ `200`
การกันซ้ำเกิดที่ **DB** (`UNIQUE(room_id, period)`) ซึ่งถูกต้อง — แต่สัญญา HTTP ยังไม่ตรง
เทสต์ `409` ตัวนี้ต้องรอ backend จริง (ระบุในหัวข้อ 6) อย่าเพิ่งเขียนเทสต์ที่ assert `200` เพราะจะล็อกพฤติกรรมผิดไว้

### 5.3 `?period=` ถูกเมินในบาง endpoint
- `GET /v1/rooms?period=2026-10` → ใช้จริง (ได้ reading รอบ ต.ค.)
- `GET /v1/invoices?period=2026-10` → **เมิน** ตอบบิล พ.ย. เสมอ
- `GET /v1/reports/summary?period=2026-10` → **เมิน** เช่นกัน

ดังนั้นการทดสอบ "ดูข้อมูลรอบก่อน" ผ่าน `/v1/invoices` จะเห็นข้อมูลผิดรอบโดยไม่รู้ตัว

### 5.4 โหมดเหมา (flat) ยังทดสอบผ่าน API ไม่ได้
seed สร้างทุกห้องเป็น `meter` (`RENT_FLAT` ประกาศไว้แต่ไม่ถูกใช้) จึงไม่มีทางเรียกเส้นทาง `flat` ใน `make_bills()` ได้
ถ้าต้องทดสอบ ให้แก้ `rooms.billing_mode` ตรงใน DB ก่อน:

```powershell
python -c "import sqlite3; c=sqlite3.connect('domplus.db'); c.execute(\"update rooms set billing_mode='flat' where id=1\"); c.commit()"
```

แล้วค่อย `POST /v1/billing/run` บน DB ที่ยังไม่มีบิลรอบนี้ (ต้องลบ `domplus.db` แล้ว seed ใหม่ หรือใช้ห้องที่ยังไม่มีบิล)
ผลที่ต้องได้: total = `rent` เท่านั้น, `water_units = elec_units = 0`

### 5.5 request ที่พังจะล็อกฐานข้อมูลทั้งไฟล์
ยิง `PUT /v1/rooms/9999/reading` (ห้องไม่มีจริง) หรือ `PUT` ที่ขาด `water_now` → `api_v1.save_reading` โยน exception
โดยไม่ `close()` connection → connection ที่ค้างถือ write lock ไว้ → **ทุก write หลังจากนั้นล้มด้วย `database is locked`**
และฝั่ง client เห็นเป็น connection ถูกตัด (ไม่มี HTTP response)

อาการที่เจอ: `sqlite3.IntegrityError: FOREIGN KEY constraint failed` ตามด้วย `OperationalError: database is locked`
ทุก request ถัดไป วิธีแก้ระหว่างทดสอบ: **รีสตาร์ทเซิร์ฟเวอร์** (ปิด process แล้ว `python server.py` ใหม่)
นี่คือ bug จริง ไม่ใช่ปัญหาสภาพแวดล้อม — ควรมีเทสต์คุม (หัวข้อ 6 ข้อ 7)

### 5.6 tenant isolation ทดสอบไม่ได้จนกว่าจะมี auth
วันนี้ `handle()` ไม่ตรวจ header/cookie ใด ๆ และ query ทุกตัวไม่กรอง `property_id`
(`db/schema.sql` มีคอลัมน์ `properties` + เปิด RLS ไว้แล้ว แต่ adapter ยังไม่ใช้)
แปลว่า **ทุก request เปิดได้ทั้งหมด** — จะทดสอบ `403` ตอนนี้ไม่ได้เลย

เมื่อ backend จริงมามี auth แล้ว สิ่งที่ต้องพิสูจน์คือ:
1. login เป็นเจ้าของหอ A → `GET /v1/invoices` เห็นเฉพาะบิลของ A
2. ใช้ session ของ A เรียก `/v1/rooms/:id/reading` ของห้องในหอ B → `403 FORBIDDEN` (ไม่ใช่ `404`, ไม่ใช่ `200`)
3. `property_id` ต้องมาจาก session **เท่านั้น** — ถ้า client ส่ง `?property_id=` มา ต้องไม่มีผล

### 5.7 `/api/*` (หน้า `/`) กับ `/v1/*` คนละพฤติกรรม
`prototype.html` ใช้ `/api/pay`, `/api/confirm` ซึ่ง **ข้ามใบที่สถานะไม่ตรงแบบเงียบ ๆ** แล้วตอบ `200 {"paid": 0}`
ในขณะที่ `/v1/invoices/:id/confirm` ตอบ `409`
ถ้าทดสอบผ่านหน้า `/` แล้วเห็น "ไม่มีอะไรเกิดขึ้น" นั่นคือ no-op ไม่ใช่ error — ให้ยิง `/v1` เพื่อยืนยันสถานะจริง

---

## 6. ชุดทดสอบอัตโนมัติชุดแรก (ยังไม่มี — ข้อเสนอ)

**เขียนตอนนี้ยังไม่ได้ประโยชน์** เพราะ `pytest`/`fastapi` ยังไม่ถูกติดตั้ง และ `TestClient` ต้องมี app จริง
แต่โครงที่ควรได้คือ: เทสต์ยิง `/v1` ผ่าน `TestClient` บน **SQLite แยกไฟล์ต่อเทสต์** (ไม่แตะ `domplus.db` ของจริง)
โดย `server.PERIOD` / `TODAY` ถูก freeze ไว้

### ติดตั้งและโครงไฟล์

```bash
pip install pytest fastapi httpx
```

```
tests/
  conftest.py          # tmp db + seed + client fixture (freeze PERIOD/TODAY)
  test_billing.py      # 1, 3, 4
  test_readings.py     # 5, 6, 7
  test_payments.py     # 8
  test_isolation.py    # 2
```

`conftest.py` ต้องชี้ `server.DB` ไปไฟล์ชั่วคราวต่อเทสต์ แล้วเรียก `seed()` — **ห้ามให้เทสต์แตะ `domplus.db`**
(`domplus.db` อยู่ใน `.gitignore` แต่ยังเป็นข้อมูลที่คนใช้กดเล่นอยู่)

### 8 เทสต์ที่คุ้มที่สุด (เรียงตามความเสียหายถ้าพลาด)

| # | ชื่อเทสต์ | assert อะไร |
|---|---|---|
| 1 | `test_invoice_total_equals_rent_plus_units_times_rates` | `total == rent + units_w*25 + units_e*7` สำหรับห้องที่มี reading 5/31 → `3562` |
| 2 | `test_other_property_session_cannot_read_room` | session หอ B ขอห้องหอ A → `403` (ปิดช่องข้ามหอ — ความเสี่ยงร้ายแรงที่สุด) |
| 3 | `test_billing_run_duplicate_returns_409_and_creates_no_rows` | รันสองครั้ง → ครั้งที่สอง `409` และ `COUNT(invoices)` เท่าเดิม (**วันนี้ยัง fail** — คือเป้าหมายของ backend) |
| 4 | `test_billing_run_bills_only_rooms_with_reading` | 42 ห้อง มี reading 12 → สร้าง 12 ใบ, ห้องไม่มี reading ไม่ถูกออกบิล |
| 5 | `test_reading_upsert_overwrites_and_keeps_previous_period` | `PUT` สองครั้ง → 1 แถว, `water_prev` เดิม, หน่วยคิดใหม่ |
| 6 | `test_meter_decrease_warns_and_clamps_units_to_zero` | `now < prev` → `warning == "METER_DECREASED"` และ `units == 0` (ยังบันทึกค่า) |
| 7 | `test_reading_for_unknown_room_returns_404_and_keeps_db_writable` | `404` (ไม่ใช่ connection ขาด) และ request เขียนถัดไปยังสำเร็จ — คุม bug 5.5 |
| 8 | `test_payment_state_machine_slip_then_confirm` | `slip` → `pending`; `slip` ซ้ำ → `409`; `confirm` ตอน `unpaid` → `409`; `confirm` → `paid` + `receipt_no`; `confirm` ซ้ำ → `409` |

เพิ่มเติมเมื่อมีเวลา (ยังไม่ต้องทำก่อน): `test_summary_is_consistent` (`paid+pending+unpaid == billed`),
`test_billing_run_rolls_back_on_failure` (เกณฑ์ rollback ใน `docs/HANDOFF.md`),
`test_flat_room_billed_rent_only` (ปิดช่อง 5.4)

### ข้อตกลงเวลาเขียนเทสต์

- **freeze เวลา**: `TODAY = date(2026, 11, 4)` และ `due_date` ต้องเป็น `2026-11-09` — อย่าใช้ `date.today()`
  (ตอนนี้ `api_v1.invoices_payload` ใช้ `date.today()` จริง ขณะที่ `server.TODAY` เป็นค่าคงที่ → `days_overdue` ไม่ตรงกัน)
- **assert ที่ DB ไม่ใช่แค่ response**: หลาย bug ข้างบน (5.1, 5.5) ตอบ HTTP ดูปกติแต่ข้อมูลผิด
- **ห้าม assert `billed`** เป็นจำนวนบิลใหม่ (5.1)

---

## 7. ที่ยังไม่มี และควรรู้

| ช่องว่าง | ผลต่อการทดสอบ |
|---|---|
| ไม่มีเทสต์ frontend | `/owner`, `/tenant`, `prototype.html` ตรวจได้ด้วยตาเท่านั้น |
| ไม่มี `/healthz` | ตรวจว่าเซิร์ฟเวอร์ยังมีชีวิตต้องยิง endpoint จริง |
| ไม่มี log การเปลี่ยนสถานะ | ไล่ประวัติว่าใครเปลี่ยนสถานะเมื่อไรไม่ได้ (`db/schema.sql` มี `audit_log` แต่ adapter ไม่เขียน) |
| ไม่มี `reject` (`pending → unpaid`) | หน้า `/` มีปุ่ม "ไม่ตรง" แต่ยิงแค่ `alert()` — ทดสอบไม่ได้ |
| `api_v1.py` เป็น adapter ไม่ใช่ backend | เทสต์ที่เขียนกับ adapter จะต้องเขียนใหม่เมื่อเป็น FastAPI — แต่เทสต์ที่ยิงผ่าน HTTP (TestClient) จะพอร์ตได้เกือบทั้งหมด |

---

## เอกสารที่เกี่ยวข้อง

- [`API.md`](API.md) — response จริงของทุก endpoint + ตาราง "สัญญา vs adapter" + ตัวอย่าง curl
- [`HANDOFF.md`](HANDOFF.md) — เกณฑ์ "เสร็จ" ของ backend (หัวข้อ 5) ซึ่งเป็นที่มาของเทสต์ชุดนี้
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — โครงระบบและจุดที่ state อยู่ (`domplus.db`)
- [`CONFIGURATION.md`](CONFIGURATION.md) — ค่าที่ต้อง freeze ตอนทดสอบ (`PERIOD`, `TODAY`, เรต, พอร์ต)
- [`../db/schema.sql`](../db/schema.sql) — constraint ที่เทสต์ระดับ DB ต้องคุม (`UNIQUE(room_id, period)` ฯลฯ)
