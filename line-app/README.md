# DormPlus — LINE prototype (ใช้ได้จริง)

เว็บแอปนี้ทำให้ LINE ของคุณส่งบิลจริง และผู้เช่าเปิดหน้า LIFF แนบสลิปได้จริง

```
LINE OA ──webhook──▶ /api/webhook ──▶ Vercel Blob (state.json ต่อ key)
   ▲                      │
   └──── push message ────┘
ผู้เช่า ──▶ /liff/bill.html ──▶ /api/bill, /api/slip
```

> **deploy อัตโนมัติ:** push เข้า `master` ของ repo `WinTuner/domplus-prototype` → Vercel deploy โปรเจกต์ `line-app` (Root Directory = `line-app`) ขึ้น production ทันที

## 1. สิ่งที่ต้องมี

- บัญชี LINE (ฟรี) และเบอร์ที่ติด LINE
- บัญชี Vercel (สำหรับ deploy) + Vercel Blob store (สร้างด้วย CLI 1 คำสั่ง)

## 2. สร้าง LINE OA + Messaging API (10 นาที)

1. ไปที่ https://developers.line.biz → ล็อกอินด้วยบัญชี LINE
2. **Create a new provider** → ตั้งชื่อ (เช่น DormPlus) → Create
3. ในหน้า provider → **Create a Messaging API channel**
   - Channel name: ชื่อหอพัก (ผู้เช่าจะเห็นชื่อนี้)
   - Category: การเงิน/อสังหาริมทรัพย์ · Subcategory: ตามจริง
   - ยอมรับข้อตกลง → Create
4. เข้า channel → แท็บ **Basic settings** → คัดลอก **Channel secret**
5. แท็บ **Messaging API** → เลื่อนลงสุด → **Channel access token (long-lived)** → กด Issue → คัดลอก
6. แท็บ **Messaging API** → **Webhook settings** → ใส่ URL `https://<โดเมนของคุณ>/api/webhook` → **Verify**
   (ต้อง deploy ก่อน ข้อ 3 — ไม่งั้น Verify ไม่ผ่าน)

> หมายเหตุ: บอทจะตอบเฉพาะเมื่อมีคนเพิ่มเพื่อน OA นี้ — เพิ่มเพื่อนด้วย QR ในแท็บ Messaging API

## 3. Deploy

```bash
cd line-app
npm i -g vercel      # ครั้งแรกครั้งเดียว
vercel               # ครั้งแรกจะถามล็อกอิน + ตั้งชื่อโปรเจกต์
vercel --prod
```

จดโดเมนที่ได้ เช่น `https://domplus-line.vercel.app`

**สร้างที่เก็บข้อมูล (Blob):**

```bash
vercel storage create domplus-bills --type blob --access private --region sin1
vercel storage connect domplus-bills --yes
```

จะได้ env `BLOB_STORE_ID` ใส่อัตโนมัติ (ใช้ OIDC ไม่ต้องมี token)

## 4. ตั้งค่า Environment Variables

Vercel → Project → Settings → Environment Variables (ใส่ทั้ง Production และ Preview)

| ชื่อ | ค่า |
|---|---|
| `LINE_CHANNEL_SECRET` | จากข้อ 2.4 |
| `LINE_CHANNEL_ACCESS_TOKEN` | จากข้อ 2.5 |
| `PUBLIC_BASE_URL` | `https://<โดเมน>` |
| `SEED_TOKEN` | สุ่มเอง เช่น `domplus-demo-2026` (ใช้เรียก endpoint ตั้งข้อมูล) |
| `BILL_PERIOD` | `2026-11` (ไม่ใส่ก็ได้) |
| `BILL_DUE` | `2026-11-16` (ไม่ใส่ก็ได้) |
| `LIFF_ID` | ใส่ทีหลังในข้อ 6 |
| `OWNER_USER_ID` | userId ของเจ้าของหอ — ใช้รับการ์ด "ยืนยันการชำระ" เมื่อผู้เช่าแนบสลิป (หาได้จาก webhook log ตอนพิมพ์อะไรในแชท) |

หลังใส่ env แล้ว **Redeploy** 1 ครั้ง (Deployments → ⋯ → Redeploy)

## 5. ใส่ข้อมูลทดสอบ + ยิงบิล

```bash
# สร้างบิลห้อง 201–212
curl -X POST "https://<โดเมน>/api/seed?token=<SEED_TOKEN>"

# ดูบิลห้อง 203 (เปิดในเบราว์เซอร์ได้)
https://<โดเมน>/api/bill?room=203
```

**หา userId ของตัวเอง:** เพิ่มเพื่อน OA → พิมพ์อะไรก็ได้ในแชท → ดู log ที่ Vercel → Deployments → Functions → `api/webhook`
หรือใช้ LINE Developers Console → Messaging API → **Webhook event log** (เห็น `userId`)

```bash
curl -X POST "https://<โดเมน>/api/sendbill?token=<SEED_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"to\":\"Uxxxxxxxx\",\"room\":\"203\"}"
```

จะได้รับ **การ์ดบิล** ในแชท กดปุ่ม → เปิดหน้า LIFF

## 6. สร้าง LIFF

> **สำคัญ:** LIFF เพิ่มใน Messaging API channel ไม่ได้ (API ตอบ `Channel must have any of following Application Types: WEB...`) — ต้องสร้าง **LINE Login channel** ใน provider เดียวกันก่อน (Developers Console → Create a new channel → **LINE Login** → App type: Web app)
>
> ยังไม่ทำก็ได้ — ปุ่มในการ์ดจะเปิดหน้าเว็บในเบราว์เซอร์ปกติ ซึ่งใช้งานได้ครบเหมือนกัน

1. LINE Developers → channel **LINE Login** → แท็บ **LIFF** → **Add**
2. LIFF app name: `บิลผู้เช่า`
3. Size: **Tall** · Endpoint URL: `https://<โดเมน>/liff/bill.html`
4. Scope: เปิด **`openid` + `profile`** · **Linked OA**: เลือก OA ของคุณ
   (`openid` ขาดไม่ได้ — หน้าเว็บใช้ `liff.getIDToken()` ตรวจสิทธิ์)
5. กด Add → คัดลอก **LIFF ID** (รูปแบบ `1234567890-AbCdEfGh`)
6. เอาไปใส่ env `LIFF_ID` → Redeploy

หลังใส่แล้ว ปุ่มในการ์ดบิลจะเปิดเป็น `https://liff.line.me/<LIFF_ID>?room=203` (เปิดในแอป LINE)

## 7. ทดสอบทั้งวงจร

1. เพิ่มเพื่อน OA → บอททัก "สวัสดีครับ"
2. พิมพ์ `ผูก 203` → บอทตอบ "ผูกกับห้อง 203 แล้ว"
3. พิมพ์ `บิล` → ได้การ์ดบิล 3,842 บาท (แล้วแต่ข้อมูล seed)
4. กดปุ่ม **ดูบิล / แนบสลิป** → เปิด LIFF → กด **แนบสลิป & แจ้งชำระ**
5. `/api/bill?room=203` → `status: "pending"`
6. **เจ้าของหอ** (userId ใน `OWNER_USER_ID`) ได้การ์ด "ห้อง 203 แจ้งชำระ" → กด **ยืนยันการชำระ**
7. `/api/bill?room=203` → `status: "paid"` และผู้เช่าได้ข้อความแจ้งว่าชำระแล้ว

## API ที่มี

| Method | Path | ใช้ทำอะไร |
|---|---|---|
| POST | `/api/webhook` | รับ event จาก LINE (ตรวจ signature) |
| GET | `/api/config` | LIFF ID ให้หน้าเว็บ init (public) |
| GET | `/api/me` | userId / ห้องที่ผูก / เป็นเจ้าของไหม |
| GET | `/api/bill?room=203` | ดึงบิล (ต้องมี idToken; ผู้เช่าเห็นเฉพาะห้องตัวเอง) |
| POST | `/api/slip` | แนบสลิป (รูปได้) → `pending` + push การ์ดหาเจ้าของ |
| GET | `/api/slip-image?room=203` | ดูรูปสลิป (เฉพาะเจ้าของ/ผู้เช่าห้องนั้น) |
| GET | `/api/rooms` | ทุกห้อง + มิเตอร์ล่าสุด (เจ้าของเท่านั้น) |
| POST | `/api/run` | ออกรอบบิลจากหน่วยมิเตอร์ + ส่งการ์ด (เจ้าของเท่านั้น) |
| POST | `/api/seed?token=` | สร้างบิลทดสอบทุกห้อง |
| POST | `/api/sendbill?token=` | ยิงการ์ดบิลให้ userId หนึ่งคน |

## ข้อจำกัดของ prototype นี้

- **auth เป็นแบบ prototype** — ตรวจ LIFF idToken จริง · bypass `x-seed-token` **ปิดอยู่โดยค่าเริ่มต้น** เปิดเฉพาะเมื่อ `ALLOW_SEED_BYPASS=true` หรือรันบน Vercel env `preview`/`development` (production ไม่มีทางเปิด)
- **ไม่มีหน้าจอสรุปยอด/ทวงหนี้** — เจ้าของจดมิเตอร์ + ดูสลิป + ยืนยันได้ แต่ยังไม่มี dashboard สรุป
- **บิลถูกทับทุกรอบ** — `bill:<room>` เก็บรอบล่าสุดเท่านั้น ยังไม่มีประวัติ
- **1 deploy = 1 หอ** — `OWNER_USER_ID` คนเดียว, รายชื่อห้องมาจาก env `ROOMS`
- ข้อมูลอยู่ใน Vercel Blob แบบ key-value ไม่ใช่ Postgres (backend จริงอยู่ใน `pakdee-prototype/backend/`)

## ดูรายละเอียดสำหรับทีมที่รับช่วงต่อ

อ่าน [`HANDOFF.md`](./HANDOFF.md) — แผนผัง, env ทั้งหมด, โครงข้อมูลใน Blob, กับดักที่เจอมาแล้ว, งานที่ยังเหลือ

## ถ้าติดปัญหา

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| Webhook Verify ไม่ผ่าน | ยังไม่ Redeploy หลังใส่ `LINE_CHANNEL_SECRET` |
| บอทไม่ตอบ | ยังไม่ได้เพิ่มเพื่อน OA / ไม่ได้เปิด "Use webhook" ใน Messaging API |
| 401 bad signature | secret ผิด หรือมีช่องว่าง/ขึ้นบรรทัดใหม่ตอนคัดลอก |
| `/api/bill` ตอบ 500 | ยังไม่ได้เชื่อม Blob store (`vercel storage connect ...`) หรือยังไม่ Redeploy |
| กดปุ่มแล้วเปิดในเบราว์เซอร์ ไม่ใช่ใน LINE | ยังไม่ใส่ `LIFF_ID` |

## ภาพรวมการทำงาน

แอปนี้ไม่มีขั้นตอน build — ทั้งระบบคือหน้า static 1 หน้า (`liff/bill.html`) กับ serverless function ใน `api/` ที่รันบน Vercel และไม่มีฐานข้อมูล: สถานะทุกอย่างเก็บเป็นไฟล์ JSON หนึ่งไฟล์ต่อหนึ่ง key ใน Vercel Blob (`kv/*.json`) ส่วนรูปสลิปแยกไปที่ `slips/*` แบบ private

วงจรฝั่งแชท: LINE ส่ง event → `/api/webhook` ตรวจ `x-line-signature` (HMAC-SHA256 ของ raw body) → อ่าน/เขียน Blob → ตอบด้วย reply หรือ push การ์ด Flex
วงจรฝั่งผู้เช่า: เปิด `/liff/bill.html` → `liff.init()` → เอา `liff.getIDToken()` แนบเป็น `Authorization: Bearer …` ทุก request → API เอาไปตรวจกับ `https://api.line.me/oauth2/v2.1/verify` แล้วได้ LINE userId กลับมา

สถานะบิล: `unpaid` → `pending` (แนบสลิปแล้ว) → `paid` (เจ้าของกดยืนยัน)

> รัน/ทดสอบในเครื่องต้องใช้ **Node.js >= 20** (ตาม `engines` ใน `package.json`) — dependency มีตัวเดียวคือ `@vercel/blob`

## โครงไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `api/webhook.js` | รับ event จาก LINE: `follow`, ข้อความ (`บิล`, `ผูก 203`), postback ยืนยันการชำระ (เฉพาะ `OWNER_USER_ID`) |
| `api/_line.js` | ตรวจ signature, `reply()` / `push()`, `billBubble()` (การ์ดบิล), `confirmBubble()` (การ์ดเจ้าของ) |
| `api/_auth.js` | ตรวจ LIFF idToken → userId, `isOwner()`, bypass `x-seed-token` (เฉพาะ preview/dev หรือ `ALLOW_SEED_BYPASS=true`) |
| `api/_store.js` | `get(key)` / `set(key, value)` ลง Blob |
| `api/_rooms.js` | รายชื่อห้องจาก env `ROOMS` + ค่าเช่า/ค่ามิเตอร์ต่อห้อง |
| `api/me.js`, `bill.js`, `slip.js`, `slip-image.js`, `rooms.js`, `run.js`, `seed.js`, `sendbill.js`, `config.js` | endpoints ตามตาราง "API ที่มี" ด้านบน |
| `liff/bill.html` | หน้าเดียว 2 บทบาท: ผู้เช่า (ดูบิล + แนบสลิป) / เจ้าของ (จดมิเตอร์ + ดูสลิป + ออกบิล) |
| `smoke.js` | smoke test แบบ offline — `node smoke.js` (ตรวจ signature + รูปการ์ด ไม่ต่อเน็ต) |
| `vercel.json` | rewrite `/` → `/liff/bill.html` |
| `HANDOFF.md` | เอกสารส่งต่อทีม: แผนผัง, โครงข้อมูลใน Blob, กับดักที่เจอมาแล้ว |

## เอกสารเชิงลึก

| ไฟล์ | เนื้อหา |
|---|---|
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | โครงระบบ, data flow, module หลัก |
| [`docs/API.md`](./docs/API.md) | endpoint, การ auth, รูปแบบ error |
| [`docs/CONFIGURATION.md`](./docs/CONFIGURATION.md) | env ทั้งหมด + ค่า default |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) | deploy บน Vercel + Blob |
| [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) | รันในเครื่อง, code style |
| [`docs/TESTING.md`](./docs/TESTING.md) | smoke test และสิ่งที่ทดสอบอัตโนมัติไม่ได้ |

> ใช้ [`HANDOFF.md`](./HANDOFF.md) เป็นแหล่งหลักได้เสมอ — ละเอียดกว่า README และอัปเดตตามงานจริง

<!-- VERIFY: docs/*.md ทั้ง 6 ไฟล์ยังไม่มีในเรพ ณ ตอนเขียน README นี้ (โฟลเดอร์ docs/ ว่าง) — จะถูกสร้างโดยรอบ docs update -->

## ข้อจำกัดเพิ่มเติม (ระดับเทคนิค)

- **แนบสลิปได้เฉพาะ JPEG / PNG / WEBP และไม่เกิน 3MB ต่อรูป** (เกินแล้วได้ `413 TOO_LARGE`) — หน้า LIFF ย่อรูปเหลือด้านยาวสุด 1280px, JPEG quality 0.8 ก่อนส่ง
- **ไม่มี rate limit ของตัวเอง** — พึ่ง limit ของ Vercel อย่างเดียว และ `?token=` ของ `/api/seed` / `/api/sendbill` จะติดไปใน access log ได้
- **ไม่มี cron** — บิลรอบใหม่เกิดเมื่อมีคนกดออกบิลจากหน้าเจ้าของ (`/api/run`) เท่านั้น ยังไม่มีตัวส่งบิลอัตโนมัติรายเดือน
- **webhook รับแค่ `follow`, ข้อความ text, และ `postback`** — ถ้าผู้เช่าส่งรูปสลิปเข้ามาในแชทตรง ๆ จะไม่มีอะไรเกิดขึ้น ต้องแนบผ่านหน้า LIFF
- **ไม่มีชุดเทสต์อัตโนมัติ** — `package.json` ไม่มี `scripts` จึงไม่มี `npm test`; ที่มีคือ `node smoke.js` (offline) กับการทดสอบมือตามข้อ 7
- **state ใน Blob เป็น key-value แบน** — ไม่มี transaction/lock ถ้าเขียน key เดียวกันพร้อมกัน ค่าที่เขียนทีหลังชนะ (เขียนทับด้วย `allowOverwrite`)
- **`/api/config` เปิดสาธารณะโดยตั้งใจ** — คืนแค่ `liffId` ไม่มีข้อมูลอ่อนไหว
