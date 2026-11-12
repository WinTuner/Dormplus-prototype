# HANDOFF — DormPlus LINE app (สำหรับทีมที่รับช่วงต่อ)

> สถานะ: **prototype ที่ใช้งานจริงได้** — ส่งบิลใน LINE, ผู้เช่าแนบสลิป, เจ้าของกดยืนยัน, จดมิเตอร์ + ออกรอบบิลได้ในหน้าเดียว
> Production: https://line-app-iota.vercel.app · LINE OA: `P'CAT HOUSE` (`@218nhslf`)

## 1. ภาพรวมการทำงาน

```
เจ้าของหอ                     ผู้เช่า
   │                             │
   ├─ LIFF /liff/bill.html ──┐   ├─ แชท LINE: "ผูก 203", "บิล"
   │  (จดมิเตอร์→ออกรอบบิล)  │   │      │
   │                         ▼   ▼      ▼
   │                    /api/run     /api/webhook ── reply/push
   │                         │           │
   │                         └──▶ Vercel Blob ◀──┘
   │                              (kv/*.json, slips/*)
   └─ การ์ด "ยืนยันการชำระ" ◀── /api/slip ◀── LIFF (แนบสลิป)
                    │
                    └─ postback action=confirm ──▶ /api/webhook ──▶ bill.status = paid
```

- **ไม่ใช้ฐานข้อมูลจริง** — เก็บ JSON ไฟล์ละ key ใน Vercel Blob (private, OIDC ไม่มี token ในโค้ด)
- **ไม่มีเซิร์ฟเวอร์ค้าง** — ทุกอย่างเป็น Vercel serverless function ใน `api/`
- **ผู้ใช้ยืนยันตัวตนด้วย LIFF idToken** — ตรวจกับ `https://api.line.me/oauth2/v2.1/verify`

## 2. ไฟล์ไหนทำอะไร

| ไฟล์ | หน้าที่ |
|---|---|
| `api/webhook.js` | รับ event LINE: `follow`, ข้อความ "บิล"/"ผูก 203", postback ยืนยันการชำระ (ตรวจ `isOwner` ก่อนปิดบิล) |
| `api/_line.js` | signature verify, reply/push, `billBubble()` (การ์ดบิล), `confirmBubble()` (การ์ดเจ้าของ) |
| `api/_auth.js` | ตรวจ idToken → userId, `isOwner()`, bypass `x-seed-token` เฉพาะ preview/dev หรือ `ALLOW_SEED_BYPASS=true` |
| `api/_store.js` | `get(key)` / `set(key, value)` บน Blob (`useCache:false` สำคัญ — ดูข้อ 6) |
| `api/_rooms.js` | รายชื่อห้อง + ค่าเช่า/เรตน้ำไฟต่อห้อง |
| `api/config.js` | คืน `{ liffId }` ให้หน้า LIFF เอาไป `liff.init()` — public โดยตั้งใจ (ไม่มี auth) |
| `api/me.js` | ฉันเป็นใคร ผูกห้องไหน เป็นเจ้าของไหม |
| `api/bill.js` | ดูบิล (ผู้เช่าเห็นเฉพาะห้องตัวเอง, เจ้าของเห็นทุกห้อง) |
| `api/slip.js` | แนบสลิป (รูปไม่บังคับ) → `pending` + push การ์ดหาเจ้าของ |
| `api/slip-image.js` | ส่งไฟล์รูปสลิป (private) ให้เจ้าของหรือผู้เช่าห้องนั้น |
| `api/rooms.js` | ข้อมูลทุกห้องสำหรับหน้าจดมิเตอร์ |
| `api/run.js` | ออกรอบบิลจากหน่วยมิเตอร์ + ส่งการ์ดให้ผู้เช่าที่ผูกห้องแล้ว |
| `api/seed.js` | ข้อมูลทดสอบ (ต้องมี `?token=`) |
| `api/sendbill.js` | ยิงการ์ดบิลหาคนเดียว (ทดสอบ) |
| `liff/bill.html` | หน้าเดียว 2 บทบาท: ผู้เช่า = บิล+แนบสลิป / เจ้าของ = จดมิเตอร์+ดูสลิป |
| `smoke.js` | เทสต์ offline: signature + การ์ดบิล + การ์ดยืนยัน (`node smoke.js`) |

## 3. Environment variables

| ชื่อ | จำเป็น | ค่า |
|---|---|---|
| `LINE_CHANNEL_SECRET` | ✅ | Basic settings ของ Messaging API channel |
| `LINE_CHANNEL_ACCESS_TOKEN` | ✅ | Messaging API → Issue (long-lived) |
| `LIFF_ID` | ✅ | `2012575885-l35sh1N4` (ใช้ทั้งสร้างลิงก์และ derive channel id) |
| `LOGIN_CHANNEL_ID` | ไม่บังคับ | override channel id ที่ใช้ตรวจ idToken (ถ้าไม่ใส่ = prefix ของ `LIFF_ID`) |
| `OWNER_USER_ID` | ✅ | userId ของเจ้าของหอ (รับการ์ดยืนยัน + สิทธิ์หน้าจดมิเตอร์) |
| `SEED_TOKEN` | ✅ | รหัสสำหรับ `/api/seed`, `/api/sendbill`, และ dev bypass |
| `PUBLIC_BASE_URL` | แนะนำ | `https://<โดเมน>` |
| `ROOMS` | ไม่บังคับ | เช่น `101,102,103` (ค่าเริ่มต้น `201…212`) |
| `DEFAULT_RENT` / `WATER_RATE` / `ELEC_RATE` | ไม่บังคับ | เริ่มต้น 3500 / 25 / 7 |
| `BILL_PERIOD` / `BILL_DUE` | ไม่บังคับ | ค่าเริ่มต้นของรอบบิล |

**ต้องมีใน LINE Developers (channel `DormPlus LIFF`)**
- LIFF app → endpoint `https://<โดเมน>/liff/bill.html`, size **Tall**
- **Scopes: ต้องติ๊ก `openid`** (ถ้าไม่มี จะ `getIDToken()` ไม่ได้ → หน้าเว็บขึ้น "ใช้งานไม่ได้")
- Linked OA = OA ของหอ (`P'CAT HOUSE`)

## 4. วิธีทดสอบเร็ว (ไม่ต้องรอ LINE)

```powershell
$B="https://line-app-iota.vercel.app"; $H=@{"x-seed-token"="<SEED_TOKEN>"}

# ใคร: ต้องได้ 401 ถ้าไม่แนบ header
curl.exe -s $B/api/me
curl.exe -s -H "x-seed-token: <SEED_TOKEN>" $B/api/me

# seed บิลทั้งหอ
curl.exe -s -X POST "$B/api/seed?token=<SEED_TOKEN>"

# ออกรอบบิลใหม่ (หน่วยมิเตอร์)
curl.exe -s -X POST "$B/api/run" -H "x-seed-token: <SEED_TOKEN>" -H "Content-Type: application/json" `
  --data-binary '{"period":"2026-12","due":"2026-12-16","readings":[{"room":"203","water":6,"elec":40}]}'

# ดูบิล
curl.exe -s -H "x-seed-token: <SEED_TOKEN>" "$B/api/bill?room=203"
```

ทดสอบใน LINE จริง: พิมพ์ `ผูก 203` → `บิล` → กดปุ่ม → แนบสลิป → (เจ้าของ) กดยืนยันในการ์ด

## 5. โครงข้อมูลใน Blob

| key | ค่า |
|---|---|
| `kv/user-room-<userId>.json` | `"203"` — ผู้ใช้ผูกกับห้องไหน |
| `kv/room-user-<room>.json` | `"U…"` — ห้องนี้ผูกกับ userId ไหน (ใช้ส่งการ์ด) |
| `kv/bill-<room>.json` | `{ room, period, rent, water, elec, waterUnits, elecUnits, total, due, status, slipPath?, slipAt? }` |
| `kv/meter-<room>.json` | `{ water, elec, at }` — หน่วยล่าสุด |
| `kv/room-<room>.json` | `{ rent, waterRate, elecRate }` — ค่าเช่าเฉพาะห้อง |
| `slips/<room>-<ts>.jpg` | รูปสลิป (private) |

`status`: `unpaid` → `pending` (แนบสลิป) → `paid` (เจ้าของยืนยัน)

## 6. กับดักที่เจอมาแล้ว (อ่านก่อนแก้)

1. **Blob cache** — ต้อง `get(..., { useCache: false })` ไม่งั้นอ่านค่าเก่า ~30 วัน (เจอมาแล้ว: ออกรอบบิลแล้วบิลยังเป็นรอบเก่า)
2. **LIFF ใน Messaging API channel ไม่ได้** — ต้องสร้าง **LINE Login channel** แยก แล้วเพิ่ม LIFF ที่นั่น (API ตอบ `Channel must have ... WEB, NATIVE_APP, LIFF`)
3. **"Use webhook" เปิดผ่าน API ไม่ได้** — `/v2/bot/channel/webhook/endpoint` ตั้ง URL ได้ แต่ `active` ต้องกดใน console
4. **Flex message แก้ย้อนหลังไม่ได้** — เปลี่ยนลิงก์ปุ่มแล้วต้องส่งการ์ดใหม่
5. **ข้อความที่ส่งแล้ว + ชื่อ OA** ผู้เช่าเห็นถาวร — เปลี่ยนชื่อ OA ภายหลังจะไม่ย้อนไปแก้แชทเก่า
6. **ชื่อ product คือ `DormPlus`** (ไม่ใช่ DomPlus) — slug ภายในยังเป็น `domplus-*` ไม่ต้องแก้

## 7. งานที่ยังไม่ได้ทำ (เรียงตามความคุ้มค่า)

> สถานะ infra ณ วันนี้: `line-app` ต่อ GitHub แล้ว (deploy อัตโนมัติจาก `master`) · `line-backend` ก็ deploy แล้วที่ https://line-backend-ten.vercel.app พร้อม Neon Postgres

| งาน | จุดที่ต้องแตะ | หมายเหตุ |
|---|---|---|
| หน้าสรุปยอด/ทวงหนี้ของเจ้าของ | `api/rooms.js` + `liff/bill.html` | ตอนนี้เห็นแค่สถานะต่อห้อง |
| เก็บประวัติหลายรอบบิล | `_store.js` | ตอนนี้ `bill:<room>` ถูกทับทุกรอบ — ควรเป็น `bill:<period>:<room>` |
| cron ออกรอบบิลอัตโนมัติ | Vercel Cron → `/api/run` | ต้องมี secret ป้องกัน endpoint |
| หลายเจ้าของ/ผู้ช่วย | `_auth.js` | `OWNER_USER_ID` เป็นคนเดียว — เปลี่ยนเป็น list หรือ role ใน Blob |
| ~~ลบ `x-seed-token` bypass~~ | `_auth.js` | ✅ ปิดแล้ว — ค่าเริ่มต้นคือปฏิเสธ เปิดเฉพาะ `ALLOW_SEED_BYPASS=true` หรือ Vercel env `preview`/`development` |
| หลายเจ้าของ | `_auth.js` | ✅ มีแล้ว — เจ้าของคนแรกจาก `OWNER_USER_ID`, คนต่อ ๆ ไปรับสิทธิ์ด้วย QR (`/api/owner-invite` → `?owner=<code>`) |
| LINE Notify/แจ้งเตือนก่อนครบกำหนด | Vercel Cron | push ข้อความเตือนจาก `room-user:` map |
| UI หลายภาษา / หลายหอใน deploy เดียว | ทั้งหมด | ตอนนี้ 1 deploy = 1 หอ (ตั้งใจ) |

## 8. กติกาการทำงานที่ทีมควรยึด

- แตะ Blob ผ่าน `_store.js` เท่านั้น (อย่าเรียก `@vercel/blob` ตรง ๆ ยกเว้น `slip.js`/`slip-image.js` ที่เก็บไฟล์)
- endpoint ที่อ่านข้อมูลผู้ใช้ ต้องเรียก `requireUser()` ก่อนเสมอ
- ก่อน deploy: `node smoke.js` ต้องผ่าน
- หลัง deploy: ทดสอบผ่าน LINE 1 ครั้ง (path ที่แตะ) — `x-seed-token` ใช้ได้เฉพาะ preview/dev
- production ไม่มี bypass: endpoint ที่ต้อง auth ใช้ idToken จาก LIFF เท่านั้น
- อย่าใส่ token/secret ลงใน URL ที่ส่งให้ผู้ใช้เห็น
