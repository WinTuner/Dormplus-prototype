<!-- generated-by: gsd-doc-writer -->

# การ deploy (DEPLOYMENT)

เอกสารนี้เขียนจากไฟล์จริงในเรพ: `vercel.json`, `package.json`, `.vercel/project.json`, `api/*.js`, `liff/bill.html` และข้อความ error ที่โค้ดส่งออกจริง ทุกอย่างที่ยืนยันจากเรพไม่ได้จะถูกกำกับด้วย `<!-- VERIFY: ... -->`

**สรุปสั้น:** โปรเจกต์ `line-app` ผูกกับ GitHub repo `WinTuner/domplus-prototype` แล้ว — **push เข้า `master` = deploy production อัตโนมัติ** (Root Directory = `line-app`, Branch Tracking = `master`) · deploy ด้วย CLI (`vercel --prod`) ก็ยังใช้ได้เมื่อไม่ได้มาจาก git

---

## 1. ปลายทางการ deploy

มีปลายทางเดียวคือ **Vercel** เพราะทั้งระบบถูกออกแบบเป็น static file + serverless function ของ Vercel

| ไฟล์ / โฟลเดอร์ | บทบาทตอน deploy |
|---|---|
| `vercel.json` | rewrite เดียว: `/` → `/liff/bill.html` (ไม่มี `builds`, `functions`, `headers`, `crons`) |
| `api/*.js` | Vercel เปิดเป็น serverless function ตามชื่อไฟล์ (เช่น `api/bill.js` → `/api/bill`) |
| `api/_auth.js`, `api/_line.js`, `api/_rooms.js`, `api/_store.js` | helper ที่ขึ้นต้นด้วย `_` — ไม่ได้ถูกเรียกเป็น endpoint ตรง ๆ (endpoint จริงมี 10 ตัวตามตารางใน `README.md`) |
| `liff/bill.html` | หน้า static ไฟล์เดียว เข้าที่ `/liff/bill.html` |
| `.vercel/project.json` | ผูกโฟลเดอร์นี้กับโปรเจกต์ Vercel ที่มีอยู่แล้ว (`projectName: line-app`) — ไม่ได้อยู่ใน git (`.gitignore` มีบรรทัดเดียวคือ `.vercel`) |
| `package.json` | `"engines": { "node": ">=20" }`, dependency ตัวเดียว `@vercel/blob ^2.9.0`, **ไม่มี `scripts` เลย** |

**ไม่มีในเรพ (ตั้งใจไม่เดา):**
- ไม่มี `Dockerfile`, `docker-compose.yml`, `fly.toml`, `netlify.toml`, `serverless.yml`
- ไม่มี `.github/workflows/` ในโฟลเดอร์นี้ — CI อยู่ที่ root ของ repo (`.github/workflows/ci.yml`, job `backend`) และไม่ครอบ `line-app/` · การ deploy มาจาก Git integration ของ Vercel หรือ CLI
- ไม่มี `.env`, `.env.example`, `.env.production`, `.env.preview` → env ทั้งหมดถูกตั้งใน Vercel เท่านั้น (ดู `docs/CONFIGURATION.md` ข้อ 4)
- ไม่มีสคริปต์ build → Vercel ไม่รัน build ใด ๆ

โฟลเดอร์นี้ **ไม่ใช่ git repo ของตัวเอง** — เป็นโฟลเดอร์ย่อยใน `domplus-prototype` · `.vercel/` ยังใช้ผูกกับโปรเจกต์เมื่อสั่ง CLI และถูก gitignore ไว้

<!-- VERIFY: plan/region/โดเมนของโปรเจกต์บน Vercel ยืนยันจากเรพไม่ได้ -->

---

## 2. สิ่งที่ต้องมีก่อน deploy

| ต้องมี | ที่มา | ถ้าไม่มี |
|---|---|---|
| Node.js `>=20` | `package.json` `engines` | ติดตั้ง dependency / รัน `node smoke.js` ไม่ผ่าน |
| Vercel CLI | `npm i -g vercel` | ไม่มีคำสั่ง `vercel` ให้ใช้ |
| บัญชี Vercel ที่เข้าถึงโปรเจกต์ `line-app` | `.vercel/project.json` (`orgId: team_YuAS04...`) | `vercel --prod` จะถามให้ link โปรเจกต์ใหม่ |
| Vercel Blob store (private) | ต้องสร้าง + connect (ข้อ 4) | ทุก endpoint ที่อ่าน state ตอบ 500 |
| ค่า LINE 4 ตัว | LINE Developers Console (ข้อ 6) | ระบบรันได้แต่ไม่มีอะไรทำงาน |

> **ไม่มีขั้นตอน `npm run build` และไม่มี `npm test`** — `package.json` ไม่มี `scripts` เลย คำสั่งเดียวที่รันในเครื่องได้คือ `node smoke.js` (offline ไม่ต่อเน็ต)

---

## 3. คำสั่ง deploy

### 3.1 Deploy ครั้งแรก (ผูกโปรเจกต์)

```bash
# ในโฟลเดอร์ line-app
npm i -g vercel     # ครั้งแรกครั้งเดียว
vercel              # ถามล็อกอิน + ยืนยันโปรเจกต์ (สร้าง Preview deployment)
vercel --prod       # ขึ้น production
```

จดโดเมนที่ได้ (รูปแบบ `https://<project>.vercel.app`) ไว้ใช้เป็น `PUBLIC_BASE_URL` และเป็น base ของ webhook/LIFF

### 3.2 Deploy ครั้งถัดไป

```bash
vercel --prod
```

### 3.3 Preview deployment (ทดสอบก่อนขึ้นจริง)

```bash
vercel              # ไม่ใส่ --prod = Preview
```

> ⚠️ Preview ได้โดเมนคนละอัน และ**ไม่มี `NODE_ENV` ในโค้ดเลย** — โค้ดทำงานเหมือน production ทุกอย่าง ถ้า Preview ต่อ Blob store เดียวกัน มันจะเขียนทับ `kv/bill-*.json` ของ production จริง ให้ทดสอบ Preview ด้วยห้องที่ไม่มีคนอยู่ หรือไม่ต้องใช้ Preview เลย
>
> <!-- VERIFY: Preview deployment ของโปรเจกต์นี้ใช้ Blob store/env ชุดเดียวกับ Production หรือแยก — ไม่มีไฟล์ในเรพยืนยัน ต้องดูที่ Project → Settings → Environment Variables -->

### 3.4 ก่อนกด deploy ทุกครั้ง

```bash
node smoke.js
```

ต้องได้บรรทัดนี้ ถ้าไม่ผ่าน **อย่า deploy**:

```
smoke OK — signature + flex card + confirm card
```

---

## 4. Blob store และ environment variables

### 4.1 สร้าง + เชื่อม Blob store

```bash
vercel storage create domplus-bills --type blob --access private --region sin1
vercel storage connect domplus-bills --yes
```

`connect` จะใส่ `BLOB_STORE_ID` ให้โปรเจกต์เอง — โค้ดไม่ต้องมี token เพราะทุก call ใช้ `access: "private"` + OIDC (`api/_store.js`, `api/slip.js`, `api/slip-image.js`)

<!-- VERIFY: ชื่อคำสั่ง/แฟล็ก `vercel storage create ... --type blob --access private --region sin1` มาจาก README ของทีม ยังไม่ได้รันยืนยันกับ Vercel CLI เวอร์ชันที่ติดตั้ง — ชื่อ subcommand อาจต่างกันตามเวอร์ชัน ให้เช็ก `vercel storage --help` ก่อน -->
<!-- VERIFY: `vercel storage connect` เป็นตัวใส่ `BLOB_STORE_ID` จริงหรือไม่ — ไม่มีไฟล์ในเรพยืนยัน ให้ดูที่ Project → Settings → Environment Variables ว่ามีค่าหรือยัง -->
<!-- VERIFY: region `sin1` (สิงคโปร์) เป็นค่าที่ตั้งจริงบน store หรือเป็นแค่ตัวอย่างใน README -->

### 4.2 ตัวแปรที่ต้องตั้งเอง (แยกตาม environment)

ตั้งที่ **Vercel → Project → Settings → Environment Variables** แล้วเลือก environment ต่อตัว (ติ๊กได้ทั้ง Production และ Preview)

| Variable | Production | Preview | ค่า / ที่มา | ถ้าไม่ตั้ง |
|---|---|---|---|---|
| `LINE_CHANNEL_SECRET` | ✅ ต้องมี | ✅ ใส่ชุดเดียวกันได้ | Basic settings ของ Messaging API channel | webhook ตอบ `401 {"error":"bad signature"}` ทุกครั้ง (Verify ใน Console ไม่ผ่าน) |
| `LINE_CHANNEL_ACCESS_TOKEN` | ✅ ต้องมี | ✅ ใส่ชุดเดียวกันได้ | Messaging API → Issue (long-lived) | บอทไม่ตอบ/ไม่ส่งการ์ด แต่ endpoint ยังคืน 200 (error ถูกกลืนไปที่ `console.error`) |
| `LIFF_ID` | ✅ ต้องมี | ⚠️ ควรแยกถ้ามี LIFF คนละตัว | เช่น `2012575885-l35sh1N4` | `/api/config` → `{"liffId":null}` → หน้าเว็บขึ้น "เปิดหน้านี้จากปุ่มในแชท LINE เท่านั้น (LIFF)" และปุ่มในการ์ดเปิดเป็น URL ตรงแทน `liff.line.me` |
| `OWNER_USER_ID` | ✅ ต้องมี | ⚠️ ควรเป็น userId ของคนทดสอบ | LINE userId ของเจ้าของหอ | ไม่มีใครเป็น owner → `/api/rooms`, `/api/run` ตอบ `403 เฉพาะเจ้าของหอ`, ไม่มีการ์ด "ยืนยันการชำระ" |
| `SEED_TOKEN` | ⚠️ ตั้งแล้ว**ปิดก่อนใช้หอจริง** | ✅ ใช้ได้ | สุ่มเอง | `/api/seed`, `/api/sendbill` ตอบ `403 ต้องมี token` และ bypass `x-seed-token` ถูกปิด (ปลอดภัยกว่า) |
| `PUBLIC_BASE_URL` | แนะนำ | **ปล่อยว่าง** | `https://<โดเมน production>` | fallback เป็น `https://${req.headers.host}` ซึ่งถูกต้องตาม deployment นั้น — แต่ถ้าตั้งเป็นโดเมน production ใน Preview การ์ดจาก Preview จะลิงก์ไป production |
| `ROOMS` | ถ้าหอไม่ใช่ 201–212 | เหมือนกัน | `101,102,103` | default `201…212` (12 ห้อง) |
| `DEFAULT_RENT` / `WATER_RATE` / `ELEC_RATE` | ตามจริง | เหมือนกัน | 3500 / 25 / 7 | ใช้ค่า default ในโค้ด |
| `BILL_PERIOD` / `BILL_DUE` | ตามรอบจริง | เหมือนกัน | `2026-11` / `2026-11-16` | `/api/run` ต้องส่ง `period` มาใน body ไม่งั้น `400`; บิลมี `due: null` |
| `LOGIN_CHANNEL_ID` | ปกติไม่ต้องตั้ง | — | อนุมานจากส่วนหน้าของ `LIFF_ID` | ใช้ค่า derive จาก `LIFF_ID` |

### 4.3 ตัวแปรที่ Vercel/Blob ฉีดให้เอง (ห้ามตั้งมือ)

| Variable | ใครอ่าน | หมายเหตุ |
|---|---|---|
| `BLOB_STORE_ID` | `@vercel/blob` | ได้จาก `storage connect` |
| `VERCEL_OIDC_TOKEN` | `@vercel/blob` | Vercel ฉีดตอน runtime ของ deployment |

`BLOB_READ_WRITE_TOKEN` **ไม่ถูกใช้**ในโปรเจกต์นี้ — อย่าไปใส่ให้สับสน

<!-- VERIFY: Vercel ฉีด `VERCEL_OIDC_TOKEN` ให้ทุก deployment รวม Preview หรือไม่ — ไม่มีไฟล์ในเรพยืนยัน -->

### 4.4 แก้ env แล้วต้อง Redeploy เสมอ

`api/_line.js` (บรรทัด 4–6), `api/_rooms.js` (บรรทัด 4–13) และ `api/_auth.js` (บรรทัด 2) อ่าน `process.env` **ตอน module load** ใส่ `const` ระดับบนสุด — instance ที่ warm อยู่จะยังใช้ค่าเก่า

```bash
vercel --prod          # หรือ Vercel → Deployments → ⋯ → Redeploy
```

อาการที่เจอถ้าลืม: ใส่ `LINE_CHANNEL_SECRET` แล้วแต่ Verify ยังไม่ผ่าน / ใส่ `LIFF_ID` แล้ว `/api/config` ยังตอบ `null`

---

## 5. ลำดับ smoke หลัง deploy (ทำตามลำดับ ห้ามข้าม)

ใช้ PowerShell บน Windows (ต้องเรียก `curl.exe` ไม่ใช่ `curl` ซึ่งเป็น alias ของ `Invoke-WebRequest`)

```powershell
$B = "https://<โดเมนของคุณ>"
$T = "<SEED_TOKEN>"
```

| # | คำสั่ง | คำตอบที่ดี | ถ้าไม่ใช่ |
|---|---|---|---|
| 1 | `curl.exe -s "$B/api/config"` | `{"liffId":"<LIFF_ID>"}` | `{"liffId":null}` → ยังไม่ตั้ง `LIFF_ID` หรือยังไม่ Redeploy |
| 2 | `curl.exe -s "$B/api/me"` | `{"error":{"code":"UNAUTHORIZED","message":"ต้องเปิดหน้านี้ผ่าน LINE"}}` | ได้ข้อมูล user กลับมา = ช่องโหว่ ตรวจ `x-seed-token` / `_auth.js` |
| 3 | `curl.exe -s -H "x-seed-token: $T" "$B/api/me"` | `{"userId":"U...","owner":true,"room":null}` | `401 UNAUTHORIZED` → `SEED_TOKEN` ไม่ตรง · `owner:false` → `OWNER_USER_ID` ผิด · `500` → Blob ยังไม่ connect |
| 4 | `curl.exe -s -X POST "$B/api/seed?token=$T"` | `{"ok":true,"period":"2026-11","rooms":["201",...,"212"]}` | `403 ต้องมี token` → `SEED_TOKEN` ไม่ตรง/ไม่มี |
| 5 | `curl.exe -s -H "x-seed-token: $T" "$B/api/bill?room=203"` | บิลเต็มก้อน `status:"unpaid"`, `hasSlip:false`, `total` เป็นตัวเลข | `404 ไม่พบบิลของห้อง 203` → ยังไม่รันข้อ 4 · `500` → Blob |
| 6 | `curl.exe -s -o NUL -w "%{http_code}" -X POST "$B/api/webhook"` | `401` | `404` = function ยังไม่ขึ้น (deploy ไม่สำเร็จ/ชื่อไฟล์ผิด) · `405` = เรียกด้วย GET · `500` = โมดูลพังตอน import |
| 7 | LINE Developers → Messaging API → **Verify** | `Success` / 200 | ดูข้อ 6.1 |
| 8 | ในแชท LINE: เพิ่มเพื่อน OA → พิมพ์ `บิล` | บอทตอบ "ยังไม่ได้ผูกห้องครับ — …" | ดูข้อ 6.2 |

**ข้อ 7–8 เป็นการทดสอบที่ขาดไม่ได้** — ข้อ 1–6 พิสูจน์แค่ฝั่ง Vercel ส่วน LINE Console เป็นคนละส่วนที่ไม่มีทางยืนยันจากเรพได้

> หมายเหตุ: ข้อ 4 (`seed`) **เขียนทับบิลทุกห้อง**ด้วยข้อมูลตัวอย่าง อย่ารันบน production ที่มีข้อมูลจริงของหอ

---

## 6. ขั้นตอนฝั่ง LINE Console (ทำนอกเรพ ทำในเบราว์เซอร์เท่านั้น)

สามข้อนี้ **ไม่มีทางทำจากโค้ด/CLI ได้** และเป็นสาเหตุอันดับหนึ่งของ "deploy ผ่านแล้วแต่ไม่ทำงาน"

### 6.1 Messaging API channel → Webhook

ที่ **LINE Developers Console → channel (Messaging API) → แท็บ Messaging API → Webhook settings**

1. Webhook URL: `https://<โดเมน>/api/webhook`
2. กด **Verify** → ต้องขึ้น Success
3. เปิดสวิตช์ **Use webhook**

| พลาดข้อไหน | อาการที่เห็น |
|---|---|
| ยังไม่ deploy ก่อนกด Verify | Verify ไม่ผ่าน (LINE เรียก URL ไม่ถึง) |
| ไม่ตั้ง `LINE_CHANNEL_SECRET` หรือค่ามีช่องว่าง/ขึ้นบรรทัดใหม่ตอนคัดลอก | Verify ไม่ผ่าน, log มี `401 {"error":"bad signature"}` |
| Verify ผ่านแต่ **ไม่เปิด "Use webhook"** | Verify ยังขึ้น Success แต่ **ไม่มี event เข้าระบบเลย** — บอทเงียบสนิท พิมพ์อะไรก็ไม่ตอบ (นี่คือกับดักที่ทีมเจอมาแล้ว: ตั้ง URL ผ่าน API ได้ แต่สวิตช์ `active` ต้องกดใน Console) |
| URL ผิด path (เช่น `/webhook` ไม่มี `/api`) | Verify ไม่ผ่าน / 404 |

### 6.2 Messaging API channel → Channel access token

ที่ **Messaging API → Channel access token (long-lived) → Issue**

| พลาด | อาการ |
|---|---|
| ไม่ออก token หรือตั้ง env ผิด/ไม่ได้ Redeploy | webhook ยังตอบ 200 (LINE ไม่รีทราย) แต่ **ผู้ใช้ไม่ได้รับข้อความ** — Vercel log มี `line message/reply 401: ...` จาก `api/_line.js` `call()` และ `api/webhook.js` เขียนว่า `event failed ...` |
| ตั้ง `OWNER_USER_ID` ผิด | การ์ด "ยืนยันการชำระ" ไม่ถึงใคร (`api/slip.js` push ไปหา userId ที่ไม่มีตัวตน → `owner push failed` ใน log) แต่ผู้เช่ายังแนบสลิปได้ปกติ |

### 6.3 LIFF app (ต้องสร้างใน **LINE Login channel** ไม่ใช่ Messaging API)

ที่ **LINE Developers → provider เดียวกัน → Create a new channel → LINE Login** → แท็บ **LIFF** → Add

1. LIFF app name: `บิลผู้เช่า`
2. Size: **Tall**
3. Endpoint URL: `https://<โดเมน>/liff/bill.html`
4. Scopes: เปิด **`openid`** (ขาดไม่ได้) + `profile`
5. Linked OA: เลือก OA ของหอ
6. Add → คัดลอก **LIFF ID** → ใส่ env `LIFF_ID` → **Redeploy**

| พลาด | อาการ |
|---|---|
| พยายามเพิ่ม LIFF ใน Messaging API channel | Console ตอบ `Channel must have any of following Application Types: WEB, NATIVE_APP, LIFF` — ต้องสร้าง LINE Login channel ก่อน |
| ไม่เปิด scope `openid` | หน้าเว็บขึ้น **"LIFF นี้ยังไม่ได้เปิด scope openid — เพิ่มใน LINE Developers → channel DormPlus LIFF → LIFF → แก้ไข → ติ๊ก openid"** (ข้อความนี้อยู่ใน `liff/bill.html` บรรทัด 64) |
| ไม่ตั้ง `LIFF_ID` | หน้าเว็บขึ้น **"เปิดหน้านี้จากปุ่มในแชท LINE เท่านั้น (LIFF)"** และ `<h1>` เป็น **"ใช้งานไม่ได้"**; ปุ่มในการ์ดเปิดเป็น `https://<โดเมน>/liff/bill.html?room=203` ในเบราว์เซอร์แทน `liff.line.me` |
| Endpoint URL ไม่ตรง (`/liff/bill.html` ไม่มี `.html`) | เปิด LIFF แล้ว 404 |
| ไม่ผูก Linked OA | เปิดจากแชท OA แล้ว LIFF ไม่รู้จักผู้ใช้ |

<!-- VERIFY: ชื่อ channel ที่แสดงในข้อความ error ("channel DormPlus LIFF") เป็นข้อความ hardcode ใน bill.html — ชื่อ channel จริงบน Console ต้องดูเอง อาจต่างจากนี้ -->
<!-- VERIFY: สถานะ Publish ของ LINE Login channel — ถ้ายังเป็น Developing มีแต่ admin/tester ของ channel ที่เปิด LIFF ได้ ผู้เช่าจริงจะเปิดไม่ได้ ต้องกด Publish ใน Console (ยืนยันจากเรพไม่ได้) -->
<!-- VERIFY: การตั้งค่า OA ฝั่งแชท (Response settings / ความเป็นเพื่อน) — โค้ด push หา userId ที่ไม่ได้เป็นเพื่อนจะถูก LINE ปฏิเสธ ต้องให้ผู้เช่าเพิ่มเพื่อน OA ก่อน (ยืนยันจากเรพไม่ได้) -->

---

## 7. Rollback

### 7.1 ย้อนโค้ด (ทำได้เร็วที่สุด)

1. Vercel → โปรเจกต์ → **Deployments**
2. หา deployment ที่ยังทำงานดีก่อนหน้า → เมนู ⋯ → **Promote to Production** / **Rollback**
3. ยืนยันว่า alias ของโดเมนชี้ไป deployment นั้นแล้ว

หรือทาง CLI:

```bash
vercel rollback
```

<!-- VERIFY: ชื่อคำสั่ง `vercel rollback` และพฤติกรรม (ย้อนแค่ alias หรือ redeploy) ขึ้นกับ Vercel CLI เวอร์ชัน — ถ้าไม่ได้ผลให้ใช้ dashboard -->

ไม่มี git repo ในเครื่องนี้ จึงไม่มี `git revert` เป็นทางเลือกในเอกสารนี้ — ทีมที่มี remote ควรย้อนที่ source แล้ว `vercel --prod` ใหม่

### 7.2 ย้อน env

แก้ค่ากลับที่ Settings → Environment Variables แล้ว **Redeploy** (ค่า env ถูกจับตอน module load — ตามข้อ 4.4)

### 7.3 ย้อนข้อมูลใน Blob — **ทำไม่ได้**

`api/_store.js` เขียนด้วย `allowOverwrite: true` และไม่มี versioning — key เดียวกันเขียนทับทันที (เช่น `kv/bill-203.json` เก็บได้แค่รอบล่าสุด) ถ้าข้อมูลเพี้ยน สิ่งที่ทำได้คือ:

- บิลผิด: เรียก `POST /api/run` ใหม่ด้วยหน่วยมิเตอร์ที่ถูกต้องของห้องนั้น (`readings: [{room, water, elec}]`)
- ข้อมูลทดสอบเพี้ยน: `POST /api/seed?token=…` (เขียนทับ **ทุกห้อง** — อย่าทำบนหอจริง)
- รูปสลิป (`slips/<room>-<ts>.<ext>`): เขียนทับไม่ได้ ส่งใหม่แล้วจะได้ไฟล์ใหม่ แต่ไฟล์เก่ายังค้างใน store

<!-- VERIFY: Vercel Blob store ของโปรเจกต์นี้เปิด versioning/snapshot ไว้หรือไม่ — ไม่มีในเรพ ถ้าเปิดไว้จะกู้ไฟล์เก่าได้จาก dashboard -->

### 7.4 ย้อนฝั่ง LINE (เมื่อ LIFF พังแต่ไม่อยากให้ผู้เช่าใช้งานไม่ได้)

ถอด `LIFF_ID` ออกแล้ว Redeploy → ปุ่มในการ์ดบิลจะ fallback เป็น `${baseUrl}/liff/bill.html?room=<room>` ซึ่งเปิดในเบราว์เซอร์ปกติและใช้งานได้ครบ (แต่การ์ด "ยืนยันการชำระ" จะไม่มีปุ่ม "ดูสลิป") นี่คือสวิตช์ถอยหลังที่ปลอดภัยที่สุดเมื่อ LIFF มีปัญหา

---

## 8. เมื่อพัง — ไล่จาก error string ที่เจอจริง

| Error ที่เห็น | มาจาก | สาเหตุที่เป็นไปได้ | ตรวจอะไร |
|---|---|---|---|
| `401 {"error":"bad signature"}` | `api/webhook.js` | `LINE_CHANNEL_SECRET` ผิด/มีช่องว่าง/ขึ้นบรรทัดใหม่ หรือยังไม่ Redeploy | เทียบค่ากับ Basic settings, ดูว่าไม่มี trailing space |
| `405 {"error":"POST only"}` | ทุก endpoint ที่รับ POST | เรียกด้วย GET (เบราว์เซอร์) | ใช้ `-X POST` |
| `400 {"error":"invalid json"}` | `api/webhook.js` | body เสีย (ปกติ LINE ไม่ส่งแบบนี้) | อย่าเทสต์ webhook ด้วย body ที่ไม่ใช่ JSON |
| `401 UNAUTHORIZED "ต้องเปิดหน้านี้ผ่าน LINE"` | `api/_auth.js` | ไม่มี `Authorization: Bearer` หรือ derive `CHANNEL_ID` ไม่ได้ (`LIFF_ID` ว่าง) | ตั้ง `LIFF_ID` หรือ `LOGIN_CHANNEL_ID` |
| `403 FORBIDDEN "idToken ไม่ถูกต้องหรือหมดอายุ"` | `api/_auth.js` | idToken หมดอายุ / `client_id` ไม่ตรงกับ LIFF | ปกติเกิดตอน LIFF อยู่คนละ provider — ตั้ง `LOGIN_CHANNEL_ID` |
| `403 FORBIDDEN "ต้องมี token"` | `api/seed.js`, `api/sendbill.js` | `?token=` ไม่ตรง `SEED_TOKEN` หรือ env ไม่มี | เรียกแบบ `?token=$T` |
| `403 FORBIDDEN "เฉพาะเจ้าของหอ"` | `api/rooms.js`, `api/run.js` | ผู้เรียกไม่ใช่ `OWNER_USER_ID` | ข้อ 5 ลำดับ 3: `owner` ต้องเป็น `true` |
| `403 FORBIDDEN "บัญชีนี้ยังไม่ได้ผูกกับห้อง 203"` | `api/bill.js`, `api/slip.js` | ผู้ใช้ยังไม่พิมพ์ `ผูก 203` ในแชท | พิมพ์ `ผูก 203` ก่อน แล้วเปิด LIFF ใหม่ |
| `404 NOT_FOUND "ไม่พบบิลของห้อง 203"` | `api/bill.js` | ยังไม่ seed / ยังไม่ออกรอบบิล | รัน `/api/seed` (ทดสอบ) หรือ `/api/run` (จริง) |
| `404 NOT_FOUND "ยังไม่มีสลิป"` / `"ไม่พบไฟล์สลิป"` | `api/slip-image.js` | บิลยังไม่ถูกแนบสลิป หรือไฟล์ใน Blob หาย | ดู `bill.slipPath` ใน `/api/bill` |
| `409 INVALID_STATE "บิลนี้ชำระแล้ว"` | `api/slip.js` | บิล `status:"paid"` แล้ว | ออกรอบใหม่ด้วย `/api/run` |
| `413 TOO_LARGE "รูปใหญ่เกิน 3MB"` | `api/slip.js` | รูปใหญ่เกิน 3MB (หน้าเว็บย่อให้เหลือ 1280px ก่อนส่ง แต่บางรูปยังเกิน) | ให้ผู้เช่าถ่ายใหม่/ลดขนาด |
| `400 VALIDATION "รูปต้องเป็น JPEG/PNG/WEBP"` | `api/slip.js` | แนบไฟล์ชนิดอื่น (เช่น HEIC) | แปลงเป็น JPEG ก่อน |
| `400 VALIDATION "ต้องระบุ period (เช่น 2026-11)"` | `api/run.js` | ไม่ส่ง `period` และไม่ได้ตั้ง `BILL_PERIOD` | ส่ง `{"period":"2026-12","readings":[…]}` |
| `400 VALIDATION "ต้องส่ง readings"` | `api/run.js` | body ไม่มี array `readings` | ต้องมี `[{room, water, elec}]` อย่างน้อย 1 แถว |
| `400 VALIDATION "ต้องระบุ room หรือผูกห้องก่อน"` | `api/bill.js` | ไม่ส่ง `?room=` และผู้ใช้ยังไม่ผูกห้อง | ส่ง `?room=203` |
| `500` ทุก endpoint ที่อ่านข้อมูล | `api/_store.js` `blobGet` | Blob ยังไม่เชื่อม / `BLOB_STORE_ID` ไม่มี / ไม่มี OIDC | รัน `vercel storage connect` แล้ว Redeploy |
| log `event failed message ...` | `api/webhook.js` | error ระหว่างจัดการ event ถูกลบกลืน (ผู้ใช้ไม่เห็นอะไร) | ดูบรรทัดถัดไปใน log ว่าเป็น `line ...` หรือ Blob |
| log `line message/push 4xx: ...` | `api/_line.js` `call()` | token ผิด/หมดอายุ, ผู้ใช้บล็อก OA, ไม่ได้เป็นเพื่อน | ออก token ใหม่ → Redeploy; ให้ผู้เช่าเพิ่มเพื่อน |
| log `bill push failed 203 ...` | `api/run.js` | การ์ดบิลส่งไม่ถึงห้องนั้น (บิลยังถูกบันทึกแล้ว) | ตรวจ `room-user:203` ว่ามี userId และเป็นเพื่อน OA |
| log `owner push failed ...` | `api/slip.js` | ส่งการ์ดหาเจ้าของไม่ได้ (สลิปยังถูกบันทึกเป็น `pending`) | ตรวจ `OWNER_USER_ID` |
| หน้าเว็บ `ใช้งานไม่ได้` + `เปิดหน้านี้จากปุ่มในแชท LINE เท่านั้น (LIFF)` | `liff/bill.html` `fail()` | เปิดในเบราว์เซอร์ตรง ๆ, `LIFF_ID` ว่าง, `liff.init()` ล้ม | เปิดผ่านปุ่มในแชท (`liff.line.me/<LIFF_ID>`) |
| หน้าเว็บ `LIFF นี้ยังไม่ได้เปิด scope openid — …` | `liff/bill.html` บรรทัด 64 | LIFF app ไม่ได้ติ๊ก `openid` | ข้อ 6.3 ข้อ 4 |
| หน้าเว็บ `ยังไม่ได้ผูกห้อง — พิมพ์ "ผูก 203" ในแชท LINE ก่อน` | `liff/bill.html` | ผู้ใช้ยังไม่ผูกห้อง | พิมพ์ `ผูก <ห้อง>` ในแชท |
| บิลที่ออกรอบใหม่ยังแสดงยอดเก่า | `api/_store.js` | ถ้าแก้โค้ดแล้วลืม `useCache: false` | ทุก `get` ต้องมี `useCache: false` (มีอยู่แล้วในโค้ดปัจจุบัน) |

---

## 9. เช็กลิสต์ก่อนให้หอจริงใช้

- [ ] เอา `x-seed-token` bypass ออกจาก `api/_auth.js` (ตอนนี้ใครถือ `SEED_TOKEN` เรียก API ได้ในนามเจ้าของ)
- [ ] เปลี่ยนหรือลบ `SEED_TOKEN` หลัง setup เสร็จ (มันติดไปใน access log เพราะส่งทาง query string)
- [ ] ตั้ง `ROOMS`, `DEFAULT_RENT`, `WATER_RATE`, `ELEC_RATE` ให้ตรงหอจริง แล้ว Redeploy
- [ ] ตั้ง `BILL_PERIOD` / `BILL_DUE` ของรอบจริง (ไม่งั้น `/api/run` ต้องส่ง `period` ทุกครั้ง และบิลจะขึ้น `due: null`)
- [ ] ตรวจว่า `OWNER_USER_ID` เป็น userId จริง (ทดสอบด้วยการ์ด "ยืนยันการชำระ" 1 ครั้ง)
- [ ] ยืนยันว่า "Use webhook" เปิดอยู่ และ Webhook event log มี event เข้าจริง (ข้อ 6.1)
- [ ] เปิด scope `openid` และ Publish LINE Login channel แล้ว (ข้อ 6.3)
- [ ] รัน `node smoke.js` + smoke ข้อ 5 ครบ 8 ขั้น บน production หลัง deploy สุดท้าย

---

## เอกสารที่เกี่ยวข้อง

| ไฟล์ | เนื้อหา |
|---|---|
| `docs/CONFIGURATION.md` | env ทุกตัว, default ในโค้ด, required vs optional |
| `docs/ARCHITECTURE.md` | โครงระบบ, data flow, module |
| `docs/API.md` | endpoint และรูปแบบ error |
| `docs/TESTING.md` | `smoke.js` และสิ่งที่ทดสอบอัตโนมัติไม่ได้ |
| `HANDOFF.md` | กับดักที่ทีมเจอมาแล้ว + งานที่ยังเหลือ |

## เปลี่ยนรูป rich menu ภายหลัง

รูปผูกกับ rich menu ตั้งแต่ตอนสร้าง — LINE **ไม่มี API ให้เปลี่ยนรูปของเมนูเดิม** (อัปโหลดซ้ำจะได้ `400 An image has already been uploaded`)
สคริปต์จึงสร้างเมนูใหม่ + ย้ายคนที่ผูกเมนูเดิมมาที่เมนูใหม่ (batch link) + คง default ถ้าเดิมเป็น default + ลบเมนูเก่า

```bash
# 1) เอารูปใหม่ไปวาง เช่น docs/richmenu-tenant.png (ต้อง 2500x1686 PNG ไม่เกิน 1MB)
# 2) อัปเดตเมนูผู้เช่า (ถ้าเมนูเดิมเป็น default ระบบย้าย default ให้)
LINE_CHANNEL_ACCESS_TOKEN=... LIFF_ID=... RICHMENU_TENANT_ID=richmenu-... \
  node scripts/set-richmenu-image.js tenant ../docs/richmenu-tenant.png

# 3) สคริปต์พิมพ์ id ใหม่ → แทน env บน Vercel
vercel env rm RICHMENU_TENANT_ID production --yes
"richmenu-xxxx" | vercel env add RICHMENU_TENANT_ID production

# 4) deploy production ใหม่ (env ถูกอ่านตอน module load)
```

ของเจ้าของใช้ `set-richmenu-image.js owner ...` + `RICHMENU_OWNER_ID` แทน

**ถ้าเลย์เอาต์ในรูปเปลี่ยน** (เช่น 2x2 → 3 ช่อง) ต้องแก้พื้นที่กดใน `scripts/_richmenu-defs.js` ด้วย ไม่งั้นปุ่มไม่ตรงกับภาพ

**สร้างใหม่ทั้งหมด** (เช่น เปลี่ยนเป็นขนาด compact 2500x843): `scripts/setup-richmenu.js` จะลบเมนูเดิมทุกอันแล้วสร้างใหม่

```bash
LINE_CHANNEL_ACCESS_TOKEN=... LIFF_ID=... node scripts/setup-richmenu.js [owner.png] [tenant.png]
```
