# Test case ตาม Use Case (TEST-CASES)

เอกสารนี้แตก **use case ในแผนภาพ UML ของทีม** เป็น test case ทีละข้อ แต่ละข้อบอกว่า ทดสอบอะไร ต้องเตรียมอะไร ทำอย่างไร ผลที่คาดคืออะไร และ **ใครเป็นคนตรวจ** (test อัตโนมัติข้อไหน หรือต้องกดมือ หรือยังไม่ได้สร้าง) เพื่อให้เห็นว่าแต่ละ use case ถูกตรวจแค่ไหน ส่วนภาพรวมของชุด test ทั้ง repo ดู [`TESTING.md`](TESTING.md)

ที่มา: `line-app/api/*.js`, `line-app/liff/bill.html`, `backend/app/`, `backend/tests/*.py`, `line-app/smoke-usecases.js` · `line-app/smoke-cron.js` — ทุกกรณีเขียนจากพฤติกรรมที่อยู่ในโค้ดจริง ไม่ได้เดา

---

## วิธีรัน

| ชุด test | คำสั่ง | ต้องมี |
|---|---|---|
| **Use case (line-app)** — ไฟล์นี้ | `cd line-app && node smoke-usecases.js` | Node ≥ 20 · ไม่ต้องมีเน็ต · ไม่ต้อง `npm install` |
| line-app อื่น ๆ | `cd line-app && node smoke.js` · `node smoke-handlers.js` · `node smoke-reads.js` · `node smoke-cron.js` (ตัวเตือนรายวัน) | เหมือนข้างบน |
| backend | `cd backend && pytest -q` | Python ≥ 3.11 · Postgres · ตั้ง `TEST_DATABASE_URL` (เช่น `postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test`) และ `DEV_AUTH=true` |

`smoke-usecases.js` พิมพ์ `✓ TC-xx-n …` ต่อกรณี และ `✗` พร้อมเหตุผลเมื่อตก จบด้วยจำนวนที่ผ่าน และออกด้วย exit 1 ถ้ามีกรณีตก CI รันให้ทุก push/PR (ขั้น "Use case tests" ใน `.github/workflows/ci.yml`)

ชุดนี้ใช้ handler จริงทุกตัว: สโตร์เป็น `Map` ในหน่วยความจำ (สลับผ่าน `require.cache`) · `fetch` ถูกจำลอง (idToken ที่ขึ้นต้นด้วย `U` ถือว่าเป็น userId นั้น, บันทึกทุก push/reply/ตั้งเมนู LINE) · `qrcode-svg` ถูกแทนที่ — กรณีทุกข้อเริ่มจากหอว่าง ไม่พึ่งผลของข้ออื่น · ตัวเตือนรายวัน (UC-16) ทดสอบโดยเรียก `runReminders({ today })` ด้วยวันที่ที่กำหนดเอง และเรียก handler `/api/cron` จริงสำหรับการตรวจสิทธิ์

## สัญลักษณ์ในคอลัมน์ "ทดสอบโดย"

| สัญลักษณ์ | ความหมาย |
|---|---|
| ✅ | **automated** — มี test รันได้เอง (`line-app/smoke-usecases.js › TC-…` หรือ pytest ที่ระบุ) |
| 🖐 | **manual** — ต้องใช้ LINE/LIFF จริงหรือมือถือจริง ไม่มี test อัตโนมัติ |
| ⏳ | **ยังไม่สร้าง** — ฟีเจอร์ยังไม่มีในโค้ด หรือมีแต่ยังไม่มี test; แถวบอกว่าควรทดสอบอะไรเมื่อสร้าง |

## Use case ที่ครอบคลุม

ผู้กระทำ **เจ้าของหอ**: UC-01 ตั้งค่าหอ · UC-02 จดมิเตอร์น้ำ–ไฟ · UC-03 ออกบิล · UC-04 ยืนยันการชำระ · UC-05 ดูห้องค้างชำระ · UC-06 ดูรายรับ · UC-07 เพิ่ม/ถอนเจ้าของและผู้ช่วย · UC-08 เปลี่ยนผู้เช่า/หมุน QR ห้อง · UC-18 ยกเลิกบิล (void) และออกบิลใหม่
ผู้กระทำ **ผู้เช่า**: UC-09 ผูกบัญชี LINE กับห้อง · UC-10 ดูบิล · UC-11 แจ้งชำระ (แนบสลิป) · UC-12 ตรวจสลิปอัตโนมัติ · UC-13 ชำระหลายงวดในสลิปเดียว · UC-14 ดูยอดค้างชำระ · UC-15 ดูใบเสร็จ · UC-17 แจ้งชำระก่อนบิลออก (โอนก่อน)
ผู้กระทำ **ระบบ/เวลา**: UC-16 ทวงอัตโนมัติ (เลยกำหนด 1 / 5 / 10 วัน)

UC-07 และ UC-08 เพิ่มเข้ามาหลังแผนภาพ ส่วน UC-17 เพิ่มเมื่อ API โอนก่อนบิลเสร็จ (ผู้กระทำคือผู้เช่า) และ UC-18 เพิ่มเมื่อมีการยกเลิกบิล/ออกบิลใหม่ (ผู้กระทำคือเจ้าของหอ)

> **สองระบบ แปลว่ากรณีเดียวกันอาจมีสองแถวผลลัพธ์** — `line-app/` คือระบบที่ใช้งานจริงตอนนี้ (บิลเก็บใน Vercel Blob, ผู้เช่าแยกด้วย LINE userId) ส่วน `backend/` คือ FastAPI + Postgres ที่จะมาแทน กรณีที่อ้าง `backend/tests/...` ถูกตรวจโดย pytest ที่มีอยู่แล้ว (ไฟล์นี้ไม่ได้รันและไม่ได้แก้)

## UC-01 ตั้งค่าหอ (ค่าเช่า · อัตราน้ำไฟ)

**ผู้กระทำ:** เจ้าของหอ

ค่าเช่าและอัตราค่าน้ำ/ค่าไฟต่อหน่วยของแต่ละห้อง ใช้คำนวณบิลตอนออกบิล ค่าเริ่มต้นมาจาก env (`DEFAULT_RENT`=3500, `WATER_RATE`=25, `ELEC_RATE`=7) และห้องใดที่ต้องการค่าต่างออกไปเก็บเป็น `room:<ห้อง>` ในสโตร์ รายชื่อห้องมาจาก env `ROOMS` (ค่าเริ่มต้น 201–212) **line-app แก้ได้เองแล้ว**: `POST /api/rooms` (`line-app/api/rooms.js` → `saveSettings`) ตั้งค่าเช่า/อัตราน้ำ–ไฟรายห้อง และ `saveDorm` ตั้งค่าเริ่มต้นของหอ (`dorm`: name/rent/rates/dueDay/promptpay) — มีหน้าจอ "แก้ไขราคาห้อง" และ "ตั้งค่าหอ" ใน LIFF (`/api/dev?do=seed` ยังมีสำหรับ dev) — ฝั่ง backend มีตาราง rooms/rate และค่าเหมาจ่ายต่อห้อง

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/_rooms.js` (`configFor`, `DEFAULTS`, `ROOMS`)
- `line-app/api/run.js` (นำไปคำนวณ)
- `line-app/api/rooms.js` (แสดง config)
- backend: `backend/app/routes/rooms.py`, `backend/app/routes/billing.py`

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-01-1 | ห้องที่ไม่มีค่าตั้งเอง ใช้ค่าเริ่มต้น | ไม่มี `room:201` ในสโตร์ ไม่ตั้ง env ราคา | ออกบิลห้อง 201 น้ำ 10 ไฟ 100 หน่วย | ค่าเช่า 3,500 · น้ำ 250 · ไฟ 700 · รวม 4,450 | ✅ `line-app/smoke-usecases.js › TC-01-1` |
| TC-01-2 | ค่าเช่า/อัตราเฉพาะห้องถูกใช้ ค่าที่ไม่ได้ตั้งตกไปใช้ค่าเริ่มต้น | `room:202`={rent 4000, น้ำ 20, ไฟ 8}, `room:203`={rent 3000} | ออกบิลห้อง 202, 203 | 202 รวม 4,180 · 203 ค่าเช่า 3,000 แต่น้ำ/ไฟใช้อัตราเริ่มต้น | ✅ `line-app/smoke-usecases.js › TC-01-2` |
| TC-01-3 | เจ้าของเห็นค่าตั้งของทุกห้อง | `room:202` ตั้งเอง | GET `/api/rooms` | 12 ห้องเรียงตาม ROOMS · 201 ใช้ค่าเริ่มต้น · 202 ใช้ค่าที่ตั้ง | ✅ `line-app/smoke-usecases.js › TC-01-3` |
| TC-01-4 | ค่าน้ำ/ไฟที่เป็นทศนิยมถูกปัดเป็นบาทเต็ม | `room:204` อัตรา 22.5 / 7.5 | ออกบิล น้ำ 3 ไฟ 3 | น้ำ 68 · ไฟ 23 (ปัดแบบ `Math.round`) | ✅ `line-app/smoke-usecases.js › TC-01-4` |
| TC-01-5 | เปลี่ยนอัตราภายหลังไม่กระทบบิลที่ออกแล้ว | ออกบิลห้อง 201 แล้ว | แก้ `room:201` เป็นอัตราใหม่ แล้วผู้เช่าเปิดบิล | ยอดบิลเดิมเท่าเดิม (บิลเก็บยอดของตัวเอง) | ✅ `line-app/smoke-usecases.js › TC-01-5` |
| TC-01-6 | เจ้าของแก้ค่าเช่า/อัตราน้ำไฟของห้องผ่านหน้าจอ/API | เจ้าของล็อกอิน | `POST /api/rooms` `{room, rent, waterRate, elecRate}` หรือกด "แก้ไขราคาห้อง" ในหน้าห้อง | บันทึกสำเร็จ · ผู้ช่วย/ผู้เช่า 403 · ค่าติดลบ/ไม่ใช่จำนวนเต็มถูกปฏิเสธ · บิลที่ออกแล้วไม่เปลี่ยน (มีผลกับบิลใหม่) · หน้าจอโชว์ราคาใหม่ทันที | ✅ `line-app/smoke-handlers.js` › room pricing |
| TC-01-7 | ค่าตั้งของห้องที่ไม่มีใน ROOMS / env `ROOMS` เว้นวรรคและค่าว่าง | ตั้ง `ROOMS=" 101, ,102 "` | โหลด `_rooms` ใหม่แล้วอ่าน `ROOMS` | ได้ `["101","102"]` เท่านั้น (ตัดช่องว่างและค่าว่าง) | ✅ `line-app/smoke-handlers.js` (small guards) |
| TC-01-8 | backend: ห้องเหมาจ่ายไม่ต้องจดมิเตอร์ ห้องว่างไม่ถูกออกบิล | seed demo dorm | `POST /v1/billing/run` | ห้องเหมาจ่ายถูกออกบิลโดยไม่มีมิเตอร์ ห้องว่างถูกข้าม | ✅ `backend/tests/test_billing.py::test_flat_rate_rooms_need_no_reading_and_vacant_rooms_are_skipped` |
| TC-01-9 | backend: เจ้าของอ่านค่าตั้งของหอตัวเอง | seed demo dorm | `GET /v1/properties/p_1` | 200 · `billing_mode`, เรตน้ำ/ไฟ, `due_days`, `rooms` = ทุกห้องรวมห้องว่าง | ✅ `backend/tests/test_properties.py::test_owner_reads_own_property` |
| TC-01-10 | backend: หออื่นตอบ 404 (ไม่ใช่ 403) · ผู้เช่า 403 · ไม่ล็อกอิน 401 | มีหอ p_2 ในฐานข้อมูล | `GET /v1/properties/*` ด้วย session ต่าง ๆ | p_2 → 404 · ผู้เช่า → 403 · ไม่ล็อกอิน → 401 | ✅ `backend/tests/test_properties.py` (3 เทสต์) |
| TC-01-11 | line-app: เจ้าของตั้งค่าหอ (ชื่อ · ค่าเช่า/น้ำ/ไฟเริ่มต้น · วันครบกำหนด) | ยังไม่มีค่าตั้ง (`dorm` ว่าง) | `GET /api/rooms?settings=1` → `POST {dorm:{name, rent, dueDay:5}}` → `POST /api/run` | `defaults` เปลี่ยนตาม · ห้องที่ไม่ได้ตั้งราคาใช้ค่าใหม่ · **บิลมี `due` = วันที่ 5 ของเดือนนั้น** · `null` ล้างค่ากลับเป็น env · dueDay 31/ชื่อยาว/ค่าว่าง → 400 · viewer → 403 | ✅ `line-app/smoke-handlers.js` (dorm settings) |
| TC-01-12 | ราคารายห้องไม่แช่ค่าตั้งของหอไว้ | ห้อง 202 ตั้ง `rent` อย่างเดียว | เปลี่ยน `dorm.waterRate` 25→22 แล้วอ่าน `GET /api/rooms` | `room:<room>` เก็บ **เฉพาะฟิลด์ที่ส่ง** · ห้องนั้นได้ค่าน้ำใหม่ 22 (ไม่ใช่ 25 ที่แช่ไว้) · ห้องที่ตั้งทับเองยังใช้ค่าของตัวเอง | ✅ `line-app/smoke-handlers.js` (room pricing) |

## UC-02 จดมิเตอร์น้ำ–ไฟ

**ผู้กระทำ:** เจ้าของหอ

ใน line-app เจ้าของกรอก **จำนวนหน่วยที่ใช้ของเดือนนั้น** (ไม่ใช่เลขมิเตอร์สะสม) ที่หน้า LIFF แล้วส่งพร้อมกับการออกบิลที่ `POST /api/run` — ไม่มี endpoint จดมิเตอร์แยก ช่องน้ำหรือไฟที่ขาด/null/ว่างถูกปฏิเสธ (เลข 0 ที่กรอกจริงใช้ได้) ระบบเก็บค่าล่าสุดเป็น `meter:<ห้อง>` ฝั่ง backend แยกเป็น `PUT /v1/rooms/{room}/reading` ที่รับเลขมิเตอร์สะสมและลบกับเดือนก่อน

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/run.js` (`isMissing`, `parseUnits`, `issueBill`)
- `line-app/api/rooms.js` (แสดง `meter`)
- `line-app/liff/bill.html` (ฟอร์มกรอกหน่วย)
- backend: `backend/app/routes/rooms.py` (`put_reading`)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-02-1 | จดหน่วยแล้วถูกเก็บเป็นมิเตอร์ล่าสุดและแสดงใน `/api/rooms` | เจ้าของล็อกอิน | ส่ง readings ห้อง 201 น้ำ 12 ไฟ 140 · แล้ว GET `/api/rooms` | `meter:201` = {12, 140, at} · `/api/rooms` แสดง meter ของห้อง 201 | ✅ `line-app/smoke-usecases.js › TC-02-1` |
| TC-02-2 | หน่วยติดลบถูกปฏิเสธ | ห้อง 201 มีผู้เช่าผูกอยู่ | ส่งน้ำ −5 | ห้องนั้นได้ `error` · ไม่เซฟมิเตอร์ · ไม่มีบิล · ไม่ส่ง LINE | ✅ `line-app/smoke-usecases.js › TC-02-2` |
| TC-02-3 | หน่วยต้องเป็นจำนวนเต็ม | — | ส่ง 1.5, 'abc', '12' | 1.5 และ 'abc' ถูกปฏิเสธ · '12' (สตริงตัวเลข) ผ่านเป็น 12 | ✅ `line-app/smoke-usecases.js › TC-02-3` |
| TC-02-4 | ห้องที่ไม่มีในหอถูกปฏิเสธ ไม่ทำให้ห้องอื่นล้ม | — | ส่ง 999 และ 201 ในคำขอเดียว | HTTP 200 · 999 ได้ `error` · 201 ออกบิลปกติ | ✅ `line-app/smoke-usecases.js › TC-02-4` |
| TC-02-5 | เพดานหน่วย 100,000 | — | ส่ง 100000 และ 100001 | 100000 ผ่าน · 100001 ถูกปฏิเสธ | ✅ `line-app/smoke-usecases.js › TC-02-5` |
| TC-02-6 | ไม่ส่ง/null/ว่าง water หรือ elec ถูกปฏิเสธ ส่วน 0 ที่กรอกตั้งใจผ่าน | — | ส่ง `{room:"201"}` · `{water:null,elec:null}` · น้ำอย่างเดียว (ลืมไฟ) · สตริงว่าง/เว้นวรรค · น้ำ 0 ไฟ 0 | สี่แบบแรกได้ `error: "ต้องกรอกหน่วยน้ำและไฟ"` · ไม่ออกบิล ไม่เซฟมิเตอร์ · 0/0 ออกบิลได้ (ค่าเช่าล้วน) — ลืมจดมิเตอร์ไม่กลายเป็นบิลค่าเช่าล้วนอีกต่อไป (LIFF ก็กันช่องว่างแล้ว ดู TC-02-14) | ✅ `line-app/smoke-usecases.js › TC-02-6` |
| TC-02-7 | ห้องซ้ำในคำขอเดียวกัน | — | ส่ง 201 สองครั้งในคำขอเดียว | ครั้งแรกผ่าน (ค่าแรกถูกเก็บ) ครั้งที่สองถูกปฏิเสธ | ✅ `line-app/smoke-usecases.js › TC-02-7` |
| TC-02-8 | เฉพาะเจ้าของจดมิเตอร์/ออกบิลได้ | มีผู้เช่า ผู้ช่วย | ผู้เช่า · ผู้ช่วย · ไม่ล็อกอิน · idToken ปลอม เรียก `/api/run` | 403 · 403 · 401 · 403 · ไม่มีมิเตอร์ถูกเขียน | ✅ `line-app/smoke-usecases.js › TC-02-8` |
| TC-02-9 | เตือนเมื่อเลขมิเตอร์ต่ำกว่าเดือนก่อน (ฝั่ง line-app) | มีมิเตอร์เดือนก่อน | กรอกหน่วยน้อยกว่าเดือนก่อน | ขึ้นคำเตือน "น้ำ/ไฟน้อยกว่าเดือนก่อน (N หน่วย)" ก่อนบันทึก · เป็นการเตือน ไม่บล็อก | 🖐 ทดสอบมือใน LIFF (ไม่มี UI test) |
| TC-02-10 | backend: จดเทียบเดือนก่อน เขียนทับได้จนกว่าจะออกบิล เลขต่ำกว่าเดิมบันทึกพร้อมคำเตือน | seed demo dorm | `PUT /v1/rooms/{room}/reading` | ได้หน่วยที่ใช้ = เลขใหม่ − เลขเดือนก่อน | ✅ `backend/tests/test_rooms.py::test_record_a_reading_against_last_month` |
| TC-02-11 | backend: ส่งซ้ำเขียนทับ · เลขต่ำกว่าเดิมมี warning · ห้องแรกไม่มีเดือนก่อน | — | ส่งเลขซ้ำ/ต่ำ/ห้องแรก | ตามสัญญา API | ✅ `backend/tests/test_rooms.py::test_sending_again_overwrites_until_billed`<br>`backend/tests/test_rooms.py::test_a_lower_meter_is_saved_with_a_warning`<br>`backend/tests/test_rooms.py::test_first_reading_of_a_room_has_nothing_to_subtract` |
| TC-02-12 | backend: งวดที่ออกบิลแล้วแก้มิเตอร์ไม่ได้ · ห้องไม่มีจริง · ค่าไม่ถูกต้อง | ออกบิลแล้ว | `PUT …/reading` | ถูกปฏิเสธ | ✅ `backend/tests/test_rooms.py::test_a_billed_period_cannot_be_changed`<br>`backend/tests/test_rooms.py::test_unknown_room`<br>`backend/tests/test_rooms.py::test_invalid_readings_are_rejected` |
| TC-02-13 | backend: ผู้เช่า/หอพักอื่นจดมิเตอร์ไม่ได้ | — | ผู้เช่า หรือเจ้าของหออื่น เรียก API | ถูกปฏิเสธ | ✅ `backend/tests/test_rooms.py::test_tenants_cannot_list_rooms_or_record_meters`<br>`backend/tests/test_rooms.py::test_another_dorm_cannot_record_a_meter_here` |
| TC-02-14 | หน้า LIFF ไม่ควรส่งช่องหน่วยที่เว้นว่างเป็น 0 | LIFF เจ้าของ · เว้นช่องน้ำหรือไฟของห้องหนึ่ง | กดออกบิล | ห้องนั้นถูกปฏิเสธพร้อมข้อความ "กรอกหน่วยน้ำและไฟให้ครบ" — guard อยู่ใน `bill.html` (ตรวจช่องว่าง/ติดลบ/ไม่เป็นจำนวนเต็มก่อนเขียน draft) · ยังไม่มีเทสต์อัตโนมัติของ UI (ฝั่ง API มี `smoke-handlers.js`) | 🖐 ทดสอบมือใน LIFF |
| TC-02-15 | อ่านเลขมิเตอร์จากรูป (Gemini) | ตั้ง `GEMINI_API_KEY` | `POST /api/run {action:"read", image:dataURL}` | 200 + `reading {water, elec, confidence, note}` · **ไม่เขียน Blob เลย** · คีย์ไปใน header `x-goog-api-key` · ขอ JSON (`responseMimeType`) · รูปไปถึงโมเดลจริง | ✅ `line-app/smoke-handlers.js` (meter photo) |
| TC-02-16 | ตัวอ่านรูปปิด/ล่ม/รูปไม่ใช่ภาพ | ไม่มีคีย์ · ผู้ให้บริการตอบ 500 · ส่งข้อความที่ไม่ใช่ data URL · ผู้เช่าเรียก | เรียก `{action:"read"}` | 503 `METERS_OFF` · 422 `UNREADABLE` (ไม่เดาตัวเลข) · 400 `VALIDATION` · 403 สำหรับผู้เช่า · อ่านได้แต่ไม่เห็นตัวเลข → 422 | ✅ `line-app/smoke-handlers.js` (meter photo) |
| TC-02-17 | เลขหน้าปัดถูกเก็บพร้อมหน่วย เพื่อหักเดือนถัดไป | อ่านรูปได้เลข 1523 / 8450 | บันทึกด้วย `dial` · แล้วส่ง `dial` ที่ผิดรูป | `meter:<room>.dial = {water, elec}` · ค่าที่ไม่ใช่ตัวเลข (สตริง/ติดลบ) ถูกทิ้ง ไม่เก็บ | ✅ `line-app/smoke-handlers.js` (meter photo) |
| TC-02-18 | การ์ดผลอ่านรูปในหน้าจดมิเตอร์ | LIFF เจ้าของ · ห้องที่มี `meter.dial` เดือนก่อน | กด "ถ่ายรูป / เลือกรูป" | ขึ้นการ์ดเลขที่อ่านได้ + ความมั่นใจ · ถ้ามีเลขเดือนก่อน โชว์ "ใช้ไป (หน่วย)" และปุ่ม "ใช้ค่านี้" เติมช่องหน่วย · ไม่มีเลขเดือนก่อน → ปุ่ม "เก็บเลขนี้ไว้" (ไม่เติมช่อง) · AI อ่านไม่ได้ → ข้อความ + พิมพ์เองได้ · เก็บ `dial` เฉพาะเมื่อเจ้าของกดปุ่มเท่านั้น | 🖐 ทดสอบมือใน LIFF |

## UC-03 ออกบิล (คำนวณบิล · ส่งบิลทาง LINE)

**ผู้กระทำ:** เจ้าของหอ

«include» คำนวณบิล และส่งบิล + QR ทาง LINE — เจ้าของส่ง period (`YYYY-MM`), วันครบกำหนด และหน่วยของแต่ละห้องที่ `POST /api/run` ระบบคำนวณ ค่าเช่า + น้ำ + ไฟ เก็บบิลสองสำเนา (`bill:<ห้อง>` ล่าสุด และ `bill:<งวด>:<ห้อง>` ประวัติ) แล้ว push การ์ดบิล (Flex) ให้ผู้เช่าที่ผูกห้อง กฎเงิน: บิลที่แจ้งชำระ (pending) หรือจ่ายแล้ว (paid) ถูกแก้ไม่ได้ (บิลที่ยกเลิก void ออกซ้ำได้ด้วย `rev`+1 — UC-18) · ช่องน้ำ/ไฟที่ขาดถูกปฏิเสธ (UC-02) · QR ชำระเงิน (PromptPay) สร้างฝั่งเซิร์ฟเวอร์ (`_promptpay.payloadFor` + CRC) แล้วส่งมาเป็น `pay: { payload, qr }` บนบิลที่ยังไม่จ่าย — placeholder `.qr-ph` จะขึ้นเฉพาะเมื่อเจ้าของยังไม่ได้ตั้งพร้อมเพย์ (TC-03-14)

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/run.js`
- `line-app/api/_bills.js` (`saveBill`)
- `line-app/api/_line.js` (`billBubble`)
- backend: `backend/app/routes/billing.py` (`run_billing`, `create_invoice`), `backend/app/tasks.py`

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-03-1 | ออกบิลสำเร็จ | เจ้าของล็อกอิน | POST `/api/run` ห้อง 201 น้ำ 10 ไฟ 100 · period 2026-11 · due 2026-11-16 | ยอด 4,450 · สถานะ unpaid · สองสำเนาตรงกัน · `bills:201`=[2026-11] | ✅ `line-app/smoke-usecases.js › TC-03-1` |
| TC-03-2 | period ผิดรูปแบบ | — | period = 2026-13, 2026-1, 202611, ว่าง (ไม่มี `BILL_PERIOD`) | 400 VALIDATION · ไม่เขียนอะไรลงสโตร์ | ✅ `line-app/smoke-usecases.js › TC-03-2` |
| TC-03-3 | due ผิดรูปแบบ / ไม่ส่ง due | — | due = 16/11/2026, 2026-11-32, 2026-13-01 · แล้วไม่ส่ง due | ผิดรูปแบบ 400 · ไม่ส่ง due ออกได้ แต่ `due`=null (การ์ดไม่มีบรรทัดครบกำหนด — TC-03-13) | ✅ `line-app/smoke-usecases.js › TC-03-3` |
| TC-03-4 | readings ว่าง/ไม่ใช่ array/ไม่มี body | — | ส่ง `[]`, ไม่ส่ง, สตริง, object | 400 | ✅ `line-app/smoke-usecases.js › TC-03-4` |
| TC-03-5 | วิธีเรียกที่ไม่ใช่ POST | — | GET `/api/run` | 405 | ✅ `line-app/smoke-usecases.js › TC-03-5` |
| TC-03-6 | ส่งการ์ดบิลให้ผู้เช่าที่ผูกห้อง | 201 มีผู้เช่า · 202 ว่าง | ออกบิล 201 และ 202 | 201 `pushed:true` ได้ Flex (altText มีห้อง/ยอด · ปุ่มเปิด LIFF `?room=201`) · 202 ได้บิลแต่ `pushed:false` | ✅ `line-app/smoke-usecases.js › TC-03-6` |
| TC-03-7 | ส่ง LINE ล้มเหลว | LINE push ของผู้เช่าตอบ 500 | ออกบิล | บิลถูกเก็บก่อนส่ง · HTTP 200 · `pushed:false` | ✅ `line-app/smoke-usecases.js › TC-03-7` |
| TC-03-8 | ออกบิลซ้ำห้องที่ยัง unpaid (แก้พิมพ์ผิด) | ออกบิล 201 แล้ว | ออกอีกครั้งด้วยหน่วยใหม่ | `reissued:true` · สองสำเนาถูกแก้ · ดัชนีงวดไม่ซ้ำ · ส่งการ์ดใหม่ | ✅ `line-app/smoke-usecases.js › TC-03-8` |
| TC-03-9 | บิล pending/paid ถูกแก้ไม่ได้ | 201 pending มีสลิป · 202 paid | ออกซ้ำทั้งสองห้อง | ทั้งสองได้ `error` · สถานะและยอดไม่เปลี่ยน (ต้องการแก้ ให้ยกเลิกบิลก่อน — UC-18) | ✅ `line-app/smoke-usecases.js › TC-03-9` |
| TC-03-10 | บิลระบบเก่าที่มีแค่ `bill:<ห้อง>` ที่ paid ก็กันการออกซ้ำ | `bill:201` paid ไม่มีสำเนารายงวด | ออกซ้ำงวดเดียวกัน | ถูกปฏิเสธ · ยัง paid | ✅ `line-app/smoke-usecases.js › TC-03-10` |
| TC-03-11 | ออกบิลงวดเก่าย้อนหลัง | ออกงวด 2026-12 แล้ว | ออกงวด 2026-11 | `bill:201` ยังเป็น 2026-12 · งวด 11 อยู่ในประวัติ · ดัชนีเรียงใหม่→เก่า | ✅ `line-app/smoke-usecases.js › TC-03-11` |
| TC-03-12 | ออกบิลทั้งหอในคำขอเดียว | ROOMS 12 ห้อง | ส่ง 12 ห้อง | ทุกห้องมีบิล · ผลลัพธ์เรียงตามลำดับที่ส่ง | ✅ `line-app/smoke-usecases.js › TC-03-12` |
| TC-03-13 | การ์ดบิลไม่ขึ้นคำว่า `null` เมื่อไม่มีวันครบกำหนด | ออกบิลโดยไม่ส่ง due | ดูการ์ดที่ผู้เช่าได้ · ออกซ้ำพร้อม due | การ์ดไม่มีบรรทัด "ครบกำหนด" และไม่มีคำว่า null · เมื่อมี due แสดง "ครบกำหนด 2026-11-16" (แก้แล้ว — ตัวเตือนรายวันก็ข้ามบิลที่ไม่มี due) | ✅ `line-app/smoke-usecases.js › TC-03-13` |
| TC-03-14 | บิลมี QR ชำระเงิน (PromptPay) ตามยอด | เจ้าของใส่พร้อมเพย์ในหน้าตั้งค่าหอ | ผู้เช่าเปิดบิลที่ยังไม่จ่าย | `pay.payload` เป็น EMVCo ที่ถูกต้อง (tag 00/01/29/53/54/58 + CRC ตรง) · `pay.qr` เป็น SVG · ยอด = ยอดบิล · บิลที่จ่ายแล้ว/ยกเลิกไม่มี QR · **การสแกนจริงด้วยแอปธนาคารยังต้องทดสอบมือ** | ✅ `line-app/smoke-handlers.js` (PromptPay QR) |
| TC-03-15 | เจ้าของเห็นผลออกบิลจริงบนหน้าจอ LIFF และผู้เช่าได้รับการ์ดใน LINE จริง | LINE OA + LIFF จริง | กรอกหน่วยทุกห้อง กดออกบิล | แสดงผลต่อห้อง · การ์ดถึงผู้เช่า · ปุ่มเปิดหน้าบิลถูกห้อง | 🖐 ทดสอบมือกับ LINE จริง |
| TC-03-16 | backend: ออกบิลห้องที่มีมิเตอร์เดือนนี้ · 42 ห้องในคำขอเดียว · ออกซ้ำ (202 จนครบทุกห้อง, 409 เมื่อครบแล้ว) · ล้มกลางทางย้อนทั้งชุด | seed + มิเตอร์ | `POST /v1/billing/run` | 202 และยอดตรงสัญญา | ✅ `backend/tests/test_billing.py::test_bills_the_rooms_that_have_this_months_reading`<br>`backend/tests/test_billing.py::test_all_42_rooms_in_one_request`<br>`backend/tests/test_billing.py::test_running_again_with_rooms_still_unread_is_202`<br>`backend/tests/test_billing.py::test_a_failure_halfway_rolls_back_the_whole_run` |
| TC-03-17 | backend: ผู้เช่าออกบิลไม่ได้ · period ผิดถูกปฏิเสธ · ผู้เช่าที่ไม่มีมิเตอร์เดือนก่อนไม่ถูกออกบิล | — | เรียก `/v1/billing/run` | 403 / 422 / ข้ามห้อง | ✅ `backend/tests/test_billing.py::test_tenants_cannot_run_billing`<br>`backend/tests/test_billing.py::test_bad_period_is_rejected`<br>`backend/tests/test_billing.py::test_a_room_without_an_earlier_reading_is_not_billed` |
| TC-03-20 | backend: ออกบิลแล้วส่งข้อความบิลเข้า LINE และ drain ในคำขอเดียว | ห้อง 3 ห้องผูก LINE | `POST /v1/billing/run` | `queued = 3`, `drained = true`, `job_id` = งานแรก · งาน `kind="invoice"` ต่อใบ · บิลทุกห้องที่พร้อมยังถูกสร้าง | ✅ `backend/tests/test_billing.py::test_run_notifies_the_rooms_that_have_a_tenant`<br>`backend/tests/test_notify.py` |
| TC-03-21 | backend: คิวไม่พร้อม (ยังไม่ apply schema) ต้องไม่ออกบิลล้ม · drain ล้มก็ยังคืน `queued` จริง | มีผู้เช่าผูก LINE | `POST /v1/billing/run` โดยคิวโยน exception | 202 · `queued: 0, drained: false` · บิลครบ 12 ใบใน DB · ถ้า enqueue สำเร็จแต่ drain ล้ม → `queued` ยังเป็นจำนวนจริง, `drained: false` | ✅ `backend/tests/test_billing.py::test_queue_down_still_returns_the_bills`<br>`backend/tests/test_billing.py::test_a_failed_drain_keeps_the_queued_count` |
| TC-03-18 | backend: ออกบิลหลายรายการเขียน `invoice_items` เป็น batch เดียว | — | ออกบิล 1 ห้อง 3 รายการ | `insert into invoice_items` ครั้งเดียว (executemany) ไม่ใช่ 3 ครั้ง | ✅ `backend/tests/test_billing.py::test_a_billing_run_is_a_handful_of_statements` (นับ statement ทั้งรอบ) |
| TC-03-22 | backend: 42 ห้องได้ข้อความครบและ `message_log` ครบ 42 แถว | ผูก LINE ทุกห้อง + จดมิเตอร์ พ.ย. ครบ | `POST /v1/billing/run` แล้วรันงานที่เข้าคิว | `queued = 42, drained = true` · เมื่อ worker รัน (LINE ตอบ 200) `message_log` มี 42 แถว `kind='invoice'`, `line_status='ok'` | ✅ `backend/tests/test_billing.py::test_all_42_bills_reach_the_tenant_and_the_message_log` |
| TC-03-23 | backend: ห้องที่มีรูมเมทได้ข้อความครั้งเดียวถึงคนล่าสุด | ห้อง 201 มีผู้เช่า 2 คนผูก LINE ต่างกัน | ออกบิล | `room 201` ปรากฏครั้งเดียวในงานที่เข้าคิว และเป็น `line_user_id` ของคนที่ `moved_in` ใหม่สุด | ✅ `backend/tests/test_billing.py::test_two_tenants_in_one_room_get_one_message` |
| TC-03-24 | backend: ออกบิลซ้ำเมื่อยังมีห้องที่ไม่มีมิเตอร์ — ยังตอบ 202 ไม่ใช่ 409 | ออกบิลแล้ว 12 ห้อง เหลือ 30 ห้องยังไม่มีมิเตอร์ | เรียก `/v1/billing/run` ซ้ำ | **202** `rooms_to_bill:0, skipped_no_reading:30` (409 เฉพาะเมื่อ **ทุก** ห้องออกบิลแล้ว) — รอบที่ออกครบทั้ง 42 ห้องแล้วจึงได้ 409 | ✅ `backend/tests/test_billing.py::test_running_again_with_rooms_still_unread_is_202`<br>`backend/tests/test_billing.py::test_running_again_after_every_room_is_billed_is_409` |
| TC-03-25 | ดัชนีบิล (`bill-state:<ห้อง>` / `bills:<ห้อง>`) รวมการเขียนพร้อมกันได้ ไม่ทิ้งงวดหาย | R2 (มี ETag) | สองคำขอเขียนดัชนีห้องเดียวกันพร้อมกัน | `store.update(key, apply)` อ่าน ETag แล้วเขียนแบบ **If-Match** · คนที่แพ้ 412 อ่านใหม่แล้วรวมซ้ำ (สูงสุด 3 ครั้ง) ไม่เขียนทับรายการของอีกฝ่าย · ครบ 3 ครั้งยังแพ้ → throw ไม่เขียนเงียบ ๆ · บน Vercel Blob ถอยเป็นเขียนครั้งเดียว (ไม่มี ETag — ช่องที่ยอมรับ) | ✅ `line-app/smoke.js › conditional put` (412 + `If-Match` + `If-None-Match: *`) |
| TC-03-26 | บันทึกงวดเก่าไม่ดึงสำเนา `bill:<room>` ย้อนหลัง | มีบิล 2027-08 เป็นตัวล่าสุด | บันทึกบิล 2027-07 (สลิปงวดเก่ามาช้า) | ตัวชี้ `bill:<room>` ยังเป็น 2027-08 (เขียนแบบเทียบ period) · บิล 2027-07 ถูกเขียนตามปกติ | ✅ `line-app/smoke-handlers.js` (races) |
| TC-03-27 | รอบบิลต้องเป็นเดือน 01–12 | หน้าออกบิล | เจ้าของกด "แก้ไข" แล้วพิมพ์ `2026-13` (หรือ `2026-00`) → "ใช้ค่านี้" | ขึ้น toast "รอบบิลต้องเป็นรูปแบบ 2026-12" · ไม่เปลี่ยน `O.period` · เลขมิเตอร์ที่จดไปแล้วไม่หาย | 🖐 LIFF (ตรวจในเบราว์เซอร์ LINE) |

## UC-04 ยืนยันการชำระ (include ออกใบเสร็จ)

**ผู้กระทำ:** เจ้าของหอ

เจ้าของกดปุ่ม "ยืนยันการชำระ" บนการ์ดที่ผู้เช่าแจ้งชำระ (postback `action=confirm&room=…&period=…` เข้า `POST /api/webhook`) บิล pending → paid, บันทึก `paidAt` และ `confirmedBy`, แจ้งผู้เช่า การ์ดผูกกับ **งวด** ของบิลนั้น การ์ดเก่าไม่ปิดบิลเดือนใหม่ **ใบเสร็จ:** ตอนยืนยันบิลได้ `receiptNo` = `R<yyyymm>-<ห้อง>` (+ `-<rev>` เมื่อ rev > 1) ซึ่งคำนวณจากบิล ไม่ใช้ตัวนับ (Blob ไม่มี transaction) และผู้เช่าได้ **การ์ดใบเสร็จ** แทนข้อความ "ชำระเงินแล้ว" เดิม (รายละเอียดฝั่งผู้เช่า — UC-15) การยืนยันสลิปหลายงวดใน 1 การ์ด — UC-13 การยกเลิกบิล — UC-18 **การตีสลิปกลับ (reject) มีใน line-app แล้ว**: `POST /api/bill { action:"reject" }` (`rejectSlip`) พาบิล `pending` กลับเป็น `unpaid` + `slipRejected {at, by, reason}` และแจ้งผู้เช่า (TC-04-11) · ตีกลับได้ **เป็นรายงวด** — ยังไม่มีแบบ "ตีกลับทั้งกลุ่มในคลิกเดียว"

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/webhook.js` (postback `confirm`)
- `line-app/api/_line.js` (`confirmBubble`, `receiptBubble`)
- `line-app/api/_bills.js` (`saveBills`, `receiptNoOf`)
- backend: `backend/app/routes/billing.py` (`confirm_invoice`, `reject_slip`)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-04-1 | เส้นทางตั้งแต่ต้นจนจบ (end-to-end) | เจ้าของ + ผู้เช่าล็อกอิน | เจ้าของขอ QR ห้อง 203 → ผู้เช่าสแกนผูก → เจ้าของออกบิล → ผู้เช่าอ่านบิล → แนบสลิป → เจ้าของกดปุ่มบนการ์ด | บิล paid · `confirmedBy`=เจ้าของ · `paidAt` มี · สองสำเนาตรงกัน · `receiptNo`=`R202611-203` · ผู้เช่าได้การ์ดใบเสร็จ (Flex "ใบเสร็จรับเงิน ห้อง 203") · เจ้าของได้คำตอบ "ยืนยันห้อง 203" | ✅ `line-app/smoke-usecases.js › TC-04-1` |
| TC-04-2 | ผู้เช่า/ผู้ช่วย/คนแปลกหน้ากดยืนยันไม่ได้ | บิล 205 pending | คนเหล่านั้นส่ง postback confirm | ตอบ "เฉพาะเจ้าของหอ…" · บิลยัง pending | ✅ `line-app/smoke-usecases.js › TC-04-2` |
| TC-04-3 | การ์ดเก่าไม่มี period | บิลล่าสุด pending | เจ้าของกดการ์ดที่ไม่มี `period` | ปฏิเสธ "ไม่ระบุรอบบิล" · บิลไม่เปลี่ยน | ✅ `line-app/smoke-usecases.js › TC-04-3` |
| TC-04-4 | บิลที่ยังไม่แจ้งชำระ (unpaid) ยืนยันไม่ได้ | บิล unpaid | เจ้าของกด confirm | ตอบ "ยังไม่ได้แจ้งชำระ" · ยัง unpaid | ✅ `line-app/smoke-usecases.js › TC-04-4` |
| TC-04-5 | กดยืนยันซ้ำ | บิลถูกยืนยันแล้ว | กดอีกครั้ง | ตอบ "ยืนยันไปแล้ว" · `paidAt` เดิม · ไม่ส่งข้อความหาผู้เช่าซ้ำ | ✅ `line-app/smoke-usecases.js › TC-04-5` |
| TC-04-6 | การ์ดรอบเก่าปิดได้เฉพาะบิลรอบนั้น | พ.ย. pending · ธ.ค. unpaid (ล่าสุด) | กดการ์ดของ 2026-11 | พ.ย. paid · ธ.ค. และ `bill:205` ไม่เปลี่ยน | ✅ `line-app/smoke-usecases.js › TC-04-6` |
| TC-04-7 | บิลที่การ์ดอ้างไม่มีอยู่ | ไม่มีบิล | กด confirm | ตอบ "ไม่พบบิล" · ไม่เขียนอะไร | ✅ `line-app/smoke-usecases.js › TC-04-7` |
| TC-04-8 | webhook ลายเซ็นปลอม | บิล pending | ส่ง postback ด้วย `x-line-signature` ปลอม | 401 · บิลไม่เปลี่ยน | ✅ `line-app/smoke-usecases.js › TC-04-8` |
| TC-04-9 | เจ้าของเป็นผู้เช่าห้องเดียวกัน | เจ้าของผูกห้อง 205 | เจ้าของยืนยันห้อง 205 | paid · ไม่ push ข้อความหาตัวเอง | ✅ `line-app/smoke-usecases.js › TC-04-9` |
| TC-04-10 | ออกเลขที่ใบเสร็จเมื่อยืนยัน (line-app) | บิล pending หลายห้อง/งวด · rev 1 และ 2 | ยืนยันการชำระ · ยืนยันซ้ำ | ได้ `R202611-205` ทั้งสองสำเนา · ห้อง/งวดอื่นได้เลขของตัวเอง · rev 2 ได้ `R202611-207-2` · ผู้เช่าได้การ์ดใบเสร็จ (เลขที่ ยอด ปุ่ม "ดูใบเสร็จ") · ยืนยันซ้ำไม่เปลี่ยนเลขและไม่ส่งซ้ำ | ✅ `line-app/smoke-usecases.js › TC-04-10` |
| TC-04-11 | ตีสลิปกลับ (reject) เจ้าของระบุเหตุผล (line-app) | บิล pending | เจ้าของกด "สลิปไม่ถูกต้อง (ตีกลับ)" | บิลกลับเป็น `unpaid` + `slipRejected {reason, at, by}` · สลิปเดิมยังอยู่เป็นหลักฐานและยังนับในเพดาน 5 ครั้ง · ผู้เช่าได้ข้อความแจ้งและแนบใหม่ได้ · ไม่ใช่ pending → 409 · ไม่มีเหตุผล → 400 · ผู้ช่วย/ผู้เช่า → 403 | ✅ `line-app/smoke-handlers.js` (slip rejection) |
| TC-04-12 | กดปุ่มยืนยันบนการ์ดจริงใน LINE | LINE OA จริง · ผู้เช่าแนบสลิปจริง | เจ้าของกดปุ่ม "ยืนยันการชำระ" · ปุ่ม "ดูสลิป" เปิดรูป | ได้ข้อความตอบกลับ · ผู้เช่าได้การ์ดใบเสร็จ · สถานะเป็นชำระแล้ว | 🖐 ทดสอบมือกับ LINE จริง |
| TC-04-13 | backend: ยืนยัน → paid พร้อมเลขที่ใบเสร็จ | invoice pending | `POST /v1/invoices/{id}/confirm` | paid + `REC-2026-11-0001` | ✅ `backend/tests/test_slip_confirm_reject.py::test_confirm_marks_paid_and_issues_a_receipt` |
| TC-04-14 | backend: เลขใบเสร็จไม่ซ้ำ · ยืนยันพร้อมกันรอล็อกของหอ | ยืนยันหลายใบ | ยืนยันต่อเนื่อง/พร้อมกัน | เลขเรียงไม่ซ้ำ | ✅ `backend/tests/test_slip_confirm_reject.py::test_receipt_numbers_do_not_repeat`<br>`backend/tests/test_slip_confirm_reject.py::test_confirm_waits_for_the_dorm_lock` |
| TC-04-15 | backend: ยืนยันต้องมีสลิปก่อน · หอพักอื่นยืนยันไม่ได้ | — | confirm ใบที่ unpaid / ข้ามหอ | ถูกปฏิเสธ | ✅ `backend/tests/test_slip_confirm_reject.py::test_confirm_needs_a_slip_first`<br>`backend/tests/test_slip_confirm_reject.py::test_other_dorm_cannot_confirm` |
| TC-04-16 | backend: ตีสลิปกลับ → unpaid · ต้องมีสลิป pending | invoice pending | `POST …/reject` | unpaid / ปฏิเสธถ้าไม่ pending | ✅ `backend/tests/test_slip_confirm_reject.py::test_reject_sends_the_invoice_back_to_unpaid`<br>`backend/tests/test_slip_confirm_reject.py::test_reject_needs_a_pending_slip` |
| TC-04-17 | ยกเลิกบิลที่แพ้การยืนยัน (สถานะเปลี่ยนระหว่างทาง) | บิล pending ที่เจ้าของจะกดยืนยันในแชทพร้อมกัน | ยิง `POST /api/bill {action:"void"}` | เขียนแบบเทียบสถานะเดิม: ไม่ผ่าน → `409 INVALID_STATE` · บิลไม่ถูกเขียนทับ (paidAt/receiptNo ไม่หาย) | ✅ `line-app/smoke-handlers.js` (races) |
| TC-04-18 | บิลเก่าที่มีเฉพาะ `bill:<room>` (ก่อนมีคีย์รายงวด) ยังขึ้นในหน้ารอตรวจ | `bill:<room>` pending มี slipPath | `GET /api/bill?pending=1` แล้วเปิด `GET /api/slip-image?period=` | ขึ้นในรายการ · กดดูสลิปได้ 200 (fallback ไป `bill:<room>`) | ✅ `line-app/smoke-handlers.js` (races) |

## UC-05 ดูห้องค้างชำระ (ค้างกี่งวด · เกินกี่วัน)

**ผู้กระทำ:** เจ้าของหอ (ผู้ช่วยดูได้)

`GET /api/rooms` ส่งทุกห้องพร้อมบิลล่าสุด (สถานะ, วันครบกำหนด) และ **จำนวนวันเกินกำหนดคำนวณฝั่งเซิร์ฟเวอร์แล้ว**: `GET /api/bill?overdue=1` (`overdue()` ใน `bill.js` ใช้วันที่ไทยจาก `_ledger.bangkokToday`) คืน `{ count, total, maxDaysOverdue, items }` — เจ้าของ/ผู้ช่วยเห็นทุกห้อง ผู้เช่าเห็นเฉพาะห้องตัวเอง (TC-05-7, TC-05-8, TC-14-2) ส่วนหน้า LIFF ยังใช้ `isOverdue()` จากนาฬิกาเครื่องเป็น fallback ระหว่างรอผลจากเซิร์ฟเวอร์ ฝั่ง backend `GET /v1/invoices` ส่ง `days_overdue` และสรุปยอด paid/pending/unpaid

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/rooms.js`
- `line-app/api/bill.js` (`history`)
- `line-app/liff/bill.html` (`isOverdue`, `maxDaysOverdue`, หน้า review/overdue)
- backend: `backend/app/routes/billing.py` (`list_invoices`)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-05-1 | เจ้าของเห็นทุกห้องพร้อมสถานะบิลและวันครบกำหนด | 201 unpaid เลยกำหนด · 202 pending · 203 paid · 204 ไม่มีบิล | GET `/api/rooms` | สถานะตรงทุกห้อง · 204 `bill:null` · `Cache-Control: no-store` | ✅ `line-app/smoke-usecases.js › TC-05-1` |
| TC-05-2 | สิทธิ์ดูรายการห้อง | มีผู้ช่วย ผู้เช่า | ผู้ช่วย · ผู้เช่า · ไม่ล็อกอิน เรียก `/api/rooms` | 200 · 403 · 401 | ✅ `line-app/smoke-usecases.js › TC-05-2` |
| TC-05-3 | ไม่เปิดเผย LINE userId ของผู้เช่า | ห้อง 201 มีผู้เช่า | เจ้าของ GET `/api/rooms` | ไม่มี userId ใน response · `linked` true/false ตามจริง | ✅ `line-app/smoke-usecases.js › TC-05-3` |
| TC-05-4 | ห้อง pending แยกจาก unpaid | 201 unpaid · 202 pending | กรองตาม status | unpaid=[201] · pending=[202] (หน้าจอแยก "ค้างชำระ" กับ "รอตรวจ") | ✅ `line-app/smoke-usecases.js › TC-05-4` |
| TC-05-5 | หลายงวดค้างของห้องเดียว | 201 ค้าง ต.ค. และ พ.ย. | GET `/api/rooms` แล้ว `/api/bill?room=201&history=1` | `/api/rooms` เห็นแค่ พ.ย. · history เห็นทั้งสองงวดเป็น unpaid | ✅ `line-app/smoke-usecases.js › TC-05-5` |
| TC-05-6 | หน้า "ค้างชำระ" นับเฉพาะ unpaid ที่เลยกำหนด เรียงค้างนานสุดก่อน และไม่นับ pending | LINE/เบราว์เซอร์จริง · มีบิลหลายสถานะ | เปิด LIFF เจ้าของ → ค้าง / รอตรวจ | ตัวเลขการ์ดและรายการตรงกับสถานะ · ห้องไม่มี `due` ไม่ถูกนับค้าง · กำหนดวันนี้ยังไม่ถือเกิน | 🖐 ทดสอบมือกับ LINE จริง |
| TC-05-7 | ค้างกี่งวดต่อห้อง (รวมหลายงวด) | ห้อง 201 ค้าง 2 งวด | เจ้าของเปิดรายการค้างชำระ | `GET /api/bill?overdue=1` ตอบต่อห้อง `{ room, count, total, maxDaysOverdue, items }` (เช่น "ค้าง 2 งวด · รวม 8,450 บาท · เลย 35 วัน") เรียงค้างนานสุดก่อน เฉพาะห้องที่ค้าง · pending / กำหนดวันนี้ / ไม่มี due / void ไม่นับ · ผู้ช่วยดูได้ | ✅ `line-app/smoke-usecases.js › TC-05-7` |
| TC-05-8 | คำนวณจำนวนวันเกินกำหนดฝั่งเซิร์ฟเวอร์ | — | ดึงรายการค้าง ณ วันที่กำหนด | เซิร์ฟเวอร์คำนวณ `daysOverdue` จากวันที่เวลาไทย (`_ledger.bangkokToday`) ถูกต้องรวมข้ามเดือน/ข้ามปี/ก.พ. (31 ต.ค. → 2 พ.ย. = 2 วัน) · กำหนดวันนี้ไม่ถือเกิน · 17:00 UTC คือวันถัดไปในไทย | ✅ `line-app/smoke-usecases.js › TC-05-8` |
| TC-05-9 | backend: รายการใบแจ้งหนี้ของงวดพร้อม `days_overdue` และสรุปยอด | seed + invoice หลายสถานะ | `GET /v1/invoices?period=` | `days_overdue` นับเฉพาะ unpaid · summary แยก paid/pending/unpaid | ✅ `backend/tests/test_billing.py::test_invoices_of_a_period_with_overdue_days_and_summary` |
| TC-05-10 | backend: กรองตามสถานะ · สถานะไม่รู้จักถูกปฏิเสธ · ค่าเริ่มต้นคืองวดนี้ | — | `?status=` / ไม่ส่ง period | ตามสัญญา | ✅ `backend/tests/test_billing.py::test_filter_by_status`<br>`backend/tests/test_billing.py::test_unknown_status_is_rejected`<br>`backend/tests/test_billing.py::test_period_defaults_to_this_month` |
| TC-05-11 | backend: หอพักอื่นไม่เห็นใบแจ้งหนี้ · ผู้เช่าดูรายการห้องไม่ได้ | — | ข้ามหอ / เป็นผู้เช่า | ไม่เห็น / 403 | ✅ `backend/tests/test_billing.py::test_another_dorm_sees_none_of_these_invoices`<br>`backend/tests/test_rooms.py::test_tenants_cannot_list_rooms_or_record_meters` |

## UC-06 ดูรายรับ

**ผู้กระทำ:** เจ้าของหอ (ผู้ช่วยดูได้)

หน้า "รายงานรายรับ" ใน LIFF สรุปจากข้อมูลของ `GET /api/rooms` (ผลรวม `total` ของบิล paid / pending / unpaid) และ **รายรับตามเดือนมีแล้ว**: `GET /api/bill?income=YYYY-MM` (`income()` นับตาม `paidAt` เวลาไทย ไม่ดูงวดของบิล, ดูย้อนได้ 12 เดือน) — TC-06-6 ส่วน `/api/rooms` เองยังส่งแค่บิลล่าสุดของแต่ละห้อง ฝั่ง backend `GET /v1/invoices` มี summary ของงวดที่เลือก

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/rooms.js`
- `line-app/api/bill.js` (อ่านตามงวด)
- `line-app/liff/bill.html` (หน้า report)
- backend: `backend/app/routes/billing.py` (`list_invoices` → `summary`)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-06-1 | ข้อมูลที่ใช้สรุปรายรับ: นับ total ของบิล paid เท่านั้น | 201,202 paid · 203 pending · 204 unpaid | GET `/api/rooms` แล้วรวมตามสถานะ | paid=8,250 · pending=5,000 · unpaid=6,000 · บิล paid ทุกใบมี `paidAt` | ✅ `line-app/smoke-usecases.js › TC-06-1` |
| TC-06-2 | สิทธิ์ดูข้อมูลรายรับ | มีผู้ช่วย ผู้เช่า | ผู้ช่วย · ผู้เช่า | 200 · 403 | ✅ `line-app/smoke-usecases.js › TC-06-2` |
| TC-06-3 | รายรับงวดก่อนไม่อยู่ใน `/api/rooms` | 201 จ่ายแล้วเดือน ต.ค. · มีบิล พ.ย. unpaid | GET `/api/rooms` · แล้ว `/api/bill?room=201&period=2026-10` | `/api/rooms` เห็นแค่ พ.ย. · งวด ต.ค. อ่านได้จาก `/api/bill` (paid, 4,000) | ✅ `line-app/smoke-usecases.js › TC-06-3` |
| TC-06-4 | หน้ารายงานแสดงตัวเลข ตรงกับข้อมูลจริง | LIFF จริง · มีบิลหลายสถานะ | เจ้าของเปิด "รายงานรายรับ" | ยอดรับ/รอตรวจ/ค้างตรงกับที่ผู้เช่าและเจ้าของทำจริง | 🖐 ทดสอบมือกับ LINE จริง |
| TC-06-5 | รายรับรายเดือนย้อนหลังและเทียบเดือน | มีบิลหลายเดือน | `GET /v1/reports/summary?period=YYYY-MM` ต่อเดือน | ยอดต่อเดือนถูกต้อง (paid/pending/unpaid/billed) — **ยังไม่มีหน้าจอเทียบหลายเดือนใน LIFF** | ✅ `backend/tests/test_reports.py` |
| TC-06-6 | แยกรายรับตามวันที่ชำระ (`paidAt`) ไม่ใช่ตามงวด | บิลงวด ต.ค. ชำระวันที่ 2 พ.ย. | ดูรายรับเดือน พ.ย. | `GET /api/bill?income=YYYY-MM` (เจ้าของ/ผู้ช่วย) นับตามเดือนของ `paidAt` เวลาไทย ไม่ดูงวดของบิล: บิล ต.ค. ที่จ่าย 2 พ.ย. เป็นรายรับ พ.ย. ไม่ใช่ ต.ค. · บิลงวด ธ.ค. ที่ออกก่อนและจ่าย 20 พ.ย. นับเป็นรายรับ พ.ย. (ไม่ใช่ ธ.ค.) · อ่านทุกงวดในดัชนีตั้งแต่ เดือน−12 ขึ้นไปไม่มีเพดานบน (ไม่นับเฉพาะบิลที่จ่ายช้ากว่างวดเกิน 12 เดือน) · นับเฉพาะ `paid` (void ไม่นับ) · ผู้เช่า 403 · เดือนผิดรูป 400 | ✅ `line-app/smoke-usecases.js › TC-06-6` |
| TC-06-7 | backend: summary ของงวด (paid/pending/unpaid/total) | — | `GET /v1/invoices?period=` | ผลรวมตรง | ✅ `backend/tests/test_billing.py::test_invoices_of_a_period_with_overdue_days_and_summary` |
| TC-06-8 | backend: `GET /v1/reports/summary` (เงิน + จำนวนห้อง) | มีบิล paid/pending/unpaid ในงวด | เรียกด้วยเจ้าของ/ผู้เช่า/หออื่น | `billed = paid+pending+unpaid` ตรงกับ `/v1/invoices` · `rooms_total` = ทุกห้อง · `rooms_overdue` นับเฉพาะ unpaid ที่เลยกำหนด · ผู้เช่า 403 · หออื่นได้ 0 | ✅ `backend/tests/test_reports.py` (5 เทสต์) |

## UC-07 เพิ่ม/ถอนเจ้าของและผู้ช่วย

**ผู้กระทำ:** เจ้าของหอ

(เพิ่มเข้ามาหลังแผนภาพ) บทบาท: **เจ้าของคนแรก (root)** = `OWNER_USER_ID` ตั้งมือ ถอนไม่ได้ · **เจ้าของร่วม** · **ผู้ช่วย (viewer)** ดูอย่างเดียว เจ้าของคนแรกสร้างรหัสเชิญ (หมดอายุ 10 นาที ใช้ได้ครั้งเดียว) ผู้ถูกเชิญสแกน QR เพื่อรับสิทธิ์ เจ้าของร่วมเชิญได้เฉพาะผู้ช่วย รหัสผิดเกิน 10 ครั้ง/ชั่วโมงถูกล็อก เจ้าของคนแรกถอนสิทธิ์ได้ (เมนู LINE กลับเป็นของผู้เช่า รหัสที่คนนั้นเคยสร้างใช้ไม่ได้อีก)

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/owner.js` (`members`, `invite`, `accept`, `revoke`)
- `line-app/api/_auth.js` (`roleOf`, `isRoot`)
- `line-app/api/_limit.js`
- `line-app/api/me.js`

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-07-1 | เจ้าของคนแรกเชิญผู้ช่วย | root ล็อกอิน | POST `/api/owner` `{role:"viewer"}` | รหัส 8 ตัว (ไม่มี 0/O/1/I/L) · role viewer · ลิงก์ `?owner=` + QR · หมดอายุภายใน 10 นาที | ✅ `line-app/smoke-usecases.js › TC-07-1` |
| TC-07-2 | ผู้ช่วยใช้รหัส | มีรหัสผู้ช่วย | ผู้ช่วยส่งรหัส (ตัวพิมพ์เล็กก็ได้) | role viewer · ได้เมนูเจ้าของ · root ได้ข้อความแจ้ง · ดู `/api/rooms` ได้ · ออกบิล/เชิญ/ดู QR ห้องไม่ได้ (403) | ✅ `line-app/smoke-usecases.js › TC-07-2` |
| TC-07-3 | เจ้าของคนแรกเชิญเจ้าของร่วม | root | สร้างรหัส (role ค่าเริ่มต้น = owner) แล้วอีกคนใช้ | ได้ role owner · ออกบิลได้ · เชิญ owner เพิ่มไม่ได้ (403) · เชิญ viewer ได้ | ✅ `line-app/smoke-usecases.js › TC-07-3` |
| TC-07-4 | ผู้เช่า/ผู้ช่วย/ไม่ล็อกอินเชิญไม่ได้ | — | POST `/api/owner` | 403 · 403 · 401 | ✅ `line-app/smoke-usecases.js › TC-07-4` |
| TC-07-5 | รหัสใช้ได้ครั้งเดียว | รหัสถูกใช้แล้ว | คนอื่นใช้รหัสเดิม | 410 INVITE_EXPIRED · ไม่ได้สิทธิ์ | ✅ `line-app/smoke-usecases.js › TC-07-5` |
| TC-07-6 | รหัสหมดอายุ | รหัสเกิน 10 นาที | ใช้รหัส | 410 · ไม่ได้สิทธิ์ | ✅ `line-app/smoke-usecases.js › TC-07-6` |
| TC-07-7 | เดารหัสผิด · rate limit | — | ส่งรหัสผิด 10 ครั้ง แล้วส่งรหัสที่ถูก | ผิด 404 · ครั้งถัดไป 429 TOO_MANY_ATTEMPTS แม้รหัสถูก | ✅ `line-app/smoke-usecases.js › TC-07-7` |
| TC-07-8 | ยังไม่ตั้ง `OWNER_USER_ID` | env ไม่ถูกตั้ง | ใช้รหัสเชิญ | 409 INVALID_STATE · ไม่ได้สิทธิ์ | ✅ `line-app/smoke-usecases.js › TC-07-8` |
| TC-07-9 | คนที่เป็นเจ้าของ/ผู้ช่วยอยู่แล้วใช้รหัส | เจ้าของร่วมมีสิทธิ์อยู่ · ผู้ช่วยมีสิทธิ์อยู่ | ใช้รหัสผู้ช่วย · แล้วอีกคนใช้รหัสเดิม | `already:true` · ไม่ถูกลดสิทธิ์ · รหัสถูกทำเครื่องหมายใช้แล้ว (`usedAt`/`usedBy`) — คนอื่นใช้ต่อได้ไม่ได้ (410) | ✅ `line-app/smoke-usecases.js › TC-07-9` |
| TC-07-10 | รายชื่อเจ้าของ/ผู้ช่วย | มี root + เจ้าของร่วม + ผู้ช่วย + รหัสเชิญค้างอยู่ | GET `/api/owner` ด้วยบทบาทต่าง ๆ | root เห็น userId · เจ้าของร่วมไม่เห็น · ผู้ช่วย/ผู้เช่า 403 · ไม่ปนรหัสเชิญ | ✅ `line-app/smoke-usecases.js › TC-07-10` |
| TC-07-11 | root ถอนสิทธิ์ | ผู้ช่วยมีสิทธิ์อยู่ | DELETE `/api/owner` `{userId}` | สิทธิ์และ `menu:` หาย · เมนู LINE กลับค่าเริ่มต้น · ผู้ถูกถอนได้ข้อความ · เข้า `/api/rooms` ไม่ได้ · ถอนซ้ำ 404 | ✅ `line-app/smoke-usecases.js › TC-07-11` |
| TC-07-12 | ถอนสิทธิ์ผิดเงื่อนไข | — | เจ้าของร่วมถอน · root ถอนตัวเอง · userId ผิดรูปแบบ | 403 · 409 · 400 | ✅ `line-app/smoke-usecases.js › TC-07-12` |
| TC-07-13 | รหัสของคนที่ถูกถอนใช้ไม่ได้ | เจ้าของร่วมสร้างรหัสผู้ช่วยไว้ | root ถอนเจ้าของร่วม แล้วมีคนใช้รหัส | 410 · ไม่ได้สิทธิ์ | ✅ `line-app/smoke-usecases.js › TC-07-13` |
| TC-07-14 | `/api/me` บอกบทบาทถูกต้อง | root · ผู้ช่วย · ผู้เช่า · คนทั่วไป | GET `/api/me` ของแต่ละคน | root: role owner/root true/ได้เมนูเจ้าของ · viewer · ผู้เช่า: role null + ห้อง · ไม่ล็อกอิน 401 | ✅ `line-app/smoke-usecases.js › TC-07-14` |
| TC-07-15 | สแกน QR เชิญด้วย LINE จริง · เมนูเจ้าของสลับ · ถอนแล้วเมนูกลับ | LINE OA + rich menu จริง | สร้างรหัส สแกนด้วยอีกบัญชี แล้วถอน | บัญชีใหม่เห็นเมนูเจ้าของ/ผู้ช่วย · หลังถอนกลับเมนูผู้เช่า | 🖐 ทดสอบมือกับ LINE จริง |
| TC-07-16 | ผู้ถูกเชิญเลือกบทบาทเองไม่ได้ (ส่ง `role` ใน body ตอนใช้รหัส) | มีรหัสผู้ช่วย | ส่ง `{code, role:"owner"}` | ได้ role ตามที่รหัสกำหนดเท่านั้น (body ถูกเมิน) | ✅ `line-app/smoke-handlers.js` (small guards) |

## UC-08 เปลี่ยนผู้เช่า / หมุน QR ห้อง

**ผู้กระทำ:** เจ้าของหอ

(เพิ่มเข้ามาหลังแผนภาพ) `GET /api/qr?room=` ให้รหัส/QR ประจำห้อง (สร้างครั้งแรกที่ขอ) `POST /api/qr?room=` = เปลี่ยนผู้เช่า: ออกรหัสใหม่ QR เดิมใช้ไม่ได้ ผู้เช่าปัจจุบันถูกปลดผูกทั้งสองทาง QR ที่ติดหน้าห้องผูกได้เฉพาะตอนห้องว่าง ทุกครั้งที่ผู้เช่าออก (เจ้าของกดเปลี่ยนผู้เช่า — แม้ห้องว่าง — หรือผู้เช่าย้ายออกด้วย `confirmMove`) ระบบเขียน `tenancy:<ห้อง>` = {since} และ `/api/run` ใส่ `issuedAt` ให้ทุกบิล ผู้เช่าเห็นเฉพาะบิลที่ออกตั้งแต่ `since` (ห้องที่ไม่เคยเปลี่ยนผู้เช่าเห็นทั้งหมดเหมือนเดิม) เจ้าของ/ผู้ช่วยเห็นทุกบิล สลิปล่วงหน้าของผู้เช่าเก่าถูกเก็บเข้า `prepay-old:<ห้อง>:<slipAt>`

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/qr.js` (`roomQr`, `ensureCode`, `unbindRoom`)
- `line-app/api/_qr.js`
- `line-app/liff/bill.html` (หน้า QR ห้อง + ปุ่ม "ยกเลิกผู้เช่า (ย้ายออก)" ในการ์ดผู้เช่าของหน้าจดมิเตอร์)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-08-1 | เจ้าของขอ QR ห้อง | ห้อง 203 มีผู้เช่า | GET `/api/qr?room=203` สองครั้ง | รหัส 10 ตัว · ลิงก์ `liff.line.me/<LIFF_ID>?bind=<รหัส>` · มี SVG · ครั้งที่สองได้รหัสเดิม · ไม่ปลดผู้เช่า | ✅ `line-app/smoke-usecases.js › TC-08-1` |
| TC-08-2 | เปลี่ยนผู้เช่า / ยกเลิกผู้เช่า | Alice ผูก 203 และมีบิล | POST `/api/qr?room=203` · หรือในแอป: หน้าจดมิเตอร์ห้อง 203 → การ์ด "ผู้เช่าในห้อง" → **"ยกเลิกผู้เช่า (ย้ายออก)"** | รหัสใหม่ · `rotated`/`unbound` true · `room-user`/`user-room` ถูกล้าง · QR เก่า 404 · Alice อ่านบิลไม่ได้ (400/403) · ปุ่มต้องยืนยันก่อน (บอกว่าบิลค้างยังอยู่) · ผู้ช่วย (viewer) ไม่เห็นปุ่ม | ✅ `line-app/smoke-usecases.js › TC-08-2` (API · ปุ่มในหน้าจอเป็นตัวเรียก API ตัวเดียวกัน) |
| TC-08-3 | ผู้เช่าใหม่ผูกด้วยรหัสใหม่ | หลังเปลี่ยนผู้เช่า | Bob สแกนรหัสใหม่ | ผูกสำเร็จ · เจ้าของได้รับแจ้ง | ✅ `line-app/smoke-usecases.js › TC-08-3` |
| TC-08-4 | หมุน QR ห้องว่าง | ห้อง 204 ไม่มีผู้เช่า | POST `/api/qr?room=204` | รหัสใหม่ · `unbound:false` | ✅ `line-app/smoke-usecases.js › TC-08-4` |
| TC-08-5 | สิทธิ์และข้อผิดพลาด | — | ผู้เช่า/ผู้ช่วย/ไม่ล็อกอิน เรียก GET/POST · ห้อง 999 · DELETE | 403 · 403 · 401 (POST ที่ถูกปฏิเสธไม่ปลดใคร) · 404 · 405 | ✅ `line-app/smoke-usecases.js › TC-08-5` |
| TC-08-6 | ทั้งเส้นทาง: ผู้เช่าใหม่ไม่เห็นบิล/สลิปของผู้เช่าเก่า | Alice มีบิลพ.ย.+สลิป pending | เจ้าของ "เปลี่ยนผู้เช่า" → Bob ผูกด้วยรหัสใหม่ → Bob เปิดบิล/งวด/ประวัติ/รูปสลิป → เจ้าของออกบิลธ.ค. | Bob ได้ 404 NOT_FOUND ทั้งบิลล่าสุด/`period=2026-11`/รูปสลิป · ประวัติว่าง · หลังออกบิลธ.ค. เห็นเฉพาะธ.ค. (ประวัติ=[2026-12]) | ✅ `line-app/smoke-usecases.js › TC-08-6` |
| TC-08-7 | เจ้าของและผู้ช่วยยังเห็นของผู้เช่าเก่า | หลังเปลี่ยนผู้เช่า | เจ้าของ/ผู้ช่วยอ่านบิล งวด ประวัติ รูปสลิปของห้อง | 200 ครบทุกอย่าง (กรองเฉพาะฝั่งผู้เช่า) | ✅ `line-app/smoke-usecases.js › TC-08-7` |
| TC-08-8 | ผู้เช่าใหม่แนบสลิป ขณะบิลล่าสุดเป็นของคนเก่า (ยังไม่จ่าย) | บิลเก่า unpaid ของ Alice | Bob POST `/api/slip` | เข้าทางโอนล่วงหน้า (`status:"advance"`) · บิลของ Alice ไม่เปลี่ยน · `prepay.by`=Bob | ✅ `line-app/smoke-usecases.js › TC-08-8` |
| TC-08-9 | พิมพ์ "บิล" ในแชท | หลังเปลี่ยนผู้เช่า | Alice พิมพ์ก่อน Bob พิมพ์หลังผูก | Alice ได้การ์ด · Bob ได้ "ยังไม่มีบิลรอบนี้" (ข้อความ ไม่ใช่การ์ดของคนเก่า) | ✅ `line-app/smoke-usecases.js › TC-08-9` |
| TC-08-10 | เจ้าของยืนยันบิลของผู้เช่าเก่าหลังเปลี่ยนผู้เช่า | บิล pending ของ Alice · Bob ผูกห้องแล้ว | เจ้าของกดยืนยัน | บิล paid · ไม่ push "ชำระเงินแล้ว" หา Bob · เจ้าของได้คำตอบปกติ | ✅ `line-app/smoke-usecases.js › TC-08-10` |
| TC-08-11 | สลิปโอนล่วงหน้าของผู้เช่าเก่าไม่ตกไปผู้เช่าใหม่ | Alice มี `prepay:203` | เจ้าของเปลี่ยนผู้เช่า → Bob ผูก → ออกบิล · เปลี่ยนผู้เช่าอีกครั้ง | ตอบ `prepayArchived:true` · เก็บเป็น `prepay-old:203:<slipAt>` (รูปยังอยู่) · `prepay:203`=null · เจ้าของได้ข้อความให้ตรวจ/คืนเงิน · บิลของ Bob เป็น unpaid ไม่ติดสลิป · ครั้งที่สองไม่มี `prepayArchived` | ✅ `line-app/smoke-usecases.js › TC-08-11` |
| TC-08-12 | ผู้เช่าย้ายออกด้วย `confirmMove` | Bob ผูก 203 มีบิล | Bob ย้ายไป 204 (confirmMove) แล้ว Carol ผูก 203 | เขียน `tenancy:203` (ห้องที่ออก) · ไม่เขียน `tenancy:204` · การผูกห้องเฉย ๆ ไม่เขียน tenancy · Carol ไม่เห็นบิลของ Bob | ✅ `line-app/smoke-usecases.js › TC-08-12` |
| TC-08-13 | เปลี่ยนผู้เช่าห้องว่าง · บิลระบบเก่าที่ไม่มี `issuedAt` | ห้อง 203 ไม่มีผู้เช่า มีบิลไม่มี `issuedAt` | เจ้าของเปลี่ยนผู้เช่า แล้ว Bob ผูก | `unbound:false` แต่เขียน `tenancy:203` · Bob ไม่เห็นบิลเก่า (บิลไม่มี `issuedAt` ถือว่าเก่ากว่าทุก tenancy) · เจ้าของยังเห็น | ✅ `line-app/smoke-usecases.js › TC-08-13` |
| TC-08-14 | ห้องที่ยังไม่เคยเปลี่ยนผู้เช่า (ไม่มี tenancy) แสดงบิลเก่าเหมือนเดิม | ผู้เช่าเดิม บิลไม่มี `issuedAt` | อ่านบิล/งวด/ประวัติ/แชท | เห็นทั้งหมด (ย้อนหลังเข้ากันได้) | ✅ `line-app/smoke-usecases.js › TC-08-14` |
| TC-08-15 | บิลที่ออกใหม่ทุกใบมี `issuedAt` | — | POST `/api/run` | `issuedAt` เป็นเวลาออกบิล | ✅ `line-app/smoke-usecases.js › TC-08-15` |
| TC-08-16 | เจ้าของพิมพ์/แสดง QR จริงและผู้เช่าสแกนด้วยกล้อง LINE | LINE + LIFF จริง | เปิดหน้า QR ห้อง · สแกนด้วยมือถือ · ย่อ/ขยายหน้าจอ | QR ไม่ถูกตัดขอบ (มี viewBox) สแกนติด | 🖐 ทดสอบมือกับ LINE จริง |
| TC-08-17 | หน้าจอผู้เช่าใหม่หลังเปลี่ยนผู้เช่า แสดง "ยังไม่มีบิลรอบนี้" และประวัติว่าง | LIFF จริง | ผู้เช่าใหม่ผูกแล้วเปิดหน้าบิลและประวัติ | ไม่เห็นบิล/สลิปของคนก่อน | 🖐 ทดสอบมือกับ LINE จริง |
| TC-08-19 | เจ้าของ/ผู้ช่วยสแกน QR หน้าห้องตัวเอง (ทดสอบสติกเกอร์) | บัญชี role owner/viewer | สแกน QR ห้องที่ยังว่าง | ขึ้นกล่องยืนยัน "ผูกเป็นผู้เช่าห้องนี้จริงหรือไม่?" · กดยกเลิก → กลับหน้าหลัก ไม่ผูกห้อง (สติกเกอร์ยังใช้ได้กับผู้เช่าจริง) | 🖐 LIFF (ตรวจในเบราว์เซอร์ LINE) |

## UC-09 ผูกบัญชี LINE กับห้อง

**ผู้กระทำ:** ผู้เช่า

ผู้เช่าสแกน QR หน้าห้อง (`?bind=<รหัส>` ใน LIFF) → `POST /api/qr {code}` ผูก LINE กับห้องสองทาง (`user-room:`/`room-user:`) ได้เมนู LINE ของผู้เช่า เจ้าของได้แจ้ง กฎ: ห้องที่มีผู้เช่าแล้ว 409 (`ROOM_TAKEN`) · คนที่มีห้องอื่นอยู่ต้อง `confirmMove:true` · เดารหัสผิดเกิน 10 ครั้ง/ชั่วโมงถูกล็อก (ห้องมีคนแล้ว **ไม่นับ** เป็นเดาผิด) ฝั่ง backend ใช้ลิงก์เชิญต่อผู้เช่า (`/v1/auth/line/link`)

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/qr.js` (`bind`)
- `line-app/api/_limit.js`
- `line-app/api/webhook.js` (follow, ข้อความ "บิล")
- `line-app/api/me.js`
- backend: `backend/app/routes/auth.py`, `backend/app/routes/invites.py`, `backend/app/invites.py`

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-09-1 | ผู้เช่าสแกน QR ห้องว่าง | เจ้าของขอ QR ห้อง 203 | Alice ส่งรหัส (พิมพ์เล็ก/มีช่องว่างท้าย) | ผูกสองทาง · ได้เมนูผู้เช่า · เจ้าของได้แจ้ง · `/api/me` ได้ room 203 | ✅ `line-app/smoke-usecases.js › TC-09-1` |
| TC-09-2 | รหัส QR ไม่มีจริง | — | ส่งรหัสมั่ว | 404 · ไม่ผูกอะไร | ✅ `line-app/smoke-usecases.js › TC-09-2` |
| TC-09-3 | เดารหัสผิดครบ 10 ครั้ง | — | ผิด 10 ครั้ง แล้วส่งรหัสถูก | ผิด 404 · ถัดไป 429 · ไม่ผูก | ✅ `line-app/smoke-usecases.js › TC-09-3` |
| TC-09-4 | ห้องมีผู้เช่าแล้ว | Alice ผูก 203 | Mallory สแกนรหัสห้อง 203 ซ้ำเกิน 10 ครั้ง | 409 ROOM_TAKEN ทุกครั้ง · Alice ยังถือห้อง · ไม่ถูกล็อก (ผูกห้องว่าง 204 ได้) | ✅ `line-app/smoke-usecases.js › TC-09-4` |
| TC-09-5 | สแกนห้องตัวเองซ้ำ | Alice ผูก 203 | สแกนรหัส 203 อีก | 200 · ไม่ส่งแจ้งเจ้าของซ้ำ | ✅ `line-app/smoke-usecases.js › TC-09-5` |
| TC-09-6 | ย้ายห้องต้องยืนยัน | Bob ผูก 203 | สแกน 204 → ส่งซ้ำพร้อม `confirmMove:true` | ครั้งแรก 409 MOVE_CONFIRM_REQUIRED (`current`=203) · ยืนยันแล้ว 203 ว่าง · 204 เป็นของ Bob · เจ้าของได้แจ้ง "ย้ายจากห้อง 203" | ✅ `line-app/smoke-usecases.js › TC-09-6` |
| TC-09-7 | `confirmMove` ต้องเป็น boolean true | Bob ผูก 203 | ส่ง `confirmMove:"true"` | ยัง 409 | ✅ `line-app/smoke-usecases.js › TC-09-7` |
| TC-09-8 | ตั้งเมนู LINE ล้มเหลว | LINE ตอบ 500 | ผูกห้อง | ผูกสำเร็จ | ✅ `line-app/smoke-usecases.js › TC-09-8` |
| TC-09-9 | คำขอไม่ครบ/ผิดวิธี | — | ไม่ส่ง room/code · GET พร้อม code · ไม่ล็อกอิน | 400 · 405 (ไม่ผูก) · 401 | ✅ `line-app/smoke-usecases.js › TC-09-9` |
| TC-09-10 | เพิ่มเพื่อน OA และพิมพ์ "บิล" ก่อนผูกห้อง | — | follow event · ข้อความ "บิล" | ได้ข้อความต้อนรับ/บอกให้สแกน QR · ได้คำตอบ "ยังไม่ได้ผูกห้อง" | ✅ `line-app/smoke-usecases.js › TC-09-10` |
| TC-09-11 | ผูกห้องด้วยมือถือจริง: สแกน QR → LIFF เปิด → ผูก → เมนูผู้เช่าเปลี่ยน | LINE + LIFF จริง | สแกน QR หน้าห้องด้วยกล้อง LINE | หน้า LIFF ถามยืนยันถ้ามีห้องอยู่แล้ว · ผูกแล้วเห็นบิลของห้อง | 🖐 ทดสอบมือกับ LINE จริง |
| TC-09-12 | backend: ลิงก์เชิญผูก LINE ต่อผู้เช่า — สร้าง/ยกเลิกของเก่า/จำกัดเจ้าของหอ | owner login | `POST /v1/rooms/{room}/invite` | ได้รหัสสำหรับผู้เช่าห้องนั้น · ออกใหม่ยกเลิกใบเก่า · ผู้เช่าที่มี LINE แล้วเชิญไม่ได้ | ✅ `backend/tests/test_line_link.py::test_invite_targets_the_rooms_tenant_without_line`<br>`backend/tests/test_line_link.py::test_a_new_invite_for_the_same_tenant_cancels_the_old_one`<br>`backend/tests/test_line_link.py::test_cannot_invite_for_a_tenant_who_already_has_line`<br>`backend/tests/test_line_link.py::test_only_the_dorms_owner_can_invite` |
| TC-09-13 | backend: ผูก LINE กับห้อง แล้วล็อกอิน | ผู้เช่าได้รหัส | `POST /v1/auth/line/link` | ผูกสำเร็จ ได้ session · ล็อกอินครั้งถัดไปเจอห้อง · เปิดลิงก์ซ้ำได้โดยคนเดิม · รหัสพิมพ์เล็ก/เว้นวรรคได้ | ✅ `backend/tests/test_line_link.py::test_linking_binds_line_to_the_room_and_logs_in`<br>`backend/tests/test_line_link.py::test_after_linking_a_plain_login_finds_the_room`<br>`backend/tests/test_line_link.py::test_the_same_person_can_open_the_link_twice`<br>`backend/tests/test_line_link.py::test_code_typed_in_lower_case_with_spaces_still_works` |
| TC-09-14 | backend: รหัสใช้ไม่ได้ — คนอื่นใช้ซ้ำ · ไม่รู้จัก · หมดอายุ · ถูกยกเลิก · เล่นซ้ำ | — | ใช้รหัสเหล่านั้น | ถูกปฏิเสธ | ✅ `backend/tests/test_line_link.py::test_someone_else_cannot_reuse_a_used_code`<br>`backend/tests/test_line_link.py::test_unknown_code`<br>`backend/tests/test_line_link.py::test_expired_code`<br>`backend/tests/test_line_link.py::test_revoked_code`<br>`backend/tests/test_line_link.py::test_an_expired_code_cannot_be_replayed_even_by_the_person_who_used_it`<br>`backend/tests/test_line_link.py::test_a_revoked_code_cannot_be_replayed_even_by_the_person_who_used_it` |
| TC-09-15 | backend: 1 LINE ต่อ 1 ห้อง · เพิ่มรูมเมต · 503 ถ้ายังไม่ตั้ง LINE · เดารหัสถูกจำกัด | — | — | ตามสัญญา | ✅ `backend/tests/test_line_link.py::test_one_line_account_cannot_hold_two_rooms`<br>`backend/tests/test_line_link.py::test_an_invite_for_a_room_whose_tenant_is_linked_adds_a_roommate`<br>`backend/tests/test_line_link.py::test_link_answers_503_until_line_is_configured`<br>`backend/tests/test_line_link.py::test_guessing_codes_is_rate_limited` |
| TC-09-16 | backend: ถอนผูก LINE / ย้ายออก ทำให้ session เดิมหมดสิทธิ์ · หอพักอื่นถอนไม่ได้ | ผูกแล้ว | `DELETE /v1/tenants/{id}/line` | session เดิมใช้ไม่ได้ · ข้ามหอ 404/403 | ✅ `backend/tests/test_line_link.py::test_unlink_makes_the_next_login_not_linked`<br>`backend/tests/test_line_link.py::test_unlinking_ends_the_tenants_existing_session`<br>`backend/tests/test_line_link.py::test_moving_out_ends_the_tenants_existing_session`<br>`backend/tests/test_line_link.py::test_another_dorm_cannot_unlink` |
| TC-09-17 | backend: idToken ของ LINE — ถูก channel / ผิด channel / session หมดอายุ / ถูกแก้ | — | `POST /v1/auth/line` | รับ/ปฏิเสธตามสัญญา | ✅ `backend/tests/test_session_and_line.py::test_verify_id_token_accepts_matching_channel`<br>`backend/tests/test_session_and_line.py::test_verify_id_token_rejects_other_channel`<br>`backend/tests/test_session_and_line.py::test_tampered_token_is_rejected`<br>`backend/tests/test_session_and_line.py::test_expired_token_is_rejected` |
| TC-09-18 | 1 ห้องมีผู้เช่ามากกว่า 1 คน (รูมเมท) | ผู้เช่าหลักผูกห้องอยู่แล้ว | เจ้าของกด "เพิ่มผู้เช่า (สมาชิก)" → คนที่สองสแกน · สแกนซ้ำ · บัญชีที่สามลองสแกน QR ประตู · เปลี่ยนผู้เช่า | สมาชิกถูกเพิ่มโดยไม่เปลี่ยนคนหลัก · `room-users` มี 2 บัญชี · สแกนซ้ำได้ `already:true` · QR ประตูยัง `409 ROOM_TAKEN` · เปลี่ยนผู้เช่าแล้วสมาชิกและรหัสเชิญถูกล้าง · การ์ด/ทวง/ใบเสร็จยังส่งหาคนหลัก | ✅ `line-app/smoke-handlers.js` (room members) |
| TC-09-19 | ผู้เช่ายังไม่ได้เพิ่ม OA เป็นเพื่อน — ผูกห้องแล้วไม่ได้รับการ์ดบิล | บัญชีที่ยังไม่ follow OA | สแกน QR หน้าห้อง → ผูกสำเร็จ | ผูกเสร็จขึ้นหน้า **"ผูกห้องแล้ว"** + การ์ด "ยังไม่ได้เพิ่ม DormPlus เป็นเพื่อน" + ปุ่ม **"เพิ่มเพื่อน DormPlus"** (`liff.requestFriendship()`) + ปุ่ม "ไปหน้าบิลของฉัน" · เพิ่มเพื่อนแล้วการ์ดหายเอง (อ่าน `friendFlag` ใหม่แล้วเรนเดอร์) · หน้าใบแจ้งหนี้ก็ยังมีการ์ดนี้ถ้ายังไม่เพิ่ม · ถ้า `getFriendship()` ตอบไม่ได้ (ไม่ใช่ LIFF browser / OA ไม่ได้ผูกกับ Login channel) → **ไม่ขึ้นการ์ด** และไปหน้าบิลเลย (ไม่เดา) | 🖐 ทดสอบมือกับ LINE จริง (ต้องเป็น Full-size LIFF) |
| TC-09-20 | backend: ผู้เช่าที่เคยย้ายออกแล้วกลับมาห้องเดิม ถูกเชิญอีกครั้งไม่พัง 500 | t_203 ย้ายออกแล้ว (`moved_out` ในอดีต) และยังถือ `line_user_id` | เจ้าของออก QR/รหัสใหม่ให้บัญชีเดิมของห้องเดิม | **200** — แถวที่ย้ายออกคืน unique key (`line_user_id = null`, เก็บประวัติไว้) แล้วผูกใหม่ได้ · มีแถวที่ถือ key เดียว ไม่ซ้ำ ไม่ 500 (`IntegrityError` จาก unique `(room_id, line_user_id)`) | ✅ `backend/tests/test_line_link.py::test_the_same_person_can_come_back_to_the_same_room` |

## UC-10 ดูบิล

**ผู้กระทำ:** ผู้เช่า (เจ้าของ/ผู้ช่วยดูได้ทุกห้อง)

`GET /api/bill` — ผู้เช่าเห็นเฉพาะห้องที่ผูก (ไม่ต้องส่ง `room`) เจ้าของ/ผู้ช่วยระบุ `room` ได้ทุกห้อง ตัวเลือก `period=YYYY-MM` (บิลงวดนั้น) หรือ `history=1` (รายการงวดทั้งหมด ใหม่→เก่า) ในแชทพิมพ์ "บิล"/"bill" ได้การ์ดบิลล่าสุด (บิลที่ถูกยกเลิก — ได้ข้อความเหตุผลแทนการ์ดจ่ายเงิน, UC-18) บิลที่จ่ายแล้วมี `receiptNo` และรายการประวัติมี `receiptNo` ต่องวด (UC-15)

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/bill.js`
- `line-app/api/webhook.js` (ข้อความ "บิล")
- `line-app/api/_line.js` (`billBubble`)
- `line-app/liff/bill.html` (หน้าบิลผู้เช่า)
- backend: `backend/app/routes/me.py`

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-10-1 | ผู้เช่าดูบิลล่าสุดของห้องตัวเอง | Utenant ผูก 201 · ออกบิลแล้ว | GET `/api/bill` (ไม่ส่ง room) | ห้อง/งวด/ค่าเช่า/น้ำ/ไฟ/รวม/สถานะ/due ครบ · `hasSlip:false` · `no-store` | ✅ `line-app/smoke-usecases.js › TC-10-1` |
| TC-10-2 | ดูบิลตามงวด | มีบิล ต.ค. และ พ.ย. | `?period=2026-10` | ได้บิลงวด ต.ค. | ✅ `line-app/smoke-usecases.js › TC-10-2` |
| TC-10-3 | ประวัติบิล | ออกบิล 2 งวด | `?history=1` | รายการงวดใหม่→เก่า มี total/status/due/hasSlip/`receiptNo` (null ถ้ายังไม่จ่าย) | ✅ `line-app/smoke-usecases.js › TC-10-3` |
| TC-10-4 | ประวัติของระบบเก่าที่ไม่มีดัชนี | มีแค่ `bill:201` | `?history=1` | ไม่ว่าง (มีงวดของบิลล่าสุด) | ✅ `line-app/smoke-usecases.js › TC-10-4` |
| TC-10-5 | ผู้เช่าอ่านห้องอื่นไม่ได้ | Utenant ผูก 201 | ระบุ `room=202` (ปกติ/period/history) | 403 ทุกกรณี | ✅ `line-app/smoke-usecases.js › TC-10-5` |
| TC-10-6 | ข้อผิดพลาดพื้นฐาน | — | ยังไม่ผูกห้อง · ผูกแล้วไม่มีบิล · ไม่ล็อกอิน | 400 · 404 NOT_FOUND · 401 | ✅ `line-app/smoke-usecases.js › TC-10-6` |
| TC-10-7 | period ผิดรูปแบบ/ไม่มีบิล | มีบิล พ.ย. | `period=2026-1` · `period=2025-01` | 400 · 404 | ✅ `line-app/smoke-usecases.js › TC-10-7` |
| TC-10-8 | เจ้าของ/ผู้ช่วยอ่านทุกห้อง | มีผู้ช่วย | ระบุ `room=202` · ไม่ระบุ room | 200 · 400 | ✅ `line-app/smoke-usecases.js › TC-10-8` |
| TC-10-9 | พิมพ์ "บิล"/"bill" ในแชท | ผูกห้อง 201 | พิมพ์ "บิล" ก่อนมีบิล · "  Bill " หลังมีบิล | ตอบ "ห้อง 201 ยังไม่มีบิล" · ตอบการ์ดบิล (Flex) | ✅ `line-app/smoke-usecases.js › TC-10-9` |
| TC-10-10 | หน้าบิลใน LIFF แสดงรายการและสถานะถูกต้อง · ปุ่มแนบสลิป/ดูสลิป · ภาษาไทย/วันที่ | LIFF จริง | ผู้เช่าเปิดจากการ์ดใน LINE | แสดงบิลตรงกับ API · สลิปแสดงเฉพาะของห้องตัวเอง | 🖐 ทดสอบมือกับ LINE จริง |
| TC-10-12 | ผู้เช่าใหม่ไม่เห็นบิลของผู้เช่าเก่า (บิลล่าสุด/งวด/ประวัติ/แชท "บิล") | หลังเจ้าของเปลี่ยนผู้เช่า | ผู้เช่าใหม่อ่านบิล | 404 · ประวัติว่าง · แชทตอบ "ยังไม่มีบิล" — รายละเอียดที่ UC-08 | ✅ `line-app/smoke-usecases.js › TC-08-6` |
| TC-10-11 | backend: ผู้เช่าเห็นเฉพาะใบแจ้งหนี้ของห้องตัวเองจาก session | ผูก LINE แล้ว | `GET /v1/me/invoices` | รายการใบแจ้งหนี้ของห้อง (12 งวดล่าสุด) | ✅ `backend/tests/test_line_link.py::test_linking_binds_line_to_the_room_and_logs_in` |
| TC-10-13 | backend: เจ้าของอ่านบิลใบเดียวได้ทุกห้องของหอ | ออกบิลรอบ พ.ย. แล้ว | `GET /v1/invoices/:id` | 200 · `items` 3 บรรทัด (`ค่าเช่า`/`ค่าน้ำ`/`ค่าไฟ`) · `payment` = `null` ก่อนจ่าย | ✅ `backend/tests/test_billing.py::test_owner_reads_any_invoice_of_the_dorm` |
| TC-10-14 | backend: ผู้เช่าเห็นเฉพาะบิลห้องตัวเอง · ใบอื่น/หออื่น 404 · `payment` ขึ้นหลังแนบสลิป | ผู้เช่าห้อง 201 | `GET /v1/invoices/:id` | บิล 201 → 200 · บิล 202 → 404 · ใบของหออื่น → 404 · หลังแนบสลิป `status: pending`, `payment.verify_ok: null` | ✅ `backend/tests/test_billing.py::test_tenant_reads_own_room_invoice_only`<br>`backend/tests/test_billing.py::test_payment_appears_after_the_slip`<br>`backend/tests/test_billing.py::test_invoice_of_another_dorm_is_404` |
| TC-10-15 | backend: ผู้เช่าที่ไม่มี `room_id` ใน session ต้องถูกปฏิเสธ (ไม่เห็นทั้งหอ) | session `role=tenant` แต่ `room_id` ว่าง | `GET /v1/invoices/:id` | `403 FORBIDDEN` (fail closed) | ✅ `backend/tests/test_billing.py::test_a_tenant_without_a_room_is_refused` |
| TC-10-16 | backend: **หนี้เป็นของคน ไม่ใช่ของห้อง** — ผู้เช่าใหม่ไม่เห็นและแนบสลิปให้บิลก่อนตัวเองเข้าอยู่ไม่ได้ | ห้อง 201 มีบิล 2026-10 ของผู้เช่าเก่า · ผู้เช่าใหม่ `moved_in = 2026-11-01` | `GET /v1/me/invoices` · `GET /v1/invoices/:id` ของใบเก่า · แนบสลิปใบเก่า | เห็นเฉพาะงวด ≥ `2026-11` (session พก `since` จาก `tenants.moved_in` ทุกคำขอ) · ใบเก่าตอบ **404** ทั้งอ่านและแนบสลิป | ✅ `backend/tests/test_line_link.py::test_a_new_tenant_does_not_see_or_pay_the_previous_tenants_bills` |

## UC-11 แจ้งชำระ (แนบสลิป)

**ผู้กระทำ:** ผู้เช่า

`POST /api/slip` — ผู้เช่าแนบรูปสลิป (JPEG/PNG/WEBP ≤ 3MB, ไม่บังคับ) กับหมายเหตุ (≤ 500 ตัวอักษร) บิลเป็น `pending` และเจ้าของได้การ์ดยืนยัน กันใช้โควตาข้อความ: สลิปได้ไม่เกิน 5 ครั้งต่อบิล และห่างกันอย่างน้อย 30 วินาที (เจ้าของไม่ถูกจำกัด) ส่งใหม่แล้วรูปเก่าถูกลบ ดูรูป: `GET /api/slip-image` (เจ้าของ/ผู้ช่วย/ผู้เช่าห้องนั้น) **กรณียังไม่มีบิล บิลจ่ายแล้ว หรือบิลล่าสุดถูกยกเลิก อยู่ในหัวข้อ "แจ้งชำระก่อนบิลออก" (UC-17)** · สลิปหนึ่งใบครอบหลายงวด — UC-13

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/slip.js`
- `line-app/api/slip-image.js`
- `line-app/api/_line.js` (`confirmBubble`)
- `line-app/liff/bill.html` (ฟอร์มแนบสลิป)
- backend: `backend/app/routes/billing.py` (`attach_slip`)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-11-1 | แนบสลิป | บิล 201 unpaid · ผู้เช่าผูก 201 | POST `/api/slip` พร้อมรูป + หมายเหตุ | บิล pending · `slipCount`=1 · รูปถูกเก็บ · สองสำเนาตรงกัน · เจ้าของได้การ์ดที่มี `action=confirm&room=201&period=2026-11` | ✅ `line-app/smoke-usecases.js › TC-11-1` |
| TC-11-2 | แจ้งชำระโดยไม่แนบรูป | บิล unpaid | ผู้เช่าส่งแต่หมายเหตุ (ทั้งบิลเดียว หลายงวด และโอนล่วงหน้า; และบิล pending ที่เจ้าของบันทึกโดยไม่มีรูป) · เจ้าของส่งแต่หมายเหตุ | ผู้เช่าส่งสลิปครั้งแรกต้องแนบรูป (เปลี่ยนตามการตัดสินใจของผลิตภัณฑ์: ผู้เช่าต้องแนบรูปครั้งแรก): 400 `VALIDATION` "ต้องแนบรูปสลิป" · ไม่เขียนอะไร ไม่ push · เจ้าของ (เช่นรับเงินสด): 200 · pending · `hasSlip:false` · การแก้หมายเหตุของสลิปที่ส่งแล้วดู TC-11-17 | ✅ `line-app/smoke-usecases.js › TC-11-2` |
| TC-11-3 | รูปไม่ใช่ JPEG/PNG/WEBP · ใหญ่เกิน 3MB | บิล unpaid | ส่ง GIF · สตริงมั่ว · รูป 3MB+1 | 400 · 400 · 413 · บิลไม่เปลี่ยน · ไม่มีไฟล์ค้าง | ✅ `line-app/smoke-usecases.js › TC-11-3` |
| TC-11-4 | หมายเหตุยาวเกิน 500 / ไม่ใช่ข้อความ | บิล unpaid | 501 ตัวอักษร · เลข · 500 ตัวอักษร | 400 · 400 · 200 | ✅ `line-app/smoke-usecases.js › TC-11-4` |
| TC-11-5 | แจ้งแทนห้องอื่น/ไม่ผูกห้อง/ไม่ล็อกอิน/GET | Utenant ผูก 201 | `room=202` · Unobody · ไม่ล็อกอิน · GET | 403 (บิล 202 ไม่เปลี่ยน) · 400 · 401 · 405 | ✅ `line-app/smoke-usecases.js › TC-11-5` |
| TC-11-6 | ส่งถี่เกินไป | แจ้งแล้ว 1 ครั้ง | ส่งอีกทันที | 429 SLIP_TOO_SOON · `slipCount` ยัง 1 | ✅ `line-app/smoke-usecases.js › TC-11-6` |
| TC-11-7 | ครบ 5 ครั้งต่อบิล | ส่งมาแล้ว 5 ครั้ง (เว้นเกิน 30 วินาที) | ส่งครั้งที่ 6 · เจ้าของแนบแทน | 429 SLIP_LIMIT · เจ้าของยังแนบได้ (ไม่ถูกจำกัด) | ✅ `line-app/smoke-usecases.js › TC-11-7` |
| TC-11-8 | ส่งสลิปใหม่แทนใบเดิม | มีสลิปแล้ว | ส่งอีกใบ (หลัง 30 วินาที) | รูปเก่าถูกลบ เหลือใบใหม่ · `slipCount`=2 | ✅ `line-app/smoke-usecases.js › TC-11-8` |
| TC-11-9 | ส่งการ์ดหาเจ้าของล้มเหลว | LINE push ของเจ้าของตอบ 500 | ผู้เช่าแจ้งชำระ | ผู้เช่ายังสำเร็จ · บิล pending | ✅ `line-app/smoke-usecases.js › TC-11-9` |
| TC-11-10 | ดูรูปสลิป | บิลมีสลิป | ผู้เช่าเจ้าของห้อง · เจ้าของ · ผู้ช่วย · ผู้เช่าห้องอื่น · ไม่ล็อกอิน · บิลยังไม่มีสลิป | 200 (private, no-store) · 403 · 401 · 404 | ✅ `line-app/smoke-usecases.js › TC-11-10` |
| TC-11-11 | สถานะหลังแจ้งตรงกันทุกที่ | ออกบิลแล้ว | แจ้งแล้วเปิดบิลและประวัติ | บิล `pending`, `hasSlip` true · ประวัติตรงกัน | ✅ `line-app/smoke-usecases.js › TC-11-11` |
| TC-11-12 | แนบรูปสลิปจริงจากมือถือใน LIFF (ย่อรูป/อัปโหลด/แสดงผล) | LIFF จริง | ผู้เช่าเลือกรูปจากคลังภาพ กดส่ง | เห็นสถานะ "รอตรวจ" · เจ้าของได้การ์ดใน LINE | 🖐 ทดสอบมือกับ LINE จริง |
| TC-11-13 | สลิปที่ไม่มีรูปไม่ควรถูกยืนยันโดยเจ้าของโดยไม่เตือน | pending ที่เจ้าของบันทึกโดยไม่มีรูป | เจ้าของดูการ์ด | การ์ดไม่มีปุ่ม "ดูสลิป" และมีบรรทัดเตือน "ไม่มีรูปสลิป — ตรวจยอดเงินเข้าเองก่อนยืนยัน" (ยังกดยืนยันได้) · สลิปที่มีรูปไม่มีคำเตือนและมีปุ่ม · ผู้เช่าส่งสลิปครั้งแรกโดยไม่มีรูปไม่ได้ (TC-11-2) จึงเกิดได้เฉพาะเจ้าของบันทึก | ✅ `line-app/smoke-usecases.js › TC-11-13` |
| TC-11-16 | ผู้เช่าใหม่แนบสลิปขณะบิลล่าสุดเป็นของผู้เช่าเก่า | บิลเก่า unpaid ของผู้เช่าคนก่อน | ผู้เช่าใหม่แนบสลิป | เข้าทางโอนล่วงหน้า บิลเก่าไม่ถูกแตะ — รายละเอียดที่ UC-08 | ✅ `line-app/smoke-usecases.js › TC-08-8` |
| TC-11-14 | backend: สลิปทำให้ invoice เป็น pending บันทึกยอดและผลตรวจ `provider:manual` | billed | `POST /v1/invoices/{id}/slip` | pending | ✅ `backend/tests/test_slip_confirm_reject.py::test_slip_moves_the_invoice_to_pending`<br>`backend/tests/test_slip_confirm_reject.py::test_slip_keeps_the_url_the_page_sent` |
| TC-11-15 | backend: ห้องอื่นแจ้งไม่ได้ · ไม่มีห้องถูกปฏิเสธ · แจ้งซ้ำ 409 | — | — | 403/409 | ✅ `backend/tests/test_slip_confirm_reject.py::test_tenant_cannot_slip_another_rooms_invoice`<br>`backend/tests/test_slip_confirm_reject.py::test_tenant_without_a_room_is_refused`<br>`backend/tests/test_slip_confirm_reject.py::test_slipping_twice_conflicts` |
| TC-11-17 | แก้หมายเหตุบนสลิปที่ส่งแล้วโดยไม่แนบรูปใหม่ | บิล `pending` ที่มีรูปและผลตรวจแล้ว (หรือ `prepay:` ที่มีรูป) | ผู้เช่าส่งแต่หมายเหตุ (ห่างจากครั้งก่อนเกิน 30 วินาที) | 200 · `slipPath`/`slipVerify`/`slipAmount`/`overpaid` เดิมอยู่ครบ รูปไม่ถูกลบ ไม่เรียก SlipOK ใหม่ · `slipNote` ใหม่ `slipCount` +1 · เจ้าของได้การ์ดใหม่ · prepay ที่มีรูปแก้ได้เช่นกัน · บิลที่ยังไม่มีรูป/อยู่ในสลิปหลายงวด ยัง 400 ต้องแนบรูป | ✅ `line-app/smoke-usecases.js › TC-11-17` |

## UC-12 ตรวจสลิปอัตโนมัติ

**ผู้กระทำ:** ระบบตรวจสลิป (extend ของแจ้งชำระ)

**สร้างแล้วใน line-app** — `line-app/api/_verify.js` เรียก SlipOK ทุกครั้งที่แนบสลิป (`SLIPOK_API_KEY` + `SLIPOK_BRANCH_ID`) แล้วปรับผลด้วย `markStale` (>30 วัน), `markEarly` (โอนก่อนบิลออก) และ `checkAmount` (ยอดเกิน/ขาด) — **ปิดบิลเองเฉพาะกรณีเดียว และเฉพาะหอที่เจ้าของเปิดสวิตช์เอง (ค่าเริ่มต้น = ปิด):** เมื่อ `dorm.autoConfirm === true` สลิปของบิลรายเดือน (บิลเดียวหรือหลายงวด) ที่แนบรูปใหม่ในคำขอนั้นและผลตรวจสุดท้ายเป็น `ok === true` เท่านั้น (บัญชีหอ ยอดตรงเป๊ะ ไม่ซ้ำ ไม่เก่าเกิน 30 วัน ไม่โอนก่อนบิลออก) → บิลเป็น `paid` พร้อมใบเสร็จ (`autoConfirmed:true`, `confirmedVia:"slipok"`, `confirmedBy:null`) เจ้าของได้ข้อความสั้น "ตรวจสลิปอัตโนมัติ" (พร้อมคำเตือน "ถ้าไม่ใช่ ให้ยกเลิกบิล") แทนการ์ดยืนยัน (TC-12-9, TC-12-11) · **สวิตช์หอปิดหรือไม่เคยตั้ง = ทุกสลิปยังเป็น `pending` ให้เจ้าของกดยืนยัน** (TC-12-16) · ผลอื่นทุกแบบ (`null`/`false`/เกิน/ขาด/เก่า/ก่อนบิลออก/ซ้ำ) สลิปล่วงหน้า prepay ที่ผูกกับบิล สลิปที่ไม่มีรูปใหม่ (แก้หมายเหตุ เจ้าของบันทึกเอง) ยังเป็น `pending` ให้เจ้าของกดยืนยัน (TC-12-10, TC-12-12, TC-12-14) · env `SLIP_AUTO_CONFIRM=0|off|false` เป็น kill switch ของทั้ง deployment ชนะสวิตช์ของหอ (TC-12-13; Preview ใช้ Blob store เดียวกับ production จึงควรตั้ง `SLIP_AUTO_CONFIRM=0` ตอนทดสอบ) · เจ้าของเปิด/ปิดสวิตช์ในหน้าตั้งค่าหอ (`POST /api/rooms { dorm: { autoConfirm } }`, TC-12-17) · backend มีแต่ช่อง `verify: {ok: null, amount, provider: "manual"}` ตอนแจ้งชำระ (ยังไม่ต่อผู้ให้บริการ)

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/_verify.js` (`verifySlip`, `markStale`, `markEarly`, `checkAmount`) · `line-app/api/slip.js`
- backend: `backend/app/routes/billing.py` → `attach_slip` (ช่อง `verify` แบบ manual)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-12-1 | สลิปจริง ยอดตรงกับบิล บัญชีปลายทางตรงกับหอ → ตรวจผ่าน | ตั้ง `SLIPOK_API_KEY` + `SLIPOK_BRANCH_ID` และผูกบัญชีรับเงินใน branch | ผู้เช่าแนบสลิป | `slipVerify.ok=true` พร้อมยอดและ `transRef` · ขึ้นป้าย "ตรวจแล้ว" ให้เจ้าของ · **ถ้าหอเปิดสวิตช์ `autoConfirm` บิลรายเดือนที่รูปใหม่ได้ `ok:true` ปิดเองเป็น `paid`** (ดู TC-12-9; ถ้าสวิตช์หอปิด/ไม่เคยตั้ง (ค่าเริ่มต้น), ถูก kill switch `SLIP_AUTO_CONFIRM` หรือเป็นสลิปล่วงหน้า ยังเป็น `pending` ให้เจ้าของกดยืนยัน — TC-12-12, TC-12-13, TC-12-16) | ✅ `line-app/smoke-handlers.js` › slip verification |
| TC-12-2 | ยอดในสลิปไม่ตรงกับบิล | — | แนบสลิปยอดน้อย/มากกว่า | `ok=false` เหตุผล "ยอดในสลิปไม่ตรงกับบิล" (1013 หรือเทียบเอง) · ไม่ปิดบิล · เจ้าของเห็นธง | ✅ `line-app/smoke-handlers.js` › 1013 |
| TC-12-3 | สลิปซ้ำ (เลขอ้างอิงเดิมถูกใช้กับบิลอื่น) | สลิปถูกใช้ไปแล้ว | แนบสลิปเดิมอีกครั้ง/ห้องอื่น | `ok=false` "สลิปนี้ถูกใช้ไปแล้ว" · กันสองชั้น: 1012 จากผู้ให้บริการ + key `slip-ref:<transRef>` ของเราเอง | ✅ `line-app/smoke-handlers.js` › 1012 + transRef ซ้ำ |
| TC-12-4 | ไฟล์ไม่ใช่สลิป/อ่านไม่ได้ | — | แนบรูปแมว | `ok=null` เหตุผล "อ่านรูปสลิปไม่ได้" (1006/1007) — **"ตรวจไม่ได้" ไม่ใช่ "ปลอม"** · ให้ส่งใหม่หรือตรวจมือ | ✅ `line-app/smoke-handlers.js` › 1006 |
| TC-12-5 | บัญชีปลายทางไม่ใช่ของหอ | branch ผูกบัญชีหอไว้ | แนบสลิปโอนให้คนอื่น | `ok=false` "บัญชีผู้รับไม่ใช่บัญชีของหอ" (1014) | ✅ `line-app/smoke-handlers.js` › 1014 |
| TC-12-6 | ผู้ให้บริการตรวจสลิปล่ม/หมดเวลา | ผู้ให้บริการตอบ 5xx/timeout | แนบสลิป | การแจ้งชำระยังสำเร็จ (`pending`) · `ok=null` · ไม่เสียสลิป | ✅ `line-app/smoke-handlers.js` › provider 500 |
| TC-12-7 | เวลาโอนในสลิปก่อนบิลออก/นานเกินกำหนด | SlipOK ตั้งค่าแล้ว | แนบสลิปที่ `paidAt` (ก) เก่ากว่า 30 วัน หรือ (ข) เก่ากว่า `issuedAt` ของบิล (บิลเดียว/หลายงวด; ล่วงหน้าทดสอบว่าไม่ถูกใช้) | รับสลิปและบิลเป็น `pending` เสมอ ไม่บล็อก · (ก) `ok:true` ลดเป็น `ok:null` เหตุผล "สลิปเก่า — โอนเมื่อ N วันก่อน" + `stale:true` `staleDays` · ครบ 30 วันพอดียังไม่ถือว่าเก่า · (ข) `ok:null` + `early:true` เหตุผล "โอนก่อนบิลออก — ตรวจว่าเป็นสลิปของบิลนี้" (หลายงวดเทียบ `issuedAt` ของบิลล่าสุด · ไม่ใช้กับสลิปล่วงหน้าและ prepay ที่ผูกกับบิล · ข้ามเมื่อไม่มี `issuedAt` หรือ `paidAt`) · ชนทั้งสองกฎ: เก็บทั้ง `stale` และ `early` เหตุผลต่อด้วย " · " · คง amount/transRef/paidAt/bank · `slip-ref` ยังถูกบันทึกก่อนลดระดับ จึงยังจับสลิปซ้ำได้ · ไม่มี `paidAt` จากผู้ให้บริการ (ปิด SlipOK/ตรวจไม่ได้) สองกฎทำงานไม่ได้โดยตั้งใจ (`slipAt` คือเวลาที่เรารับรูป ไม่ใช่เวลาที่โอน) | ✅ `line-app/smoke-usecases.js › TC-12-7` |
| TC-12-8 | ตรวจกับผู้ให้บริการจริง (sandbox) | บัญชีทดสอบของผู้ให้บริการ | แนบสลิปจริง/ปลอม | ผลตรงความจริง · คิดโควตา/ค่าบริการตามที่ตกลง | 🖐 ทดสอบมือกับ LINE จริง |
| TC-12-9 | สวิตช์หอเปิด: สลิปบิลรายเดือนที่ตรวจผ่านครบ → ปิดบิลเอง | `dorm.autoConfirm = true` · SlipOK ตั้งค่าแล้ว · บิลห้อง 201 `unpaid` 4,450 บาท · ผู้เช่าผูกห้อง | ผู้เช่าแนบสลิปรูปใหม่ ยอดตรง บัญชีหอ ไม่ซ้ำ ไม่เก่า | ตอบ `{ status:"paid", autoConfirmed:true, receiptNo:"R202611-201", total, verify.ok:true }` · บิลสองสำเนาเป็น `paid` `paidAt` `receiptNo` `autoConfirmed:true` `confirmedVia:"slipok"` `confirmedBy:null` · ผู้เช่าได้การ์ดใบเสร็จ (retry key รูปแบบเดียวกับเจ้าของกดยืนยัน) · เจ้าของได้ข้อความสั้น "ห้อง 201 ชำระแล้ว 4,450 บาท (ตรวจสลิปอัตโนมัติ)" มีปุ่ม "ดูสลิป" **ไม่มีปุ่มยืนยัน/ตีกลับ** และไม่มีการ์ดยืนยัน · กดการ์ดเก่าซ้ำตอบ "ยืนยันไปแล้ว" ไม่ส่งใบเสร็จซ้ำ · ผู้เช่าเห็นบิล `paid` ไม่เห็น `confirmedBy` · push ล้ม (เจ้าของ/ผู้เช่า) คำขอยังสำเร็จ | ✅ `line-app/smoke-usecases.js › TC-12-9` |
| TC-12-10 | สวิตช์หอเปิด แต่สลิปตรวจไม่ผ่านครบ ยังเป็น `pending` พร้อมการ์ดยืนยัน | `dorm.autoConfirm = true` · บิล `unpaid` ห้องละหนึ่งบิล | แนบสลิปที่ (ก) ตรวจไม่ได้เพราะไม่ได้ตั้ง SlipOK (ข) ผู้ให้บริการล่ม (ค) ยอดขาด (ง) ยอดเกิน (จ) เก่ากว่า 30 วัน (ฉ) โอนก่อนบิลออก (ช) สลิปซ้ำกับห้องอื่นที่ปิดเองไปแล้ว | ทุกกรณีบิลเป็น `pending` ไม่มี `autoConfirmed`/`receiptNo`/`paidAt` · เจ้าของได้การ์ดยืนยัน 1 ใบ · ผู้เช่าไม่ได้ใบเสร็จ · `ok` ตามเดิม (`null`/`false`) | ✅ `line-app/smoke-usecases.js › TC-12-10` |
| TC-12-11 | สวิตช์หอเปิด: สลิปหลายงวดยอดรวมตรง → ปิดทุกงวดเอง | `dorm.autoConfirm = true` · บิล ต.ค. และ พ.ย. ของห้อง 201 `unpaid` | ผู้เช่าส่ง `periods` สองงวดพร้อมรูปที่ยอดเท่าผลรวม 8,900 (และอีกสองห้อง: ยอดไม่ตรงผลรวม / ตรวจไม่ได้) | ตอบ `status:"paid"` `autoConfirmed:true` `receiptNos` ต่องวด · ทุกงวด `paid` `confirmedBy:null` · เจ้าของได้ข้อความเดียว ระบุ "รอบ 2026-10, 2026-11" ยอดรวม ไม่มีปุ่มยืนยัน · ผู้เช่าได้ push เดียวมีใบเสร็จสองใบ · ยอดไม่ตรง/ตรวจไม่ได้ → ทุกงวด `pending` + การ์ดเดียว ไม่มีใบเสร็จ | ✅ `line-app/smoke-usecases.js › TC-12-11` |
| TC-12-12 | สวิตช์หอเปิด แต่สลิปล่วงหน้าและ prepay ไม่ปิดเอง แม้ตรวจผ่าน | `dorm.autoConfirm = true` · ห้องที่ยังไม่มีบิล · SlipOK ตั้งค่าแล้ว | ผู้เช่าส่งสลิปล่วงหน้ายอดตรงกับบิลที่จะออก (`ok:true`) → เจ้าของออกบิลซึ่งผูกสลิปนั้น → เจ้าของกดยืนยัน | สลิปล่วงหน้าได้ `status:"advance"` ไม่มีใบเสร็จ ไม่มีข้อความ "ตรวจสลิปอัตโนมัติ" · บิลที่ออกเป็น `pending` `prepaid:true` เจ้าของได้การ์ดยืนยัน 1 ใบ ผู้เช่ายังไม่ได้ใบเสร็จ · เจ้าของกดยืนยัน → `paid` `confirmedBy` = เจ้าของ ไม่มี `autoConfirmed` | ✅ `line-app/smoke-usecases.js › TC-12-12` |
| TC-12-13 | kill switch `SLIP_AUTO_CONFIRM=0/off/false` ชนะสวิตช์ของหอ | `dorm.autoConfirm = true` · SlipOK ตั้งค่าแล้ว · สลิปที่ตรวจผ่านครบ | ตั้ง env เป็น `0`, `off`, `false`, `OFF` แล้วส่งสลิปบิลเดียว · ตั้ง `off` แล้วส่งสลิปหลายงวด · ตั้งเป็น `1`/`on`/ไม่ตั้งแล้วส่งสลิปบิลเดียว · ตั้ง `dorm.autoConfirm = false` + env `1` แล้วส่งสลิป | ค่าปิดทั้งสี่ + หลายงวด: `pending` พร้อมการ์ดยืนยัน ไม่มีใบเสร็จ แม้หอเปิดสวิตช์ · ค่าอื่นหรือไม่ตั้ง env: ตามสวิตช์หอ (เปิด → `paid` `autoConfirmed:true`) · env ไม่เคยเปิดให้หอที่ปิดสวิตช์ (ยัง `pending`) | ✅ `line-app/smoke-usecases.js › TC-12-13` |
| TC-12-14 | สวิตช์หอเปิด แต่ไม่มีรูปใหม่ในคำขอ → ไม่ปิดเอง | `dorm.autoConfirm = true` · บิล `pending` ที่เก็บสลิปซึ่งผลตรวจเดิมเป็น `ok:true` · บิล `unpaid` สองห้อง | ผู้เช่าแก้หมายเหตุโดยไม่แนบรูป · เจ้าของบันทึกการชำระบิลเดียวและหลายงวดโดยไม่มีรูป | ทุกกรณี `pending` ไม่ส่งรูปไป SlipOK ไม่มี `autoConfirmed` ไม่มีใบเสร็จ · เจ้าของได้การ์ดยืนยัน | ✅ `line-app/smoke-usecases.js › TC-12-14` |
| TC-12-15 | ยกเลิก (void) บิลที่ปิดเอง (สวิตช์หอเปิด) | `dorm.autoConfirm = true` · บิลห้อง 201 ที่ปิดเองแล้ว (`paid`, `autoConfirmed:true`) | เจ้าของยกเลิกบิลพร้อมเหตุผล | `paid` → `void` `statusBefore:"paid"` `refundDue` = 4,450 ตอบ `refund:4450` · `receiptNo` `autoConfirmed` `confirmedVia` ยังอยู่เป็นหลักฐาน · อยู่ในรายการต้องคืนเงิน (`kind:"void"`) · ผู้เช่าไม่เห็น `confirmedBy`/`voidedBy` | ✅ `line-app/smoke-usecases.js › TC-12-15` |
| TC-12-16 | สวิตช์หอปิด (ไม่เคยตั้ง = ค่าเริ่มต้น / `autoConfirm=false`) → ไม่ปิดเอง | ไม่มีระเบียน `dorm` หรือ `autoConfirm=false` · SlipOK ตั้งค่าแล้ว · บิล `unpaid` สองห้อง และห้องที่มีสองงวด | ผู้เช่าแนบสลิปรูปใหม่ที่ตรวจผ่านครบ (`ok:true`) บิลเดียวและหลายงวด → เจ้าของกดยืนยัน → เจ้าของเปิดสวิตช์ แล้วผู้เช่าห้องอื่นส่งสลิปที่ตรวจผ่านครบ | ทุกสลิปก่อนเปิดสวิตช์: `pending` ไม่มี `autoConfirmed`/`receiptNo`/`paidAt` · เจ้าของได้การ์ดยืนยัน 1 ใบ · ผู้เช่าไม่ได้ใบเสร็จ · เจ้าของกดยืนยัน → `paid` `confirmedBy` = เจ้าของ · หลังเปิดสวิตช์: สลิปถัดไป `paid` `autoConfirmed:true` | ✅ `line-app/smoke-usecases.js › TC-12-16` |
| TC-12-17 | ตั้งค่าหอ: เปิด/ปิดสวิตช์ปิดบิลอัตโนมัติ | หอใหม่ (ยังไม่มีระเบียน `dorm`) · ผู้ช่วย (viewer) | `POST /api/rooms { dorm: { autoConfirm } }` ด้วยค่า `"true"`/`1`/`0`/`null`/`""` · ผู้ช่วยส่ง `true` · เจ้าของส่ง `true` · `GET ?settings=1` ทั้งเจ้าของและผู้ช่วย · บันทึกฟิลด์อื่น · ส่ง `false` | ค่าที่ไม่ใช่ boolean → 400 ไม่เขียนอะไร · ผู้ช่วย 403 · เจ้าของ 200 `dorm.autoConfirm:true` ฟิลด์อื่นของหอไม่หาย · `GET ?settings=1` อ่านกลับได้ (`dorm` เป็น `null` ถ้ายังไม่เคยตั้ง = ปิด) · บันทึกฟิลด์อื่นไม่ล้มค่าสวิตช์ · `false` ปิดสวิตช์ | ✅ `line-app/smoke-usecases.js › TC-12-17` |

## UC-13 ชำระหลายงวดในสลิปเดียว

**ผู้กระทำ:** ผู้เช่า (extend ของแจ้งชำระ)

**สร้างแล้วใน line-app** — `POST /api/slip` รับ `periods: ["2026-10","2026-11"]` (1–12 งวด รูปแบบ YYYY-MM ไม่ซ้ำ) ใส่สลิปใบเดียวกันบนทุกบิลที่ระบุ ทุกบิลต้องมีอยู่ เป็น unpaid/pending และ (ถ้าเป็นผู้เช่า) เป็นบิลในสัญญาของตัวเอง ไม่อย่างนั้นปฏิเสธทั้งคำขอ (409) บิลทั้งหมดเป็น `pending` พร้อม `slipGroup: {periods, total}` เจ้าของได้ **การ์ดเดียว** ยอดรวม (ปุ่มยืนยันคือ `action=confirm&room=…&periods=2026-10,2026-11`) กดครั้งเดียวปิดทุกบิลที่ยังรอสลิปใบนั้น แต่ละบิลได้เลขที่ใบเสร็จของตัวเอง ผู้เช่าได้การ์ดใบเสร็จ (ส่งรวมใน push เดียว ครั้งละไม่เกิน 5 ใบ) ข้อจำกัดนับบนบิลล่าสุดของกลุ่ม (5 ครั้ง/ห่าง 30 วินาที, เจ้าของไม่ถูกจำกัด) **ข้อจำกัดที่เหลือ:** กฎอายุสลิปมีแล้ว (เกิน 30 วัน หรือโอนก่อนบิลออก → `ok:null` ไม่บล็อก — TC-12-7) · เจ้าของตีสลิปกลับได้เป็นรายงวด (TC-04-11) แต่ยังไม่มีแบบตีกลับทั้งกลุ่มในคลิกเดียว · การเขียนหลายบิลไม่ atomic (Blob ไม่มี transaction) แต่กดการ์ดซ้ำปิดส่วนที่ค้างได้ (TC-13-6)

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/slip.js` (`saveGroup`)
- `line-app/api/webhook.js` (`confirmGroup`)
- `line-app/api/_line.js` (`confirmBubble` แบบกลุ่ม, `receiptBubble`)
- `line-app/liff/bill.html` (เลือกหลายงวดก่อนส่งสลิป)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-13-1 | สลิปเดียวครอบสองงวดที่ค้าง ยอดเท่ากับผลรวม | ค้าง ต.ค. + พ.ย. | ผู้เช่าส่ง `periods` สองงวด (ลำดับใดก็ได้) พร้อมรูป · เจ้าของกดการ์ด | ทั้งสองบิล pending ผูกรูปเดียวกัน (`slipGroup` periods เรียงแล้ว total 8,900) · เจ้าของได้การ์ดเดียว (altText "2 งวด" ยอดรวม · postback `periods=2026-10%2C2026-11`) · กดครั้งเดียวปิดทั้งคู่ · ใบเสร็จแยกต่องวด (`R202610-201`, `R202611-201`) · ผู้เช่าได้ 1 push 2 การ์ด | ✅ `line-app/smoke-usecases.js › TC-13-1` |
| TC-13-2 | ยอดสลิปน้อยกว่าผลรวมที่เลือก | SlipOK ตั้งค่าแล้ว | ส่งยอดไม่ครบ | `slipVerify.ok=false` (1013 "ยอดในสลิปไม่ตรงกับบิล") — **ตรวจเทียบกับยอดรวมของกลุ่ม** ไม่ใช่ยอดงวดเดียว (ส่ง `amount` = ผลรวม) | ✅ `line-app/smoke-handlers.js` (1013 + group amount = 7000) |
| TC-13-3 | ยอดสลิปไม่ตรงบิล (เกิน/ขาดเทียบยอดบิลหรือผลรวมงวด) | SlipOK ตั้งค่าแล้ว | ส่งสลิปยอดเกิน และยอดขาด | นโยบาย: ติดธงอย่างเดียว ไม่บล็อก ไม่เก็บเครดิตรอบหน้า ยอดเกินต้องคืนผู้เช่า · เก็บ `slipAmount` และ `overpaid` หรือ `shortBy` บนบิล (หลายงวดเก็บใน `slipGroup` และบนทุกบิล; prepay เทียบตอนผูกกับบิล) · `ok:false` "ยอดในสลิปเกินบิล X บาท" / "ยอดในสลิปขาด X บาท" · 1013 ที่ไม่มียอดคง "ยอดในสลิปไม่ตรงกับบิล" · สลิปที่ไม่ผ่านไม่จอง `slip-ref` · การ์ดเจ้าของแสดงยอดเกิน/ขาด และบอก "ยังไม่ได้ตรวจยอดในสลิป — เทียบยอดเงินเข้าเอง" เมื่อตรวจยอดไม่ได้ · บิลยัง `pending` เจ้าของยืนยันหรือปฏิเสธได้ · ยืนยันสลิปที่เกิน: บิล `paid` มี `refundDue`=ยอดเกิน `refundReason:"overpaid"` + แท็ก `<period>:<rev>` ใน `overpaid:<ห้อง>` (ไม่ซ้ำ) + reply "ยอดเกิน X บาท — ต้องคืนผู้เช่า" · สลิปหลายงวดใส่ที่งวดใหม่สุดครั้งเดียว · ยอดขายไม่มีการคืน | ✅ `line-app/smoke-usecases.js › TC-13-3` |
| TC-13-4 | เลือกงวดผิด · งวดที่ใช้ไม่ได้ · ห้องอื่น | ค้าง ต.ค. + พ.ย. · ห้อง 202 มีบิล | ส่ง `periods` ผิดรูปแบบ/ซ้ำ/เกิน 12 · งวดที่ไม่มีบิล/จ่ายแล้ว/ยกเลิก/ของผู้เช่าเก่า · ห้อง 202 · ผู้ช่วย · ไม่ล็อกอิน · เจ้าของระบุห้องที่ไม่มี | 400 · 409 `INVALID_STATE` (ปฏิเสธทั้งคำขอ งวดที่เปิดอยู่ไม่ถูกแตะ ไม่เก็บรูป ไม่ push) · ห้องอื่น/ผู้ช่วย 403 · 401 · ห้องไม่มี 404 · เจ้าของแนบแทนห้องที่ผู้เช่าเก่าถือได้ (200) | ✅ `line-app/smoke-usecases.js › TC-13-4` |
| TC-13-5 | เจ้าของปฏิเสธ (reject) สลิปหลายงวด | สลิปหลายงวด pending | ตีกลับ | **ตีกลับเป็นรายงวด** (แต่ละบิลมีปุ่มของตัวเอง) — งวดที่ตีกลับเป็น `unpaid` พร้อมเหตุผล งวดอื่นยัง `pending` · ถ้าต้องการ "ตีกลับทั้งกลุ่มในคลิกเดียว" ยังไม่มี (ต้องออกแบบ UI เพิ่ม) | ✅ `line-app/smoke-handlers.js` (slip rejection) — ต่องวด |
| TC-13-6 | กดการ์ดกลุ่มซ้ำ/ยืนยันค้างครึ่งทาง | สลิปกลุ่ม · งวด ต.ค. ถูกเขียนเป็น paid ไปแล้ว พ.ย. ยัง pending (เหมือนยืนยันที่ล้มกลางทาง) | เจ้าของกดการ์ดกลุ่ม · แล้วกดอีกครั้ง | ปิดเฉพาะ พ.ย. (ใบเสร็จ 1 ใบ) · ต.ค. ไม่ถูกเขียนทับ · ตอบ "ข้าม 2026-10" · กดซ้ำตอบ "ไม่มีบิลที่รอยืนยัน" ไม่ส่งอะไร — การเขียนหลายบิลไม่ atomic (Blob) แต่ไม่เหลือบิลที่ปิดไม่ได้ | ✅ `line-app/smoke-usecases.js › TC-13-6` |
| TC-13-7 | ผู้เช่าเลือกหลายงวดใน LIFF แล้วดูยอดรวมก่อนส่ง | LIFF จริง | เลือกงวด แนบสลิป | ยอดรวมตรงและแสดงรายการงวด · หลังส่งเห็น "แจ้งชำระ N งวดแล้ว" | 🖐 ทดสอบมือกับ LINE จริง |
| TC-13-8 | แจ้งเฉพาะงวดเก่า (ไม่ใช่บิลล่าสุด) | ค้าง ต.ค. + พ.ย. | ส่ง `periods:["2026-10"]` | ต.ค. pending · พ.ย. และ `bill:201` ไม่ถูกแตะ · การ์ดเป็นแบบงวดเดียว (`period=2026-10`) ปิดได้ | ✅ `line-app/smoke-usecases.js › TC-13-8` |
| TC-13-9 | ผู้เช่าส่งสลิปใหม่ของบิลล่าสุดเอง หลังแจ้งแบบกลุ่ม | สลิปกลุ่ม pending (ผ่าน 30 วินาที) | ส่งสลิปปกติ (ไม่มี periods) · เจ้าของกดการ์ดกลุ่มเก่า | พ.ย. หลุดจากกลุ่ม (ไม่มี `slipGroup`, `slipCount`=2) · รูปเก่าไม่ถูกลบ (ต.ค. ยังใช้) · การ์ดเก่าปิดเฉพาะ ต.ค. ตอบ "ข้าม 2026-11" | ✅ `line-app/smoke-usecases.js › TC-13-9` |
| TC-13-10 | ยกเลิก (void) บิลหนึ่งงวดของกลุ่ม | สลิปกลุ่ม pending | เจ้าของยกเลิกบิล พ.ย. แล้วกดการ์ดกลุ่ม | ปิดเฉพาะ ต.ค. · พ.ย. ยังเป็น void · **บิลที่เหลือยังจำยอดรวมเดิม (8,900) และการ์ดที่ส่งไปแล้วยังรวมงวดที่ยกเลิก** (ข้อสังเกตที่ยังไม่ตัดสินใจ — บันทึกพฤติกรรมปัจจุบัน) | ✅ `line-app/smoke-usecases.js › TC-13-10` |
| TC-13-11 | ข้อจำกัดของสลิปหลายงวด | ค้าง ต.ค. + พ.ย. | ส่งซ้ำทันที · หลัง 30 วินาที · ครบ 5 ครั้ง · เจ้าของแนบแทน | 429 `SLIP_TOO_SOON` · สำเร็จ (`slipCount`=2 รูปเก่าถูกลบ เหลือใบเดียว) · 429 `SLIP_LIMIT` (นับบนบิลล่าสุด) · เจ้าของไม่ถูกจำกัด | ✅ `line-app/smoke-usecases.js › TC-13-11` |
| TC-13-12 | การ์ดกลุ่ม: สิทธิ์ ข้อมูลผิดรูปแบบ ไม่มีสลิปกลุ่ม | สลิปกลุ่ม pending · ผู้ช่วย | ผู้เช่า/ผู้ช่วย/คนแปลกหน้ากดการ์ด · เจ้าของกดการ์ดที่รอบผิดรูปแบบ (`2026-1`, มี `bad`, 13 งวด) · กดการ์ดกลุ่มที่บิลไม่มีสลิปกลุ่ม | ตอบ "เฉพาะเจ้าของหอ…" บิลยัง pending · ตอบ "ระบุรอบบิลไม่ถูกต้อง" · ตอบ "ไม่มีบิลที่รอยืนยัน" บิลไม่เปลี่ยน | ✅ `line-app/smoke-usecases.js › TC-13-12` |
| TC-13-13 | สลิปเดียวกันจ่ายสองบิลไม่ได้ แม้ยิงพร้อมกัน (CAS ไม่ใช่ read-then-write) | SlipOK ตอบ `transRef` เดียว | ส่งสลิปสองครั้งด้วยสลิปใบเดียวกัน (ขนานหรือต่อกัน) | คนแรกได้ `slip-ref:<transRef>` แบบ **create-only** (`If-None-Match: *` บน R2) · คนที่สองได้ `ok:false` "สลิปนี้ถูกใช้ไปแล้ว (ห้อง …)" · บิลที่สองไม่ถูกแตะ · บน Vercel Blob (ไม่มี `If-Match`) ถอยเป็นเขียนครั้งเดียว (ช่องที่ยอมรับ) | ✅ `line-app/smoke.js › conditional put`<br>`line-app/smoke-handlers.js › claim` |
## UC-14 ดูยอดค้างชำระ

**ผู้กระทำ:** ผู้เช่า

ผู้เช่าดูว่าตัวเองค้างอะไรบ้างจากบิลล่าสุดและ `history=1` (แต่ละงวดมีสถานะ unpaid/pending/paid และ due) และ **มียอดรวมค้างแล้ว**: `GET /api/bill?overdue=1` คืน `{ count, total, maxDaysOverdue, items }` ของห้องตัวเอง (TC-14-2) ฝั่ง backend `GET /v1/me/invoices` ส่งรายการใบแจ้งหนี้ 12 งวดล่าสุดพร้อมสถานะ

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/bill.js` (`history`)
- `line-app/liff/bill.html`
- backend: `backend/app/routes/me.py`

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-14-1 | ประวัติของผู้เช่าแสดงสถานะรายงวด (ค้าง/รอตรวจ/จ่ายแล้ว) | ต.ค. paid · พ.ย. unpaid | `/api/bill?history=1` | สถานะต่องวดตรงจริง (ดู TC-10-3, TC-05-5) | 🖐 ทดสอบมือกับ LINE จริง |
| TC-14-2 | ยอดค้างรวมทุกงวดและจำนวนงวด | ค้าง 2 งวด | ผู้เช่าเปิดหน้า "ค้างชำระ" | `GET /api/bill?overdue=1` (ผู้เช่า) ตอบ `{ count, total, maxDaysOverdue, items:[{ period, total, due, daysOverdue }] }` ของห้องตัวเองเท่านั้น · ไม่นับ pending/paid/กำหนดวันนี้ · ไม่เห็นบิลของผู้เช่าเก่า · ขอห้องอื่น 403 | ✅ `line-app/smoke-usecases.js › TC-14-2` |
| TC-14-3 | ผู้เช่าเห็นเฉพาะของห้องตัวเอง | — | ระบุ room อื่นใน history | 403 (ครอบคลุมโดย TC-10-5) | ✅ `line-app/smoke-usecases.js › TC-10-5` |
| TC-14-4 | backend: ผู้เช่าเห็นรายการใบแจ้งหนี้ห้องตัวเองเท่านั้น (ห้องมาจาก session) | ผูก LINE แล้ว | `GET /v1/me/invoices` | เห็นเฉพาะห้องตัวเอง — pytest มีอยู่แล้ว (`test_linking_binds_line_to_the_room_and_logs_in` เรียก endpoint นี้หลังผูก LINE) | ✅ `backend/tests/test_line_link.py › test_linking_binds_line_to_the_room_and_logs_in` |

## UC-15 ดูใบเสร็จ

**ผู้กระทำ:** ผู้เช่า

**สร้างแล้วใน line-app** — ตอนเจ้าของยืนยัน บิลได้ `receiptNo` = `R<yyyymm>-<ห้อง>` (+ `-<rev>` เมื่อ rev > 1, ดู UC-18) คำนวณจากบิล ไม่ใช้ตัวนับ เพราะ Blob ไม่มี transaction (บิลเดียวต่อห้องต่องวด เลขจึงไม่ซ้ำ) แล้ว push **การ์ดใบเสร็จ** (Flex) ให้ผู้เช่าห้องนั้น ปุ่ม "ดูใบเสร็จ" เปิดหน้าใบเสร็จใน LIFF (`?room=&receipt=<งวด>#receipt/<งวด>`) ซึ่งอ่านจาก `GET /api/bill?period=` (ไม่มี endpoint ใบเสร็จแยก) รายการประวัติ (`history=1`) มี `receiptNo` ต่องวด บิลที่จ่ายก่อนมีใบเสร็จไม่มีเลขเก็บไว้ ระบบคำนวณเลขเดียวกันให้ตอนอ่าน ผู้เช่าไม่เห็น LINE userId ของคนยืนยัน ใบเสร็จของบิลที่ถูกยกเลิกยังอ่านได้และขึ้น "ยกเลิกแล้ว" (UC-18) ส่วน backend ออก `REC-<งวด>-<ลำดับ 4 หลัก>` ตอนยืนยัน แต่ยังไม่มี endpoint ให้ผู้เช่าเปิดดู

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/webhook.js` (`paidCopy`, `sendReceipts`)
- `line-app/api/_bills.js` (`receiptNoOf`)
- `line-app/api/_line.js` (`receiptBubble`)
- `line-app/api/bill.js` (`withReceipt`)
- `line-app/liff/bill.html` (`receiptScreen`)
- backend: `backend/app/routes/billing.py` (`confirm_invoice` → `receipt_no`)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-15-1 | ผู้เช่าได้การ์ดใบเสร็จหลังเจ้าของยืนยัน | สลิป pending | เจ้าของยืนยัน | ผู้เช่าได้ push การ์ดใบเสร็จ (ตรวจใน TC-04-1 และ TC-04-10) | ✅ `line-app/smoke-usecases.js › TC-04-1` |
| TC-15-2 | ผู้เช่าเปิดดูใบเสร็จของงวดที่จ่ายแล้ว (line-app) | บิล paid · และบิลเก่าที่ paid ก่อนมีใบเสร็จ (ไม่มี `receiptNo` เก็บไว้ · rev 2) | `GET /api/bill?period=` · บิลล่าสุด · `history=1` | ได้ `receiptNo` `R202611-201` · paidAt · ยอด/ค่าเช่า/น้ำ/ไฟ · ไม่มี `confirmedBy` (เจ้าของเห็น) · บิลเก่าได้เลขคำนวณ (`R202610-201`, rev 2 → `R202609-201-2`) · ประวัติมีเลขตรงกัน | ✅ `line-app/smoke-usecases.js › TC-15-2` |
| TC-15-3 | บิลที่ยังไม่จ่ายไม่มีใบเสร็จ | บิล unpaid · pending | อ่านบิลล่าสุด/ตามงวด/ประวัติ | `receiptNo` เป็น null ทุกที่ (API ตอบบิลได้ ไม่ใช่ 404) · LIFF ขึ้น "ยังไม่มีใบเสร็จ" แทน (ดู TC-15-9) | ✅ `line-app/smoke-usecases.js › TC-15-3` |
| TC-15-4 | ผู้เช่าเปิดใบเสร็จห้องอื่น/ของผู้เช่าเก่าไม่ได้ | ห้อง 202 มีใบเสร็จ · ห้อง 201 เปลี่ยนผู้เช่า | ผู้เช่า 201 ระบุห้อง 202 (งวด/ล่าสุด/ประวัติ) · ผู้เช่าใหม่เปิดใบเสร็จของคนเก่า · ไม่ล็อกอิน · ผู้ช่วย · เจ้าของ | 403 · 404 และประวัติว่าง · 401 · ผู้ช่วย/เจ้าของอ่านได้ (200) | ✅ `line-app/smoke-usecases.js › TC-15-4` |
| TC-15-5 | ใบเสร็จอ่านออกบนมือถือและบันทึกไว้ได้ | LIFF จริง | เปิดใบเสร็จ แคปหน้าจอ/ส่งต่อในแชท (LIFF ยังไม่มีปุ่มบันทึกหรือแชร์) | ตัวหนังสืออ่านออก ยอดและเลขที่ถูก ไม่ถูกตัดขอบ | 🖐 ทดสอบมือกับ LINE จริง |
| TC-15-6 | backend: เลขใบเสร็จ `REC-2026-11-0001` และเลขไม่ซ้ำ | ยืนยันหลายใบ | `POST …/confirm` | เลขเรียงต่อในงวดเดียวกัน | ✅ `backend/tests/test_slip_confirm_reject.py::test_confirm_marks_paid_and_issues_a_receipt`<br>`backend/tests/test_slip_confirm_reject.py::test_receipt_numbers_do_not_repeat` |
| TC-15-7 | การ์ดใบเสร็จใน LINE: เนื้อหาและปุ่ม | บิล rev 2 pending | เจ้าของยืนยัน แล้วดูการ์ดที่ผู้เช่าได้ | altText "ใบเสร็จรับเงิน ห้อง 203 · 4,450 บาท" · เลขที่ `R202611-203-2` · ห้อง/รอบ · ค่าเช่า น้ำ ไฟ รวม · ชำระเมื่อ · ปุ่ม "ดูใบเสร็จ" เปิด `liff.line.me/<LIFF_ID>?room=203&receipt=2026-11#receipt/2026-11` | ✅ `line-app/smoke-usecases.js › TC-15-7` |
| TC-15-8 | ส่งใบเสร็จหาผู้เช่าล้มเหลว | LINE push ของผู้เช่าตอบ 500 | เจ้าของยืนยัน | บิลยัง paid และมี `receiptNo` · เจ้าของยังได้คำตอบ "ยืนยันห้อง …" | ✅ `line-app/smoke-usecases.js › TC-15-8` |
| TC-15-9 | กดปุ่มบนการ์ดใบเสร็จใน LINE จริง · หน้าใบเสร็จใน LIFF | LINE OA + LIFF จริง | ผู้เช่ากด "ดูใบเสร็จ" · เปิดงวดที่ยังไม่จ่าย · เปิดงวดที่ถูกยกเลิก · เจ้าของเปิดใบเสร็จของห้อง | เห็นหน้าใบเสร็จตรงกับ API (ชำระแล้ว) · งวดที่ยังไม่จ่ายขึ้น "ยังไม่มีใบเสร็จ" · งวดที่ยกเลิกขึ้น "ยกเลิกแล้ว" พร้อมเหตุผล · LIFF ที่ทิ้ง `#fragment` ตอนล็อกอินยังเข้าหน้าใบเสร็จถูกงวด | 🖐 ทดสอบมือกับ LINE จริง |
| TC-15-10 | กดยืนยันซ้ำพร้อมกัน (เจ้าของสองคน/ดับเบิลแท็ป) ไม่ควรส่งใบเสร็จสองใบ | Blob ไม่มี transaction · บิล pending | สอง postback ยืนยันเข้ามาพร้อมกัน (ทั้งคู่อ่านบิลเป็น pending ก่อนใครเขียน) | ผู้เช่าได้ใบเสร็จใบเดียว — push ใบเสร็จใช้ `X-Line-Retry-Key` (`receipt:<ห้อง>:<ผู้เช่า>:<รอบ:rev:total:receiptNo:slipAt>` (ไม่ใส่ `paidAt` เพราะสอง confirm ที่แข่งกันประทับเวลาคนละค่า)) LINE ตอบ 409 ให้ใบที่ซ้ำ ซึ่งนับเป็นสำเร็จ · เจ้าของทั้งสองยังได้คำตอบ · บิลที่ void แล้วออกใหม่ (rev ใหม่) ยังได้ใบเสร็จตามปกติ · รอบ/rev เดียวกันแต่ยอดรวม (หรือสลิป) ต่างกัน = ใบเสร็จคนละใบ ได้คีย์ต่างและถูกส่งถึงผู้เช่า ไม่ถูก LINE ตัดเป็นซ้ำ | ✅ `line-app/smoke-usecases.js › TC-15-10` |
## UC-16 ทวงอัตโนมัติ (เลยกำหนด 1 / 5 / 10 วัน)

**ผู้กระทำ:** เวลา (Scheduler)

**line-app (สร้างแล้ว):** Vercel Cron เรียก `GET /api/cron` วันละครั้ง (`vercel.json`: `0 2 * * *` = 09:00 เวลาไทย) พร้อม `Authorization: Bearer <CRON_SECRET>` (ต้องตั้งอย่างน้อย 16 ตัวอักษร ไม่ตั้ง = 503) `api/_remind.js` ดูบิลล่าสุดของแต่ละห้องกับงวดเก่าที่ค้างอีกไม่เกิน 12 งวด เฉพาะบิล `unpaid` ที่มี `due` (pending/paid/void ข้าม) แล้วส่งการ์ดเตือนตามขั้น: **before_3** (ก่อนกำหนด 1–3 วัน) · **due_0** (วันครบกำหนด) · **after_1** (เลย 1–4 วัน) · **after_5** (5–9) · **after_10** (≥10) แต่ละขั้นต่อบิลครั้งเดียว (บันทึก `reminded:<ห้อง>:<งวด>:<ขั้น>` หลัง push สำเร็จ push ล้มเหลวไม่บันทึกแล้วลองใหม่รอบหน้า) ขั้นที่ข้ามเพราะ cron ไม่ทำงานจะส่งขั้นของวันที่มารันแทน · รวมการ์ดได้ถึง 5 ใบต่อ push — ห้องที่มีเตือนค้างเกิน 5 ใบจะได้มากกว่า 1 push ในรอบนั้น (TC-16-19) · ห้องที่ไม่มีผู้เช่าผูกและบิลของผู้เช่าเก่าถูกข้าม เมื่อมีข้อความทวงหลังกำหนดออกไป เจ้าของได้ข้อความสรุป 1 ข้อความ วันที่คำนวณตามเวลาไทย (`Asia/Bangkok`)

**backend:** cron รายวัน (`GET /v1/cron/daily` ด้วย secret ใน header) คิวการแจ้งเตือน: ใบที่ยัง unpaid และเลยกำหนด 1–4 วัน = ขั้น 1, 5–9 = ขั้น 5, ≥10 = ขั้น 10 ส่งแต่ละขั้นครั้งเดียว (บันทึกใน `message_log` เมื่อ LINE ตอบ ok) ขั้นที่ข้ามไปเพราะ cron ไม่ทำงานจะตามส่งวันถัดไป ผู้เช่าที่ไม่มี LINE และใบที่ paid ถูกข้าม (backend ยังไม่มีการแจ้งเตือนก่อนครบกำหนด)

**โค้ดที่เกี่ยวข้อง:**
- line-app: `line-app/api/cron.js`, `line-app/api/_remind.js` (`runReminders`, `kindFor`), `line-app/vercel.json` (`crons`) · รายละเอียดเพิ่มใน `line-app/smoke-cron.js`
- backend: `backend/app/dunning.py`
- `backend/app/routes/dunning.py`, `backend/app/routes/cron.py`
- `backend/app/tasks.py`, `backend/app/queue.py`

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-16-1 | ขั้นของการทวงตามจำนวนวันที่เลยกำหนด | — | 1, 5, 10 วัน | reminder_1 / reminder_5 / reminder_10 | ✅ `backend/tests/test_dunning.py::test_reminder_kind_matches_the_days_late` |
| TC-16-2 | แต่ละใบได้ขั้นที่ถึง (ตามส่งขั้นที่ข้าม) และเปลี่ยนขั้นที่วัน 5 และ 10 | ใบเลย 1,3,5,12 วัน / 4,5,9,10 วัน | เลือกใบที่ต้องทวง | 1→1, 3→1, 5→5, 12→10 · 4→1, 5→5, 9→5, 10→10 | ✅ `backend/tests/test_dunning.py::test_each_invoice_gets_the_step_it_has_reached`<br>`backend/tests/test_dunning.py::test_reminder_step_changes_at_days_five_and_ten` |
| TC-16-3 | ข้ามใบที่จ่ายแล้ว · ผู้เช่าไม่มี LINE · ขั้นที่ส่งแล้ว · หอพักอื่น | — | เลือกใบที่ต้องทวง | ไม่ถูกเลือก | ✅ `backend/tests/test_dunning.py::test_paid_invoices_are_skipped`<br>`backend/tests/test_dunning.py::test_a_tenant_without_line_is_not_queued`<br>`backend/tests/test_dunning.py::test_a_reminder_already_logged_is_not_selected_again`<br>`backend/tests/test_dunning.py::test_other_dorms_are_not_touched` |
| TC-16-4 | push ล้มเหลวไม่นับว่าส่งแล้ว และ task ยก error ให้คิว retry | LINE ตอบ error | คิวส่งข้อความ | ไม่ลง log ok · retry ภายหลัง | ✅ `backend/tests/test_dunning.py::test_a_failed_push_does_not_count_as_sent`<br>`backend/tests/test_dunning.py::test_the_push_task_raises_so_the_queue_retries` |
| TC-16-5 | ส่งเข้าคิวต่อแถว และ query เดียว (ไม่ N+1) | — | `queue_reminders` | ครบทุกแถว | ✅ `backend/tests/test_dunning.py::test_queue_reminders_hands_each_row_to_the_worker`<br>`backend/tests/test_dunning.py::test_due_for_reminder_uses_one_select` |
| TC-16-6 | ป้องกันการเรียก cron/ทวง: ต้องมี secret ใน header เท่านั้น | — | ไม่มี/ผิด/ใส่ใน URL/ไม่ได้ตั้ง secret | 401 · ถูกต้องผ่าน (คิวและระบายคิว) | ✅ `backend/tests/test_cron.py::test_no_secret_is_refused`<br>`backend/tests/test_cron.py::test_a_wrong_secret_is_refused`<br>`backend/tests/test_cron.py::test_a_token_in_the_url_is_refused`<br>`backend/tests/test_cron.py::test_the_cron_secret_in_the_header_queues_and_drains`<br>`backend/tests/test_cron.py::test_an_unset_secret_never_authorises`<br>`backend/tests/test_dunning.py::test_cron_token_is_read_from_the_header_only`<br>`backend/tests/test_dunning.py::test_a_token_in_the_url_is_refused` |
| TC-16-7 | ใบที่แจ้งชำระแล้ว (pending) ไม่ถูกทวง | ใบ pending เลยกำหนด 5 วัน | รันทวง | ไม่ถูกเลือก (ไม่ใช่ความล่าช้าของผู้เช่า) ไม่มีข้อความและไม่มีสรุปถึงเจ้าของ — ทดสอบฝั่ง line-app (backend มี pytest เฉพาะใบ paid ยังไม่มี pytest ของ pending) | ✅ `line-app/smoke-usecases.js › TC-16-7` |
| TC-16-8 | ครบกำหนดวันนี้/ยังไม่เลยกำหนดไม่ใช่การทวง | due = 16 พ.ย. | รันที่ 12 · 13 · 15 · 16 พ.ย. | ไม่มีขั้น `after_*` และไม่ส่งสรุปถึงเจ้าของ: 12 ไม่ส่งอะไร · 13 และ 15 ได้เตือน `before_3` · 16 ได้ `due_0` — ทดสอบฝั่ง line-app (backend เลือกใบเมื่อเลยกำหนดอย่างน้อย 1 วันเท่านั้น และยังไม่มี pytest ของกรณี due = วันนี้) | ✅ `line-app/smoke-usecases.js › TC-16-8` |
| TC-16-11 | ผู้เช่าที่ย้ายออกแล้วไม่ถูกทวง (`moved_out`) · ใช้ผู้เช่าล่าสุดที่มี LINE | tenant moved_out ≤ วันนี้ | รันทวง | ไม่ถูกเลือก · `moved_out` = วันนี้ ถือว่าย้ายออกแล้ว · ผู้เช่าใหม่ที่ไม่มี LINE ถูกข้ามไปใช้คนที่มี LINE | ✅ `backend/tests/test_dunning.py::test_a_tenant_who_moved_out_is_not_reminded` · `test_the_latest_tenant_with_line_is_used` |
| TC-16-9 | ข้อความทวงถึงผู้เช่าใน LINE จริง · ขั้น 1/5/10 ภาษา/ยอด/ห้องถูกต้อง | backend deploy + LINE จริง | รัน cron วันเลยกำหนด 1/5/10 | ผู้เช่าได้ข้อความต่างกันตามขั้น ไม่ได้ซ้ำในวันเดียว | 🖐 ทดสอบมือกับ LINE จริง |
| TC-16-10 | ทั้งเส้นทางใน line-app: ออกบิล → เตือนก่อนกำหนด → แจ้งชำระแล้วหยุดเตือน → ยืนยัน | ผู้เช่าผูกห้อง 201 | ออกบิล due 16 พ.ย. → รัน 13 พ.ย. → ผู้เช่าแนบสลิป → รัน 20 พ.ย. → เจ้าของยืนยัน → รัน 30 พ.ย. | 13 พ.ย. ผู้เช่าได้เตือน `before_3` (ยอด 4,450) · หลังแจ้งชำระ (pending) และหลังยืนยัน (paid) ไม่มีข้อความเพิ่มเลย | ✅ `line-app/smoke-usecases.js › TC-16-10` |
| TC-16-12 | ป้องกัน `GET /api/cron` ด้วย CRON_SECRET (line-app) | ตั้ง/ไม่ตั้ง/ตั้งสั้นกว่า 16 | เรียกด้วย Bearer ถูก/ผิด/ไม่มี · ใส่ secret ใน URL · POST | ไม่ตั้งหรือสั้น 503 `NOT_CONFIGURED` · ไม่มี/ผิด/ใน URL 401 · POST 405 · ถูกต้อง 200 `{ok, today, sent, failed}` (วันที่รูปแบบ YYYY-MM-DD เวลาไทย) | ✅ `line-app/smoke-usecases.js › TC-16-12` |
| TC-16-13 | แจ้งเตือนก่อนครบกำหนด (before_3) | บิล unpaid 4,450 บาท due 16 พ.ย. · ผู้เช่าผูกห้อง | รันที่ 12 · 13 · 14 · 15 พ.ย. | 12 (ก่อน 4 วัน) ไม่ส่ง · 13 ได้การ์ด "ครบกำหนด 16 พ.ย. (อีก 3 วัน)" พร้อมยอด/ปุ่มเปิด LIFF ห้องนั้น · 14–15 ไม่ส่งซ้ำ (บันทึก `reminded:` เป็นเวลา ISO) · ไม่มีสรุปถึงเจ้าของ | ✅ `line-app/smoke-usecases.js › TC-16-13` |
| TC-16-14 | ถึงกำหนดวันนี้ (due_0) แล้ววันถัดไป | บิล unpaid due 16 พ.ย. | รัน 16 (สองครั้ง) แล้ว 17 พ.ย. | 16 ได้ "ครบกำหนดวันนี้ (16 พ.ย.)" ครั้งเดียว · 17 เป็น `after_1` | ✅ `line-app/smoke-usecases.js › TC-16-14` |
| TC-16-15 | ทวงหลังเลยกำหนด 1 / 5 / 10 วัน (line-app) | บิล unpaid due 16 พ.ย. | รันต่อเนื่อง 17, 18, 20, 21, 25, 26, 27 พ.ย. และ 30 ธ.ค. | 17 `after_1` · 18–20 ไม่ส่ง · 21 `after_5` (ข้อความ "เลยกำหนดมา 5 วัน") · 22–25 ไม่ส่ง · 26 `after_10` · หลังจากนั้นไม่ส่งอีก · ผู้เช่าที่เพิ่งถูกรันครั้งแรกวันที่เลย 10 วันได้ `after_10` ขั้นเดียว | ✅ `line-app/smoke-usecases.js › TC-16-15` |
| TC-16-16 | cron ไม่ทำงานบางวัน | บิล unpaid due 16 พ.ย. · ไม่เคยเตือน | รันครั้งแรกวันที่ 19 พ.ย. (เลยกำหนด 3 วัน) | ได้ `after_1` ข้อความเดียว (ไม่ตามส่ง before_3/due_0 ย้อนหลัง) | ✅ `line-app/smoke-usecases.js › TC-16-16` |
| TC-16-17 | ไม่ทวง: paid · void · ไม่มี due · ห้องที่ไม่มีผู้เช่า | บิลเลยกำหนดในแต่ละสถานะ · ห้อง 202 ไม่มีผู้เช่าผูก | รันที่ 20 พ.ย. | ไม่ส่งอะไร ไม่มีสรุปถึงเจ้าของ | ✅ `line-app/smoke-usecases.js › TC-16-17` |
| TC-16-18 | บิลของผู้เช่าเก่าไม่ถูกทวงผู้เช่าใหม่ (เทียบ TC-16-11 ฝั่ง backend) | ผู้เช่าใหม่ผูก 201 · มี tenancy · ต.ค. ออกก่อนเปลี่ยนผู้เช่า พ.ย. ออกหลัง | รันที่ 20 พ.ย. | ได้เฉพาะ พ.ย. (`after_1`) · ไม่มีข้อความของ ต.ค. · ไม่บันทึก `reminded` ของ ต.ค. | ✅ `line-app/smoke-usecases.js › TC-16-18` |
| TC-16-19 | หลายบิลในช่วงเตือนพร้อมกัน · งวดเก่าที่ค้าง | ต.ค. เลยกำหนด 12 วัน + พ.ย. ก่อนกำหนด 3 วัน · อีกกรณี 7 งวดค้าง | รันที่ 13 พ.ย. สองครั้ง | หนึ่ง push สองการ์ด (`after_10` ต.ค. · `before_3` พ.ย.) · บันทึกแยกต่องวด/ขั้น · รันซ้ำไม่ส่ง · 7 การ์ดส่งเป็น 5 + 2 (ข้อจำกัดของ LINE) | ✅ `line-app/smoke-usecases.js › TC-16-19` |
| TC-16-20 | สรุปถึงเจ้าของเมื่อมีการทวงหลังกำหนด | 201, 202 ค้างเลยกำหนด 1 วัน · 203 จ่ายแล้ว | รันที่ 17 พ.ย. สองครั้ง · กรณีที่ส่งแค่ before_3/due_0 | เจ้าของได้ 1 ข้อความ "สรุปทวงวันนี้: เลยกำหนด 2 ห้อง (201, 202) · ส่งเตือนแล้ว 2 ข้อความ" · รันซ้ำไม่มีอะไร · เตือนก่อน/ครบกำหนดไม่ส่งสรุป | ✅ `line-app/smoke-usecases.js › TC-16-20` |
| TC-16-21 | push หาผู้เช่าล้มเหลว | LINE push ของ 201 ตอบ 500 · 202 ปกติ | รันที่ 13 พ.ย. แล้ว 14 พ.ย. | 202 ได้เตือน · `failed`=1 · ไม่บันทึก `reminded` ของ 201 · วันถัดไป 201 ได้ `before_3` (ไม่ส่ง 202 ซ้ำ) | ✅ `line-app/smoke-usecases.js › TC-16-21` |
| TC-16-22 | cron ทำงานจริงบน Vercel + ผู้เช่าได้การ์ดเตือนใน LINE | deploy จริง · ตั้ง `CRON_SECRET` · มีบิลใกล้/เลยกำหนด | รอรอบ 09:00 เวลาไทย (หรือเรียก `/api/cron` ด้วย Bearer) | ผู้เช่าได้การ์ดเตือนที่ปุ่มเปิดบิลถูกห้อง · เจ้าของได้สรุปเมื่อมีเลยกำหนด · เวลาไทยตรงวัน | 🖐 ทดสอบมือกับ LINE จริง |
| TC-16-23 | cron สองรอบซ้อนกัน (หรือ Vercel เรียกซ้ำ) ไม่ควรส่งเตือนซ้ำ | Blob ไม่มี transaction | รัน `runReminders` สองรอบพร้อมกันบนบิลเดียว (ทั้งคู่อ่าน `reminded:` ยังไม่มีก่อนใครเขียน) | ผู้เช่าได้เตือนครั้งเดียวต่อห้อง — push ใช้ retry key `remind:<ห้อง>:<วัน>:<รอบ:ขั้น:rev>` LINE ตอบ 409 ให้ชุดที่ซ้ำ · รอบที่ซ้ำไม่นับเป็น `sent` และไม่นับ `failed` · key มี `total` และ `due` ของแต่ละการ์ดด้วย (`<รอบ>:<ขั้น>:<rev>:<ยอด>:<due>`) ดังนั้นบิลเดิม rev เดิมที่ยอดหรือวันครบกำหนดเปลี่ยนในวันเดียวกันเป็นข้อความใหม่และส่งถึง · สรุปถึงเจ้าของใช้ key `remind-summary:<วัน>:<ข้อความสรุป>` ได้ใบเดียวต่อข้อความ สรุปที่ต่างกันไม่ถูกตัด | ✅ `line-app/smoke-usecases.js › TC-16-23` |
| TC-16-24 | cron retry ขณะรอบแรกยังทำงานอยู่ → ข้าม ไม่ส่งซ้ำ | มี `cron-lock` สด (ไม่เกิน 15 นาที) | เรียก `GET /api/cron` ด้วย secret; และอีกครั้งด้วย lock เก่า 16 นาที | รอบที่สองตอบ `200 {ok:true, skipped:"another run is in progress"}` ไม่ส่งอะไร · lock เก่าไม่บล็อก · รอบที่รันจบแล้วล้าง lock | ✅ `line-app/smoke-cron.js` |
| TC-16-25 | ยังไม่ได้ตั้ง LINE token → cron ไม่เขียน `message_log` ทิ้งวันละแถวต่อบิล | `LINE_CHANNEL_ACCESS_TOKEN` ว่าง | รันขั้น `queue_reminders` | คืน **0** และไม่แตะคิว/ไม่เขียน log (เดิมเขียน `skipped` ทุกใบทุกวันตลอดไป) · พอใส่ token แล้วขั้นนี้กลับมาทำงานเอง | ✅ `backend/tests/test_dunning.py::test_without_a_line_token_nothing_is_queued_or_logged` |

## UC-17 แจ้งชำระก่อนบิลออก (โอนก่อน)

**ผู้กระทำ:** ผู้เช่า

ผู้เช่าที่โอนเงินก่อนเจ้าของออกบิลของเดือนนั้น (ยังไม่มีบิล บิลล่าสุดจ่ายแล้ว หรือบิลล่าสุดถูกยกเลิก) ยังแนบสลิปได้: `POST /api/slip` เก็บสลิปเป็น `prepay:<ห้อง>` (รูปชื่อ `slips/<ห้อง>-advance-<ts>.<นามสกุล>`) ตอบ `{ok, status:"advance", hasSlip}` และส่งข้อความหาเจ้าของ "ห้อง X แจ้งโอนก่อนบิลออก…" เมื่อเจ้าของออกบิล (`POST /api/run`) บิลใหม่ของห้องนั้นเริ่มเป็น `pending` พร้อมสลิป (`prepaid:true`) prepay ถูกล้างหลังบันทึกบิลสำเร็จ ผู้เช่าได้การ์ดบิลและเจ้าของได้การ์ดยืนยันทันที แล้วยืนยันผ่าน webhook ได้เหมือนบิล pending ทั่วไป สิทธิ์ ตรวจรูป/หมายเหตุ และข้อจำกัด (5 ครั้ง/รายการ, ห่าง 30 วินาที; เจ้าของไม่ถูกจำกัด) ใช้ชุดเดียวกับการแจ้งชำระปกติ แต่นับบนระเบียน prepay · อ่านสถานะ: `GET /api/bill` (ล่าสุด) เพิ่มฟิลด์ `advance`, ไม่มีบิลก็ 404 พร้อม `error.advance` · `GET /api/rooms` มี `advance` ต่อห้อง · `GET /api/slip-image?room=&advance=1` ดูรูป

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/slip.js` (`saveAdvance`)
- `line-app/api/run.js` (`issueBill` ผูก prepay กับบิลใหม่)
- `line-app/api/bill.js`, `line-app/api/rooms.js`, `line-app/api/slip-image.js`
- `line-app/api/webhook.js` (ยืนยัน)
- `line-app/liff/bill.html` (ป้าย "โอนล่วงหน้า", การ์ดสลิปล่วงหน้า)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-17-1 | ทั้งเส้นทางโอนก่อนบิล | ผู้เช่าผูก 201 · ยังไม่มีบิล | ผู้เช่าแนบสลิป → ผู้เช่าเปิดบิล + เจ้าของเปิด `/api/rooms` → เจ้าของออกบิล → เจ้าของกดยืนยันจากการ์ด | สลิป `advance` + เจ้าของได้ข้อความ · `/api/bill` 404 พร้อม `error.advance` · rooms เห็น `advance` · บิลใหม่ pending มีสลิป `prepaid` · prepay หาย · ยืนยันแล้ว paid และ `advance:null` | ✅ `line-app/smoke-usecases.js › TC-17-1` |
| TC-17-2 | ยังไม่มีบิล: เก็บเป็น prepay | ผู้เช่าผูก 201 | POST `/api/slip` พร้อมรูปและหมายเหตุ | `prepay:201` มี room/slipNote/slipCount=1/by · รูปชื่อ `…-advance-…` · ไม่สร้างบิล · เจ้าของได้ข้อความ (text) ไม่ใช่การ์ดยืนยัน | ✅ `line-app/smoke-usecases.js › TC-17-2` |
| TC-17-3 | บิลล่าสุดจ่ายแล้ว → นับเป็นโอนรอบถัดไป; บิล unpaid/pending ทำงานแบบเดิม | 201 บิล paid · 202 unpaid · 203 pending | แต่ละห้องแนบสลิป | 201 `advance` (บิลเดิมไม่เปลี่ยน) · 202 และ 203 `pending` ไม่มี prepay · 203 `slipCount`=2 | ✅ `line-app/smoke-usecases.js › TC-17-3` |
| TC-17-4 | `GET /api/bill` รายงาน `advance` | บิลล่าสุดจ่ายแล้ว | ก่อนและหลังแจ้งโอนล่วงหน้า · อ่านแบบระบุ period | ก่อน `advance:null` · หลัง `{slipAt, hasSlip:true, note}` · แบบระบุ period ไม่มีฟิลด์ `advance` | ✅ `line-app/smoke-usecases.js › TC-17-4` |
| TC-17-5 | แจ้งโอนล่วงหน้าซ้ำ | มี prepay แล้ว (เว้นเกิน 30 วินาที) | ส่งสลิปอีกใบ | แทนที่ prepay · **รูปเก่าเก็บไว้** (บิลที่กำลังเขียนอยู่อาจอ้างถึง) · `slipCount`=2 · หมายเหตุใหม่ | ✅ `line-app/smoke-usecases.js › TC-17-5` |
| TC-17-6 | ข้อจำกัดนับบน prepay | — | ส่งทันที · ส่งครบ 5 ครั้ง · เจ้าของแนบแทน | 429 SLIP_TOO_SOON · 429 SLIP_LIMIT (นับคงที่ 5) · เจ้าของไม่ถูกจำกัด | ✅ `line-app/smoke-usecases.js › TC-17-6` |
| TC-17-7 | กฎตรวจสลิปเดิมใช้กับ prepay | ผู้เช่าผูก 201 | GIF · 3MB+1 · หมายเหตุ 501 ตัว · `room=202` · ไม่ผูกห้อง · ไม่ล็อกอิน | 400 · 413 · 400 · 403 · 400 · 401 · ไม่มี prepay/ไฟล์ค้าง | ✅ `line-app/smoke-usecases.js › TC-17-7` |
| TC-17-8 | โอนล่วงหน้าโดยไม่แนบรูป | — | ส่งแต่หมายเหตุ | 200 `advance` `hasSlip:false` · `slipPath:null` | ✅ `line-app/smoke-usecases.js › TC-17-8` |
| TC-17-9 | ส่งข้อความหาเจ้าของล้มเหลว | LINE push เจ้าของตอบ 500 | แจ้งโอนล่วงหน้า | ผู้เช่ายังสำเร็จ · prepay ถูกเก็บ | ✅ `line-app/smoke-usecases.js › TC-17-9` |
| TC-17-10 | เจ้าของ/ผู้ช่วยเห็นสลิปรอบิลในรายการห้อง | 201 มี prepay | GET `/api/rooms` (เจ้าของ, ผู้ช่วย, ผู้เช่า) | 201 `advance:{slipAt,hasSlip}` ห้องอื่น null · ไม่มี userId · ผู้เช่า 403 | ✅ `line-app/smoke-usecases.js › TC-17-10` |
| TC-17-11 | ดูรูปสลิปล่วงหน้า | 201 มี prepay | GET `/api/slip-image?room=201&advance=1` โดยแต่ละบทบาท | ผู้เช่าห้องนั้น/เจ้าของ/ผู้ช่วย 200 · ห้องอื่น 403 · ไม่ล็อกอิน 401 · ยังไม่มี prepay 404 · ไม่ใส่ `advance` อ่านสลิปของบิล (404) | ✅ `line-app/smoke-usecases.js › TC-17-11` |
| TC-17-12 | ออกบิลห้องที่มี prepay | 201 มี prepay พร้อมหมายเหตุ | POST `/api/run` ห้อง 201 | บิล `pending` คัดลอก slipPath/slipNote/slipAt/slipCount · `prepaid:true` · ผลลัพธ์ `prepaid:true` · สองสำเนาตรงกัน · prepay ถูกล้าง · ผู้เช่าได้การ์ดบิล · เจ้าของได้การ์ดยืนยัน (period ถูก) · ดูรูปจากบิลได้ | ✅ `line-app/smoke-usecases.js › TC-17-12` |
| TC-17-13 | ห้องอื่นไม่ถูกกระทบ | 201 มี prepay · 202 ไม่มี | ออกบิล 201 และ 202 | 202 `unpaid` ไม่มีสลิป ไม่มี `prepaid` | ✅ `line-app/smoke-usecases.js › TC-17-13` |
| TC-17-14 | บิลงวดนี้ pending/paid แล้ว ออกซ้ำถูกปฏิเสธ และ prepay ไม่หาย | 201 pending · 202 paid · ทั้งคู่มี prepay | ออกบิลซ้ำงวดเดียวกัน | ถูกปฏิเสธ · prepay ยังอยู่ · บิลเดิมไม่เปลี่ยน | ✅ `line-app/smoke-usecases.js › TC-17-14` |
| TC-17-15 | prepay ไม่มีรูป · ส่งการ์ดเจ้าของล้มเหลว | prepay มีแต่หมายเหตุ · push เจ้าของล้ม | ออกบิล | บิล pending `hasSlip:false` · HTTP 200 · prepay ถูกล้าง | ✅ `line-app/smoke-usecases.js › TC-17-15` |
| TC-17-16 | ออกบิลซ้ำห้อง unpaid ที่เพิ่งมี prepay | 201 บิล unpaid แล้วมี prepay | ออกบิลซ้ำ | `reissued` และ `prepaid` · บิล pending · prepay ล้าง | ✅ `line-app/smoke-usecases.js › TC-17-16` |
| TC-17-17 | วนซ้ำรอบถัดไป | 201 โอนก่อน → ออกบิล → ยืนยัน (paid) | แจ้งโอนอีกครั้ง แล้วออกบิลธันวาคม | ครั้งที่สอง `advance` · บิลธันวาคม pending มีสลิป · บิลพฤศจิกายนยัง paid | ✅ `line-app/smoke-usecases.js › TC-17-17` |
| TC-17-24 | เปลี่ยนผู้เช่าห้องที่มี prepay: สลิปล่วงหน้าของคนเก่าถูกเก็บเข้า `prepay-old` ไม่ตกไปผู้เช่าใหม่ | Alice มี `prepay` | เจ้าของเปลี่ยนผู้เช่า | `prepayArchived:true` · เจ้าของได้ข้อความ — รายละเอียดที่ UC-08 | ✅ `line-app/smoke-usecases.js › TC-08-11` |
| TC-17-18 | แข่งกัน: ผู้เช่าแจ้งโอนพร้อมกับที่เจ้าของออกบิลในเสี้ยววินาที | Blob ไม่มี transaction | สลิปมาถึงขณะ `run` อ่าน prepay ไปแล้ว (และกลับด้าน) | ทุกลำดับจบที่บิล `pending` พร้อมสลิป (`prepaid`) · `prepay:` ถูกล้าง · เจ้าของได้การ์ดยืนยันใบเดียว: `run` อ่าน prepay ซ้ำหลังเขียนบิล และ `slip` อ่านบิลซ้ำหลังเขียน prepay (ตอบ `{status:"pending", attached:true}`) · ถ้าทั้งสองผูกพร้อมกัน เนื้อหาเหมือนกันและการ์ดซ้ำถูก LINE ตัดด้วย retry key `confirm:<ห้อง>:<รอบ>:<total>:<slipAt>` (มี `total` เพื่อไม่ตัดการ์ดที่เนื้อหาต่างกัน) · บิลของผู้เช่าเก่าไม่รับสลิป · สลิปล่วงหน้าที่เจ้าของบันทึก (`prepay.byStaff:true`) ใช้ได้ทั้งสองฝั่ง: `run` ผูกให้เมื่อออกบิล และการตรวจซ้ำของ `slip` ผูกได้เมื่อบิลออกระหว่างบันทึก (ตรวจผู้เช่า/สัญญาเช่าเฉพาะสลิปที่ผู้เช่าส่ง) · ทั้งสองฝั่งใช้ helper เดียวกัน `api/_prepay.js` · `status:"advance"` ถูกต้อง ณ ตอนตอบ (LIFF โหลดบิลใหม่หลังส่ง) | ✅ `line-app/smoke-usecases.js › TC-17-18` |
| TC-17-19 | สลิปล่วงหน้าไม่ตรงงวด/ยอด: เจ้าของตีกลับสลิปที่ผูกกับบิลใหม่ | บิล pending จาก prepay | เจ้าของพบยอดไม่ตรง | ใช้ **ตีกลับ** (TC-04-11) ได้: บิลกลับ `unpaid` + `slipRejected` · สลิปเดิมยังอยู่ · ผู้เช่าแนบใหม่ได้ · **นโยบาย "สลิปล่วงหน้าควรผูกงวดไหน" ยังไม่ได้ตัดสิน** (ตอนนี้ผูกกับบิลรอบถัดไปที่ออก) | ✅ `line-app/smoke-handlers.js` (slip rejection) |
| TC-17-20 | LIFF ผู้เช่า: ยังไม่มีบิล | LIFF จริง · ผู้เช่าผูกห้อง ยังไม่มีบิล | เปิดหน้าบิล | เห็น "ยังไม่มีบิลรอบนี้" และปุ่ม "โอนก่อน / แนบสลิป" · หลังแนบเห็นสถานะสลิปล่วงหน้ารอบิลออก | 🖐 ทดสอบมือกับ LINE จริง |
| TC-17-21 | LIFF ผู้เช่า: บิลล่าสุดจ่ายแล้ว | บิลจ่ายแล้ว | เปิดหน้าบิล | เห็นปุ่ม/ข้อความ "โอนรอบถัดไปก่อน" และแนบสลิปล่วงหน้าได้ | 🖐 ทดสอบมือกับ LINE จริง |
| TC-17-22 | LIFF เจ้าของ: รายการห้องมีป้าย "โอนล่วงหน้า" และหน้าห้องมีการ์ดสลิปล่วงหน้า | LIFF จริง · ห้องมี prepay | เปิดรายการห้อง → เข้าห้อง → กด "ดูสลิป" | เห็นป้าย "โอนล่วงหน้า" · การ์ดสลิปล่วงหน้า · "ดูสลิป" เปิดรูป · ออกบิลแล้วป้ายหาย และบิลขึ้น "รอตรวจ" | 🖐 ทดสอบมือกับ LINE จริง |
| TC-17-23 | การ์ดใน LINE จริง: ข้อความ "แจ้งโอนก่อนบิลออก" ถึงเจ้าของ และการ์ดยืนยันหลังออกบิล | LINE OA จริง | ผู้เช่าแนบสลิปก่อนบิล แล้วเจ้าของออกบิล | เจ้าของได้ข้อความแล้วได้การ์ดยืนยันที่กดได้ | 🖐 ทดสอบมือกับ LINE จริง |
| TC-17-25 | บิลล่าสุดถูกยกเลิก (void) → สลิปที่แนบเป็นโอนล่วงหน้า บิล void ไม่ถูกแตะ | บิลล่าสุดสถานะ void | ผู้เช่าแนบสลิป | `status:"advance"` · บิล void เหมือนเดิม · มี `prepay` — รายละเอียดที่ UC-18 | ✅ `line-app/smoke-usecases.js › TC-18-5` |
| TC-17-26 | ออกบิลใหม่ทับบิล void ที่มี prepay รออยู่ | บิล void · มี prepay | เจ้าของออกบิลห้องนั้นใหม่ | บิลใหม่ `pending` พร้อมสลิป (`prepaid`, rev 2) · prepay ถูกล้าง · เจ้าของได้การ์ดยืนยัน — รายละเอียดที่ UC-18 | ✅ `line-app/smoke-usecases.js › TC-18-9` |
| TC-17-27 | สลิปโอนล่วงหน้าของอีกบัญชีรออยู่แล้ว | `prepay:<room>` ของผู้เช่าคนหนึ่ง | ผู้เช่าร่วมอีกคนส่งสลิปโอนล่วงหน้า | `409 INVALID_STATE` (ไม่เขียนทับสลิปเดิม) · เจ้าของ/ผู้ช่วยยังบันทึกแทนได้ | ✅ `line-app/smoke-handlers.js` (races) |

## UC-18 ยกเลิกบิล (void) และออกบิลใหม่

**ผู้กระทำ:** เจ้าของหอ

(เพิ่มรอบนี้) บิลที่ออกผิดไม่ถูกแก้ทับ เจ้าของยกเลิกด้วย `POST /api/bill {action:"void", room, period, reason}` (เหตุผล 1–200 ตัวอักษร เจ้าของเท่านั้น ผู้ช่วย 403) บิลเป็น `void` พร้อม `voidReason`/`voidedBy`/`voidedAt`/`statusBefore` ทั้งสองสำเนา เลขที่ใบเสร็จ วันที่ชำระ และสลิปยังอยู่บนบิลเป็นหลักฐาน ผู้เช่าได้ข้อความแจ้งพร้อมเหตุผล (ยกเว้นบิลที่เป็นของผู้เช่าเก่า) จากนั้นเจ้าของออกบิลใหม่ที่ `POST /api/run` — บิล void ถูกเก็บเข้า `bill-void:<งวด>:<ห้อง>:<rev>` (ดัชนี `bill-voids:<ห้อง>`) ก่อนถูกเขียนทับ และบิลใหม่ได้ `rev` + 1 ทำให้ใบเสร็จใหม่เลขต่างจากใบเก่า (`R202611-201-2`) เจ้าของ/ผู้ช่วยอ่านบิลที่ยกเลิกแล้วออกใหม่ได้ที่ `GET /api/bill?room=&period=&voided=1` บิลที่ void อยู่: ยืนยันไม่ได้ · พิมพ์ "บิล" ได้ข้อความเหตุผลแทนการ์ดจ่ายเงิน · แนบสลิปแล้วเข้าทางโอนล่วงหน้า (UC-17) · ไม่ถูกทวง (UC-16) · LIFF ไม่นับเป็นเงินค้าง/เป็นห้องที่ออกบิลแล้ว

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/bill.js` (`voidBill`, `voided`)
- `line-app/api/run.js` (`issueBill`: `rev`, archive)
- `line-app/api/_bills.js` (`archiveVoid`, `receiptNoOf`)
- `line-app/api/webhook.js`, `line-app/api/slip.js` (จัดการบิล void)
- `line-app/liff/bill.html` (`voidBill`, ปุ่ม "ยกเลิกบิล", `receiptScreen`)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-18-1 | เจ้าของยกเลิกบิล unpaid | บิล 201 unpaid · ผู้เช่าผูก | POST void (เหตุผลมีช่องว่างหน้าหลัง) · ยกเลิกซ้ำ | `{ok, status:"void"}` · บิลมี `voidReason` (ตัดช่องว่าง) `voidedBy` `voidedAt` `statusBefore:"unpaid"` ทั้งสองสำเนา · ผู้เช่าได้ข้อความ "บิลห้อง 201 รอบ 2026-11 ถูกยกเลิก — …" · ซ้ำ 409 `INVALID_STATE` เหตุผลเดิมอยู่ | ✅ `line-app/smoke-usecases.js › TC-18-1` |
| TC-18-2 | ยกเลิกบิลที่จ่ายแล้ว/รอตรวจ ยังเก็บหลักฐาน | บิล paid (มี `receiptNo`) · บิล pending (มีสลิป) | POST void ทั้งสอง | status void · `statusBefore` paid/pending · `receiptNo` `paidAt` `confirmedBy` ยังอยู่ · สลิปและไฟล์รูปยังอยู่ | ✅ `line-app/smoke-usecases.js › TC-18-2` |
| TC-18-3 | สิทธิ์และข้อมูลที่ส่ง | ผู้เช่า · ผู้ช่วย · บิล 201 unpaid | ผู้เช่า/ผู้ช่วย/ไม่ล็อกอิน/idToken ปลอม · action ผิด · room ว่าง · period ผิดรูปแบบ · เหตุผลว่าง/ไม่ใช่ข้อความ/201 ตัว · ห้อง 999 · งวดที่ไม่มีบิล | 403 · 403 · 401 · 403 · 400 `VALIDATION` ทุกแบบ · 404 · 404 · บิลไม่เปลี่ยน ไม่มีใครได้ข้อความ · เหตุผล 200 ตัวผ่าน | ✅ `line-app/smoke-usecases.js › TC-18-3` |
| TC-18-4 | การแจ้งผู้เช่า: ห้องว่าง · push ล้ม · บิลของผู้เช่าเก่า | 201 ไม่มีผู้เช่า · 202 push ล้ม · 203 ผู้เช่าใหม่ (tenancy) | ยกเลิกบิลทั้งสามห้อง | ยกเลิกสำเร็จทั้งสาม · ไม่มีข้อความถึงใคร (ผู้เช่าใหม่ไม่ถูกแจ้งเรื่องบิลของคนเก่า) | ✅ `line-app/smoke-usecases.js › TC-18-4` |
| TC-18-5 | บิล void ในทางอื่น: ยืนยัน · แชท · อ่าน · แนบสลิป | บิล 201 void เหตุผล "ออกผิดห้อง" | เจ้าของกดการ์ดเก่า · ผู้เช่าพิมพ์ "บิล" · ผู้เช่า/เจ้าของอ่านบิลและประวัติ · ผู้เช่าแนบสลิป | ตอบ "ยกเลิกแล้ว" บิลยัง void · ได้ข้อความเหตุผล (ไม่ใช่การ์ดจ่ายเงิน) · ผู้เช่าเห็น status/`voidReason` แต่ไม่เห็น `voidedBy` (เจ้าของเห็น) · สลิป → `advance` (มี prepay) บิล void ไม่เปลี่ยน | ✅ `line-app/smoke-usecases.js › TC-18-5` |
| TC-18-6 | ออกบิลใหม่ทับบิล void | บิล void (rev 1) | POST `/api/run` ห้องเดิมงวดเดิมด้วยหน่วยใหม่ · ออกซ้ำตอน unpaid | `reissued:true` · บิลใหม่ rev 2 unpaid สด (ไม่มีเหตุผล/สลิป/เลขใบเสร็จเก่า) · ดัชนีงวดไม่ซ้ำ · บิลเก่าถูกเก็บใน `bill-void:2026-11:201:1` และ `bill-voids:201` · ผู้เช่าได้การ์ดใหม่ · การแก้ตอน unpaid ไม่เพิ่ม rev ไม่เก็บซ้ำ | ✅ `line-app/smoke-usecases.js › TC-18-6` |
| TC-18-7 | ทั้งเส้นทางบิลที่จ่ายแล้วแต่ออกผิด | ผู้เช่าผูกห้อง | ออกบิล → สลิป → ยืนยัน → ยกเลิก → ออกบิลใหม่ → สลิป → ยืนยัน | ใบเสร็จแรก `R202611-201` · ใบหลัง `R202611-201-2` (ผู้เช่าได้ 2 การ์ด) · ใบแรกยังอ่านได้ในรายการยกเลิก (`void`, `statusBefore:"paid"`) · ประวัติแสดงเลขใบใหม่ | ✅ `line-app/smoke-usecases.js › TC-18-7` |
| TC-18-8 | อ่านบิลที่ถูกยกเลิก (`?voided=1`) | พ.ย. ยกเลิก/ออกใหม่ 2 รอบ · ต.ค. 1 รอบ · ธ.ค. void แต่ยังไม่ออกใหม่ | เจ้าของ/ผู้ช่วย/ผู้เช่า/ไม่ล็อกอิน เรียก `GET /api/bill?room=201&voided=1` (กรอง period ด้วย) | เรียง งวดใหม่→เก่า แล้ว rev ใหม่→เก่า (ธ.ค. rev1, พ.ย. rev2, พ.ย. rev1, ต.ค.) พร้อมเหตุผล · กรอง period ได้ · ห้องที่ไม่มี [] · ผู้ช่วย 200 · ผู้เช่า 403 (แม้ห้องตัวเอง) · 401 · period ผิดรูปแบบ 400 · **ธ.ค. อยู่ในรายการด้วย** (เก็บตอนกดยกเลิก ไม่รอออกใหม่) | ✅ `line-app/smoke-usecases.js › TC-18-8` |
| TC-18-9 | ออกบิลใหม่ทับบิล void ที่มี prepay รออยู่ | บิล void · ผู้เช่าแนบสลิปรอ (prepay) | เจ้าของออกบิลใหม่ | บิลใหม่ `pending` พร้อมสลิป (`prepaid`, rev 2) · prepay ถูกล้าง · เจ้าของได้การ์ดยืนยันของงวดนั้น | ✅ `line-app/smoke-usecases.js › TC-18-9` |
| TC-18-10 | บิลระบบเก่าที่มีแค่ `bill:<ห้อง>` | `bill:201` paid ไม่มีสำเนารายงวด | ยกเลิก แล้วออกใหม่ | ยกเลิกได้ · เขียนสำเนารายงวดและดัชนี · ออกใหม่ได้ rev 2 · บิลเก่าถูกเก็บ (`statusBefore:"paid"`) | ✅ `line-app/smoke-usecases.js › TC-18-10` |
| TC-18-11 | ยกเลิกบิลจากหน้าจอ LIFF | LIFF เจ้าของ/ผู้ช่วย/ผู้เช่าจริง | เจ้าของเปิดห้อง → กด "ยกเลิกบิล" → ใส่เหตุผล → ยืนยัน · ดูรายการห้อง/รายงาน/ใบเสร็จ · ผู้เช่าเปิดบิล | ต้องใส่เหตุผลก่อน · บิลที่จ่ายแล้วมีคำเตือนว่าใบเสร็จจะถูกยกเลิก · ผู้ช่วยไม่เห็นปุ่ม · ห้องกลับเป็นยังไม่ได้ออกบิลรอบนั้น (ออกใหม่ได้) · ยอดรายงานไม่นับบิล void · ผู้เช่าเห็น "ยกเลิกแล้ว" พร้อมเหตุผล · หน้าใบเสร็จขึ้น "ยกเลิกแล้ว" | 🖐 ทดสอบมือกับ LINE จริง |
| TC-18-12 | ยกเลิกบิลหนึ่งงวดของสลิปหลายงวด | สลิปกลุ่ม pending | ยกเลิกหนึ่งงวด แล้วกดการ์ดกลุ่ม | งวดที่เหลือปิดได้ งวด void ไม่ถูกปิด · ยอดบนการ์ดยังรวมงวดที่ยกเลิก (ข้อสังเกต) — รายละเอียดที่ UC-13 | ✅ `line-app/smoke-usecases.js › TC-13-10` |
| TC-18-13 | ยกเลิกบิลที่จ่ายแล้ว: ขั้นตอนคืนเงิน/ใบลดหนี้ | บิล paid | เจ้าของยกเลิกบิลที่ผู้เช่าจ่ายไปแล้ว | บิลที่ยกเลิกบันทึก `refundDue` = ยอดที่ต้องคืน และ response มี `refund` (LIFF ขึ้น "ต้องคืนเงิน X บาท") · นโยบาย: เจ้าของกด "คืนเงินแล้ว" → `POST /api/bill {action:"refunded", room, period, rev, note?}` บันทึก `refundedAt/refundedBy/refundNote` (เฉพาะเจ้าของ · ไม่มี `refundDue` หรือคืนแล้ว 409 · ไม่มีรายการ 404) · `GET /api/bill?voided=1&refunds=1` แสดงรายการที่ยังค้างคืนทุกห้อง · ผู้เช่าไม่เห็น `refundedBy` · บิลที่ออกใหม่ (rev ถัดไป) ไม่รับสถานะคืนเงิน · **ยอดโอนเกิน:** บิล `paid` ที่สลิปที่ยืนยันมากกว่ายอดบิลมี `refundDue` (= ส่วนเกิน) + `refundReason:"overpaid"` และแท็ก `<รอบ>:<rev>` ใน `overpaid:<ห้อง>` · `GET /api/bill?voided=1&refunds=1` แสดงทั้งสองชนิดโดยมี `kind: "void" \| "overpaid"` · `POST {action:"refunded", kind:"overpaid", room, period, rev}` (ค่าเริ่มต้น `kind` = `void`; `kind` แปลก 400; บิลไม่ใช่ `paid`/rev ไม่ตรง/ไม่มี `refundDue`/คืนแล้ว 409; ไม่มีบิล 404) ตั้ง `refundedAt/refundedBy/refundNote` บนบิลที่จ่ายแล้ว · **ยกเลิกบิลที่มียอดโอนเกิน:** ยอดคืน = ยอดบิล + ส่วนเกินที่ยังไม่ได้คืน (`refund` ใน response และ `refundDue` ในบิลที่ยกเลิก) และรายการแสดงเป็นรายการ `void` เดียว ไม่มีรายการ `overpaid` ซ้ำ · ถ้าส่วนเกินคืนไปแล้วก่อนยกเลิก ยอดคืน = ยอดบิล, บิลที่ยกเลิกไม่รับ `refundedAt/refundedBy/refundNote` เดิม (จึงไม่ถูกซ่อนว่า "คืนแล้ว") และเก็บเป็น `priorRefund` เพื่อดูประวัติ · LIFF แสดง "ต้องคืนเงินที่โอนเกิน X บาท" + ปุ่ม "คืนเงินแล้ว" (เจ้าของเท่านั้น) | ✅ `line-app/smoke-usecases.js › TC-18-13` |

## UC-19 รับ event จาก LINE (webhook ฝั่ง backend)

endpoint พร้อม ตรวจ signature จริง และ **ตอบ event ด้วยข้อความแล้ว** (`follow` → ทักทาย, พิมพ์ "บิล" → บิลล่าสุดของผู้เช่า) แต่ **ยังไม่ผูกกับ OA** — webhook ของช่องทางยังชี้ที่ `line-app` เพราะบิลที่ผู้เช่าเห็นอยู่จริงอยู่ใน Blob/R2 ของ `line-app` ไม่ใช่ Postgres ของ backend (ดู docs/DEPLOYMENT.md)

| # | เคส | เงื่อนไขตั้งต้น | ขั้นตอน | ผลที่ต้องเห็น | สถานะ |
|---|---|---|---|---|---|
| TC-19-1 | signature ถูกต้อง → 200 และบันทึก event | ตั้ง `LINE_CHANNEL_SECRET` | POST body ที่มี 2 event | 200 `{"ok": true}` · `audit_log` 1 แถว action `webhook.line` payload `{count: 2, types: [...]}` | ✅ `backend/tests/test_webhook.py::test_valid_signature_is_200_and_writes_one_audit_row` |
| TC-19-2 | signature ผิด → 401 และไม่เขียนอะไร | ตั้ง secret แล้ว | POST ด้วย signature ของ secret อื่น | 401 · ไม่มีแถวใหม่ใน `audit_log` | ✅ `backend/tests/test_webhook.py::test_bad_signature_is_401_and_logs_nothing` |
| TC-19-3 | หอที่ไม่ใช่ของ deployment → 404 แม้ signature ถูก | path `p_2` | POST พร้อม signature ที่ถูก | 404 · ไม่เขียน `audit_log` | ✅ `backend/tests/test_webhook.py::test_another_dorm_is_404_even_with_a_valid_signature` |
| TC-19-4 | body ที่ไม่ใช่ JSON → 400 | signature ของ body นั้นถูกต้อง | POST body ขยะ | 400 · ไม่เขียน `audit_log` | ✅ `backend/tests/test_webhook.py::test_body_that_is_not_json_is_400` |
| TC-19-5 | ยังไม่ตั้ง secret → 503 | `LINE_CHANNEL_SECRET` ว่าง | POST อะไรก็ได้ | 503 `LINE_NOT_CONFIGURED` | ✅ `backend/tests/test_webhook.py::test_missing_secret_is_503` |
| TC-19-6 | LINE ส่ง event เดิมซ้ำ (redelivery) → บันทึกครั้งเดียว | ตั้ง secret แล้ว | POST body เดิมสองครั้ง | 200 ทั้งสองครั้ง · `audit_log` มีแถวเดียว · event id อื่นยังถูกบันทึก | ✅ `backend/tests/test_webhook.py::test_a_redelivered_event_is_ignored` |
| TC-19-7 | secret รายหอ (`properties.line_secret_enc`) ชนะ env | เก็บ secret ที่เข้ารหัสไว้ + ตั้ง `SECRET_ENC_KEY` + ตั้ง env เป็นค่าอื่น | POST ด้วย signature ของ secret ที่เก็บไว้ / ของ env | ตัวแรก 200 · ตัวที่สอง 401 (env เป็นแค่ fallback) | ✅ `backend/tests/test_webhook.py::test_a_stored_secret_wins_over_the_env` |
| TC-19-8 | ถอด secret รายหอไม่ได้ → 503 ไม่ใช่ 401 | เก็บ secret ด้วยกุญแจ A แล้วสลับ `SECRET_ENC_KEY` เป็นกุญแจ B | POST ด้วย signature ที่ถูกของ secret เดิม | 503 `LINE_SECRET_UNREADABLE` · ไม่เขียน `audit_log` · LINE จะ retry (5xx) ให้แก้กุญแจ | ✅ `backend/tests/test_webhook.py::test_an_unreadable_stored_secret_is_503_not_401` |
| TC-19-9 | มี secret รายหอแล้วไม่ต้องตั้ง env | `LINE_CHANNEL_SECRET` ว่าง + เก็บ secret รายหอไว้ | POST ด้วย signature ของ secret ที่เก็บไว้ | 200 (ไม่ใช่ 503 `LINE_NOT_CONFIGURED`) | ✅ `backend/tests/test_webhook.py::test_a_stored_secret_works_without_the_env` |
| TC-19-10 | webhook ที่ LINE ส่งมาหลาย event ในครั้งเดียว (มี `webhookEventId` 2 ตัวขึ้นไป) | — | POST body ที่มี 2 event id | **200** และบันทึกทั้ง 2 id (ไม่ใช่ 500 จาก `ResourceClosedError`: `execute` หลายชุด parameter กลายเป็น `executemany` ที่ทิ้ง `RETURNING`) · ส่งซ้ำทั้งชุด → 200 และไม่มี audit ใหม่ · audit 1 แถวต่อการส่งครั้งแรก | ✅ `backend/tests/test_webhook.py::test_two_event_ids_in_one_delivery_are_both_recorded` |
| TC-19-11 | ผู้ใช้เพิ่มเพื่อน (`follow`) → backend ทักทายกลับ | ตั้ง secret + มี reply token | POST event `follow` (มี `webhookEventId`) | ส่ง reply ข้อความต้อนรับ 1 ครั้ง · ส่ง event เดิมซ้ำ → ไม่ตอบซ้ำ | ✅ `backend/tests/test_line_handlers.py::test_a_follow_gets_the_welcome` · `::test_a_redelivery_does_not_answer_twice` |
| TC-19-12 | ผู้เช่าพิมพ์ "บิล" → ตอบบิลล่าสุดเป็นข้อความ | ผู้เช่าผูก LINE กับห้อง 203 (มีบิลค้าง 2026-10) | POST event `message` text `บิล` | ตอบ "ห้อง 203 · รอบ 2026-10 · ยอด … บาท · ครบกำหนด … · สถานะ: รอชำระ" · ยังไม่ผูกห้อง → "ยังไม่ได้ผูกห้อง…" · ข้อความอื่น → ไม่ตอบ | ✅ `backend/tests/test_line_handlers.py::test_bill_answers_with_the_tenants_newest_bill` · `::test_bill_from_someone_not_bound_says_so` · `::test_other_text_is_not_answered` |
| TC-19-13 | handler พัง (LINE ล่ม) → webhook ยังตอบ LINE 200 | ทำให้ `reply_text` โยน exception | POST event `follow` | 200 `{"ok": true}` · event ถูกบันทึกใน `line_events` แล้ว · error อยู่ใน log ไม่ทำให้ LINE ส่งซ้ำทั้งชุด | ✅ `backend/tests/test_line_handlers.py::test_a_broken_handler_still_answers_line_200` |

## สรุป

| UC | ชื่อ | TC ทั้งหมด | ✅ automated | 🖐 manual | ⏳ ยังไม่สร้าง |
|---|---|---:|---:|---:|---:|
| UC-01 | ตั้งค่าหอ (ค่าเช่า · อัตราน้ำไฟ) | 12 | 12 | 0 | 0 |
| UC-02 | จดมิเตอร์น้ำ–ไฟ | 18 | 15 | 3 | 0 |
| UC-03 | ออกบิล (คำนวณบิล · ส่งบิลทาง LINE) | 26 | 24 | 2 | 0 |
| UC-04 | ยืนยันการชำระ (include ออกใบเสร็จ) | 18 | 17 | 1 | 0 |
| UC-05 | ดูห้องค้างชำระ (ค้างกี่งวด · เกินกี่วัน) | 11 | 10 | 1 | 0 |
| UC-06 | ดูรายรับ | 8 | 7 | 1 | 0 |
| UC-07 | เพิ่ม/ถอนเจ้าของและผู้ช่วย | 16 | 15 | 1 | 0 |
| UC-08 | เปลี่ยนผู้เช่า / หมุน QR ห้อง | 18 | 15 | 3 | 0 |
| UC-09 | ผูกบัญชี LINE กับห้อง | 20 | 18 | 2 | 0 |
| UC-10 | ดูบิล | 16 | 15 | 1 | 0 |
| UC-11 | แจ้งชำระ (แนบสลิป) | 17 | 16 | 1 | 0 |
| UC-12 | ตรวจสลิปอัตโนมัติ | 17 | 16 | 1 | 0 |
| UC-13 | ชำระหลายงวดในสลิปเดียว | 13 | 12 | 1 | 0 |
| UC-14 | ดูยอดค้างชำระ | 4 | 3 | 1 | 0 |
| UC-15 | ดูใบเสร็จ | 10 | 8 | 2 | 0 |
| UC-16 | ทวงอัตโนมัติ (เลยกำหนด 1 / 5 / 10 วัน) | 25 | 23 | 2 | 0 |
| UC-17 | แจ้งชำระก่อนบิลออก (โอนก่อน) | 27 | 23 | 4 | 0 |
| UC-18 | ยกเลิกบิล (void) และออกบิลใหม่ | 13 | 12 | 1 | 0 |
| UC-19 | รับ event จาก LINE (webhook ฝั่ง backend) | 13 | 13 | 0 | 0 |
| **รวม** | | **302** | **274** | **28** | **0** |

หมายเหตุ: คอลัมน์ ✅ รวมทั้ง test ใน `line-app/smoke-usecases.js` (177 ข้อ) และ test ที่มีอยู่แล้วใน `backend/tests/` ที่ผูกกับกรณีนั้น (บางแถวอ้างหลายฟังก์ชัน นับเป็น 1 TC) แถว ✅ ที่อ้าง pytest ไม่ได้ถูกรันโดยชุดนี้ — รันด้วย `cd backend && pytest -q`

---

## ข้อสังเกตจากโค้ดระหว่างเขียน test (พฤติกรรมที่ควรตัดสินใจ)

ข้อด้านล่าง **ยังไม่ได้ตัดสินใจ/ยังไม่ได้แก้** — เขียนไว้เพื่อให้ทีมตัดสินใจว่าเป็นบักหรือเป็นพฤติกรรมที่ตั้งใจ ส่วนที่แก้แล้วและมี test ล็อกไว้: การ์ดบิลไม่ขึ้น "ครบกำหนด null" เมื่อไม่มี due (TC-03-13) · API ปฏิเสธช่องน้ำ/ไฟที่ขาดแทนการนับเป็น 0 หน่วย (TC-02-6) · รหัสเชิญที่คนมีสิทธิ์แล้วใช้ถูกทำเครื่องหมายว่าใช้แล้ว (TC-07-9) · ผู้เช่าใหม่ไม่เห็นประวัติบิลของห้อง (UC-08 TC-08-6…15) · ผู้เช่าต้องแนบรูปสำหรับสลิปใหม่ แต่แก้หมายเหตุของสลิปที่ส่งไปแล้วได้โดยไม่ต้องแนบใหม่ เจ้าของบันทึกแบบไม่มีรูปได้และการ์ดเตือน (TC-11-2, TC-11-13, TC-11-17) · สลิปที่โอนก่อนบิลออกหรือเกิน 30 วันถูกติดธง "ตรวจไม่ได้" ไม่บล็อก (TC-12-7) · ยอดเกิน/ขาดติดธงอย่างเดียว ส่วนเกินเป็นเงินที่ต้องคืนซึ่งเจ้าของกดบันทึก ไม่มีเครดิตยกยอด (TC-13-3, TC-18-13) · ค้างกี่งวด/เกินกี่วันคำนวณฝั่งเซิร์ฟเวอร์ด้วยวันที่ไทย `/api/bill?overdue=1` (TC-05-7, TC-05-8, TC-14-2) · รายรับนับตามวันที่ชำระ `/api/bill?income=` (TC-06-6) · เจ้าของบันทึก "คืนเงินแล้ว" ของบิลที่ยกเลิกหลังจ่าย (TC-18-13) · ใบเสร็จ/เตือนซ้ำจากคำขอที่ชนกันถูกตัดด้วย `X-Line-Retry-Key` (TC-15-10, TC-16-23) · สลิปโอนก่อนที่มาพร้อมการออกบิลถูกผูกกับบิลใหม่ด้วยการอ่านซ้ำทั้งสองฝั่ง (TC-17-18) · ผู้เช่าที่ย้ายออกไม่ถูกทวงฝั่ง backend (TC-16-11)

1. **guard ฝั่ง LIFF ไม่มีเทสต์อัตโนมัติ** — `bill.html` ปฏิเสธช่องหน่วยว่าง/ติดลบ/ไม่เป็นจำนวนเต็มก่อนเขียน draft (ตรงกับ API ที่ตอบ `400 VALIDATION`) แต่ทั้งชุด smoke รันเฉพาะ handler ไม่ได้โหลดหน้า LIFF จึงต้องยืนยันด้วยมือ (TC-02-14 🖐)
2. **Blob ไม่มี transaction** — ส่วนที่ปิดแล้ว: การ push ซ้ำใช้ `X-Line-Retry-Key` ที่สร้างจากสิ่งที่ทำให้ข้อความหนึ่งต่างจากอีกข้อความ ทำให้ LINE ตัดข้อความซ้ำใน 24 ชั่วโมง — ใบเสร็จใช้ `งวด:rev:ยอด:เลขใบเสร็จ:slipAt` · การเตือนเพิ่ม `ยอด:due` · สรุปรวมข้อความของมันเอง · การ์ดยืนยันใช้ `ยอด:slipAt` (TC-15-10, TC-16-23) · สลิปโอนก่อนที่มาพร้อมการออกบิลถูกผูกด้วยการอ่านซ้ำทั้งสองฝั่ง (TC-17-18) · ที่ยังเหลือ: การเขียน Blob ยังซ้อนกันได้ (เช่น `paidAt` ถูกเขียนสองครั้ง) และการยืนยันสลิปหลายงวดเขียนทีละบิล (TC-13-6 ครอบคลุมการกดซ้ำเพื่อปิดส่วนที่ค้าง)
3. **ยกเลิกบิลหนึ่งงวดของสลิปหลายงวด ไม่ปรับยอดกลุ่ม** — บิลที่เหลือยังจำ `slipGroup.total` เดิม และการ์ดที่ส่งเจ้าของไปแล้วยังแสดงยอดรวมงวดที่ยกเลิก (TC-13-10, TC-18-12)
4. **ตรวจสลิปด้วย SlipOK** — สลิปของบิลรายเดือนที่รูปใหม่ตรวจผ่านครบ (`ok === true`) ถูกปิดเป็น `paid` เอง ไม่ต้องรอเจ้าของ **เฉพาะหอที่เจ้าของเปิดสวิตช์ `autoConfirm` เอง (ค่าเริ่มต้น = ปิด)** (TC-12-9, TC-12-11) ส่วนผลอื่น สลิปล่วงหน้า และ prepay ที่ผูกกับบิลยังรอเจ้าของกด (TC-12-10, TC-12-12) · สวิตช์หอปิดหรือไม่เคยตั้ง = เจ้าของกดทุกใบ (TC-12-16) · `SLIP_AUTO_CONFIRM=0|off|false` ปิดทั้ง deployment แม้หอเปิดสวิตช์ (TC-12-13) · ระบบบันทึกยอดในสลิป (`slipAmount`, `overpaid`, `shortBy`) · ยอดเกินหรือขาดถูกติดธงให้เจ้าของตัดสิน ไม่บล็อก · ส่วนเกินคือเงินที่ต้องคืนผู้เช่า เจ้าของกดบันทึกว่าคืนแล้ว (kind overpaid) ไม่มีเครดิตยกยอด (TC-13-3, TC-18-13) · สลิปที่โอนก่อนบิลออก หรือเก่ากว่า 30 วัน ถูกติดธง "ตรวจไม่ได้" (TC-12-7) · ถ้าผู้ให้บริการไม่ส่งวันที่โอนมา ทั้งสองกฎจะไม่ทำงาน
5. **รูปสลิป** — ผู้เช่าต้องแนบรูปเมื่อส่งสลิปใหม่ (400 "ต้องแนบรูปสลิป") แต่แก้หมายเหตุของสลิปที่ส่งไปแล้วได้โดยไม่ต้องมีรูปใหม่ (TC-11-17) · เจ้าของบันทึกการชำระโดยไม่มีรูปได้ (เงินสด) และการ์ดยืนยันขึ้น "ไม่มีรูปสลิป — ตรวจยอดเงินเข้าเองก่อนยืนยัน" (TC-11-2, TC-11-13)
6. **ค้างกี่งวด/เกินกี่วัน** — คำนวณฝั่งเซิร์ฟเวอร์ด้วยวันที่ไทยที่ `/api/bill?overdue=1` (บิลล่าสุด + ย้อนหลัง 12 งวด) (TC-05-7, TC-05-8, TC-14-2) · ตัวเลข "ค้างเกินกำหนด" บนหน้าแรกเจ้าของยังนับจากบิลล่าสุดด้วยนาฬิกาของเครื่อง · TC-05-6 ยังต้องทดสอบหน้าจอด้วยมือ
7. **ยกเลิกบิลที่จ่ายแล้ว** — บันทึก `refundDue` และเจ้าของกด "คืนเงินแล้ว" เพื่อบันทึก `refundedAt` (`POST /api/bill {action:"refunded"}`); รายการที่ยังไม่คืนดูได้ที่ `/api/bill?voided=1&refunds=1` และหน้าแรกเจ้าของ · ไม่มีการหักเป็นเครดิตเข้าบิลใหม่ (TC-18-13)
8. **ตัวเลขที่เป็นสตริง** (`"12"`) ถูกรับเป็นหน่วยมิเตอร์ (`Number("12")`) — น่าจะตั้งใจเพราะ input ของ LIFF ส่งสตริง (TC-02-3)
9. **รายรับนับตามวันที่ชำระ** — "รับเงินเดือนนี้" ในรายงานนับจาก `paidAt` (เวลาไทย) ไม่ว่าเป็นบิลของรอบไหน เช่น บิล ต.ค. ที่ชำระ 2 พ.ย. นับเป็นรายรับ พ.ย. · ส่วนแยกตามรอบบิล (ชำระแล้ว/รอตรวจ/ยังไม่ชำระ) ยังนับตามงวด (TC-06-6)

ข้อสังเกตนอกเหนือจาก use case: line-app **มี** `POST /api/rooms` ให้เจ้าของแก้ค่าเช่า/อัตราน้ำไฟและตั้งค่าหอแล้ว (UC-01) แต่หน้าจอรายงาน/ค้างชำระยังเรนเดอร์ฝั่งเบราว์เซอร์ จึงมีเพียง `node --check` ใน CI ที่ตรวจว่าสคริปต์ parse ได้ ไม่มี test ของ logic หน้าจอ
