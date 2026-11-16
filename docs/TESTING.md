<!-- generated-by: gsd-doc-writer -->

# การทดสอบ (TESTING)

repo นี้แยกเป็นสองครึ่งที่ deploy แยกกัน และมีชุด test คนละแบบ: **`line-app/`** ใช้สคริปต์ Node ล้วน (`node:assert`, ไม่ต่อเน็ต) จำนวน **5 ไฟล์** และ **`backend/`** ใช้ pytest กับ Postgres จริง ไม่มี browser test และไม่มี LINE end-to-end ใน CI — เอกสารนี้แยกให้เห็นชัดว่าอะไรถูกตรวจอัตโนมัติ อะไรต้องกดมือ และอะไรยังไม่มีใครตรวจ

ตัวเลขในเอกสารนี้คือ **snapshot ที่วัดจาก repo ณ ตอนเขียน** ไม่ใช่สัญญา — ถ้าเพิ่ม test ตัวเลขจะขยับ

ที่มา: `line-app/smoke.js`, `line-app/smoke-handlers.js`, `line-app/smoke-reads.js`, `line-app/smoke-usecases.js`, `line-app/smoke-cron.js`, `line-app/package.json`, `backend/tests/*.py`, `backend/pyproject.toml`, `backend/docker-compose.yml`, `docs/TEST-CASES.md`, `.github/workflows/ci.yml`, `scripts/prod-smoke.mjs`

---

## 1. ภาพรวม — อะไรถูกทดสอบด้วยอะไร

| ชั้น | ไฟล์ | รันด้วย | ต้องมีอะไร | ครอบอะไร |
|---|---|---|---|---|
| `line-app` โครงสร้าง/handler | `smoke.js`, `smoke-handlers.js`, `smoke-reads.js` | `node` (หรือ `npm test`) | Node ≥ 20 · ไม่ต้องมีเน็ต · **ไม่ต้อง `npm install`** | signature ของ webhook, Flex card, QR binding + move-confirm, rate limit, ยืนยันการชำระ + ใบเสร็จ, ยกเลิก/ออกบิลใหม่, สลิปหนึ่งใบหลายงวด, roles/invite, slip limits, **ตรวจสลิปผ่าน SlipOK (stub)**, **แก้ราคาห้อง**, concurrency ของ read |
| `line-app` use case | `smoke-usecases.js` | `node smoke-usecases.js` | เหมือนข้างบน | **156 เคส** ที่ id ตรงกับ `docs/TEST-CASES.md` (TC-xx-n) ไล่ตาม UC-01 … UC-18 |
| `line-app` cron เตือนรายวัน | `smoke-cron.js` | `node smoke-cron.js` | เหมือนข้างบน | auth ของ `/api/cron`, lock กันรอบซ้อน, 6 หน้าต่างเตือน, dedup, catch-up, ข้ามบิลที่ไม่ควรเตือน, retry, สรุปถึงเจ้าของ |
| `backend` API | `backend/tests/*.py` (14 ไฟล์) | `pytest` | Python ≥ 3.11 · **Postgres** สำหรับ test ที่แตะ DB | สัญญา error, session cookie, LINE idToken, ห้อง/มิเตอร์, ออกบิล + ส่งบิลเข้า LINE, สลิป/ยืนยัน/ตีกลับ, ผูก LINE, dunning, cron, **RLS**, webhook signature + dedupe, รายงานสรุป |
| LIFF inline script | `line-app/liff/bill.html` | `node --check` (ใน CI) | Node | แค่ **parse ได้** ไม่ได้รัน logic |
| production หลัง deploy | `scripts/prod-smoke.mjs` | `node scripts/prod-smoke.mjs` | เน็ต + URL จริง | **14 ข้อ**: build ปัจจุบัน, security header, endpoint ที่ต้อง auth ตอบ 401, dev endpoint ปิด, cron ป้องกัน secret |

> ไม่มี Jest/Vitest/Playwright และไม่มี coverage tool ใน repo นี้ — ทุกอย่างข้างบนคือทั้งหมดที่มี

**catalogue ของเคสคือ [`docs/TEST-CASES.md`](TEST-CASES.md)**: 268 เคสใน 19 use case โดยแบ่งเป็น ✅ 231 เคสที่ automation แตะ, 🖐 25 เคสที่ต้องทำมือกับ LINE/LIFF จริง และ ⏳ 12 เคสที่ **ยังไม่สร้างฟีเจอร์** (จึงยังไม่มี test) — ใน 231 เคสนั้น 156 เคสมี id ของตัวเองใน `smoke-usecases.js`, 50 เคสชี้ไปที่ backend pytest, 8 เคสชี้ไปเคสที่ automate ไว้แล้วใน UC อื่น, 1 เคสชี้ไป `smoke-cron.js` และ 16 เคสอ้าง `smoke-handlers.js` (ตรวจสลิป, สมาชิกห้อง, ตั้งค่าหอ, QR พร้อมเพย์, ตีกลับสลิป, guard เล็ก ๆ)

---

## 2. `line-app/` — offline smoke (ไม่ต่อเน็ต)

### 2.1 คำสั่ง

```bash
cd line-app

npm test                 # = node smoke.js && node smoke-handlers.js && node smoke-reads.js

node smoke.js            # signature + Flex card + auth guards
node smoke-handlers.js   # dev gate, QR binding, rate limit, confirm, ออกบิล, roles, slip limits, ใบเสร็จ, void, ตรวจสลิป (SlipOK), ราคาห้อง
node smoke-reads.js      # concurrency, ลำดับ, history, สิทธิ์
node smoke-usecases.js   # 156 เคสตาม UC (id ตรง docs/TEST-CASES.md)
node smoke-cron.js       # เตือนรายวัน: auth, lock, หน้าต่างเตือน, dedup, retry
```

`package.json` ตั้ง `"test": "node smoke.js && node smoke-handlers.js && node smoke-reads.js"` และ `"engines": {"node": ">=20"}`

> ⚠️ **`npm test` รันแค่ 3 ไฟล์** — `smoke-usecases.js` (156 เคส) และ `smoke-cron.js` ไม่ได้อยู่ใน script นี้ CI รันครบทั้ง 5 ไฟล์แยกเป็น step (`ci.yml`) ดังนั้นก่อน push ให้รันเองทั้ง 5 หรือรันตามข้อ 4

**ไม่ต้อง `npm install`:** ทั้งห้าไฟล์ `require` เฉพาะ builtin ของ Node (`assert`, `crypto`, `module`, `path`) และ stub dependency เองผ่าน `Module._load` / `require.cache` — ข้อยกเว้นเดียวคือ block QR ใน `smoke.js` ที่จะพิมพ์ `qrcode-svg not installed, QR check skipped` ถ้ายังไม่ได้ติดตั้ง (`smoke.js` บรรทัด 88–101)

### 2.2 `smoke.js` — ตรวจอะไร

| block | assert อะไร |
|---|---|
| signature | payload+secret เดียวกัน → ผ่าน · signature ผิด → `false` · ไม่มี signature → `false` |
| `billBubble` | `type === "flex"`, `altText` มีจำนวนเงิน `3,842`, `contents.type === "bubble"`, มี `ห้อง 203`, สีแบรนด์ `#4FD8D2`, ปุ่มชี้ไปหน้า LIFF |
| `confirmBubble` | ปุ่มเป็นการ์ดเจ้าของเป็น `postback` และ `data` มี `action=confirm` + `room=203` |
| bypass ของ seed token | `BYPASS_ALLOWED` เป็น `false` เมื่อไม่มี env / production (แม้เปิด opt-in) / preview, เป็น `true` เมื่อ preview + `ALLOW_SEED_BYPASS=true` หรือ `vercel dev` |
| owner/viewer | `OWNER_USER_ID` เป็น owner · คนที่ถูกเชิญเป็น owner ได้ · viewer ไม่ใช่ owner แต่ `canView` ได้ · ผู้เช่าไม่ใช่อะไรทั้งนั้น · ไม่ตั้ง `OWNER_USER_ID` → เฉพาะคนที่ถูกเชิญเป็น owner |
| QR | SVG เริ่มด้วย `<svg`, มี `viewBox`, ไม่มี `width` ตายตัว (ถ้าติดตั้ง `qrcode-svg`) |

### 2.3 `smoke-handlers.js` — ตรวจอะไร

stub ทั้งหมด: Blob store เป็น `Map` ในหน่วยความจำ, `fetch` ถูกแทนที่ (เฉพาะ `/oauth2/v2.1/verify` ที่ idToken ขึ้นต้นด้วย `U` ถือว่าผ่าน · `api.slipok.com` ตอบตามตัวแปร `slipok` ที่แต่ละเคสตั้งไว้), `qrcode-svg` ถูกแทนด้วย class ที่คืน `<svg/>`

| กลุ่ม | ตัวอย่างที่ assert |
|---|---|
| dev gate | `POST /api/dev` บน production-like env → 404 และเขียนอะไรไม่ลง store |
| QR binding | ผูกห้องว่างได้ + แจ้ง owner · ห้องที่มีคนอยู่แล้ว → 409 `ROOM_TAKEN` และคนเดิมไม่เสียห้อง · สแกนซ้ำห้องตัวเองได้ · คนที่ไม่ใช่ owner ดู QR ไม่ได้ (403) · ห้องนอก `ROOMS` → 404 · เปลี่ยนผู้เช่า → คืน `unbound: true`, ออก code ใหม่, ผูกเก่าใช้ไม่ได้ |
| move confirm | คนที่ผูกห้องอยู่แล้วสแกนห้องใหม่ → 409 `MOVE_CONFIRM_REQUIRED` พร้อม `current` · ยืนยันแล้วย้ายจริงและห้องเก่าเลิกผูก · สแกนห้องเดิมซ้ำไม่ push ซ้ำ |
| rate limit | รหัสผิดครบ `MAX_FAILURES` ครั้ง/ชั่วโมง → 429 · ห้องที่มีคนอยู่ได้ 409 ไม่กินโควตา (ยังสแกนห้องว่างต่อได้) |
| ยืนยันการชำระ (postback) | ผู้เช่ากดยืนยันไม่ได้ · owner กดแล้วปิดบิลของ period นั้นเท่านั้น · การ์ดเก่าที่ไม่มี `period` ปิดบิลใบใหม่ไม่ได้แม้สถานะ `pending` · ใบใหม่ + history ถูกอัปเดตทั้งคู่ · signature ปลอม → 401 |
| ออกบิล | บิลที่ `paid` แล้วไม่ถูกรีเซ็ต · บิล `unpaid` ออกซ้ำได้ (แก้เลขผิด) · หน่วยติดลบ/ไม่ใช่จำนวนเต็ม/ห้องนอก `ROOMS` → error และไม่เขียนบิล · บิล legacy ที่ใช้ key `bill:<room>` ก็ถูกกัน · ผู้เช่าเรียก → 403 · period ผิดรูปแบบ → 400 |
| idToken cache | token เดิมยืนยันกับ LINE ครั้งเดียว · token ที่ถูกปฏิเสธไม่ถูก cache |
| roles / invite / revoke | `/api/me` คืน `role`/`owner`/`root` ถูก · owner ที่ถูกเชิญสร้าง owner ใหม่ไม่ได้แต่สร้าง viewer ได้ · viewer เชิญใครไม่ได้ · invite ที่สร้างโดย non-root ก่อนกฎนี้ → 410 · คนที่ไม่ใช่ root ไม่เห็น userId ของสมาชิก · root ลบตัวเองไม่ได้ (409) · userId ที่มี `../` → 400 · เพิกถอนแล้วสิทธิ์หายใน request ถัดไป และ invite ที่คนนั้นสร้างตายตาม · invite ที่ถูกใช้แล้วใช้ซ้ำไม่ได้ |
| slip limits | note > 500 ตัวอักษร หรือ note ไม่ใช่ string → 400 · 1 สลิป/30 วินาที (`SLIP_TOO_SOON`) · 5 สลิป/บิล (`SLIP_LIMIT`) · แนบใหม่ลบไฟล์เก่า · `slipCount` ใน history เพิ่ม · owner ไม่ติด limit |
| ออกบิลห้องซ้ำใน request เดียว | อันที่สองตก, ยอดที่ออกคืออันแรก |
| ลำดับ period | บิลเดือนใหม่ยังเป็น "ใบปัจจุบัน" แม้เขียนเดือนเก่าทีหลัง |
| slip image | ผู้เช่าห้องอื่น → 403 · owner เปิดสลิปที่ไม่มี → 404 |
| แจ้งชำระก่อนบิลออก | ห้องที่ยังไม่มีบิล/บิลจ่ายแล้ว แนบสลิปแล้วได้ `status: "advance"` + `prepay:<ห้อง>` · บิลไม่ถูกสร้างหรือแก้ · พอออกบิล สลิปล่วงหน้ากลายเป็น `pending` ของบิลใหม่ · ออกบิลแล้วป้าย `prepay` หาย |
| ผู้เช่าใหม่ vs บิลของผู้เช่าเก่า | เขียน `tenancy:<ห้อง>` แล้วผู้เช่าใหม่ไม่เห็นบิลก่อน `since` (บิลไม่มี `issuedAt` ถือว่าเก่ากว่าทุก tenancy) · เจ้าของยังเห็น · สลิปล่วงหน้าของคนเก่าแยกไป `prepay-old:<ห้อง>:<slipAt>` |
| ใบเสร็จ, void, หนึ่งสลิปหลายงวด | ออกเลข `R<period>-<room>` (และ `-<rev>` เมื่อ rev 2) ทั้งสองสำเนา · ยืนยันซ้ำไม่เปลี่ยนเลขไม่ส่งซ้ำ · การ์ดใบเสร็จมีปุ่มเปิดหน้าใบเสร็จ · void ต้องมีเหตุผล, เก็บใบเดิมใน `bill-void:*`, rev+1 ตอนออกใหม่, บิล void ไม่ถูกทวง/ไม่ถูกปิด · สลิปหนึ่งใบเลือกหลายงวด → การ์ดกลุ่มปิดทีละงวดได้ และกดซ้ำตอบ "ไม่มีบิลที่รอยืนยัน" |
| บิลไม่มี due | การ์ดไม่พิมพ์คำว่า `null` และตัวเตือนข้ามบิลที่ไม่มี due |
| หน่วยมิเตอร์ขาด | ห้องที่ไม่มีหน่วยเดือนนี้ไม่ถูกออกบิล |
| seed token | `x-seed-token` ใช้ได้เฉพาะเมื่อ env เปิด และไม่กินสิทธิ์ของเจ้าของ |
| ตรวจสลิปผ่าน SlipOK (`api/_verify.js`) | ไม่ตั้ง key/branch → สลิปรับได้แต่ `slipVerify.ok = null` (`reason: "not_configured"`) และไม่ยิงออกเน็ต · ตั้งคีย์ → ยิงครั้งเดียวไป `/api/line/apikey/<branch>` พร้อม header `x-authorization` และ form `log=true` + `amount=<ยอดบิล>` · สลิปผ่าน → `ok: true` พร้อม `amount`/`transRef`/`provider: "slipok"` แต่ **บิลยัง `pending`** (การตรวจไม่จ่ายบิลให้) · `transRef` ถูกจำไว้ที่ `slip-ref:<transRef>` เพื่อกันสลิปเดิมไปใช้กับบิลที่สอง (ของเราเองจับได้แม้ SlipOK บอกว่าผ่าน) · `1013` = ยอดไม่ตรง, `1014` = บัญชีผู้รับไม่ใช่ของหอ, `1012` = สลิปซ้ำ → `ok: false` · `1009` (ธนาคารขัดข้อง) และ `1006` (อ่านรูปไม่ได้) → `ok: null` ไม่ใช่ "ปลอม" · ผู้ให้บริการตอบ 500 → ยังรับสลิป (`200`) แต่ `ok: null` · สลิปกลุ่มตรวจเทียบ **ยอดรวม** และทุกงวดในกลุ่มได้ผลเดียวกัน · body ผิดรูปจริงของ SlipOK (`{code, message, data}` ที่ไม่มี `success: false`) ต้องไม่ถูกอ่านว่าผ่าน |
| แก้ราคาห้อง (`POST /api/rooms`) | owner ตั้งค่าเช่า/อัตราน้ำไฟได้ และ `/api/rooms` เห็นค่าใหม่ · ห้องอื่นยังใช้ค่าเริ่มต้น · แก้บางฟิลด์ไม่ล้างฟิลด์ที่ไม่ได้ส่ง · viewer และผู้เช่า → 403 · ห้องนอก `ROOMS` → 404 · ไม่ส่งอะไรเลย/ค่าเช่าติดลบ/มีสตางค์/อัตราไม่ใช่ตัวเลข → 400 · ออกบิลจริงได้ 1 บาท (ค่าเช่า 1 ไม่มีหน่วย) |

### 2.4 `smoke-reads.js` — ตรวจอะไร

| assert | ค่า |
|---|---|
| อ่านห้อง 42 ห้องแล้วได้ครบตาม `ROOMS` และลำดับคงที่ | 200 |
| การอ่านซ้อนกันจริงแต่มีขอบเขต | peak > 1 และ ≤ 72 (12 ห้อง × 6 read) |
| `/api/rooms` ไม่พา LINE userId ของผู้เช่าออกไป | assert ว่าไม่มี `Usecret-tenant-id` ใน response |
| แสดงแค่ว่าห้องถูกผูกหรือไม่ | `linked` true/false |
| history เรียงใหม่→เก่า, ข้ามเดือนที่ไม่มีบิล, รองรับบิล legacy และ `hasSlip` | 200 |
| read ของ history มีขอบเขต 6 และอ่าน binding ครั้งเดียว | peak ≤ 6, `user-room:tenant` ถูกอ่าน 1 ครั้ง |
| ผู้เช่าขอห้องอื่น | 403 |

### 2.5 `smoke-usecases.js` — 156 เคสตาม use case

ไฟล์นี้จัดกลุ่มตาม use case และ **ทุกบล็อกมี id เดียวกับแถวใน [`docs/TEST-CASES.md`](TEST-CASES.md)** (`await tc("TC-04-10", ...)`) — ถ้าเคสในเอกสารกับในโค้ดไม่ตรงกัน ให้ถือเอกสารเป็นสเปก

```bash
cd line-app && node smoke-usecases.js
# ... 156 บรรทัด ✓ ...
# 156/156 use case tests passed
```

- แต่ละเคสห่อด้วย `tc(id, title, fn)` — ผ่านพิมพ์ `✓ <id> <title>`, ตกพิมพ์ error แล้วสรุปท้ายเป็น `failed: TC-xx-n, ...` พร้อม `process.exit(1)` (CI จึงแดง)
- ครอบ UC-01 คิดยอดบิล · UC-02 บันทึกมิเตอร์ · UC-03 ออกบิล · UC-04 ยืนยันการชำระ + ใบเสร็จ · UC-05 รายการห้อง · UC-06 รายงานรายรับ · UC-07 เพิ่ม/ถอนเจ้าของและผู้ช่วย · UC-08 เปลี่ยนผู้เช่า/หมุน QR · UC-09 ผูก LINE · UC-10 ดูบิลและประวัติ · UC-11 แนบสลิป · UC-13 สลิปหลายงวด · UC-15 ใบเสร็จ · UC-16 เตือนรายวัน (ฝั่ง line-app) · UC-17 แจ้งชำระก่อนบิลออก · UC-18 ยกเลิกบิล
- **UC-12 (ตรวจสลิปอัตโนมัติ) มีฟีเจอร์แล้ว** — 6 ใน 8 เคสถูกตรวจใน `smoke-handlers.js` (บล็อก `slip verification (SlipOK)`) แต่ **ผู้ให้บริการถูก stub**: `TC-12-7` (กฎอายุสลิป) ยังเป็น ⏳ และ `TC-12-8` (ยิง sandbox จริง) ยังเป็น 🖐
- UC-14 (ประวัติของผู้เช่า) ถูกตรวจผ่านเคสของ UC-10 (`TC-14-3` ชี้ไป `TC-10-5` โดยตั้งใจ) จึงไม่มีบล็อกของตัวเอง
- UC-19 (รับ event จาก LINE ฝั่ง backend) ไม่มีบล็อกในไฟล์นี้ — ทั้ง 6 เคสเป็น pytest (`backend/tests/test_webhook.py`)

harness เดียวกับ `smoke-handlers.js` แต่เพิ่ม: `keysWith` (index ของบิล), `getFile`/`putFile`/`delFile` (สลิป), และ `fetch` ที่บันทึก push / reply / rich-menu link / unlink / profile แยกกัน — ยังไม่ต่อเน็ตและไม่ต้องมี `node_modules`

### 2.6 `smoke-cron.js` — เตือนรายวัน

ทดสอบ `api/cron.js` + `api/_remind.js` ตรง ๆ (เรียก `runReminders({ today })` เพื่อเลื่อนวัน) ด้วย store ในหน่วยความจำ

| กลุ่ม | ตัวอย่างที่ assert |
|---|---|
| auth | ไม่ตั้ง `CRON_SECRET` → 503 `NOT_CONFIGURED` · secret สั้นกว่า 16 ตัวอักษรก็นับว่ายังไม่ตั้ง → 503 · ไม่มี header / secret ผิด → 401 `UNAUTHORIZED` · secret ถูก → 200 `{ok:true, today, sent:[], failed:0}` และล้าง `cron-lock` |
| lock | มี lock สด → 200 `{skipped:"another run is in progress"}` ไม่ส่งอะไร · lock เก่า 16 นาทีไม่บล็อก และรอบนั้นล้าง lock |
| หน้าต่างเตือน | 6 ช่วง: ยังไม่ถึง (ก่อน 4 วัน) · `before_3` (3 และ 1 วันก่อนครบกำหนด) · `due_0` · `after_1` (เลย 1–4 วัน) · `after_5` (5–9 วัน) · `after_10` (10 วันขึ้นไป) |
| ข้อความ | altText/text ตรงรูป `แจ้งเตือน: บิลห้อง 203 รอบ พ.ย. 2569 ยอด 3,796 บาท ครบกำหนด 16 พ.ย. (อีก 3 วัน)` · เป็น Flex · มีลิงก์ `liff.line.me/<LIFF_ID>?room=203` · ครบกำหนดวันนี้ขึ้น "ครบกำหนดวันนี้" · เลยกำหนดขึ้น "เลยกำหนดมา 5 วันแล้ว" |
| dedup / catch-up | รันวันเดิมซ้ำ → 0 · หน้าต่างเดิมที่ส่งแล้ว → 0 · หน้าต่างถัดไปเริ่มเมื่อถึงวัน · พลาด cron ไปหลายวัน รอบแรกที่รันยังส่งขั้นเดิม (ไม่กระโดดข้าม) |
| ข้าม | `pending` / `paid` / `void` / ไม่มี `due` / ห้องไม่ผูกผู้เช่า / บิลที่ออกก่อนผู้เช่าย้ายเข้า (`tenancy:<ห้อง>.since`) → ไม่ส่งและไม่มีสรุปถึงเจ้าของ |
| บิลค้างเก่า | บิลงวดเก่าที่ยัง `unpaid` ถูกเตือนด้วย (ใช้ index) · งวดเก่าที่ `paid` ไม่ถูก |
| retry | push ล้ม → `failed: 1`, ไม่เขียน mark, รอบถัดไปส่งซ้ำได้ · ห้องหนึ่งล้มไม่หยุดห้องอื่น |
| สรุปเจ้าของ | เฉพาะเมื่อมีการเตือนขั้น `after_*`: `สรุปทวงวันนี้: เลยกำหนด 2 ห้อง (203, 205) · ส่งเตือนแล้ว 2 ข้อความ` · `before_3`/`due_0` ไม่มีสรุป · ไม่มีอะไรส่งก็ไม่มีสรุป |
| หนึ่ง push ต่อห้อง | ห้องเดียวมีสองบิลในหน้าต่างพร้อมกัน → push เดียวสองการ์ด และ mark แยกกันทีละขั้น · rev 2 ที่ออกใหม่ถูกเตือนแม้ rev 1 ถูก mark แล้ว · mark รูปแบบก่อนมี rev ยังถูกนับ (ไม่ส่งซ้ำหลัง deploy) · เกิน 5 การ์ดแบ่งเป็น batch 5 + 2 |
| mark เขียนไม่ได้ | `reminded:*` เขียนล้ม → log `reminder mark failed` และนับว่าส่งแล้ว (ไม่ throw) เพราะการ์ดถึงผู้เช่าไปแล้ว |

### 2.7 ข้อจำกัดของชุดนี้

- ทุกอย่างถูก stub: **ไม่ได้ทดสอบ Vercel Blob จริง, LINE Messaging API จริง, SlipOK จริง, runtime ของ Vercel, หรือ LIFF**
- ตรวจได้เฉพาะ request ที่เรียก handler ตรง ๆ ด้วย `req`/`res` ปลอม — routing, header ที่ platform ใส่, และ timeout ไม่ถูกทดสอบ
- เป็น sequential ทั้งหมด: เคสยิงพร้อมกันจริงไม่ถูกจำลอง (ดูข้อ 10) — รวมถึง cron สองรอบซ้อนกัน (`TC-16-23` ยังเป็น ⏳)

---

## 3. `backend/` — pytest

### 3.1 ติดตั้งและเตรียม Postgres

```bash
# จาก root ของ repo
pip install -e "backend[dev]"        # CI ใช้คำสั่งนี้
# หรือจาก backend/
pip install -e ".[dev]"
```

`dev` extras มีแค่ `pytest>=8` กับ `httpx>=0.27` (`backend/pyproject.toml`)

```bash
cd backend
docker compose up -d                 # postgres:17 บน localhost:5432
```

`docker/init-test-db.sql` สร้างฐาน `domplus_test` ให้ครั้งแรกที่ volume ถูกสร้าง — ถ้า volume เดิมมีอยู่แล้วและยังไม่มีฐานนี้ ต้อง `create database domplus_test;` เอง ไม่งั้น alembic จะล้ม (ไม่ skip)

### 3.2 รัน

```bash
cd backend

pytest                                    # ไม่ตั้ง TEST_DATABASE_URL → test ที่ต้องใช้ DB ถูก skip
pytest -q                                 # แบบ CI
pytest tests/test_cron.py -q              # ไฟล์เดียว
pytest tests/test_rls.py -q               # เฉพาะ RLS (ต้องมี Postgres)
pytest -q -k "cron"                       # ตามชื่อ

TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test pytest -q
```

บน PowerShell:

```powershell
$env:TEST_DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test"
pytest -q
```

> ⚠️ **ฐานข้อมูลใน `TEST_DATABASE_URL` ถูกล้างทุกครั้งที่รัน** — `conftest.py` สั่ง alembic `downgrade base` แล้ว `upgrade head` ทั้ง session (ลบทุกตาราง) และ truncate **12** ตารางก่อนทุก test ห้ามชี้ไปที่ Neon/Supabase ตัวจริง

ตัวเลขที่วัดได้:

| สภาพ | ผล |
|---|---|
| `pytest -q` **มี** Postgres ตาม `TEST_DATABASE_URL` | **142 passed** (ทั้งหมด รวมไฟล์ที่แตะ DB) |
| `pytest -q` ไม่มี Postgres | **23 passed, 119 skipped** (test ที่ไม่ต้องใช้ DB รันได้หมด) |
| `pytest --collect-only -q` | **142 tests collected** ใน 14 ไฟล์ |

### 3.3 ไฟล์ test แต่ละไฟล์

| ไฟล์ | ต้องมี DB | ครอบอะไร |
|---|---|---|
| `test_app.py` | บางตัว (`test_healthz_ok`) | `/docs` เปิดนอก production / ปิดบน production · `DEV_AUTH` ถูกเพิกเฉยบน production · 404 ใช้รูป `{"error": {"code","message"}}` · `/healthz` 503 เมื่อ DB ล่ม |
| `test_session_and_line.py` | ไม่ | cookie sign/unsign, token ถูกแก้, secret อื่น, หมดอายุ, default secret ถูกปฏิเสธ · idToken `aud` ต้องตรง channel · `POST /v1/auth/line` → 503 เมื่อยังไม่ตั้ง `LINE_CHANNEL_ID` |
| `test_cron.py` | ไม่ (stub queue) | `GET /v1/cron/daily`: ไม่มี secret / secret ผิด / token ทาง query → 401 · secret ถูก → 200 `{"queued":1,"drained":true}` และ drain ใน invocation เดียว · ไม่ตั้ง `CRON_SECRET` → fail closed |
| `test_rooms.py` | ใช่ | 401 ไม่มี session · `DEV_AUTH` header เลือก session · ผู้เช่า → 403 · หออื่นเห็น/แก้ห้องนี้ไม่ได้ · list ตาม period + invoice ของ period · บันทึกมิเตอร์เทียบเดือนก่อน, ส่งซ้ำทับได้, เลขลดลงเตือนแต่บันทึก, ออกบิลแล้วแก้ไม่ได้ (409), ห้องไม่รู้จัก, ค่าผิด → 422 |
| `test_schema_and_seed.py` | ใช่ | seed สร้าง demo dorm และตัวเลขตรง prototype · seed ซ้ำไม่เปลี่ยนอะไร · DB กันบิลซ้ำ `(room, period)` · สถานะบิลถูกล็อกด้วย constraint |
| `test_billing.py` | ใช่ | `POST /v1/billing/run`: ออกบิลเฉพาะห้องที่มี reading · 42 ห้องใน request เดียว · รันซ้ำ 409 · จดมิเตอร์ทีหลังแล้วรันซ้ำออกเฉพาะห้องนั้น · พังกลางทาง rollback ทั้งก้อน · ใช้มิเตอร์เดือนก่อนค่าล่าสุด · ห้องเหมาจ่าย/ห้องว่าง · ผู้เช่า → 403 · period ผิดรูป → 422 (pydantic pattern) · **ส่งบิลเข้า LINE**: `queued`/`drained`/`job_id`, คิวพังก็ยัง 200 และบิลครบ · **enqueue สำเร็จแต่ drain ล้ม → ยังคืน `queued` ตามจริง `drained:false`** · **ห้องที่มีรูมเมทได้ข้อความเดียวถึงคนที่ `moved_in` ใหม่สุด** · **42 ห้อง: `queued=42` และ `message_log` มี 42 แถว `line_status='ok'`** · **ผู้เช่าที่ไม่มีห้องอ่านใบแจ้งหนี้ → 403** · `GET /v1/invoices`: `days_overdue`, `summary`, กรองสถานะ, ค่า default period, หออื่นไม่เห็น · **`GET /v1/invoices/:id`**: เจ้าของ/ผู้เช่า/หออื่น/ใบที่ไม่มี |
| `test_properties.py` | ใช่ | `GET /v1/properties/:id`: เจ้าของอ่านหอตัวเอง (รวมจำนวนห้อง) · หออื่น → 404 ไม่ใช่ 403 · ผู้เช่า → 403 · ไม่ล็อกอิน → 401 |
| `test_notify.py` | ไม่ (stub queue) | `notify_invoices`: 1 งานต่อใบด้วย `line.push_text` kind `invoice` · ข้อความมีห้องและยอด · ห้องไม่มีผู้เช่าไม่ถูก enqueue · ไม่มีอะไรส่ง = ไม่เปิดคิว |
| `test_webhook.py` | ใช่ | `POST /v1/webhooks/line/:property_id`: signature ถูก → 200 + `audit_log` 1 แถว (count/types) · signature ผิด → 401 และไม่เขียน · หออื่น → 404 แม้ signature ถูก · body ไม่ใช่ JSON → 400 · ไม่ตั้ง `LINE_CHANNEL_SECRET` → 503 · **event ซ้ำ (`webhookEventId`) เขียนครั้งเดียว** · header non-ASCII → mismatch ไม่ crash |
| `test_reports.py` | ใช่ | `GET /v1/reports/summary`: ยอดตรงกับ `GET /v1/invoices` · `rooms_total` = ทุกห้อง · `rooms_overdue` นับเฉพาะ unpaid ที่เลยกำหนด (ก่อนถึงกำหนด = 0) · ค่าเริ่มต้นคืองวดนี้ · ผู้เช่า 403 · หออื่นได้ 0 |
| `test_slip_confirm_reject.py` | ใช่ | สลิป → `pending` และเก็บ URL ตามที่หน้าเว็บส่ง · แนบห้องอื่น → 404 · แนบซ้ำ → 409 · **ผู้เช่าที่ไม่มีห้อง → 403** · ยืนยันแล้ว `paid` + `receipt_no` ไม่ซ้ำ · ยืนยันก่อนมีสลิปไม่ได้ · หออื่นยืนยันไม่ได้ · **ยืนยันรอ lock ระดับหอ** (`test_confirm_waits_for_the_dorm_lock`) · ตีกลับ → `unpaid` + `audit_log` |
| `test_line_link.py` | ใช่ | ออก invite ให้ผู้เช่าที่ยังไม่มี LINE · invite ใหม่ยกเลิกอันเก่า · ผูกแล้ว login ได้ทันที · พิมพ์ตัวเล็ก/เว้นวรรคได้ · เปิดซ้ำได้ · คนอื่นใช้ซ้ำ 409 · หมดอายุ/ถูกยกเลิก 410 · รหัสผิด 404 · ผูกครั้งเดียวต่อบัญชี · รูมเมท · หออื่นทำไม่ได้ · ยกเลิกผูก/move-out ตัด session เดิม · เดารหัสถี่ถูก rate limit |
| `test_dunning.py` | ใช่ | เลือกบิลตามวัน overdue (1/5/10) · kind ต่อบิล · `due_for_reminder` ใช้ `SELECT` เดียว · push ล้มไม่นับว่าส่งแล้วและ task โยน error ให้คิว retry · ผู้เช่าที่ไม่มี LINE ไม่ถูก enqueue · บิล `paid` ข้าม · เคย log kind นั้นแล้วไม่เลือกซ้ำ · หออื่นไม่ถูกแตะ |
| `test_rls.py` | ใช่ (และต้องสร้าง role ได้) | migration 0004: connection หนึ่งเห็นได้หอเดียว **แม้ query ไม่มี `where property_id`** · `app.property_id` = `p_1` เห็นข้อมูล · สลับเป็น `p_2` → 0 แถวทั้ง `rooms`/`invoices` · ไม่ตั้งค่า → 0 แถว (fail closed ไม่ใช่ fail open) · insert แถวของหออื่นถูกปฏิเสธ (`DBAPIError`) · ตารางลูก (`invoices`, `tenants`, `payments`) ที่ไม่มี `property_id` ถูกกรองผ่าน `rooms` |

**หมายเหตุของ `test_rls.py`:** CI ต่อ Postgres ด้วย user `postgres` ซึ่งเป็น superuser และ **ข้าม RLS ทั้งหมดไม่ว่า policy จะเขียนไว้อะไร** ไฟล์นี้จึงสร้าง role `rls_probe` (nologin, ไม่ใช่ owner) แล้ว `set local role` ก่อนตรวจ เพื่อให้ policy ทำงานเหมือน user ที่แอปใช้จริง — ถ้าใครแก้ policy แล้ว test ยังเขียว ให้สงสัยก่อนว่าตรวจในฐานะ superuser อยู่หรือเปล่า

### 3.4 fixtures ใน `conftest.py`

| fixture | ทำอะไร |
|---|---|
| `engine` (session scope) | ถ้าไม่มี `TEST_DATABASE_URL` → `pytest.skip` ทั้งไฟล์ที่ขอ · downgrade ถึง `base` แล้ว upgrade ถึง `head` ครั้งเดียวต่อ session · ต่อ engine ผ่าน `attach_property(..., "p_1")` เพื่อตั้ง `app.property_id` เหมือนแอป |
| `seeded` | truncate 12 ตาราง (`... restart identity cascade`) แล้วรัน `seed()` ใหม่ทุก test |
| `client_for` | สร้าง `TestClient` บน engine ที่ส่งมา และ override `get_engine` / `current_session` / `today` ได้ |
| `owner`, `phone`, `line_ready`, `billed`, `second_dorm` | ตัวช่วยเฉพาะไฟล์ (สร้าง invite/ผู้เช่า, ตั้ง LINE ให้พร้อม, สร้างบิลก่อน test) |
| `probe` (module scope, ใน `test_rls.py`) | สร้าง role `rls_probe` + grant บนทุกตาราง เพื่อทดสอบ RLS ในฐานะคนที่ไม่ใช่ superuser |

`conftest.py` ตั้ง `SESSION_SECRET=test-secret` และ `COOKIE_SECURE=false` ให้เอง เพราะ `app/session.py` ปฏิเสธ default secret และ `TestClient` คุยผ่าน `http://testserver` (cookie แบบ `Secure` จะไม่ถูกส่งกลับ)

### 3.5 ข้อจำกัดของชุดนี้

- `TestClient` เรียก ASGI app ในโปรเซสเดียว — ไม่มี network, TLS, reverse proxy, หรือ timeout จริง
- ไม่มี worker ของ Procrastinate: `test_cron.py` แทน `due_for_reminder`, `queue_reminders`, `drain_queue` ด้วย stub ทั้งสามตัว · `test_dunning.py` stub แค่ `queue_reminders` แล้วทดสอบ `due_for_reminder` ตัวจริง
- การ push LINE ถูก monkeypatch — ไม่มีข้อความจริงถูกส่ง
- test ที่ต้อง DB ทั้งหมด **ไม่รัน** ถ้าไม่มี Postgres: เขียวทั้ง suite ทั้งที่ตัวที่รันจริงเหลือ 23 ตัว (ดูข้อ 10)
- `test_rls.py` ตรวจ policy ในทรานแซกชันเดียวที่สลับ role — ไม่ได้พิสูจน์ว่า connection pool ของแอปตั้ง `app.property_id` ถูกทุกครั้ง (นั่นคือหน้าที่ของ `attach_property` ซึ่ง test ไม่ครอบ)

---

## 4. รันทุกอย่างในคำสั่งเดียว (ก่อน push)

```bash
cd line-app
node smoke.js && node smoke-handlers.js && node smoke-reads.js && node smoke-usecases.js && node smoke-cron.js
cd ../backend
TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test pytest -q
cd ..
node scripts/prod-smoke.mjs    # หลัง deploy เท่านั้น (ต้องมี URL จริง)
```

บน PowerShell แยกเป็นสองบรรทัด:

```powershell
cd line-app; node smoke.js; node smoke-handlers.js; node smoke-reads.js; node smoke-usecases.js; node smoke-cron.js
cd ..\backend; $env:TEST_DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/domplus_test"; pytest -q
```

**CI (`.github/workflows/ci.yml`, workflow `ci`, trigger: push ที่ `master` + ทุก PR)** รัน:

1. job `line-app` — Node 20 · `npm ci` · `node --check` ทุกไฟล์ใน `api/` · `node smoke.js` · `node smoke-handlers.js` · `node smoke-reads.js` · `node smoke-usecases.js` · `node smoke-cron.js` · แตก inline `<script>` ของ `liff/bill.html` แล้ว `node --check`
2. job `backend` — Postgres 16 service · Python 3.12 · `pip install -e "backend[dev]"` · `pytest -q` พร้อม `TEST_DATABASE_URL` และ `DEV_AUTH=true`

`prod-smoke.mjs` **ไม่อยู่ใน CI** (ไม่มี step เรียก)

---

## 5. ถ้า test ตก หมายความว่าอะไร

| ชุดที่ตก | ความหมาย | ไปดูตรงไหนก่อน |
|---|---|---|
| `smoke.js` | signature ของ webhook เพี้ยน (จะรับของปลอมหรือทิ้งของจริง) · การ์ดบิลผิดยอด/ผิดปุ่ม · seed bypass เปิดได้บน production · สิทธิ์ owner/viewer เพี้ยน | `api/_line.js`, `api/_auth.js` |
| `smoke-handlers.js` | มีช่องโหว่ที่แตะเงินหรือการผูกห้อง: แย่งห้องคนอื่น, ยืนยันบิลผิดใบ/ผิดงวด, เลขใบเสร็จซ้ำ, void ไม่เก็บใบเดิม, limit หลุด, เพิกถอนสิทธิ์ไม่จริง, ตรวจสลิปผ่าน SlipOK ผิดสัญญา (เช่น ไม่ส่ง `log:true`/`amount`, อ่าน error body ผิดรูปว่าผ่าน), แก้ราคาห้องได้โดยไม่ใช่ owner | handler ที่ชื่อใน assert (`api/qr.js`, `api/webhook.js`, `api/run.js`, `api/slip.js`, `api/_verify.js`, `api/rooms.js`, `api/bill.js`, `api/owner.js`) |
| `smoke-reads.js` | อ่าน Blob เกินขอบเขต (จะช้าจน timeout บน production) หรือผู้เช่าอ่านห้องคนอื่นได้ | `api/rooms.js`, `api/bill.js` |
| `smoke-usecases.js` | พฤติกรรมตาม use case เปลี่ยนจากที่ `docs/TEST-CASES.md` สัญญาไว้ — ข้อความที่พิมพ์ท้ายบอก id ที่ตก (เช่น `failed: TC-13-4`) เปิดแถวนั้นในเอกสารเพื่อดูผลที่คาด | ไฟล์ที่แถวนั้นอ้างถึง (`api/*.js`, `liff/bill.html`) |
| `smoke-cron.js` | ผู้เช่าไม่ได้รับเตือน, เตือนซ้ำ, เตือนผิดขั้น/ผิดวัน, ทวงบิลที่จ่ายแล้ว, สรุปถึงเจ้าของผิด, cron เปิดให้คนไม่มี secret | `api/_remind.js`, `api/cron.js` |
| pytest (ไฟล์ที่ต้อง DB) | สัญญา API หรือ state machine เปลี่ยน — บ่อยสุดคือ migration ไม่ตรงกับ model หรือ constraint ถูกถอด | `backend/app/routes/*`, `backend/migrations/` |
| pytest `test_rls.py` | policy รั่วหรือปิดเกิน: เห็นข้ามหอ, fail open เมื่อไม่ตั้ง `app.property_id`, หรือเขียนแถวข้ามหอได้ | `backend/migrations/versions/0004_rls_property.py`, `backend/app/db.py` (`attach_property`) |
| pytest (ไฟล์ที่ไม่ต้อง DB) | session cookie / cron auth / error shape พัง ซึ่งเป็นชั้น security | `app/session.py`, `app/routes/cron.py`, `app/errors.py` |
| `prod-smoke.mjs` | deploy ไม่ตรงกับโค้ด: build เก่า, header หาย, dev endpoint ยังเปิด, endpoint ที่ต้อง auth ตอบ 200 | Vercel deployment + env ของโปรเจกต์นั้น |
| `node --check` ของ `liff/bill.html` (ใน CI) | inline script ของหน้า LIFF parse ไม่ได้ — ถ้า merge ไปจะเห็นเป็นจอขาวใน LINE | `line-app/liff/bill.html` |

---

## 6. Coverage

**ไม่มีการตั้ง coverage threshold ที่ไหนเลย** — ไม่มี `.coveragerc`, `.nycrc`, `pytest-cov`, หรือ `--cov` ใน CI และ `line-app` ไม่มี coverage tool (ทดสอบด้วย `assert` ตรง ๆ) ดังนั้นตัวเลข coverage ที่ "ควรมี" ไม่มีอยู่ใน repo นี้

สิ่งที่พอวัดได้คือ **ความครอบของ use case** จาก [`docs/TEST-CASES.md`](TEST-CASES.md) (267 เคส / 19 UC):

| สถานะในเอกสาร | จำนวน | ใครตรวจ |
|---|---|---|
| ✅ automated — id ของตัวเองใน `smoke-usecases.js` | 156 | `line-app/smoke-usecases.js` |
| ✅ automated — ชี้ไป backend pytest | 50 | `backend/tests/*.py` |
| ✅ automated — ชี้ไปเคสที่ automate แล้วใน UC อื่น | 8 | `smoke-usecases.js` (เช่น `TC-14-3` → `TC-10-5`) |
| ✅ automated — ชี้ไป `smoke-cron.js` | 1 | `line-app/smoke-cron.js` |
| ✅ automated — ตรวจสลิป, สมาชิกห้อง, ตั้งค่าหอ, QR พร้อมเพย์, ตีกลับสลิป (`smoke-handlers.js`) | 16 | `line-app/smoke-handlers.js` |
| 🖐 manual | 25 | คนกดกับ LINE OA + LIFF จริง (ข้อ 7) |
| ⏳ ยังไม่สร้าง | 12 | ยังไม่มีฟีเจอร์ จึงยังไม่มี test |
| **รวม** | **267** | |

ตัวเลข 222 ไม่ได้แปลว่าโค้ดทุกบรรทัดถูกตรวจ — เคสหนึ่งอาจ assert หลายอย่างหรือแค่ทางเดียวของ handler

---

## 7. Manual matrix — สิ่งที่ automation แตะไม่ได้

ทั้งหมดนี้ต้องมี LINE OA จริง + LIFF จริง (HTTPS) + Vercel deployment เพราะ smoke test stub LINE และ Blob ไปแล้ว แต่ละแถวคือเคส 🖐 ใน `TEST-CASES.md` — ยกเว้นแถวสุดท้าย (ตรวจสลิปกับผู้ให้บริการจริง) ที่รวมเคส ✅ ซึ่ง automation ตรวจได้เฉพาะกับ stub:

| flow | เคส | ขั้นตอนย่อ | ต้องเห็นอะไร |
|---|---|---|---|
| **QR bind** | `TC-09-11` | เปิด LIFF ในแอป LINE จริง → สแกน QR ที่หน้า owner สร้าง → ยืนยันผูก | ผูกสำเร็จ, เห็นบิลของห้องตัวเอง, owner ได้ข้อความแจ้ง, เมนูผู้เช่าขึ้น |
| **ยังไม่เพิ่มเพื่อน OA** | `TC-09-19` | ใช้บัญชีที่ยังไม่ follow OA สแกน QR หน้าห้อง (LIFF ต้องเป็น Full-size) | เห็นการ์ด "ยังไม่ได้เพิ่ม DormPlus เป็นเพื่อน" · กด "เพิ่มเพื่อน DormPlus" → หน้าต่างเพิ่มเพื่อนของ LINE → กลับมา "ตรวจอีกครั้ง" แล้วการ์ดหาย · ถ้าบัญชีเป็นเพื่อนอยู่แล้ว (หรืออ่านไม่ได้) ไม่มีการ์ด |
| **QR พิมพ์/สแกน** | `TC-08-16` | เปิดหน้า QR ห้อง · ย่อ/ขยายหน้าจอ · สแกนด้วยกล้อง LINE | QR ไม่ถูกตัดขอบ (มี `viewBox`) และสแกนติด |
| **move-confirm** | `TC-09-11` | บัญชีที่ผูกห้องอยู่แล้วสแกน QR ห้องอื่น | ขึ้นคำถามยืนยันก่อนย้าย (ไม่ย้ายเงียบ ๆ แม้มาจากลิงก์ `?bind=` ที่ถูก forward) · ยืนยันแล้วห้องเก่าเลิกผูก |
| **ออกบิลจากหน้าจอ** | `TC-03-15` | เจ้าของกรอกหน่วยทุกห้อง กดออกบิล | ผลต่อห้องแสดงถูก · การ์ดถึงผู้เช่า · ปุ่มเปิดหน้าบิลถูกห้อง |
| **ช่องหน่วยว่างใน LIFF** | `TC-02-14` | เว้นช่องน้ำหรือไฟของห้องหนึ่งแล้วกดออกบิล | ขึ้น "กรอกหน่วยน้ำและไฟให้ครบ" · ห้องนั้นไม่ถูกออกบิล (ไม่กลายเป็นบิลค่าเช่าล้วน) |
| **ยืนยันการชำระจาก Flex card** | `TC-04-12` | owner กดปุ่ม "ยืนยันการชำระ" / "ดูสลิป" บนการ์ดในแชท (ไม่ใช่หน้าเว็บ) | webhook รับ postback จริง, บิลเป็น `paid`, ผู้เช่าได้การ์ดใบเสร็จ |
| **ใบเสร็จใน LINE + LIFF** | `TC-15-9` | ผู้เช่ากด "ดูใบเสร็จ" · เปิดงวดที่ยังไม่จ่าย · เปิดงวดที่ถูกยกเลิก · เจ้าของเปิดใบเสร็จของห้อง | หน้าตรงกับ API · งวดที่ยังไม่จ่ายขึ้น "ยังไม่มีใบเสร็จ" · งวดที่ยกเลิกขึ้น "ยกเลิกแล้ว" พร้อมเหตุผล · `#fragment` ไม่หายตอนล็อกอิน |
| **ใบเสร็จบนมือถือ** | `TC-15-5` | เปิดใบเสร็จแล้วแคป/ส่งต่อในแชท (LIFF ยังไม่มีปุ่มบันทึก/แชร์) | ตัวหนังสืออ่านออก ยอดและเลขที่ถูก ไม่ถูกตัดขอบ |
| **ยกเลิกบิลจาก LIFF** | `TC-18-11` | เจ้าของเปิดห้อง → "ยกเลิกบิล" → ใส่เหตุผล → ยืนยัน · ดูรายการห้อง/รายงาน/ใบเสร็จ · ผู้เช่าเปิดบิล | ต้องใส่เหตุผลก่อน · บิลที่จ่ายแล้วมีคำเตือนว่าใบเสร็จจะถูกยกเลิก · ผู้ช่วยไม่เห็นปุ่ม · ออกใหม่ได้ · ยอดรายงานไม่นับ void · ผู้เช่าเห็น "ยกเลิกแล้ว" |
| **สลิปหนึ่งใบหลายงวด (UI)** | `TC-13-7` | ผู้เช่าเลือกหลายงวดใน LIFF แล้วดูยอดรวมก่อนส่ง | ยอดรวม/รายการงวดถูก · หลังส่งขึ้น "แจ้งชำระ N งวดแล้ว" |
| **แนบสลิปจริง** | `TC-11-12` | ผู้เช่าเลือกรูปจากกลังภาพใน LIFF | เห็น "รอตรวจ" · owner เห็นรูปในหน้า "สลิปรอตรวจ" |
| **สลิปล่วงหน้า (UI)** | `TC-17-20`, `TC-17-21`, `TC-17-22`, `TC-17-23` | ผู้เช่าเปิดหน้าบิลตอนยังไม่มีบิล/บิลจ่ายแล้ว · เจ้าของดูป้าย "โอนล่วงหน้า" · แนบสลิปก่อนบิลแล้ว owner ออกบิล | ปุ่ม "โอนก่อน/แนบสลิป" ใช้ได้ · ป้ายและ "ดูสลิป" ถูก · เจ้าของได้ข้อความแล้วได้การ์ดยืนยัน |
| **viewer role** | `TC-05-6`, `TC-07-15` | owner เชิญผู้ช่วย (viewer) → เปิด LIFF ด้วยบัญชีนั้น · สแกนรหัสเชิญด้วย LINE จริง | เห็นบิล/สลิป/รายงาน แต่ปุ่ม "ออกบิลทั้งหอ", "เจ้าของและผู้ช่วย" หาย และยืนยันการชำระไม่ได้ · เมนูสลับตามบทบาท และกลับเมื่อถูกถอน |
| **หน้าจอรายงาน/ค้างชำระ** | `TC-05-6`, `TC-06-4` | เจ้าของเปิด "ค้างชำระ" และ "รายงานรายรับ" | ตัวเลขตรงกับสถานะจริง · pending ไม่ถูกนับค้าง · ห้องไม่มี `due` ไม่ถูกนับ |
| **ประวัติผู้เช่า/ผู้เช่าใหม่** | `TC-14-1`, `TC-08-17`, `TC-10-10` | ผู้เช่าเปิดหน้าบิลและประวัติ · หลังเปลี่ยนผู้เช่าเปิดด้วยบัญชีใหม่ | สถานะต่องวดถูก · ผู้เช่าใหม่เห็น "ยังไม่มีบิลรอบนี้" และประวัติว่าง |
| **เตือนรายวันถึง LINE จริง** | `TC-16-9`, `TC-16-22` | รอรอบ 09:00 เวลาไทย (หรือเรียก `/api/cron` ด้วย Bearer) ในวันก่อนกำหนด/ครบกำหนด/เลยกำหนด | ผู้เช่าได้การ์ดตามขั้น ไม่ซ้ำในวันเดียว · เจ้าของได้สรุปเมื่อมีเลยกำหนด · เวลาไทยตรงวัน |
| **rich menu** | `TC-07-15` | `node scripts/setup-richmenu.js` แล้ว `node scripts/set-richmenu-image.js` → ผูก/เพิกถอนผู้ใช้ | เมนูเปลี่ยนตามบทบาทเมื่อผูก และกลับเมนู tenant เมื่อถูกเพิกถอน |
| **ตรวจสลิปกับผู้ให้บริการจริง** | `TC-12-1`, `TC-12-2`, `TC-12-5`, `TC-12-8` | ตั้ง `SLIPOK_API_KEY` + `SLIPOK_BRANCH_ID` ของ branch จริง แล้วแนบสลิปจริง (ยอดตรง · ยอดผิด · โอนเข้าบัญชีอื่น) จาก LIFF | `slipVerify` ตรงความจริง · สลิปยอดผิดขึ้น "ยอดในสลิปไม่ตรงกับบิล" · สลิปที่โอนเข้าบัญชีอื่นขึ้น "บัญชีผู้รับไม่ใช่บัญชีของหอ" · สลิปถูกใช้ซ้ำถูกปฏิเสธ (ทั้งจาก `1012` และ `slip-ref:<transRef>`) · คิดโควตา/ค่าบริการตามที่ตกลงกับผู้ให้บริการ |

> หมายเหตุเรื่องใบเสร็จ/void/สลิปหลายงวด: **logic ฝั่ง handler ถูกตรวจใน CI แล้ว** (`smoke-handlers.js` กลุ่ม "receipts, void, one slip for several periods" และ `smoke-usecases.js` UC-15/UC-18) สิ่งที่ยังไม่มีใครตรวจคือ **ครึ่งที่ต้องมี LINE/LIFF จริง** — ปุ่มบนการ์ดจริง, การแสดงผลบนหน้าจอ, และการที่ผู้ใช้กดแล้วได้ผลตามที่เอกสารสัญญา (เคส 🖐 ข้างบน)

> หมายเหตุเรื่องตรวจสลิป: `slip verification (SlipOK)` ใน `smoke-handlers.js` ตรึง **สัญญา** ไว้ครบ (ยิงที่ไหน, `log:true`, `amount`, `1012/1013/1014`, `1006/1009`, provider 500, ยอดรวมของสลิปกลุ่ม) แต่คำตอบของผู้ให้บริการถูก stub — **ยังไม่มีการเรียก SlipOK จริงในชุด test เลย** และ backend ไม่มีส่วนตรวจสลิป (เก็บเฉพาะ URL ของสลิปที่หน้าเว็บส่งมา)

matrix ละเอียดระดับ endpoint และ race table ของ `line-app` ยังไม่มีเอกสารแยกใน repo นี้ — ตารางที่ใช้ได้จริงคือข้อ 2.3 และข้อ 10.4 ข้างบน

---

## 8. ตรวจ production หลัง deploy

```bash
node scripts/prod-smoke.mjs
LINE_APP=https://... BACKEND=https://... node scripts/prod-smoke.mjs
```

ค่า default คือ `https://line-app-iota.vercel.app` และ `https://line-backend-ten.vercel.app` (ดู `scripts/prod-smoke.mjs` บรรทัด 8–9) ใช้ `fetch` ของ Node 20+ ไม่มี dependency และ **ไม่ต้องล็อกอิน** — ตรวจ **14 ข้อ**:

- หน้า LIFF ตอบ 200 และเป็น build ปัจจุบัน (`qr-ph` อยู่ใน HTML)
- `/api/config` 200 · API มี `X-Content-Type-Options: nosniff` และ `X-Frame-Options: DENY` · หน้า LIFF **ไม่** ถูก frame-deny (LINE ต้องฝังได้)
- `/api/me` ไม่มี token → 401 · `POST /api/dev` → 404
- backend `/healthz` คืน `{"status":"ok"}` · `/docs` และ `/openapi.json` → 404
- `/v1/rooms` ไม่มี session → 401 · `/v1/dunning/run?token=guess` → 401
- `/v1/cron/daily` ไม่มี secret → 401

exit code 1 ถ้ามีข้อใดตก **สคริปต์นี้ไม่ถูกรันใน CI** (ไม่มี step ใน `.github/workflows/ci.yml`) — ต้องรันเองหลัง deploy

---

## 9. ตรวจ cron ด้วยมือ

**ตัวที่ตั้งเวลาจริงคือ `line-app`** — `line-app/vercel.json` มี `{"crons":[{"path":"/api/cron","schedule":"0 2 * * *"}]}` (02:00 UTC = 09:00 ไทย) และ Vercel ใส่ `Authorization: Bearer <CRON_SECRET>` ให้เองเมื่อตั้ง env บนโปรเจกต์ (secret ต้องยาว ≥ 16 ตัวอักษร ไม่งั้น endpoint ตอบ 503 `NOT_CONFIGURED`)

`backend/vercel.json` **ไม่มี `crons` แล้ว** — backend ยังมี `/v1/cron/daily` ไว้ให้เรียกเอง (คิว Procrastinate) แต่ไม่มีตัวตั้งเวลาในโปรเจกต์ backend

```bash
# line-app: ต้องได้ 200 {"ok":true,"today":"...","sent":[...],"failed":0}
curl -i -H "Authorization: Bearer $CRON_SECRET" https://line-app-iota.vercel.app/api/cron

# รอบซ้อน (ระหว่างรอบแรกยังทำงาน) → 200 {"ok":true,"skipped":"another run is in progress"}
# ต้องได้ 401 / 503
curl -i https://line-app-iota.vercel.app/api/cron
curl -i "https://line-app-iota.vercel.app/api/cron?token=$CRON_SECRET"

# backend (ถ้าใช้คิวProcrastinate)
curl -i -H "Authorization: Bearer $CRON_SECRET" https://line-backend-ten.vercel.app/v1/cron/daily
curl -i https://line-backend-ten.vercel.app/v1/cron/daily
```

| อาการ | ความหมาย |
|---|---|
| 200 + `{"sent":[],"failed":0}` | ไม่มีบิลถึงกำหนด — ปกติ |
| 200 + `skipped: "another run is in progress"` | มี `cron-lock` สด (ไม่เกิน 15 นาที) — รอรอบถัดไป |
| 200 + `sent` มีรายการ แต่ผู้เช่าไม่ได้รับข้อความ | `LINE_CHANNEL_ACCESS_TOKEN` ไม่ได้ตั้ง หรือ push ถูกปฏิเสธ — `failed` จะนับให้ |
| 401 | ไม่มี/ผิด `CRON_SECRET` |
| 503 `NOT_CONFIGURED` | ยังไม่ตั้ง `CRON_SECRET` หรือตั้งสั้นกว่า 16 ตัวอักษร (fail closed) |
| backend 503 `QUEUE_UNAVAILABLE` | ยังไม่ได้สร้างตาราง Procrastinate → `python -m app.queue` ครั้งเดียวต่อฐานข้อมูล |
| 500 | ต่อ DB ไม่ได้ — เช็ค `/healthz` ก่อน |

test อัตโนมัติที่ครอบส่วนนี้: `line-app/smoke-cron.js` (auth, lock, 6 หน้าต่างเตือน, dedup, retry, สรุปเจ้าของ) · `backend/tests/test_cron.py` (5 เคส: 401 สามแบบ, 200 + drain, fail closed) · ข้อ `/v1/cron/daily → 401` ใน `prod-smoke.mjs` — แต่ **การที่ Vercel เรียก 09:00 จริงและการ์ดถึงมือผู้ใช้** ยังเป็นงานมือ (`TC-16-22`)

---

## 10. ช่องว่างที่รู้อยู่ (อย่าอ่านว่า "ผ่าน test แล้วปลอดภัย")

1. **ไม่มี browser/UI test เลย** — `liff/bill.html` มี inline JS หลายร้อยบรรทัดที่ CI ตรวจแค่ `node --check` ว่า parse ได้ ไม่มีใครตรวจว่าปุ่มทำงาน, สถานะแสดงถูก, หรือ layout ไม่พัง — และไม่มี test ของ sitemap/menu ที่ LINE วาด
2. **ไม่มี LINE end-to-end ใน CI** — webhook, postback, rich menu และการส่งข้อความจริงถูก stub/monkeypatch ทั้งหมด; regression ที่เกิดจาก LINE API เปลี่ยนจะไม่ถูกจับ
3. **ไม่มี test ของ Blob จริง** — `smoke-*.js` ใช้ `Map` แทน `api/_store.js`; พฤติกรรมของ `list`/`put`/`get` (pagination, overwrite, permission, latency) ไม่ถูกทดสอบ
4. **race ของ line-app ไม่มี lock** — Blob store เป็น read-modify-write **ไม่มี compare-and-swap** (`api/_store.js` เขียนด้วย `allowOverwrite: true`):
   - แนบสลิป 2 ครั้งพร้อมกัน → เขียนทับกัน, push การ์ด owner 2 ใบ
   - owner กดยืนยัน 2 เครื่องพร้อมกัน → push ผู้เช่า 2 ครั้ง, เลขใบเสร็จอาจชนกัน
   - 2 คนสแกน QR ห้องว่างเดียวกันเป๊ะ → คนหลังอาจทับคนแรก

   เลขใบเสร็จ (`receiptNoOf`) **derive จากบิล** (`R<period>-<room>[-rev]`) ไม่ใช่ counter กลาง จึงไม่ชนกันข้ามห้อง — แต่การ์ดยืนยันสองใบของห้อง/งวดเดียวกันที่กดพร้อมกัน (หรือ void แล้วออกใหม่พร้อมกันจน `rev` เดียวกัน) ยังเป็นการอ่าน-แก้-เขียนทับกันได้

   test ที่มีอยู่ยืนยันได้แค่เคส **sequential** (เช่น `ROOM_TAKEN` เมื่อผูกไปแล้ว) — เคสที่ต้องยิงพร้อมกันจริง (`TC-15-10`, `TC-16-23`, `TC-17-18`) ยังเป็น ⏳
5. **cron เป็น at-least-once ไม่ใช่ exactly-once** — `api/cron.js` อ่าน `cron-lock` แล้วค่อยเขียน (ไม่มี CAS) จึงแค่ *ลด* ช่วงที่สองรอบซ้อนกัน ไม่ได้ปิดสนิท และ mark `reminded:*` ถูกเขียนหลัง push สำเร็จ: ถ้า process ตายระหว่าง push กับ mark ผู้เช่าจะได้เตือนซ้ำในรอบถัดไป (ยอมรับได้ แต่ต้องรู้) `TC-16-23` (สองรอบซ้อนกันจริง) ยังเป็น ⏳ เพราะจำลองใน-process ไม่ได้
6. **backend กัน race ได้แค่บางจุด** — ยืนยันการชำระมี lock ระดับหอ (`test_confirm_waits_for_the_dorm_lock`) และ DB กันบิลซ้ำด้วย `UNIQUE(room_id, period)` แต่ไม่มี test ของ concurrent request จริงจากหลายโปรเซส (TestClient เป็น single-process)
7. **`test_rls.py` พิสูจน์เฉพาะ policy ในทรานแซกชันเดียว** — ไม่ครอบว่า connection ทุกเส้นของแอปตั้ง `app.property_id` ก่อนใช้ (ถ้าลืม set ค่าจะ fail closed แต่จะเห็นเป็น 0 แถว ซึ่ง debug ยาก)
8. **ไม่มี load/performance test** — ขอบเขต concurrency ของ read ถูก pin ด้วย `assert` (peak ≤ 72 และประวัติ ≤ 6) แต่ไม่ได้วัดเวลา
9. **ไม่มี coverage measurement** — ดูข้อ 6
10. **`prod-smoke.mjs` เป็น manual** — ไม่มี schedule หรือ workflow เรียก มันจึงเขียวค้างได้แม้ production พัง
11. **`npm test` ไม่ได้รันทั้ง 5 ชุด** — `smoke-usecases.js` และ `smoke-cron.js` ต้องเรียกเอง (CI เรียกครบ แต่คนที่รัน `npm test` ก่อน push จะพลาด 156 + 1 ชุด)
12. **20 เคสในเอกสารยังเป็น ⏳** — เช่น ปฏิเสธสลิปใน line-app (`TC-04-11`, `TC-13-5`), ค้างกี่งวดต่อห้อง (`TC-05-7`), ผู้เช่า `moved_out` ยังไม่มี pytest (`TC-16-11`), กฎอายุสลิป (`TC-12-7`), กดยืนยันพร้อมกัน (`TC-15-10`) — อย่านับว่า "มี test แล้ว" เพราะมีแถวในเอกสาร
13. **ผู้ให้บริการตรวจสลิปถูก stub ทั้งชุด** — `smoke-handlers.js` ตรึงสัญญาไว้ครบ (endpoint, header, `log:true`, `amount`, code `1012/1013/1014/1006/1009`, provider 500, ยอดรวมของสลิปกลุ่ม, body ผิดรูปจริงของ SlipOK) แต่ **ไม่มีการเรียก SlipOK จริงใน CI** และไม่มี test ที่ยืนยันว่า branch ผูกบัญชีรับเงินถูกบัญชี — ถ้า SlipOK เปลี่ยนสัญญา test จะยังเขียว

---

## 11. เขียน test ใหม่

### line-app

- เลือกไฟล์ให้ตรงหมวด: `smoke.js` = โครงสร้าง/สิทธิ์พื้นฐาน · `smoke-handlers.js` = handler ที่แตะเงิน/ผูกห้อง · `smoke-reads.js` = read/concurrency · `smoke-usecases.js` = เคสตาม use case (และเพิ่มแถวใน `docs/TEST-CASES.md` ด้วย id เดียวกัน) · `smoke-cron.js` = เตือนรายวัน
- ถ้าสร้างไฟล์ใหม่ ต้องเพิ่ม step ใน `.github/workflows/ci.yml` เอง — `npm test` ใน `line-app/package.json` ยังรันแค่ 3 ไฟล์เดิม (จะเพิ่มเข้า `"test"` ด้วยก็ได้ แต่ระวังเวลารัน)
- ใช้ `node:assert` และ stub แบบเดิม: `require.cache[require.resolve("./api/_store")] = {...}` สำหรับ store, แทน `global.fetch` สำหรับ LINE และ SlipOK (เคสสลิปตั้งตัวแปร `slipok` แล้วเรียก `call(slip, ...)` — ตั้ง `SLIPOK_API_KEY`/`SLIPOK_BRANCH_ID` ให้ครบและ `delete` ทิ้งเมื่อจบ), `call(handler, {body, user})` สำหรับ handler, `await tc("TC-xx-n", "ชื่อ", async () => {...})` สำหรับเคสใน `smoke-usecases.js`
- ทุกเคสต้องรันได้โดยไม่ต้องมีเน็ตและไม่ต้องมี `node_modules` — ถ้าต้องใช้ dependency ให้ stub ผ่าน `Module._load` เหมือน `qrcode-svg`
- ห้ามใช้ `process.env` ของเครื่องจริง: ตั้งค่าที่ต้องใช้บนหัวไฟล์ (ไฟล์ที่มีอยู่ตั้ง `LINE_CHANNEL_SECRET`, `OWNER_USER_ID`, `ROOMS`, `CRON_SECRET` เอง)

### backend

- วางใน `backend/tests/test_<area>.py` ชื่อฟังก์ชัน `test_...` (ตรงกับ `testpaths = ["tests"]` ใน `pyproject.toml`)
- เคสที่แตะ DB ต้องรับ fixture `seeded` (หรือ `engine`) — ถ้าไม่ตั้ง `TEST_DATABASE_URL` มันจะถูก skip เงียบ ๆ (และอย่าลืมว่ารันด้วย user superuser จะข้าม RLS — ถ้า test เรื่องสิทธิ์ข้ามหอ ให้ทำแบบ `test_rls.py`: `set local role` เป็น role ธรรมดา)
- ใช้ `client_for(engine, session=..., day=...)` เพื่อเลือก session และวันที่ แทนการแก้ `datetime` ในโค้ด
- อย่าใช้ DB จริงใน `.env`: `TEST_DATABASE_URL` คือฐานที่ถูกล้าง
- ถ้าเพิ่มเคสที่ผู้ใช้มองเห็น ให้เพิ่มแถวใน `docs/TEST-CASES.md` พร้อมชี้ไปที่ `test_...` (คอลัมน์ "ทดสอบโดย")

---

## เอกสารที่เกี่ยวข้อง

- [`docs/TEST-CASES.md`](TEST-CASES.md) — catalogue 267 เคส / 19 UC พร้อมสถานะ ✅/🖐/⏳ และโค้ดที่แต่ละเคสอ้างถึง
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — โครงสร้างสองครึ่ง, data flow, state machine ของบิล
- [`docs/CONFIGURATION.md`](CONFIGURATION.md) — env ทุกตัว (`TEST_DATABASE_URL`, `CRON_SECRET`, `DEV_AUTH`, `SLIPOK_API_KEY`/`SLIPOK_BRANCH_ID`)
- [`backend/README.md`](../backend/README.md) — วิธีรัน backend และ seed
