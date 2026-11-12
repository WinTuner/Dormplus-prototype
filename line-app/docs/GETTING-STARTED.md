<!-- generated-by: gsd-doc-writer -->

# เริ่มต้นใช้งาน (GETTING-STARTED)

เอกสารนี้พาไปจาก "เพิ่งโคลนเรพ" ถึง "คำขอ HTTP แรกที่สำเร็จ" โดยยึดตามสิ่งที่รันได้จริงในเรพวันนี้

## 0. อ่านก่อนอย่างเดียว: เรพนี้ไม่มี dev server

`package.json` **ไม่มี `scripts` เลย** (มีแค่ `engines`, `dependencies`) ดังนั้น:

- ไม่มี `npm run dev`, `npm start`, ไม่มี `npm test`
- ไม่มี `.env`, `.env.example` และไม่มี `dotenv` — ใส่ค่าในไฟล์ `.env` แล้วไม่มีผล เพราะไม่มีอะไรโหลดไฟล์นั้น (รายละเอียดใน [`CONFIGURATION.md`](./CONFIGURATION.md) ข้อ 4)
- ไม่มี dev server สำหรับ `liff/bill.html` — หน้าเว็บเรียก `/api/*` แบบ path สัมพัทธ์ผ่าน helper `fetch` ตัวเดียว (จุดเรียกจริง: `/api/config` · `/api/me` · `/api/bill` · `/api/slip` · `/api/slip-image` · `/api/rooms` · `/api/run`) จึงต้องเสิร์ฟจาก origin เดียวกับ API

สิ่งที่รันได้ในเครื่องตอนนี้มีอย่างเดียวคือ smoke test แบบ offline และ "คำขอแรกที่สำเร็จ" ของคุณจะเกิดบน **deployment บน Vercel** ไม่ใช่บน localhost

## 1. สิ่งที่ต้องมี

| สิ่งที่ต้องมี | ทำไม | ตรวจจาก |
|---|---|---|
| Node.js **>= 20** | `package.json` → `engines.node` | `node -v` |
| npm (มากับ Node) | ติดตั้ง dependency ตัวเดียว `@vercel/blob@^2.9.0` | `npm -v` |
| บัญชี LINE (ฟรี) + เบอร์ที่ผูก LINE | สร้าง Messaging API channel (webhook) และ LINE Login channel (LIFF) | — |
| บัญชี Vercel + Vercel Blob store | ทุก endpoint ที่อ่าน/เขียนข้อมูลต้องใช้ Blob | — |

รายละเอียดการสร้าง LINE OA / Messaging API channel / LIFF อยู่ใน [`../README.md`](../README.md) ข้อ 2 และข้อ 6 — **ไม่ทำซ้ำที่นี่** ถ้ายังไม่มี channel ให้เปิด README คู่กันไปเลย

**ไม่ต้องมีบัญชี Google** — เรพนี้ไม่ใช้ Google service ใด ๆ นอกจาก `<link>` ไป Google Fonts ใน `liff/bill.html` บรรทัด 7 (เป็น public stylesheet ไม่ต้องล็อกอิน) และไม่มี env/dependency เกี่ยวกับ Google ในโค้ด

## 2. ติดตั้งในเครื่อง (2 นาที)

```bash
git clone <repo-url>
cd line-app
npm install
```

<!-- VERIFY: ไม่มี git remote หรือ .git ในเครื่องนี้ (git rev-parse ตอบ "not a git repository") จึงยืนยัน URL ของเรพต้นทางไม่ได้ — เอา URL จากที่ทีมให้มา -->

ผลที่ควรได้จาก `npm install`: โฟลเดอร์ `node_modules/@vercel/blob` เวอร์ชัน `2.9.0` ไม่มีขั้นตอน build ใด ๆ

## 3. ตรวจว่าเครื่องพร้อม — smoke test

```bash
node smoke.js
```

ผลที่ต้องเห็น (ยืนยันแล้วบน Node v26.13.0 ในเครื่องผู้เขียน):

```
smoke OK — signature + flex card + confirm card
```

`smoke.js` ไม่ต้องใช้ network, ไม่ต้องใช้ Blob, และ **ไม่ต้อง `npm install` ก็รันได้** เพราะ dependency chain ของมันคือ `smoke.js` → `api/_line.js` ซึ่งใช้แค่ `crypto` ของ Node (ดู `api/_line.js` บรรทัด 2) — มันตั้ง `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` ปลอมเองในโปรเซสที่บรรทัด 2–3 ก่อน `require`

ถ้าแก้โค้ดใน `api/_line.js` หรือ `api/_rooms.js` ให้รันคำสั่งนี้ก่อน deploy เสมอ (เป็นข้อกำหนดใน [`../HANDOFF.md`](../HANDOFF.md) ข้อ 8)

## 4. Deploy แล้วขอ "คำขอแรกที่สำเร็จ"

ลำดับคำสั่ง deploy ที่ README ข้อ 3 ใช้ (ของจริงคือ `vercel` ไม่ใช่ `vercel link` — เพิ่มลิงก์โปรเจกต์ตรงนี้เพื่อให้เห็นว่า "คำขอแรก" อยู่ตรงไหน):

```bash
npm i -g vercel
vercel link          # ไม่มีใน README: เรพไม่มี .vercel ติดมา (.gitignore มีบรรทัดเดียวคือ .vercel)
vercel --prod
```

<!-- VERIFY: `vercel link` / `vercel --prod` เป็นคำสั่งของ Vercel CLI ไม่ได้อยู่ใน package.json — ยืนยันได้แค่ว่าเครื่องผู้เขียนมี CLI ติดตั้งอยู่ (`vercel.ps1`) ส่วนสิทธิ์เข้าถึงโปรเจกต์ `line-app` (org `team_YuAS04XM20SBQpjH6iJw5Mrk` ตาม `.vercel/project.json`) ขึ้นกับบัญชีของคุณ -->

**คำขอแรกที่ไม่ต้องใช้ credential ใด ๆ** — `api/config.js` เปิดสาธารณะและคืนค่า env ตรง ๆ:

```bash
curl.exe -s https://<โดเมนของคุณ>/api/config
```

ได้ `{"liffId":null}` = deploy สำเร็จและ function รันได้ (ยังไม่ต้องมี env, ยังไม่ต้องมี Blob) นี่คือจุดที่ควรไปให้ถึงก่อนอย่างอื่น

จากนั้นสร้าง Blob store แล้วใส่ env ตาม [`../README.md`](../README.md) ข้อ 3–4 และ [`CONFIGURATION.md`](./CONFIGURATION.md) ข้อ 1 (**ใส่ทั้ง Production และ Preview แล้ว Redeploy** — โค้ดอ่าน env ตอน module load)

```bash
vercel storage create domplus-bills --type blob --access private --region sin1
vercel storage connect domplus-bills --yes
```

<!-- VERIFY: สองคำสั่ง `vercel storage ...` มาจาก README ข้อ 3 ไม่ได้ยืนยันกับ Vercel CLI จริง และยังไม่ยืนยันว่า `vercel storage connect` ใส่ `BLOB_STORE_ID` ให้อัตโนมัติ — เช็กที่ Project → Settings → Environment Variables -->

**คำขอที่สอง — ต้องมี env + Blob แล้ว** (ใช้ dev bypass `x-seed-token` แทน idToken):

```bash
curl.exe -s -H "x-seed-token: <SEED_TOKEN>" https://<โดเมนของคุณ>/api/me
```

ควรได้ `{"userId":"<OWNER_USER_ID หรือ dev>","owner":true,"room":null}` ถ้าได้ `401` = ยังไม่ได้ Redeploy หลังใส่ `SEED_TOKEN`, ถ้าได้ `500` = Blob ยังไม่เชื่อม

**คำขอที่สาม — เขียนข้อมูลจริงลง Blob:**

```bash
curl.exe -s -X POST "https://<โดเมนของคุณ>/api/seed?token=<SEED_TOKEN>"
curl.exe -s -H "x-seed-token: <SEED_TOKEN>" "https://<โดเมนของคุณ>/api/bill?room=203"
```

`/api/seed` สร้างบิลห้อง 201–212 (idempotent) และ `/api/bill?room=203` ควรคืนบิล `status: "unpaid"` — ถึงตรงนี้คือ "clone → คำขอที่สำเร็จ" ครบวงแล้ว

## 5. อะไรทดสอบได้ในเครื่อง vs ต้อง deploy

| สิ่งที่อยากทดสอบ | ในเครื่อง | ต้อง deploy | เหตุผลจากโค้ด |
|---|---|---|---|
| signature + รูปการ์ด Flex | ✅ `node smoke.js` | — | ไม่ต่อเน็ต ใช้ `crypto` + `assert` |
| `api/config.js` logic | อ่านโค้ดได้ | ✅ | ต้องมี HTTP layer ที่แมป `/api/config` |
| endpoint ใด ๆ ใน `api/` (ยกเว้น config) | ❌ | ✅ | ไม่มี HTTP server ในเรพ; handler เป็น `(req,res)` ต้องมีคนเรียก |
| อ่าน/เขียนข้อมูล (`_store.js`) | ❌ | ✅ | `@vercel/blob` ต้องมี `BLOB_READ_WRITE_TOKEN` **หรือ** `VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID` (ข้อความ error ใน `node_modules/@vercel/blob/dist/chunk-*.js` บรรทัด 184–204) — ในเครื่องไม่มีทั้งสองอย่าง |
| `liff/bill.html` | ❌ | ✅ | เรียก `/api/*` แบบ path สัมพัทธ์ + `liff.init()` ต้องมี `LIFF_ID` ที่ตั้งบน Vercel |
| ส่งข้อความ/การ์ดเข้า LINE จริง | ❌ | ✅ | ต้องมี access token จริง และ LINE ต้องเรียก webhook จาก HTTPS สาธารณะ |
| Webhook Verify ใน LINE Developers | ❌ | ✅ | LINE ต้องยิง `POST /api/webhook` จากอินเทอร์เน็ต |
| `vercel dev` (ถ้าอยากลอง) | ? | — | ไม่มี script/config ในเรพ และยังไม่ยืนยันว่า `vercel dev` ฉีด Blob credential ให้เครื่องได้ |

<!-- VERIFY: `vercel dev` ใช้ได้กับโปรเจกต์นี้แค่ไหน (โดยเฉพาะ Blob OIDC) — ไม่มีไฟล์ใดในเรพยืนยัน ลองแล้วบันทึกผลได้เลย -->
<!-- VERIFY: production URL ที่ทีมใช้อยู่ (`https://line-app-iota.vercel.app` ตาม HANDOFF.md บรรทัด 4) ไม่ได้ยืนยันจาก Vercel -->

**สรุปสั้น:** ในเครื่องทดสอบได้แค่ "ตรรกะที่ไม่มี I/O" (signature, รูปการ์ด) ทุกอย่างที่แตะ Blob, LINE, LIFF ต้องมี deployment

## 6. Checklist 5 นาทีแรก

- [ ] `node -v` → ต้อง `>= 20`
- [ ] `npm install` → มี `node_modules/@vercel/blob` (2.9.0)
- [ ] `node smoke.js` → เห็น `smoke OK — signature + flex card + confirm card`
- [ ] อ่าน [`CONFIGURATION.md`](./CONFIGURATION.md) ข้อ 1 ให้ครบ 13 ตัวแปร — ตัวที่ขาดแล้วพังทันทีคือ `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `LIFF_ID`, `OWNER_USER_ID`
- [ ] มี Messaging API channel (secret + long-lived token) และ LINE Login channel สำหรับ LIFF (README ข้อ 2, 6)
- [ ] `vercel --prod` แล้ว `curl.exe -s https://<โดเมน>/api/config` ตอบ `200`
- [ ] ใส่ env + Blob แล้ว Redeploy แล้ว `curl.exe -s -H "x-seed-token: <SEED_TOKEN>" https://<โดเมน>/api/me` ตอบ `200`
- [ ] `POST /api/seed?token=<SEED_TOKEN>` แล้ว `GET /api/bill?room=203` เห็นบิล

## 7. ปัญหาที่เจอบ่อยตอนsetup

| อาการ | สาเหตุ | ทางแก้ |
|---|---|---|
| หา `npm run dev` / `npm start` ไม่เจอ | `package.json` ไม่มี `scripts` | ไม่มีจริง — ใช้ deploy + `curl` ตามข้อ 4 |
| `node smoke.js` ขึ้น `Cannot find module '...smoke.js'` | รันจากโฟลเดอร์อื่น (path ของ smoke.js ผิด) | `cd` ไปที่ root ของ `line-app` ก่อน — ตัว `require("./api/_line")` ข้างในอ้างจากตำแหน่งไฟล์ ไม่ใช่ cwd |
| ใส่ค่าใน `.env` แล้วค่าไม่ติด | ไม่มี dotenv ใน dependency | ต้องตั้ง env บน Vercel (หรือ `$env:X="..."` ใน PowerShell ก่อนรัน) |
| เรียก API แล้วได้ `500` | Blob ยังไม่เชื่อม / ยังไม่ Redeploy | `vercel storage connect ...` แล้ว Redeploy |
| รันโค้ด Blob ในเครื่องแล้วขึ้น `No blob credentials found` | ไม่มี `BLOB_READ_WRITE_TOKEN` และไม่มี OIDC | ทดสอบบน deployment แทน |
| `401 bad signature` จาก webhook | secret ผิด/มีช่องว่างตอนคัดลอก | คัดลอก `LINE_CHANNEL_SECRET` ใหม่ แล้ว Redeploy |
| หน้า `/` เปิดแล้วขึ้น "เปิดหน้านี้จากปุ่มในแชท LINE เท่านั้น" | `LIFF_ID` ยังว่าง (`/api/config` คืน `null`) | ใส่ `LIFF_ID` แล้ว Redeploy (หรือยอมใช้โหมดเปิดในเบราว์เซอร์) |
| แก้ env แล้วค่าไม่เปลี่ยน | โค้ดอ่าน env ตอน module load | Redeploy ทุกครั้งหลังแก้ env |

## 8. ขั้นต่อไป

| เอกสาร | อ่านเมื่อ |
|---|---|
| [`../README.md`](../README.md) | ต้องการขั้นตอน LINE OA / LIFF / ทดสอบวงจรในแชทแบบละเอียด |
| [`CONFIGURATION.md`](./CONFIGURATION.md) | ต้องรู้ว่า env ตัวไหนจำเป็น มี default อะไร |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | อยากเข้าใจว่า request วิ่งผ่านไฟล์ไหน |
| [`API.md`](./API.md) | ต้องยิง endpoint เองหรือดู auth/error |
| [`../HANDOFF.md`](../HANDOFF.md) | จะแก้โค้ดต่อ — มีกับดักที่เจอมาแล้วและงานที่ยังเหลือ |

> [`DEVELOPMENT.md`](./DEVELOPMENT.md) และ [`TESTING.md`](./TESTING.md) มีอยู่ใน `docs/` แล้ว — DEVELOPMENT อธิบาย convention ของ handler/module, TESTING อธิบายว่า `smoke.js` ครอบอะไรและแมตริกซ์ที่ต้องทดสอบมือ

<!-- VERIFY: README.md ข้อ "เอกสารเชิงลึก" ลิงก์ docs/*.md ทั้ง 6 ไฟล์ — ตรวจแล้วว่ามีอยู่จริงในโฟลเดอร์ docs/ ของ repo ณ ตอนสร้างเอกสารชุดนี้ -->
