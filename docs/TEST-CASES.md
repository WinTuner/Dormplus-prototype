# Test case ตาม Use Case (TEST-CASES)

เอกสารนี้แตก **use case ในแผนภาพ UML ของทีม** เป็น test case ทีละข้อ แต่ละข้อบอกว่า ทดสอบอะไร ต้องเตรียมอะไร ทำอย่างไร ผลที่คาดคืออะไร และ **ใครเป็นคนตรวจ** (test อัตโนมัติข้อไหน หรือต้องกดมือ หรือยังไม่ได้สร้าง) เพื่อให้เห็นว่าแต่ละ use case ถูกตรวจแค่ไหน ส่วนภาพรวมของชุด test ทั้ง repo ดู [`TESTING.md`](TESTING.md)

ที่มา: `line-app/api/*.js`, `line-app/liff/bill.html`, `backend/app/`, `backend/tests/*.py`, `line-app/smoke-usecases.js` — ทุกกรณีเขียนจากพฤติกรรมที่อยู่ในโค้ดจริง ไม่ได้เดา

---

## วิธีรัน

| ชุด test | คำสั่ง | ต้องมี |
|---|---|---|
| **Use case (line-app)** — ไฟล์นี้ | `cd line-app && node smoke-usecases.js` | Node ≥ 20 · ไม่ต้องมีเน็ต · ไม่ต้อง `npm install` |
| line-app อื่น ๆ | `cd line-app && node smoke.js` · `node smoke-handlers.js` · `node smoke-reads.js` | เหมือนข้างบน |
| backend | `cd backend && pytest -q` | Python ≥ 3.11 · Postgres · ตั้ง `TEST_DATABASE_URL` (เช่น `postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test`) และ `DEV_AUTH=true` |

`smoke-usecases.js` พิมพ์ `✓ TC-xx-n …` ต่อกรณี และ `✗` พร้อมเหตุผลเมื่อตก จบด้วยจำนวนที่ผ่าน และออกด้วย exit 1 ถ้ามีกรณีตก CI รันให้ทุก push/PR (ขั้น "Use case tests" ใน `.github/workflows/ci.yml`)

ชุดนี้ใช้ handler จริงทุกตัว: สโตร์เป็น `Map` ในหน่วยความจำ (สลับผ่าน `require.cache`) · `fetch` ถูกจำลอง (idToken ที่ขึ้นต้นด้วย `U` ถือว่าเป็น userId นั้น, บันทึกทุก push/reply/ตั้งเมนู LINE) · `qrcode-svg` ถูกแทนที่ — กรณีทุกข้อเริ่มจากหอว่าง ไม่พึ่งผลของข้ออื่น

## สัญลักษณ์ในคอลัมน์ "ทดสอบโดย"

| สัญลักษณ์ | ความหมาย |
|---|---|
| ✅ | **automated** — มี test รันได้เอง (`line-app/smoke-usecases.js › TC-…` หรือ pytest ที่ระบุ) |
| 🖐 | **manual** — ต้องใช้ LINE/LIFF จริงหรือมือถือจริง ไม่มี test อัตโนมัติ |
| ⏳ | **ยังไม่สร้าง** — ฟีเจอร์ยังไม่มีในโค้ด หรือมีแต่ยังไม่มี test; แถวบอกว่าควรทดสอบอะไรเมื่อสร้าง |

## Use case ที่ครอบคลุม

ผู้กระทำ **เจ้าของหอ**: UC-01 ตั้งค่าหอ · UC-02 จดมิเตอร์น้ำ–ไฟ · UC-03 ออกบิล · UC-04 ยืนยันการชำระ · UC-05 ดูห้องค้างชำระ · UC-06 ดูรายรับ · UC-07 เพิ่ม/ถอนเจ้าของและผู้ช่วย · UC-08 เปลี่ยนผู้เช่า/หมุน QR ห้อง
ผู้กระทำ **ผู้เช่า**: UC-09 ผูกบัญชี LINE กับห้อง · UC-10 ดูบิล · UC-11 แจ้งชำระ (แนบสลิป) · UC-12 ตรวจสลิปอัตโนมัติ · UC-13 ชำระหลายงวดในสลิปเดียว · UC-14 ดูยอดค้างชำระ · UC-15 ดูใบเสร็จ · UC-17 แจ้งชำระก่อนบิลออก (โอนก่อน)
ผู้กระทำ **ระบบ/เวลา**: UC-16 ทวงอัตโนมัติ (เลยกำหนด 1 / 5 / 10 วัน)

UC-07 และ UC-08 เพิ่มเข้ามาหลังแผนภาพ ส่วน UC-17 เพิ่มเมื่อ API โอนก่อนบิลเสร็จ (ผู้กระทำคือผู้เช่า)

> **สองระบบ แปลว่ากรณีเดียวกันอาจมีสองแถวผลลัพธ์** — `line-app/` คือระบบที่ใช้งานจริงตอนนี้ (บิลเก็บใน Vercel Blob, ผู้เช่าแยกด้วย LINE userId) ส่วน `backend/` คือ FastAPI + Postgres ที่จะมาแทน กรณีที่อ้าง `backend/tests/...` ถูกตรวจโดย pytest ที่มีอยู่แล้ว (ไฟล์นี้ไม่ได้รันและไม่ได้แก้)

## UC-01 ตั้งค่าหอ (ค่าเช่า · อัตราน้ำไฟ)

**ผู้กระทำ:** เจ้าของหอ

ค่าเช่าและอัตราค่าน้ำ/ค่าไฟต่อหน่วยของแต่ละห้อง ใช้คำนวณบิลตอนออกบิล ค่าเริ่มต้นมาจาก env (`DEFAULT_RENT`=3500, `WATER_RATE`=25, `ELEC_RATE`=7) และห้องใดที่ต้องการค่าต่างออกไปเก็บเป็น `room:<ห้อง>` ในสโตร์ รายชื่อห้องมาจาก env `ROOMS` (ค่าเริ่มต้น 201–212) **ใน line-app ยังไม่มี API/หน้าจอให้เจ้าของแก้ค่าเอง** (มีแต่ `/api/dev?do=seed` สำหรับ dev) — ฝั่ง backend มีตาราง rooms/rate และค่าเหมาจ่ายต่อห้อง

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
| TC-01-6 | เจ้าของแก้ค่าเช่า/อัตราน้ำไฟของห้องผ่านหน้าจอ/API | เจ้าของล็อกอิน | ส่งค่าใหม่ของห้อง 201 | บันทึกสำเร็จ · เจ้าของร่วมทำได้ · ผู้ช่วย/ผู้เช่า 403 · ค่าติดลบ/ไม่ใช่ตัวเลขถูกปฏิเสธ · มีบันทึกว่าใครแก้ | ⏳ ยังไม่สร้าง |
| TC-01-7 | ค่าตั้งของห้องที่ไม่มีใน ROOMS / env `ROOMS` เว้นวรรคและค่าว่าง | ตั้ง `ROOMS=" 101, ,102 "` | เรียก `/api/rooms` | ได้ห้อง 101, 102 เท่านั้น (ตัดช่องว่างและค่าว่าง) — ต้องมี test ที่ตั้ง env ก่อน require โมดูล | ⏳ ยังไม่สร้าง |
| TC-01-8 | backend: ห้องเหมาจ่ายไม่ต้องจดมิเตอร์ ห้องว่างไม่ถูกออกบิล | seed demo dorm | `POST /v1/billing/run` | ห้องเหมาจ่ายถูกออกบิลโดยไม่มีมิเตอร์ ห้องว่างถูกข้าม | ✅ `backend/tests/test_billing.py::test_flat_rate_rooms_need_no_reading_and_vacant_rooms_are_skipped` |

## UC-02 จดมิเตอร์น้ำ–ไฟ

**ผู้กระทำ:** เจ้าของหอ

ใน line-app เจ้าของกรอก **จำนวนหน่วยที่ใช้ของเดือนนั้น** (ไม่ใช่เลขมิเตอร์สะสม) ที่หน้า LIFF แล้วส่งพร้อมกับการออกบิลที่ `POST /api/run` — ไม่มี endpoint จดมิเตอร์แยก ระบบเก็บค่าล่าสุดเป็น `meter:<ห้อง>` ฝั่ง backend แยกเป็น `PUT /v1/rooms/{room}/reading` ที่รับเลขมิเตอร์สะสมและลบกับเดือนก่อน

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/run.js` (`parseUnits`, `issueBill`)
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
| TC-02-6 | ไม่ส่ง water/elec หรือส่ง null นับเป็น 0 หน่วย | — | ส่ง `{room:"201"}` และ `{water:null}` | ไม่ error · ออกบิลเฉพาะค่าเช่า (ดูหมายเหตุ: ลืมจดมิเตอร์จะกลายเป็นบิลค่าเช่าล้วนโดยไม่เตือน) | ✅ `line-app/smoke-usecases.js › TC-02-6` |
| TC-02-7 | ห้องซ้ำในคำขอเดียวกัน | — | ส่ง 201 สองครั้งในคำขอเดียว | ครั้งแรกผ่าน (ค่าแรกถูกเก็บ) ครั้งที่สองถูกปฏิเสธ | ✅ `line-app/smoke-usecases.js › TC-02-7` |
| TC-02-8 | เฉพาะเจ้าของจดมิเตอร์/ออกบิลได้ | มีผู้เช่า ผู้ช่วย | ผู้เช่า · ผู้ช่วย · ไม่ล็อกอิน · idToken ปลอม เรียก `/api/run` | 403 · 403 · 401 · 403 · ไม่มีมิเตอร์ถูกเขียน | ✅ `line-app/smoke-usecases.js › TC-02-8` |
| TC-02-9 | เตือนเมื่อเลขมิเตอร์ต่ำกว่าเดือนก่อน (ฝั่ง line-app) | มีมิเตอร์เดือนก่อน | กรอกหน่วย/เลขที่ผิดปกติมาก | line-app ไม่มีตรรกะนี้ (รับหน่วยตรง ๆ) — ถ้าต้องการต้องสร้างก่อน | ⏳ ยังไม่สร้าง |
| TC-02-10 | backend: จดเทียบเดือนก่อน เขียนทับได้จนกว่าจะออกบิล เลขต่ำกว่าเดิมบันทึกพร้อมคำเตือน | seed demo dorm | `PUT /v1/rooms/{room}/reading` | ได้หน่วยที่ใช้ = เลขใหม่ − เลขเดือนก่อน | ✅ `backend/tests/test_rooms.py::test_record_a_reading_against_last_month` |
| TC-02-11 | backend: ส่งซ้ำเขียนทับ · เลขต่ำกว่าเดิมมี warning · ห้องแรกไม่มีเดือนก่อน | — | ส่งเลขซ้ำ/ต่ำ/ห้องแรก | ตามสัญญา API | ✅ `backend/tests/test_rooms.py::test_sending_again_overwrites_until_billed`<br>`backend/tests/test_rooms.py::test_a_lower_meter_is_saved_with_a_warning`<br>`backend/tests/test_rooms.py::test_first_reading_of_a_room_has_nothing_to_subtract` |
| TC-02-12 | backend: งวดที่ออกบิลแล้วแก้มิเตอร์ไม่ได้ · ห้องไม่มีจริง · ค่าไม่ถูกต้อง | ออกบิลแล้ว | `PUT …/reading` | ถูกปฏิเสธ | ✅ `backend/tests/test_rooms.py::test_a_billed_period_cannot_be_changed`<br>`backend/tests/test_rooms.py::test_unknown_room`<br>`backend/tests/test_rooms.py::test_invalid_readings_are_rejected` |
| TC-02-13 | backend: ผู้เช่า/หอพักอื่นจดมิเตอร์ไม่ได้ | — | ผู้เช่า หรือเจ้าของหออื่น เรียก API | ถูกปฏิเสธ | ✅ `backend/tests/test_rooms.py::test_tenants_cannot_list_rooms_or_record_meters`<br>`backend/tests/test_rooms.py::test_another_dorm_cannot_record_a_meter_here` |

## UC-03 ออกบิล (คำนวณบิล · ส่งบิลทาง LINE)

**ผู้กระทำ:** เจ้าของหอ

«include» คำนวณบิล และส่งบิล + QR ทาง LINE — เจ้าของส่ง period (`YYYY-MM`), วันครบกำหนด และหน่วยของแต่ละห้องที่ `POST /api/run` ระบบคำนวณ ค่าเช่า + น้ำ + ไฟ เก็บบิลสองสำเนา (`bill:<ห้อง>` ล่าสุด และ `bill:<งวด>:<ห้อง>` ประวัติ) แล้ว push การ์ดบิล (Flex) ให้ผู้เช่าที่ผูกห้อง กฎเงิน: บิลที่แจ้งชำระ (pending) หรือจ่ายแล้ว (paid) ถูกแก้ไม่ได้ · QR ชำระเงิน (PromptPay) บนบิลยังเป็นที่ว่าง (placeholder) ใน LIFF

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/run.js`
- `line-app/api/_bills.js` (`saveBill`)
- `line-app/api/_line.js` (`billBubble`)
- backend: `backend/app/routes/billing.py` (`run_billing`, `create_invoice`), `backend/app/tasks.py`

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-03-1 | ออกบิลสำเร็จ | เจ้าของล็อกอิน | POST `/api/run` ห้อง 201 น้ำ 10 ไฟ 100 · period 2026-11 · due 2026-11-16 | ยอด 4,450 · สถานะ unpaid · สองสำเนาตรงกัน · `bills:201`=[2026-11] | ✅ `line-app/smoke-usecases.js › TC-03-1` |
| TC-03-2 | period ผิดรูปแบบ | — | period = 2026-13, 2026-1, 202611, ว่าง (ไม่มี `BILL_PERIOD`) | 400 VALIDATION · ไม่เขียนอะไรลงสโตร์ | ✅ `line-app/smoke-usecases.js › TC-03-2` |
| TC-03-3 | due ผิดรูปแบบ / ไม่ส่ง due | — | due = 16/11/2026, 2026-11-32, 2026-13-01 · แล้วไม่ส่ง due | ผิดรูปแบบ 400 · ไม่ส่ง due ออกได้ แต่ `due`=null (ดูหมายเหตุบัก) | ✅ `line-app/smoke-usecases.js › TC-03-3` |
| TC-03-4 | readings ว่าง/ไม่ใช่ array/ไม่มี body | — | ส่ง `[]`, ไม่ส่ง, สตริง, object | 400 | ✅ `line-app/smoke-usecases.js › TC-03-4` |
| TC-03-5 | วิธีเรียกที่ไม่ใช่ POST | — | GET `/api/run` | 405 | ✅ `line-app/smoke-usecases.js › TC-03-5` |
| TC-03-6 | ส่งการ์ดบิลให้ผู้เช่าที่ผูกห้อง | 201 มีผู้เช่า · 202 ว่าง | ออกบิล 201 และ 202 | 201 `pushed:true` ได้ Flex (altText มีห้อง/ยอด · ปุ่มเปิด LIFF `?room=201`) · 202 ได้บิลแต่ `pushed:false` | ✅ `line-app/smoke-usecases.js › TC-03-6` |
| TC-03-7 | ส่ง LINE ล้มเหลว | LINE push ของผู้เช่าตอบ 500 | ออกบิล | บิลถูกเก็บก่อนส่ง · HTTP 200 · `pushed:false` | ✅ `line-app/smoke-usecases.js › TC-03-7` |
| TC-03-8 | ออกบิลซ้ำห้องที่ยัง unpaid (แก้พิมพ์ผิด) | ออกบิล 201 แล้ว | ออกอีกครั้งด้วยหน่วยใหม่ | `reissued:true` · สองสำเนาถูกแก้ · ดัชนีงวดไม่ซ้ำ · ส่งการ์ดใหม่ | ✅ `line-app/smoke-usecases.js › TC-03-8` |
| TC-03-9 | บิล pending/paid ถูกแก้ไม่ได้ | 201 pending มีสลิป · 202 paid | ออกซ้ำทั้งสองห้อง | ทั้งสองได้ `error` · สถานะและยอดไม่เปลี่ยน | ✅ `line-app/smoke-usecases.js › TC-03-9` |
| TC-03-10 | บิลระบบเก่าที่มีแค่ `bill:<ห้อง>` ที่ paid ก็กันการออกซ้ำ | `bill:201` paid ไม่มีสำเนารายงวด | ออกซ้ำงวดเดียวกัน | ถูกปฏิเสธ · ยัง paid | ✅ `line-app/smoke-usecases.js › TC-03-10` |
| TC-03-11 | ออกบิลงวดเก่าย้อนหลัง | ออกงวด 2026-12 แล้ว | ออกงวด 2026-11 | `bill:201` ยังเป็น 2026-12 · งวด 11 อยู่ในประวัติ · ดัชนีเรียงใหม่→เก่า | ✅ `line-app/smoke-usecases.js › TC-03-11` |
| TC-03-12 | ออกบิลทั้งหอในคำขอเดียว | ROOMS 12 ห้อง | ส่ง 12 ห้อง | ทุกห้องมีบิล · ผลลัพธ์เรียงตามลำดับที่ส่ง | ✅ `line-app/smoke-usecases.js › TC-03-12` |
| TC-03-13 | การ์ดบิลไม่ขึ้นคำว่า `null` เมื่อไม่มีวันครบกำหนด | ออกบิลโดยไม่ส่ง due | ดูการ์ดที่ผู้เช่าได้ | ไม่มีข้อความ "ครบกำหนด null" (**ปัจจุบันขึ้น** — ดูรายงานบัก)  | ⏳ ยังไม่สร้าง |
| TC-03-14 | บิลมี QR ชำระเงิน (PromptPay) ตามยอด | เจ้าของตั้งเลขพร้อมเพย์ | ผู้เช่าเปิดบิล | QR ตรงยอดและเลขพร้อมเพย์ของหอ (ตอนนี้ LIFF มีแต่ที่ว่าง) | ⏳ ยังไม่สร้าง |
| TC-03-15 | เจ้าของเห็นผลออกบิลจริงบนหน้าจอ LIFF และผู้เช่าได้รับการ์ดใน LINE จริง | LINE OA + LIFF จริง | กรอกหน่วยทุกห้อง กดออกบิล | แสดงผลต่อห้อง · การ์ดถึงผู้เช่า · ปุ่มเปิดหน้าบิลถูกห้อง | 🖐 ทดสอบมือกับ LINE จริง |
| TC-03-16 | backend: ออกบิลห้องที่มีมิเตอร์เดือนนี้ · 42 ห้องในคำขอเดียว · ออกซ้ำ 409 · ล้มกลางทางย้อนทั้งชุด | seed + มิเตอร์ | `POST /v1/billing/run` | 202 และยอดตรงสัญญา | ✅ `backend/tests/test_billing.py::test_bills_the_rooms_that_have_this_months_reading`<br>`backend/tests/test_billing.py::test_all_42_rooms_in_one_request`<br>`backend/tests/test_billing.py::test_running_again_is_409_and_creates_nothing`<br>`backend/tests/test_billing.py::test_a_failure_halfway_rolls_back_the_whole_run` |
| TC-03-17 | backend: ผู้เช่าออกบิลไม่ได้ · period ผิดถูกปฏิเสธ · ผู้เช่าที่ไม่มีมิเตอร์เดือนก่อนไม่ถูกออกบิล | — | เรียก `/v1/billing/run` | 403 / 422 / ข้ามห้อง | ✅ `backend/tests/test_billing.py::test_tenants_cannot_run_billing`<br>`backend/tests/test_billing.py::test_bad_period_is_rejected`<br>`backend/tests/test_billing.py::test_a_room_without_an_earlier_reading_is_not_billed` |
| TC-03-18 | backend: ส่งบิลทาง LINE (queue) ใช้ line item เดียว | — | ออกบิลแล้วคิวส่ง push | batch เดียว ไม่ N+1 | ✅ `backend/tests/test_billing.py::test_create_invoice_batches_line_item_execute` |

## UC-04 ยืนยันการชำระ (include ออกใบเสร็จ)

**ผู้กระทำ:** เจ้าของหอ

เจ้าของกดปุ่ม "ยืนยันการชำระ" บนการ์ดที่ผู้เช่าแจ้งชำระ (postback `action=confirm&room=…&period=…` เข้า `POST /api/webhook`) บิล pending → paid, บันทึก `paidAt` และ `confirmedBy`, แจ้งผู้เช่า การ์ดผูกกับ **งวด** ของบิลนั้น การ์ดเก่าไม่ปิดบิลเดือนใหม่ ส่วน **การออกใบเสร็จ (เลขที่ใบเสร็จ) และการตีสลิปกลับ (reject) ยังไม่มีใน line-app** — มีใน backend (`REC-<งวด>-<ลำดับ>`, `reject`)

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/webhook.js` (postback `confirm`)
- `line-app/api/_line.js` (`confirmBubble`)
- `line-app/api/_bills.js`
- backend: `backend/app/routes/billing.py` (`confirm_invoice`, `reject_slip`)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-04-1 | เส้นทางตั้งแต่ต้นจนจบ (end-to-end) | เจ้าของ + ผู้เช่าล็อกอิน | เจ้าของขอ QR ห้อง 203 → ผู้เช่าสแกนผูก → เจ้าของออกบิล → ผู้เช่าอ่านบิล → แนบสลิป → เจ้าของกดปุ่มบนการ์ด | บิล paid · `confirmedBy`=เจ้าของ · `paidAt` มี · สองสำเนาตรงกัน · ผู้เช่าได้ข้อความ "ชำระเงินแล้ว" · เจ้าของได้คำตอบ "ยืนยันห้อง 203" | ✅ `line-app/smoke-usecases.js › TC-04-1` |
| TC-04-2 | ผู้เช่า/ผู้ช่วย/คนแปลกหน้ากดยืนยันไม่ได้ | บิล 205 pending | คนเหล่านั้นส่ง postback confirm | ตอบ "เฉพาะเจ้าของหอ…" · บิลยัง pending | ✅ `line-app/smoke-usecases.js › TC-04-2` |
| TC-04-3 | การ์ดเก่าไม่มี period | บิลล่าสุด pending | เจ้าของกดการ์ดที่ไม่มี `period` | ปฏิเสธ "ไม่ระบุรอบบิล" · บิลไม่เปลี่ยน | ✅ `line-app/smoke-usecases.js › TC-04-3` |
| TC-04-4 | บิลที่ยังไม่แจ้งชำระ (unpaid) ยืนยันไม่ได้ | บิล unpaid | เจ้าของกด confirm | ตอบ "ยังไม่ได้แจ้งชำระ" · ยัง unpaid | ✅ `line-app/smoke-usecases.js › TC-04-4` |
| TC-04-5 | กดยืนยันซ้ำ | บิลถูกยืนยันแล้ว | กดอีกครั้ง | ตอบ "ยืนยันไปแล้ว" · `paidAt` เดิม · ไม่ส่งข้อความหาผู้เช่าซ้ำ | ✅ `line-app/smoke-usecases.js › TC-04-5` |
| TC-04-6 | การ์ดรอบเก่าปิดได้เฉพาะบิลรอบนั้น | พ.ย. pending · ธ.ค. unpaid (ล่าสุด) | กดการ์ดของ 2026-11 | พ.ย. paid · ธ.ค. และ `bill:205` ไม่เปลี่ยน | ✅ `line-app/smoke-usecases.js › TC-04-6` |
| TC-04-7 | บิลที่การ์ดอ้างไม่มีอยู่ | ไม่มีบิล | กด confirm | ตอบ "ไม่พบบิล" · ไม่เขียนอะไร | ✅ `line-app/smoke-usecases.js › TC-04-7` |
| TC-04-8 | webhook ลายเซ็นปลอม | บิล pending | ส่ง postback ด้วย `x-line-signature` ปลอม | 401 · บิลไม่เปลี่ยน | ✅ `line-app/smoke-usecases.js › TC-04-8` |
| TC-04-9 | เจ้าของเป็นผู้เช่าห้องเดียวกัน | เจ้าของผูกห้อง 205 | เจ้าของยืนยันห้อง 205 | paid · ไม่ push ข้อความหาตัวเอง | ✅ `line-app/smoke-usecases.js › TC-04-9` |
| TC-04-10 | ออกใบเสร็จเลขที่ใบเสร็จเมื่อยืนยัน (line-app) | บิล pending | ยืนยันการชำระ | ได้เลขที่ใบเสร็จเรียงต่อไม่ซ้ำภายในงวด · แสดงให้ผู้เช่า (ตอนนี้ line-app ไม่มี) | ⏳ ยังไม่สร้าง |
| TC-04-11 | ตีสลิปกลับ (reject) เจ้าของระบุเหตุผล (line-app) | บิล pending | เจ้าของกดปุ่มปฏิเสธ | บิลกลับเป็น unpaid · ผู้เช่าได้แจ้งเหตุผลและส่งสลิปใหม่ได้ (ตอนนี้ line-app ไม่มี) | ⏳ ยังไม่สร้าง |
| TC-04-12 | กดปุ่มยืนยันบนการ์ดจริงใน LINE | LINE OA จริง · ผู้เช่าแนบสลิปจริง | เจ้าของกดปุ่ม "ยืนยันการชำระ" · ปุ่ม "ดูสลิป" เปิดรูป | ได้ข้อความตอบกลับ · ผู้เช่าเห็นสถานะเป็นชำระแล้ว | 🖐 ทดสอบมือกับ LINE จริง |
| TC-04-13 | backend: ยืนยัน → paid พร้อมเลขที่ใบเสร็จ | invoice pending | `POST /v1/invoices/{id}/confirm` | paid + `REC-2026-11-0001` | ✅ `backend/tests/test_slip_confirm_reject.py::test_confirm_marks_paid_and_issues_a_receipt` |
| TC-04-14 | backend: เลขใบเสร็จไม่ซ้ำ · ยืนยันพร้อมกันรอล็อกของหอ | ยืนยันหลายใบ | ยืนยันต่อเนื่อง/พร้อมกัน | เลขเรียงไม่ซ้ำ | ✅ `backend/tests/test_slip_confirm_reject.py::test_receipt_numbers_do_not_repeat`<br>`backend/tests/test_slip_confirm_reject.py::test_confirm_waits_for_the_dorm_lock` |
| TC-04-15 | backend: ยืนยันต้องมีสลิปก่อน · หอพักอื่นยืนยันไม่ได้ | — | confirm ใบที่ unpaid / ข้ามหอ | ถูกปฏิเสธ | ✅ `backend/tests/test_slip_confirm_reject.py::test_confirm_needs_a_slip_first`<br>`backend/tests/test_slip_confirm_reject.py::test_other_dorm_cannot_confirm` |
| TC-04-16 | backend: ตีสลิปกลับ → unpaid · ต้องมีสลิป pending | invoice pending | `POST …/reject` | unpaid / ปฏิเสธถ้าไม่ pending | ✅ `backend/tests/test_slip_confirm_reject.py::test_reject_sends_the_invoice_back_to_unpaid`<br>`backend/tests/test_slip_confirm_reject.py::test_reject_needs_a_pending_slip` |

## UC-05 ดูห้องค้างชำระ (ค้างกี่งวด · เกินกี่วัน)

**ผู้กระทำ:** เจ้าของหอ (ผู้ช่วยดูได้)

`GET /api/rooms` ส่งทุกห้องพร้อมบิลล่าสุด (สถานะ, วันครบกำหนด) หน้าจอ LIFF คำนวณเองว่าห้องไหน "ค้างเกินกำหนด" (`unpaid` และ `due` < วันนี้) และ "ค้างมาแล้วกี่วัน" ฝั่งเบราว์เซอร์ — **การคำนวณนี้ไม่มีใน API ของ line-app จึงทดสอบอัตโนมัติไม่ได้** ส่วน "ค้างกี่งวด" รวมหลายงวดยังไม่มีในทั้งสองส่วนของ line-app ฝั่ง backend `GET /v1/invoices` ส่ง `days_overdue` และสรุปยอด paid/pending/unpaid

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/rooms.js`
- `line-app/api/bill.js` (`history`)
- `line-app/liff/bill.html` (`isOverdue`, `daysLate`, หน้า review/overdue)
- backend: `backend/app/routes/billing.py` (`list_invoices`)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-05-1 | เจ้าของเห็นทุกห้องพร้อมสถานะบิลและวันครบกำหนด | 201 unpaid เลยกำหนด · 202 pending · 203 paid · 204 ไม่มีบิล | GET `/api/rooms` | สถานะตรงทุกห้อง · 204 `bill:null` · `Cache-Control: no-store` | ✅ `line-app/smoke-usecases.js › TC-05-1` |
| TC-05-2 | สิทธิ์ดูรายการห้อง | มีผู้ช่วย ผู้เช่า | ผู้ช่วย · ผู้เช่า · ไม่ล็อกอิน เรียก `/api/rooms` | 200 · 403 · 401 | ✅ `line-app/smoke-usecases.js › TC-05-2` |
| TC-05-3 | ไม่เปิดเผย LINE userId ของผู้เช่า | ห้อง 201 มีผู้เช่า | เจ้าของ GET `/api/rooms` | ไม่มี userId ใน response · `linked` true/false ตามจริง | ✅ `line-app/smoke-usecases.js › TC-05-3` |
| TC-05-4 | ห้อง pending แยกจาก unpaid | 201 unpaid · 202 pending | กรองตาม status | unpaid=[201] · pending=[202] (หน้าจอแยก "ค้างชำระ" กับ "รอตรวจ") | ✅ `line-app/smoke-usecases.js › TC-05-4` |
| TC-05-5 | หลายงวดค้างของห้องเดียว | 201 ค้าง ต.ค. และ พ.ย. | GET `/api/rooms` แล้ว `/api/bill?room=201&history=1` | `/api/rooms` เห็นแค่ พ.ย. · history เห็นทั้งสองงวดเป็น unpaid | ✅ `line-app/smoke-usecases.js › TC-05-5` |
| TC-05-6 | หน้า "ค้างชำระ" นับเฉพาะ unpaid ที่เลยกำหนด เรียงค้างนานสุดก่อน และไม่นับ pending | LINE/เบราว์เซอร์จริง · มีบิลหลายสถานะ | เปิด LIFF เจ้าของ → ค้าง / รอตรวจ | ตัวเลขการ์ดและรายการตรงกับสถานะ · ห้องไม่มี `due` ไม่ถูกนับค้าง · กำหนดวันนี้ยังไม่ถือเกิน | 🖐 ทดสอบมือกับ LINE จริง |
| TC-05-7 | ค้างกี่งวดต่อห้อง (รวมหลายงวด) | ห้อง 201 ค้าง 2 งวด | เจ้าของเปิดรายการค้างชำระ | แสดง "ค้าง 2 งวด · ยอดรวม · เกินกำหนดกี่วัน" ต่อห้อง (ตอนนี้ line-app ไม่มี API รวม) | ⏳ ยังไม่สร้าง |
| TC-05-8 | คำนวณจำนวนวันเกินกำหนดฝั่งเซิร์ฟเวอร์ | — | ดึงรายการค้าง ณ วันที่กำหนด | ได้ `days_overdue` ที่ถูกต้อง รวมกรณีเขตเวลา/ข้ามเดือน (ปัจจุบันคำนวณในเบราว์เซอร์) | ⏳ ยังไม่สร้าง |
| TC-05-9 | backend: รายการใบแจ้งหนี้ของงวดพร้อม `days_overdue` และสรุปยอด | seed + invoice หลายสถานะ | `GET /v1/invoices?period=` | `days_overdue` นับเฉพาะ unpaid · summary แยก paid/pending/unpaid | ✅ `backend/tests/test_billing.py::test_invoices_of_a_period_with_overdue_days_and_summary` |
| TC-05-10 | backend: กรองตามสถานะ · สถานะไม่รู้จักถูกปฏิเสธ · ค่าเริ่มต้นคืองวดนี้ | — | `?status=` / ไม่ส่ง period | ตามสัญญา | ✅ `backend/tests/test_billing.py::test_filter_by_status`<br>`backend/tests/test_billing.py::test_unknown_status_is_rejected`<br>`backend/tests/test_billing.py::test_period_defaults_to_this_month` |
| TC-05-11 | backend: หอพักอื่นไม่เห็นใบแจ้งหนี้ · ผู้เช่าดูรายการห้องไม่ได้ | — | ข้ามหอ / เป็นผู้เช่า | ไม่เห็น / 403 | ✅ `backend/tests/test_billing.py::test_another_dorm_sees_none_of_these_invoices`<br>`backend/tests/test_rooms.py::test_tenants_cannot_list_rooms_or_record_meters` |

## UC-06 ดูรายรับ

**ผู้กระทำ:** เจ้าของหอ (ผู้ช่วยดูได้)

หน้า "รายงานรายรับ" ใน LIFF สรุปจากข้อมูลของ `GET /api/rooms` (ผลรวม `total` ของบิล paid / pending / unpaid) — ไม่มี endpoint รายงานโดยเฉพาะ และเพราะ `/api/rooms` ส่งแค่บิลล่าสุดของแต่ละห้อง **รายรับของงวดก่อนหน้า/หลายเดือนจึงยังไม่มี** ฝั่ง backend `GET /v1/invoices` มี summary ของงวดที่เลือก

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
| TC-06-5 | รายรับรายเดือนย้อนหลังและเทียบเดือน | มีบิลหลายเดือน | เลือกช่วงเดือน | รวมต่อเดือนถูกต้อง รวมงวดที่ชำระข้ามเดือน (ตอนนี้ไม่มี API รวม) | ⏳ ยังไม่สร้าง |
| TC-06-6 | แยกรายรับตามวันที่ชำระ (`paidAt`) ไม่ใช่ตามงวด | บิลงวด ต.ค. ชำระวันที่ 2 พ.ย. | ดูรายรับเดือน พ.ย. | ถูกนับตามนโยบายที่ตกลง (ยังไม่ได้ตัดสินใจ) | ⏳ ยังไม่สร้าง |
| TC-06-7 | backend: summary ของงวด (paid/pending/unpaid/total) | — | `GET /v1/invoices?period=` | ผลรวมตรง | ✅ `backend/tests/test_billing.py::test_invoices_of_a_period_with_overdue_days_and_summary` |

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
| TC-07-9 | คนที่เป็นเจ้าของอยู่แล้วใช้รหัสผู้ช่วย | เจ้าของร่วมมีสิทธิ์อยู่ | ใช้รหัสผู้ช่วย | `already:true` · ไม่ถูกลดสิทธิ์ · รหัสยังไม่ถูกใช้ | ✅ `line-app/smoke-usecases.js › TC-07-9` |
| TC-07-10 | รายชื่อเจ้าของ/ผู้ช่วย | มี root + เจ้าของร่วม + ผู้ช่วย + รหัสเชิญค้างอยู่ | GET `/api/owner` ด้วยบทบาทต่าง ๆ | root เห็น userId · เจ้าของร่วมไม่เห็น · ผู้ช่วย/ผู้เช่า 403 · ไม่ปนรหัสเชิญ | ✅ `line-app/smoke-usecases.js › TC-07-10` |
| TC-07-11 | root ถอนสิทธิ์ | ผู้ช่วยมีสิทธิ์อยู่ | DELETE `/api/owner` `{userId}` | สิทธิ์และ `menu:` หาย · เมนู LINE กลับค่าเริ่มต้น · ผู้ถูกถอนได้ข้อความ · เข้า `/api/rooms` ไม่ได้ · ถอนซ้ำ 404 | ✅ `line-app/smoke-usecases.js › TC-07-11` |
| TC-07-12 | ถอนสิทธิ์ผิดเงื่อนไข | — | เจ้าของร่วมถอน · root ถอนตัวเอง · userId ผิดรูปแบบ | 403 · 409 · 400 | ✅ `line-app/smoke-usecases.js › TC-07-12` |
| TC-07-13 | รหัสของคนที่ถูกถอนใช้ไม่ได้ | เจ้าของร่วมสร้างรหัสผู้ช่วยไว้ | root ถอนเจ้าของร่วม แล้วมีคนใช้รหัส | 410 · ไม่ได้สิทธิ์ | ✅ `line-app/smoke-usecases.js › TC-07-13` |
| TC-07-14 | `/api/me` บอกบทบาทถูกต้อง | root · ผู้ช่วย · ผู้เช่า · คนทั่วไป | GET `/api/me` ของแต่ละคน | root: role owner/root true/ได้เมนูเจ้าของ · viewer · ผู้เช่า: role null + ห้อง · ไม่ล็อกอิน 401 | ✅ `line-app/smoke-usecases.js › TC-07-14` |
| TC-07-15 | สแกน QR เชิญด้วย LINE จริง · เมนูเจ้าของสลับ · ถอนแล้วเมนูกลับ | LINE OA + rich menu จริง | สร้างรหัส สแกนด้วยอีกบัญชี แล้วถอน | บัญชีใหม่เห็นเมนูเจ้าของ/ผู้ช่วย · หลังถอนกลับเมนูผู้เช่า | 🖐 ทดสอบมือกับ LINE จริง |
| TC-07-16 | ผู้ถูกเชิญเลือกบทบาทเองไม่ได้ (ส่ง `role` ใน body ตอนใช้รหัส) | มีรหัสผู้ช่วย | ส่ง `{code, role:"owner"}` | ได้ role ตามที่รหัสกำหนดเท่านั้น | ⏳ ยังไม่สร้าง |

## UC-08 เปลี่ยนผู้เช่า / หมุน QR ห้อง

**ผู้กระทำ:** เจ้าของหอ

(เพิ่มเข้ามาหลังแผนภาพ) `GET /api/qr?room=` ให้รหัส/QR ประจำห้อง (สร้างครั้งแรกที่ขอ) `POST /api/qr?room=` = เปลี่ยนผู้เช่า: ออกรหัสใหม่ QR เดิมใช้ไม่ได้ ผู้เช่าปัจจุบันถูกปลดผูกทั้งสองทาง QR ที่ติดหน้าห้องผูกได้เฉพาะตอนห้องว่าง ทุกครั้งที่ผู้เช่าออก (เจ้าของกดเปลี่ยนผู้เช่า — แม้ห้องว่าง — หรือผู้เช่าย้ายออกด้วย `confirmMove`) ระบบเขียน `tenancy:<ห้อง>` = {since} และ `/api/run` ใส่ `issuedAt` ให้ทุกบิล ผู้เช่าเห็นเฉพาะบิลที่ออกตั้งแต่ `since` (ห้องที่ไม่เคยเปลี่ยนผู้เช่าเห็นทั้งหมดเหมือนเดิม) เจ้าของ/ผู้ช่วยเห็นทุกบิล สลิปล่วงหน้าของผู้เช่าเก่าถูกเก็บเข้า `prepay-old:<ห้อง>:<slipAt>`

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/qr.js` (`roomQr`, `ensureCode`, `unbindRoom`)
- `line-app/api/_qr.js`
- `line-app/liff/bill.html` (หน้า QR ห้อง)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-08-1 | เจ้าของขอ QR ห้อง | ห้อง 203 มีผู้เช่า | GET `/api/qr?room=203` สองครั้ง | รหัส 10 ตัว · ลิงก์ `liff.line.me/<LIFF_ID>?bind=<รหัส>` · มี SVG · ครั้งที่สองได้รหัสเดิม · ไม่ปลดผู้เช่า | ✅ `line-app/smoke-usecases.js › TC-08-1` |
| TC-08-2 | เปลี่ยนผู้เช่า | Alice ผูก 203 และมีบิล | POST `/api/qr?room=203` | รหัสใหม่ · `rotated`/`unbound` true · `room-user`/`user-room` ถูกล้าง · QR เก่า 404 · Alice อ่านบิลไม่ได้ (400/403) | ✅ `line-app/smoke-usecases.js › TC-08-2` |
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

## UC-10 ดูบิล

**ผู้กระทำ:** ผู้เช่า (เจ้าของ/ผู้ช่วยดูได้ทุกห้อง)

`GET /api/bill` — ผู้เช่าเห็นเฉพาะห้องที่ผูก (ไม่ต้องส่ง `room`) เจ้าของ/ผู้ช่วยระบุ `room` ได้ทุกห้อง ตัวเลือก `period=YYYY-MM` (บิลงวดนั้น) หรือ `history=1` (รายการงวดทั้งหมด ใหม่→เก่า) ในแชทพิมพ์ "บิล"/"bill" ได้การ์ดบิลล่าสุด

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
| TC-10-3 | ประวัติบิล | ออกบิล 2 งวด | `?history=1` | รายการงวดใหม่→เก่า มี total/status/due/hasSlip | ✅ `line-app/smoke-usecases.js › TC-10-3` |
| TC-10-4 | ประวัติของระบบเก่าที่ไม่มีดัชนี | มีแค่ `bill:201` | `?history=1` | ไม่ว่าง (มีงวดของบิลล่าสุด) | ✅ `line-app/smoke-usecases.js › TC-10-4` |
| TC-10-5 | ผู้เช่าอ่านห้องอื่นไม่ได้ | Utenant ผูก 201 | ระบุ `room=202` (ปกติ/period/history) | 403 ทุกกรณี | ✅ `line-app/smoke-usecases.js › TC-10-5` |
| TC-10-6 | ข้อผิดพลาดพื้นฐาน | — | ยังไม่ผูกห้อง · ผูกแล้วไม่มีบิล · ไม่ล็อกอิน | 400 · 404 NOT_FOUND · 401 | ✅ `line-app/smoke-usecases.js › TC-10-6` |
| TC-10-7 | period ผิดรูปแบบ/ไม่มีบิล | มีบิล พ.ย. | `period=2026-1` · `period=2025-01` | 400 · 404 | ✅ `line-app/smoke-usecases.js › TC-10-7` |
| TC-10-8 | เจ้าของ/ผู้ช่วยอ่านทุกห้อง | มีผู้ช่วย | ระบุ `room=202` · ไม่ระบุ room | 200 · 400 | ✅ `line-app/smoke-usecases.js › TC-10-8` |
| TC-10-9 | พิมพ์ "บิล"/"bill" ในแชท | ผูกห้อง 201 | พิมพ์ "บิล" ก่อนมีบิล · "  Bill " หลังมีบิล | ตอบ "ห้อง 201 ยังไม่มีบิล" · ตอบการ์ดบิล (Flex) | ✅ `line-app/smoke-usecases.js › TC-10-9` |
| TC-10-10 | หน้าบิลใน LIFF แสดงรายการและสถานะถูกต้อง · ปุ่มแนบสลิป/ดูสลิป · ภาษาไทย/วันที่ | LIFF จริง | ผู้เช่าเปิดจากการ์ดใน LINE | แสดงบิลตรงกับ API · สลิปแสดงเฉพาะของห้องตัวเอง | 🖐 ทดสอบมือกับ LINE จริง |
| TC-10-12 | ผู้เช่าใหม่ไม่เห็นบิลของผู้เช่าเก่า (บิลล่าสุด/งวด/ประวัติ/แชท "บิล") | หลังเจ้าของเปลี่ยนผู้เช่า | ผู้เช่าใหม่อ่านบิล | 404 · ประวัติว่าง · แชทตอบ "ยังไม่มีบิล" — รายละเอียดที่ UC-08 | ✅ `line-app/smoke-usecases.js › TC-08-6` |
| TC-10-11 | backend: ผู้เช่าเห็นเฉพาะใบแจ้งหนี้ของห้องตัวเองจาก session | ผูก LINE แล้ว | `GET /v1/me/invoices` | รายการใบแจ้งหนี้ของห้อง (12 งวดล่าสุด) | ✅ `backend/tests/test_line_link.py::test_linking_binds_line_to_the_room_and_logs_in` |

## UC-11 แจ้งชำระ (แนบสลิป)

**ผู้กระทำ:** ผู้เช่า

`POST /api/slip` — ผู้เช่าแนบรูปสลิป (JPEG/PNG/WEBP ≤ 3MB, ไม่บังคับ) กับหมายเหตุ (≤ 500 ตัวอักษร) บิลเป็น `pending` และเจ้าของได้การ์ดยืนยัน กันใช้โควตาข้อความ: สลิปได้ไม่เกิน 5 ครั้งต่อบิล และห่างกันอย่างน้อย 30 วินาที (เจ้าของไม่ถูกจำกัด) ส่งใหม่แล้วรูปเก่าถูกลบ ดูรูป: `GET /api/slip-image` (เจ้าของ/ผู้ช่วย/ผู้เช่าห้องนั้น) **กรณียังไม่มีบิลหรือบิลจ่ายแล้ว อยู่ในหัวข้อ "แจ้งชำระก่อนบิลออก" (UC-17)**

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/slip.js`
- `line-app/api/slip-image.js`
- `line-app/api/_line.js` (`confirmBubble`)
- `line-app/liff/bill.html` (ฟอร์มแนบสลิป)
- backend: `backend/app/routes/billing.py` (`attach_slip`)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-11-1 | แนบสลิป | บิล 201 unpaid · ผู้เช่าผูก 201 | POST `/api/slip` พร้อมรูป + หมายเหตุ | บิล pending · `slipCount`=1 · รูปถูกเก็บ · สองสำเนาตรงกัน · เจ้าของได้การ์ดที่มี `action=confirm&room=201&period=2026-11` | ✅ `line-app/smoke-usecases.js › TC-11-1` |
| TC-11-2 | แจ้งชำระโดยไม่แนบรูป | บิล unpaid | ส่งแต่หมายเหตุ | 200 · pending · `hasSlip:false` (ดูข้อสังเกต) | ✅ `line-app/smoke-usecases.js › TC-11-2` |
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
| TC-11-13 | สลิปที่ไม่มีรูปไม่ควรถูกยืนยันโดยเจ้าของโดยไม่เตือน | pending ที่ไม่มีรูป | เจ้าของดูการ์ด | การ์ดไม่มีปุ่ม "ดูสลิป" (ปัจจุบันเป็นเช่นนั้น) — ต้องตัดสินนโยบายว่าบังคับให้มีรูปหรือไม่ | ⏳ ยังไม่สร้าง |
| TC-11-16 | ผู้เช่าใหม่แนบสลิปขณะบิลล่าสุดเป็นของผู้เช่าเก่า | บิลเก่า unpaid ของผู้เช่าคนก่อน | ผู้เช่าใหม่แนบสลิป | เข้าทางโอนล่วงหน้า บิลเก่าไม่ถูกแตะ — รายละเอียดที่ UC-08 | ✅ `line-app/smoke-usecases.js › TC-08-8` |
| TC-11-14 | backend: สลิปทำให้ invoice เป็น pending บันทึกยอดและผลตรวจ `provider:manual` | billed | `POST /v1/invoices/{id}/slip` | pending | ✅ `backend/tests/test_slip_confirm_reject.py::test_slip_moves_the_invoice_to_pending`<br>`backend/tests/test_slip_confirm_reject.py::test_slip_keeps_the_url_the_page_sent` |
| TC-11-15 | backend: ห้องอื่นแจ้งไม่ได้ · ไม่มีห้องถูกปฏิเสธ · แจ้งซ้ำ 409 | — | — | 403/409 | ✅ `backend/tests/test_slip_confirm_reject.py::test_tenant_cannot_slip_another_rooms_invoice`<br>`backend/tests/test_slip_confirm_reject.py::test_tenant_without_a_room_is_refused`<br>`backend/tests/test_slip_confirm_reject.py::test_slipping_twice_conflicts` |

## UC-12 ตรวจสลิปอัตโนมัติ

**ผู้กระทำ:** ระบบตรวจสลิป (extend ของแจ้งชำระ)

**ยังไม่สร้างทั้งสองส่วน** — line-app ให้เจ้าของตรวจสลิปด้วยตา backend มีช่องไว้แล้ว (`verify: {ok: null, amount, provider: "manual"}` ตอนแจ้งชำระ) แต่ยังไม่ต่อผู้ให้บริการตรวจสลิป กรณีด้านล่างคือสิ่งที่ต้องทดสอบเมื่อสร้าง

**โค้ดที่เกี่ยวข้อง:**
- ยังไม่มี (ช่อง `verify` ใน `backend/app/routes/billing.py` → `attach_slip`)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-12-1 | สลิปจริง ยอดตรงกับบิล บัญชีปลายทางตรงกับหอ → ผ่านอัตโนมัติ | ผู้ให้บริการตรวจสลิปพร้อม | ผู้เช่าแนบสลิป | `verify.ok=true` · บิลถูกยืนยันอัตโนมัติ (หรือขึ้นว่า "ตรวจแล้ว" ตามนโยบาย) · เจ้าของได้แจ้ง · ออกใบเสร็จ | ⏳ ยังไม่สร้าง |
| TC-12-2 | ยอดในสลิปไม่ตรงกับบิล | — | แนบสลิปยอดน้อย/มากกว่า | `verify.ok=false` · ไม่ปิดบิลเอง · ส่งให้เจ้าของตรวจมือพร้อมเหตุผล | ⏳ ยังไม่สร้าง |
| TC-12-3 | สลิปซ้ำ (เลขอ้างอิงเดิมถูกใช้กับบิลอื่น) | สลิปถูกใช้ไปแล้ว | แนบสลิปเดิมอีกครั้ง/ห้องอื่น | ปฏิเสธ/ติดธง "สลิปซ้ำ" | ⏳ ยังไม่สร้าง |
| TC-12-4 | ไฟล์ไม่ใช่สลิป/อ่านไม่ได้ | — | แนบรูปแมว | `verify.ok=false` เหตุผล "อ่านสลิปไม่ได้" · ให้ส่งใหม่หรือตรวจมือ | ⏳ ยังไม่สร้าง |
| TC-12-5 | บัญชีปลายทางไม่ใช่ของหอ | — | แนบสลิปโอนให้คนอื่น | ไม่ผ่าน | ⏳ ยังไม่สร้าง |
| TC-12-6 | ผู้ให้บริการตรวจสลิปล่ม/หมดเวลา | ผู้ให้บริการตอบ 5xx/timeout | แนบสลิป | แจ้งชำระยังสำเร็จ (pending) · ตกไปตรวจมือ · ไม่เสียสลิป · retry ตามนโยบาย | ⏳ ยังไม่สร้าง |
| TC-12-7 | เวลาโอนในสลิปก่อนบิลออก/นานเกินกำหนด | — | แนบสลิป | ตามนโยบายที่ตกลง (เชื่อมกับ "แจ้งชำระก่อนบิลออก") | ⏳ ยังไม่สร้าง |
| TC-12-8 | ตรวจกับผู้ให้บริการจริง (sandbox) | บัญชีทดสอบของผู้ให้บริการ | แนบสลิปจริง/ปลอม | ผลตรงความจริง · คิดโควตา/ค่าบริการตามที่ตกลง | 🖐 ทดสอบมือกับ LINE จริง |

## UC-13 ชำระหลายงวดในสลิปเดียว

**ผู้กระทำ:** ผู้เช่า (extend ของแจ้งชำระ)

**ยังไม่สร้าง** — ตอนนี้สลิปหนึ่งใบผูกกับบิลล่าสุดใบเดียว (`bill:<ห้อง>`) ผู้เช่าที่ค้างหลายงวดจึงต้องแจ้งทีละงวด/ไม่มีทางแจ้งงวดเก่า กรณีด้านล่างคือสิ่งที่ต้องทดสอบเมื่อสร้าง

**โค้ดที่เกี่ยวข้อง:**
- ยังไม่มี

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-13-1 | สลิปเดียวครอบสองงวดที่ค้าง ยอดเท่ากับผลรวม | ค้าง ต.ค. + พ.ย. | ผู้เช่าเลือกสองงวดแล้วแนบสลิปเดียว | ทั้งสองบิลเป็น pending ผูกสลิปเดียวกัน · เจ้าของได้การ์ดเดียวระบุทุกงวด · ยืนยันครั้งเดียวปิดทั้งคู่ · ใบเสร็จแยกต่องวด | ⏳ ยังไม่สร้าง |
| TC-13-2 | ยอดสลิปน้อยกว่าผลรวมที่เลือก | — | ยอดโอนไม่ครบ | ปฏิเสธ/ตามนโยบายว่าจ่ายงวดเก่าก่อน | ⏳ ยังไม่สร้าง |
| TC-13-3 | ยอดเกิน (จ่ายล่วงหน้างวดอนาคต) | — | ยอดเกิน | ตามนโยบายที่ตกลง (เครดิต/ปฏิเสธ) | ⏳ ยังไม่สร้าง |
| TC-13-4 | เลือกงวดที่ไม่ติดกัน/งวดที่จ่ายแล้ว/งวดของห้องอื่น | — | ส่งรายการงวดที่ผิด | ถูกปฏิเสธ (ห้องอื่น 403) | ⏳ ยังไม่สร้าง |
| TC-13-5 | เจ้าของปฏิเสธ (reject) สลิปหลายงวด | สลิปหลายงวด pending | ตีกลับ | ทุกงวดกลับ unpaid พร้อมกัน ไม่ค้างครึ่งทาง | ⏳ ยังไม่สร้าง |
| TC-13-6 | ยืนยันกลางทางล้ม (เขียนสำเร็จบางงวด) | — | จำลอง store ล้มตอนปิดงวดที่สอง | ไม่เหลือสถานะครึ่ง ๆ กลาง ๆ (ทั้งหมดหรือไม่มี) หรือกลับมายืนยันซ้ำได้ | ⏳ ยังไม่สร้าง |
| TC-13-7 | ผู้เช่าเลือกหลายงวดใน LIFF แล้วดูยอดรวมก่อนส่ง | LIFF จริง | เลือกงวด แนบสลิป | ยอดรวมตรงและแสดงรายการงวด | 🖐 ทดสอบมือกับ LINE จริง |

## UC-14 ดูยอดค้างชำระ

**ผู้กระทำ:** ผู้เช่า

ผู้เช่าดูว่าตัวเองค้างอะไรบ้างจากบิลล่าสุดและ `history=1` (แต่ละงวดมีสถานะ unpaid/pending/paid และ due) — ไม่มี endpoint ยอดรวมค้าง ฝั่ง backend `GET /v1/me/invoices` ส่งรายการใบแจ้งหนี้ 12 งวดล่าสุดพร้อมสถานะ

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/bill.js` (`history`)
- `line-app/liff/bill.html`
- backend: `backend/app/routes/me.py`

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-14-1 | ประวัติของผู้เช่าแสดงสถานะรายงวด (ค้าง/รอตรวจ/จ่ายแล้ว) | ต.ค. paid · พ.ย. unpaid | `/api/bill?history=1` | สถานะต่องวดตรงจริง (ดู TC-10-3, TC-05-5) | 🖐 ทดสอบมือกับ LINE จริง |
| TC-14-2 | ยอดค้างรวมทุกงวดและจำนวนงวด | ค้าง 2 งวด | ผู้เช่าเปิดหน้า "ค้างชำระ" | รวมยอดและจำนวนวันเกินกำหนดต่องวด (ตอนนี้ไม่มี API รวม) | ⏳ ยังไม่สร้าง |
| TC-14-3 | ผู้เช่าเห็นเฉพาะของห้องตัวเอง | — | ระบุ room อื่นใน history | 403 (ครอบคลุมโดย TC-10-5) | ✅ `line-app/smoke-usecases.js › TC-10-5` |
| TC-14-4 | backend: ผู้เช่าเห็นรายการใบแจ้งหนี้ห้องตัวเองเท่านั้น (ห้องมาจาก session) | ผูก LINE แล้ว | `GET /v1/me/invoices` | เห็นเฉพาะห้องตัวเอง — pytest มีอยู่แล้ว (`test_linking_binds_line_to_the_room_and_logs_in` เรียก endpoint นี้หลังผูก LINE) | ✅ `backend/tests/test_line_link.py › test_linking_binds_line_to_the_room_and_logs_in` |

## UC-15 ดูใบเสร็จ

**ผู้กระทำ:** ผู้เช่า

**line-app ยังไม่มีใบเสร็จ** (มีแค่สถานะ paid, `paidAt`, `confirmedBy` และข้อความ "ชำระเงินแล้ว" ที่ push หาผู้เช่า) backend ออกเลขที่ใบเสร็จ `REC-<งวด>-<ลำดับ 4 หลัก>` ตอนยืนยัน แต่ยังไม่มี endpoint ให้ผู้เช่าเปิดดูใบเสร็จ

**โค้ดที่เกี่ยวข้อง:**
- `line-app/api/webhook.js` (แจ้งผู้เช่าตอนยืนยัน)
- backend: `backend/app/routes/billing.py` (`confirm_invoice` → `receipt_no`)

| ID | กรณี | เงื่อนไขก่อน | ขั้นตอน | ผลที่คาด | ทดสอบโดย |
|---|---|---|---|---|---|
| TC-15-1 | ผู้เช่าได้ข้อความ "ชำระเงินแล้ว" หลังเจ้าของยืนยัน | สลิป pending | เจ้าของยืนยัน | ผู้เช่าได้ push (ตรวจใน TC-04-1) | ✅ `line-app/smoke-usecases.js › TC-04-1` |
| TC-15-2 | ผู้เช่าเปิดดูใบเสร็จของงวดที่จ่ายแล้ว (line-app) | บิล paid | เปิดใบเสร็จ | แสดงเลขที่ใบเสร็จ วันที่ชำระ ยอด รายการ (ตอนนี้ line-app ไม่มี) | ⏳ ยังไม่สร้าง |
| TC-15-3 | บิลที่ยังไม่จ่ายไม่มีใบเสร็จ | บิล unpaid/pending | เปิดใบเสร็จ | 404 | ⏳ ยังไม่สร้าง |
| TC-15-4 | ผู้เช่าเปิดใบเสร็จห้องอื่นไม่ได้ | — | ระบุห้อง/ใบเสร็จของคนอื่น | 403 | ⏳ ยังไม่สร้าง |
| TC-15-5 | ใบเสร็จพิมพ์/แชร์/บันทึกรูปจากมือถือ | LIFF จริง | กดบันทึก/แชร์ | ไฟล์อ่านออก ยอดและเลขที่ถูก | 🖐 ทดสอบมือกับ LINE จริง |
| TC-15-6 | backend: เลขใบเสร็จ `REC-2026-11-0001` และเลขไม่ซ้ำ | ยืนยันหลายใบ | `POST …/confirm` | เลขเรียงต่อในงวดเดียวกัน | ✅ `backend/tests/test_slip_confirm_reject.py::test_confirm_marks_paid_and_issues_a_receipt`<br>`backend/tests/test_slip_confirm_reject.py::test_receipt_numbers_do_not_repeat` |

## UC-16 ทวงอัตโนมัติ (เลยกำหนด 1 / 5 / 10 วัน)

**ผู้กระทำ:** เวลา (Scheduler)

**line-app ไม่มีการทวงอัตโนมัติ** (มีแต่การคำนวณวันค้างบนหน้าจอเจ้าของ) backend: cron รายวัน (`GET /v1/cron/daily` ด้วย secret ใน header) คิวการแจ้งเตือน: ใบที่ยัง unpaid และเลยกำหนด 1–4 วัน = ขั้น 1, 5–9 = ขั้น 5, ≥10 = ขั้น 10 ส่งแต่ละขั้นครั้งเดียว (บันทึกใน `message_log` เมื่อ LINE ตอบ ok) ขั้นที่ข้ามไปเพราะ cron ไม่ทำงานจะตามส่งวันถัดไป ผู้เช่าที่ไม่มี LINE และใบที่ paid ถูกข้าม

**โค้ดที่เกี่ยวข้อง:**
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
| TC-16-7 | ใบที่แจ้งชำระแล้ว (pending) ไม่ถูกทวง | ใบ pending เลยกำหนด | รันทวง | ไม่ถูกเลือก (ไม่ใช่ความล่าช้าของผู้เช่า) — pytest ที่มีทดสอบเฉพาะใบ paid | ⏳ ยังไม่สร้าง |
| TC-16-8 | ใบที่ยังไม่เลยกำหนด/ครบกำหนดวันนี้ ไม่ถูกทวง | due = วันนี้ | รันทวง | ไม่ถูกเลือก | ⏳ ยังไม่สร้าง |
| TC-16-11 | ผู้เช่าที่ย้ายออกแล้วไม่ถูกทวง (`moved_out`) · ใช้ผู้เช่าล่าสุดที่มี LINE | tenant moved_out ≤ วันนี้ | รันทวง | ไม่ถูกเลือก (โค้ดมีเงื่อนไขนี้แต่ยังไม่มี pytest) | ⏳ ยังไม่สร้าง |
| TC-16-9 | ข้อความทวงถึงผู้เช่าใน LINE จริง · ขั้น 1/5/10 ภาษา/ยอด/ห้องถูกต้อง | backend deploy + LINE จริง | รัน cron วันเลยกำหนด 1/5/10 | ผู้เช่าได้ข้อความต่างกันตามขั้น ไม่ได้ซ้ำในวันเดียว | 🖐 ทดสอบมือกับ LINE จริง |
| TC-16-10 | ทวงอัตโนมัติใน line-app (production) | — | — | ยังไม่มี — ถ้าจะทำต้องกำหนด Vercel Cron และ test ตามกรณีข้างบน | ⏳ ยังไม่สร้าง |

## UC-17 แจ้งชำระก่อนบิลออก (โอนก่อน)

**ผู้กระทำ:** ผู้เช่า

ผู้เช่าที่โอนเงินก่อนเจ้าของออกบิลของเดือนนั้น (ยังไม่มีบิล หรือบิลล่าสุดจ่ายแล้ว) ยังแนบสลิปได้: `POST /api/slip` เก็บสลิปเป็น `prepay:<ห้อง>` (รูปชื่อ `slips/<ห้อง>-advance-<ts>.<นามสกุล>`) ตอบ `{ok, status:"advance", hasSlip}` และส่งข้อความหาเจ้าของ "ห้อง X แจ้งโอนก่อนบิลออก…" เมื่อเจ้าของออกบิล (`POST /api/run`) บิลใหม่ของห้องนั้นเริ่มเป็น `pending` พร้อมสลิป (`prepaid:true`) prepay ถูกล้างหลังบันทึกบิลสำเร็จ ผู้เช่าได้การ์ดบิลและเจ้าของได้การ์ดยืนยันทันที แล้วยืนยันผ่าน webhook ได้เหมือนบิล pending ทั่วไป สิทธิ์ ตรวจรูป/หมายเหตุ และข้อจำกัด (5 ครั้ง/รายการ, ห่าง 30 วินาที; เจ้าของไม่ถูกจำกัด) ใช้ชุดเดียวกับการแจ้งชำระปกติ แต่นับบนระเบียน prepay · อ่านสถานะ: `GET /api/bill` (ล่าสุด) เพิ่มฟิลด์ `advance`, ไม่มีบิลก็ 404 พร้อม `error.advance` · `GET /api/rooms` มี `advance` ต่อห้อง · `GET /api/slip-image?room=&advance=1` ดูรูป

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
| TC-17-18 | แข่งกัน: ผู้เช่าแจ้งโอนพร้อมกับที่เจ้าของออกบิลในเสี้ยววินาที | Blob ไม่มี transaction | สลิปมาถึงขณะ `run` อ่าน prepay ไปแล้ว | สลิปอาจกลายเป็น prepay ข้างบิล unpaid ใหม่ · เจ้าของเห็นป้าย "โอนล่วงหน้า" ใน `/api/rooms` และสลิปถูกผูกกับบิลรอบถัดไปที่ออกให้ห้องนั้น (ข้อจำกัดที่ทราบ — ทำซ้ำอัตโนมัติไม่ได้โดยไม่มีตัวหน่วง) | ⏳ ยังไม่สร้าง |
| TC-17-19 | สลิปล่วงหน้าไม่ตรงงวด/ยอด: เจ้าของตีกลับสลิปที่ผูกกับบิลใหม่ | บิล pending จาก prepay | เจ้าของพบยอดไม่ตรง | line-app ยังไม่มี reject (ดู TC-04-11) — ต้องตัดสินนโยบายว่าสลิปล่วงหน้าผูกกับงวดไหน | ⏳ ยังไม่สร้าง |
| TC-17-20 | LIFF ผู้เช่า: ยังไม่มีบิล | LIFF จริง · ผู้เช่าผูกห้อง ยังไม่มีบิล | เปิดหน้าบิล | เห็น "ยังไม่มีบิลรอบนี้" และปุ่ม "โอนก่อน / แนบสลิป" · หลังแนบเห็นสถานะสลิปล่วงหน้ารอบิลออก | 🖐 ทดสอบมือกับ LINE จริง |
| TC-17-21 | LIFF ผู้เช่า: บิลล่าสุดจ่ายแล้ว | บิลจ่ายแล้ว | เปิดหน้าบิล | เห็นปุ่ม/ข้อความ "โอนรอบถัดไปก่อน" และแนบสลิปล่วงหน้าได้ | 🖐 ทดสอบมือกับ LINE จริง |
| TC-17-22 | LIFF เจ้าของ: รายการห้องมีป้าย "โอนล่วงหน้า" และหน้าห้องมีการ์ดสลิปล่วงหน้า | LIFF จริง · ห้องมี prepay | เปิดรายการห้อง → เข้าห้อง → กด "ดูสลิป" | เห็นป้าย "โอนล่วงหน้า" · การ์ดสลิปล่วงหน้า · "ดูสลิป" เปิดรูป · ออกบิลแล้วป้ายหาย และบิลขึ้น "รอตรวจ" | 🖐 ทดสอบมือกับ LINE จริง |
| TC-17-23 | การ์ดใน LINE จริง: ข้อความ "แจ้งโอนก่อนบิลออก" ถึงเจ้าของ และการ์ดยืนยันหลังออกบิล | LINE OA จริง | ผู้เช่าแนบสลิปก่อนบิล แล้วเจ้าของออกบิล | เจ้าของได้ข้อความแล้วได้การ์ดยืนยันที่กดได้ | 🖐 ทดสอบมือกับ LINE จริง |

## สรุป

| UC | ชื่อ | TC ทั้งหมด | ✅ automated | 🖐 manual | ⏳ ยังไม่สร้าง |
|---|---|---:|---:|---:|---:|
| UC-01 | ตั้งค่าหอ (ค่าเช่า · อัตราน้ำไฟ) | 8 | 6 | 0 | 2 |
| UC-02 | จดมิเตอร์น้ำ–ไฟ | 13 | 12 | 0 | 1 |
| UC-03 | ออกบิล (คำนวณบิล · ส่งบิลทาง LINE) | 18 | 15 | 1 | 2 |
| UC-04 | ยืนยันการชำระ (include ออกใบเสร็จ) | 16 | 13 | 1 | 2 |
| UC-05 | ดูห้องค้างชำระ (ค้างกี่งวด · เกินกี่วัน) | 11 | 8 | 1 | 2 |
| UC-06 | ดูรายรับ | 7 | 4 | 1 | 2 |
| UC-07 | เพิ่ม/ถอนเจ้าของและผู้ช่วย | 16 | 14 | 1 | 1 |
| UC-08 | เปลี่ยนผู้เช่า / หมุน QR ห้อง | 17 | 15 | 2 | 0 |
| UC-09 | ผูกบัญชี LINE กับห้อง | 17 | 16 | 1 | 0 |
| UC-10 | ดูบิล | 12 | 11 | 1 | 0 |
| UC-11 | แจ้งชำระ (แนบสลิป) | 16 | 14 | 1 | 1 |
| UC-12 | ตรวจสลิปอัตโนมัติ | 8 | 0 | 1 | 7 |
| UC-13 | ชำระหลายงวดในสลิปเดียว | 7 | 0 | 1 | 6 |
| UC-14 | ดูยอดค้างชำระ | 4 | 2 | 1 | 1 |
| UC-15 | ดูใบเสร็จ | 6 | 2 | 1 | 3 |
| UC-16 | ทวงอัตโนมัติ (เลยกำหนด 1 / 5 / 10 วัน) | 11 | 6 | 1 | 4 |
| UC-17 | แจ้งชำระก่อนบิลออก (โอนก่อน) | 24 | 18 | 4 | 2 |
| **รวม** | | **211** | **156** | **19** | **36** |

หมายเหตุ: คอลัมน์ ✅ รวมทั้ง test ใน `line-app/smoke-usecases.js` (118 ข้อ) และ test ที่มีอยู่แล้วใน `backend/tests/` ที่ผูกกับกรณีนั้น (บางแถวอ้างหลายฟังก์ชัน นับเป็น 1 TC) แถว ✅ ที่อ้าง pytest ไม่ได้ถูกรันโดยชุดนี้ — รันด้วย `cd backend && pytest -q`

---

## ข้อสังเกตจากโค้ดระหว่างเขียน test (พฤติกรรมที่ควรตัดสินใจ)

ข้อเหล่านี้ **ยังไม่ได้แก้** (ข้อเดิม "ผู้เช่าใหม่เห็นประวัติบิลของห้อง" แก้แล้วด้วย `tenancy:<ห้อง>` — ดู UC-08 TC-08-6…15) — เขียนไว้เพื่อให้ทีมตัดสินใจว่าเป็นบักหรือเป็นพฤติกรรมที่ตั้งใจ

1. **การ์ดบิลขึ้น "ครบกำหนด null"** — `POST /api/run` ไม่บังคับ `due` (ไม่ส่ง = `due: null`) แต่ `billBubble` (`line-app/api/_line.js`) พิมพ์ `ครบกำหนด ${bill.due}` ตรง ๆ จึงขึ้นคำว่า null ให้ผู้เช่า และหน้าจอคำนวณค้างเกินกำหนดไม่ได้ (`isOverdue` ต้องมี `due`) → TC-03-13 ⏳
2. **ลืมจดมิเตอร์กลายเป็นบิลค่าเช่าล้วน** — `water`/`elec` ที่ขาดหรือเป็น `null` ถูกนับเป็น 0 ไม่ error (`parseUnits` ใช้ `value ?? 0`) → ออกบิลและส่งให้ผู้เช่าทันที (TC-02-6 บันทึกพฤติกรรมนี้ไว้)
3. **แจ้งชำระโดยไม่มีรูปสลิปได้** — `image` เป็นตัวเลือก บิลจึงเป็น pending ได้โดยไม่มีสลิปเลย และปุ่มยืนยันของเจ้าของใช้ได้ตามปกติ (TC-11-2, TC-11-13)
4. **รหัสเชิญที่คนมีสิทธิ์แล้วใช้ จะไม่ถูกทำเครื่องหมายว่าใช้แล้ว** (`already:true`) — รหัสยังใช้ได้กับคนอื่นจนหมดอายุ 10 นาที (TC-07-9 บันทึกพฤติกรรมนี้)
5. **ค้างกี่งวด/เกินกี่วัน ไม่มี API** — `/api/rooms` ส่งแค่บิลล่าสุดต่อห้อง และ "เกินกำหนดกี่วัน" คำนวณในเบราว์เซอร์ด้วยเวลาของเครื่อง (`daysLate` ใน `bill.html`) → ทดสอบอัตโนมัติไม่ได้ (TC-05-6, TC-05-7, TC-05-8)
6. **ตัวเลขที่เป็นสตริง** (`"12"`) ถูกรับเป็นหน่วยมิเตอร์ (`Number("12")`) — น่าจะตั้งใจเพราะ input ของ LIFF ส่งสตริง (TC-02-3)

ข้อสังเกตนอกเหนือจาก use case: line-app ไม่มี endpoint ให้เจ้าของแก้ค่าเช่า/อัตราน้ำไฟ (UC-01) และ `bill.html` ทำหน้ารายงาน/ค้างชำระฝั่งเบราว์เซอร์ทั้งหมด จึงมีเพียง `node --check` ใน CI ที่ตรวจว่าสคริปต์ parse ได้ ไม่มี test ของ logic หน้าจอ
