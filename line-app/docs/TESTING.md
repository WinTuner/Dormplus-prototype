<!-- generated-by: gsd-doc-writer -->

# การทดสอบ (TESTING)

เอกสารนี้พูดตรง ๆ ว่าโปรเจกต์นี้ **มีเทสต์อัตโนมัติอยู่ชุดเดียวคือ `smoke.js`** และที่เหลือทั้งหมดเป็นการทดสอบมือที่คนต้องทำเอง ไม่มี test runner, ไม่มี framework, ไม่มี CI และไม่มี coverage ในเรพนี้เลย

## 1. สถานะการทดสอบตอนนี้

| ชนิด | มีไหม | หลักฐานจากเรพ |
|---|---|---|
| Unit/offline test อัตโนมัติ | ✅ มีชุดเดียว: `smoke.js` | `smoke.js` (34 บรรทัด) |
| Test runner (`jest`/`vitest`/`mocha`/`node --test`) | ❌ ไม่มี | `package.json` ไม่มี `scripts` และ dependency มีตัวเดียวคือ `@vercel/blob` |
| คำสั่ง `npm test` | ❌ ไม่มี | `package.json` ไม่มี `"scripts"` เลย |
| CI (GitHub Actions ฯลฯ) | ❌ ไม่มี | ไม่มี `.github/` ในเรพ |
| Coverage threshold | ❌ ไม่มี | ไม่มี config ของ coverage ใด ๆ |
| เทสต์ที่ยิง HTTP endpoint | ❌ ไม่มี | `smoke.js` ไม่ได้โหลด `req`/`res` และไม่เรียก `fetch` |
| E2E ผ่าน LINE จริง | ❌ ไม่มีอัตโนมัติ | ต้องทำมือตามข้อ 7 |

ผลที่ตามมา: **`node smoke.js` ผ่านไม่ได้แปลว่าระบบทำงาน** — มันตรวจแค่ 3 กลุ่ม: สูตร HMAC, โครงการ์ดบิล และ postback ของการ์ดเจ้าของ (ดูข้อ 3–4) endpoint ทั้ง 10 ตัว, Blob, LINE API และหน้า LIFF ไม่ถูกแตะเลย

## 2. `node smoke.js` — รันอะไร ได้อะไร

รันจาก root ของโปรเจกต์ (ไม่มีอะไรต้องติดตั้งเพิ่มนอกจาก `npm install` ครั้งแรก เพราะ `smoke.js` ไม่ได้ใช้ dependency ภายนอกเลย):

```bash
node smoke.js
```

ผลที่รันจริงในเวิร์กสเปซนี้ (Node `v26.13.0`, PowerShell):

```text
> node -v
v26.13.0
> node smoke.js; "exit=$LASTEXITCODE"
smoke OK — signature + flex card + confirm card
exit=0
```

ข้อความ `smoke OK — ...` มาจาก `console.log` บรรทัดสุดท้ายของไฟล์ (`smoke.js` บรรทัด 34) ส่วน **exit code 0** มาจากการที่ `assert` ทุกตัวไม่ throw — ถ้าตัวใดตัวหนึ่ง fail โปรเซสจะจบด้วย exit code ที่ไม่ใช่ 0 และไม่มีบรรทัด `smoke OK` พิมพ์ออกมา จำสองอย่างนี้ไว้เพราะมันคือทั้งหมดที่ใช้ gate ก่อน deploy

### 2.1 สิ่งที่ `smoke.js` ตั้งค่าก่อน require (บรรทัด 2–3)

```js
process.env.LINE_CHANNEL_SECRET = "test-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
```

ลำดับนี้ **บังคับ** เพราะ `api/_line.js` จับ env ใส่ `const` ระดับบนสุดตอน module load (บรรทัด 4–6):

```js
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const SECRET = process.env.LINE_CHANNEL_SECRET;
const LIFF_ID = process.env.LIFF_ID;
```

ถ้าตั้ง env หลัง `require` ค่าที่ถูกจับไปแล้วจะไม่เปลี่ยน — เทสต์จะเงียบ ๆ ตรวจของเก่า และเพราะไม่ได้ตั้ง `LIFF_ID` เลย การ์ดในเทสต์จึงใช้ branch fallback URL (ไม่ใช่ `liff.line.me`) ตามที่อธิบายในข้อ 4

### 2.2 สิ่งที่มันโหลด

มีแค่บรรทัดเดียว:

```js
const { verify, billBubble, confirmBubble } = require("./api/_line");
```

ไม่มีการ `require` `_store`, `_auth`, `_rooms`, `webhook` หรือไฟล์ endpoint ใด ๆ → `@vercel/blob` ไม่ถูกโหลด → ไม่มีการต่อ network → ไม่ต้องมี credential ใด ๆ จึงรันได้บนเครื่องที่ไม่มี env ครบ

## 3. `smoke.js` ยืนยันอะไรบ้าง (ไล่ทีละ assert)

### 3.1 Signature verification (บรรทัด 10–14)

```js
const raw = Buffer.from(JSON.stringify({ events: [] }));
const good = crypto.createHmac("sha256", "test-secret").update(raw).digest("base64");
assert.strictEqual(verify(raw, good), true, "valid signature should pass");
assert.strictEqual(verify(raw, "wrong"), false, "invalid signature should fail");
assert.strictEqual(verify(raw, undefined), false, "missing signature should fail");
```

| # | เคส | คาดหวัง | ตรวจอะไรจริง |
|---|---|---|---|
| 1 | signature คำนวณจาก payload เดียวกัน + secret เดียวกัน | `true` | สูตร HMAC-SHA256 → base64 ตรงกับที่ `verify()` คำนวณ |
| 2 | signature ผิด (`"wrong"`) | `false` | การเทียบไม่ผ่าน |
| 3 | ไม่ส่ง signature (`undefined`) | `false` | ไม่ throw — เทียบ base64 string กับ `undefined` แล้วได้ `false` ตรง ๆ |

สิ่งที่เคสนี้ **ไม่ได้** พิสูจน์:
- **ไม่มี `LINE_CHANNEL_SECRET`** → `verify()` คืน `false` ทันที (บรรทัด 9) เคสนี้เทสต์ในโปรเซสเดียวกันไม่ได้เพราะ `SECRET` ถูกจับตอน load — ต้องรันโปรเซสใหม่ที่ไม่มี env (ดูตัวอย่างในข้อ 5.3)
- **ใช้ signature ของ body A กับ body B** → ควรได้ `false` แต่ไม่มี assert นี้ (จริงตามสูตร แต่ไม่มีเทสต์กันคนแก้ `verify()` ให้ใช้ค่าคงที่)
- `verify()` ใช้ `===` เทียบ base64 ไม่ใช่ `crypto.timingSafeEqual` — ไม่ใช่เรื่องที่เทสต์จับได้ แต่เป็นที่รู้ไว้ (timing attack บน signature ของ LINE แทบไม่ realistic แต่โค้ดไม่ได้กัน)

### 3.2 การ์ดบิล `billBubble` (บรรทัด 17–25)

```js
const bill = { room: "203", period: "2026-11", rent: 3500, water: 125, elec: 217, total: 3842, due: "2026-11-16" };
const card = billBubble(bill, "https://example.test");
```

| # | assert | คาดหวัง | ทำไมสำคัญ |
|---|---|---|---|
| 4 | `card.type === "flex"` | `"flex"` | LINE จะปฏิเสธข้อความถ้าไม่ใช่ flex/text |
| 5 | `card.altText` มี `"3,842"` | มี | `altText` คือข้อความที่จะเห็นตอน LIFF ยังโหลด / ใน notification — ต้องมียอด |
| 6 | `card.contents.type === "bubble"` | `"bubble"` | Flex ต้องมี root เป็น bubble/carousel |
| 7 | JSON ทั้งก้อนมี `"ห้อง 203"` | มี | ชื่อห้องแสดงถูก |
| 8 | JSON ทั้งก้อนมี `"#4FD8D2"` | มี | สีแบรนด์ (accent) ถูกใช้ |
| 9 | JSON มี `"/liff/bill.html?room=203"` **หรือ** `"liff.line.me"` | อย่างใดอย่างหนึ่ง | ปุ่มลิงก์ไปหน้าบิลจริง — `||` ทำให้ผ่านได้ทั้งสอง branch |

บิลที่ใช้ในเทสต์คำนวณมือ: `3500 + 125 + 217 = 3842` (ยอดนี้เป็นตัวเลขสมมติของเทสต์ ไม่ได้ออกมาจาก `run.js`)

หมายเหตุเรื่อง assert ข้อ 8–9: `JSON.stringify(card)` แล้ว `includes(...)` เป็นการตรวจแบบ "ข้อความอยู่ที่ไหนก็ได้ใน JSON" — ถ้ามีคนย้ายสีไปผิด element หรือทำลิงก์โผล่ในที่อื่น เทสต์ยังผ่าน เป็นข้อจำกัดที่ยอมรับได้ในระดับ smoke แต่ไม่ใช่ unit test ที่ดี

### 3.3 การ์ดเจ้าของ `confirmBubble` (บรรทัด 28–32)

```js
const confirm = confirmBubble(bill);
const pb = confirm.contents.footer.contents[0].action;
assert.strictEqual(pb.type, "postback");
assert.ok(pb.data.includes("action=confirm"), "postback action");
assert.ok(pb.data.includes("room=203"), "postback carries room");
```

| # | assert | คาดหวัง | ทำไมสำคัญ |
|---|---|---|---|
| 10 | `contents.footer.contents[0].action.type` | `"postback"` | ถ้าเป็น `uri` ปุ่มจะไม่ส่ง event กลับมาที่ webhook |
| 11 | `pb.data` มี `action=confirm` | มี | ตรงกับ `if (data.get("action") === "confirm")` ใน `api/webhook.js` บรรทัด 87 |
| 12 | `pb.data` มี `room=203` | มี | webhook ใช้ `data.get("room")` ไปหา `bill:<room>` — ถ้าห้องหาย การ์ดกดแล้วจะตอบ "ไม่พบบิลห้อง null ครับ" |

`contents[0]` เป็น index ที่ปลอดภัยเพราะปุ่ม postback ถูก push เป็นตัวแรกเสมอ (บรรทัด 102–121) ปุ่มที่สอง ("ดูสลิป") จะเกิดเฉพาะเมื่อมีทั้ง `LIFF_ID` และ `bill.slipPath` — ซึ่งใน `smoke.js` ไม่มีทั้งคู่

## 4. `smoke.js` แตะอะไร **และไม่แตะอะไร**

| ส่วนของระบบ | ถูกเทสต์ไหม | ผลคืออะไร |
|---|---|---|
| `verify()` (สูตร HMAC) | ✅ 3 เคส | ครอบคลุมเฉพาะ happy path + ค่าเพี้ยน 2 แบบ |
| `billBubble()` / `confirmBubble()` (โครงสร้าง JSON) | ✅ บางส่วน | ตรวจ presence ของ string ไม่ได้ตรวจ schema ทั้งก้อน |
| `reply()` / `push()` | ❌ | ต้องมี `LINE_CHANNEL_ACCESS_TOKEN` จริงและยิง `api.line.me` — ไม่มีทางรัน offline |
| `api/_auth.js` (`requireUser`, `isOwner`, การ verify idToken กับ LINE) | ❌ | ทั้งระบบ auth ไม่มีเทสต์อัตโนมัติเลย |
| `api/_store.js` (Blob get/set, `useCache:false`, การ sanitize key) | ❌ | ต้องมี Blob credential → ทดสอบได้เฉพาะบน deployment |
| endpoint ทั้ง 10 ตัว (method check, status code, error envelope) | ❌ | ไม่มี `req`/`res` ปลอม, ไม่มี HTTP layer ในเทสต์ |
| `webhook.js` (follow/บิล/ผูก/postback → เปลี่ยน state) | ❌ | logic ที่สำคัญที่สุดของแอปไม่มีเทสต์ |
| `liff/bill.html` (boot, `liff.init`, การแนบสลิป, หน้าจดมิเตอร์) | ❌ | ต้องเปิดใน LINE จริง |
| env อื่น (`ROOMS`, `OWNER_USER_ID`, `BILL_PERIOD`, …) | ❌ | `smoke.js` ตั้งแค่ 2 ตัว |
| branch ที่ใช้ `LIFF_ID` (ลิงก์ `liff.line.me`, ปุ่ม "ดูสลิป") | ❌ | เพราะ `LIFF_ID` ไม่ถูกตั้ง → ตรวจเฉพาะ fallback URL |

สรุปสั้น ๆ สำหรับคนที่เพิ่งเข้าโปรเจกต์: **`smoke.js` เป็น canary ไม่ใช่ safety net** มันจับได้แค่ว่า "คนแก้ `_line.js` ทำการ์ดพังจนโครงสร้างเปลี่ยน" เท่านั้น

## 5. ขยาย `smoke.js` ด้วย `assert` ของ Node (ไม่ต้องติดตั้งอะไร)

Node มี `assert` มาให้แล้ว — ห้ามเพิ่ม dependency หรือย้ายไปใช้ framework เพราะจะขัดกับข้อจำกัดของโปรเจกต์ (dependency เดียว, ไม่มี build) กติกาที่ทำให้เทสต์ใหม่มีประโยชน์จริง:

1. **ตั้ง env ก่อน `require` เสมอ** ถ้าเทสต์ต้องใช้ค่าที่โมดูลจับตอน load
2. **เทสต์เฉพาะฟังก์ชันบริสุทธิ์** (`verify`, `billBubble`, `confirmBubble`, `ROOMS`, `DEFAULTS`) — อย่าเขียน mock `req`/`res` หรือ mock `fetch` เพราะจะกลายเป็นเทสต์ที่โกหกได้ง่าย
3. **assert ต้อง throw** ถ้าอยากได้ exit code ≠ 0 — อย่าใช้ `console.log` อย่างเดียว
4. **ตรวจว่าเทสต์ใหม่จับของพังได้จริง** — แก้ค่าที่ assert ชั่วคราวแล้วรัน ต้องเห็น fail (เช่นเปลี่ยน `"#4FD8D2"` เป็น `"#000000"`)

### 5.1 ตัวอย่างที่รันผ่านจริงแล้ว — ตรวจค่า default ของห้อง

`require("./api/_rooms")` ทำงานได้โดยไม่ต้องมี credential (ยืนยันแล้ว: ได้ `ROOMS 12`, `{"rent":3500,"waterRate":25,"elecRate":7}`) ต่อท้าย `smoke.js` ได้เลย:

```js
// 4) default ของห้องและเรต — ต้องตรงกับที่ api/run.js ใช้คิดเงิน
const { ROOMS, DEFAULTS } = require("./api/_rooms");
assert.strictEqual(ROOMS.length, 12, "default 12 ห้อง");
assert.strictEqual(ROOMS[0], "201", "ห้องแรกคือ 201");
assert.deepStrictEqual(DEFAULTS, { rent: 3500, waterRate: 25, elecRate: 7 });
```

ข้อควรรู้: `_rooms.js` อ่าน `process.env.ROOMS` / `DEFAULT_RENT` / `WATER_RATE` / `ELEC_RATE` ตอน load ถ้าเครื่องที่รันมี env พวกนี้ค้างอยู่ ค่าจะไม่ใช่ default — เทสต์นี้จึงควรตั้ง env ให้ชัดก่อน `require` (หรือยอมรับว่ามันเทสต์ "ค่าที่เครื่องนี้เห็น")

### 5.2 ตัวอย่าง — ตรวจ branch ที่ต้องมี `LIFF_ID` (ต้องรันโปรเซสใหม่)

เพราะ `_line.js` จับ `LIFF_ID` ตอน load และ `smoke.js` ไม่ได้ตั้งค่านี้ การจะเทสต์ branch `liff.line.me` ต้องแยกโปรเซส คำสั่งนี้รันแล้วได้ผลจริง:

```bash
node -e "process.env.LIFF_ID='2012575885-l35sh1N4';process.env.LINE_CHANNEL_SECRET='x';const l=require('./api/_line');const c=l.billBubble({room:'203',period:'2026-11',rent:1,water:1,elec:1,total:3,due:'d'},'https://x.test');console.log(c.contents.footer.contents[0].action.uri)"
# → https://liff.line.me/2012575885-l35sh1N4?room=203
```

ถ้าอยากให้เป็นเทสต์ถาวร ให้เพิ่มเป็นบล็อกที่ spawn child process (`child_process.execFileSync(process.execPath, ["-e", ...])`) แล้ว assert จาก stdout — แต่ระวัง: มันเริ่มซับซ้อนเกินกว่าที่โปรเจกต์นี้ต้องการ ถ้าไม่จำเป็นให้ตรวจ branch นี้ด้วยมือใน LINE แทน

### 5.3 ตัวอย่าง — signature ต้อง fail เมื่อไม่มี secret

```js
// ต้องรันในโปรเซสที่ไม่มี LINE_CHANNEL_SECRET
const assert = require("assert");
process.env.LINE_CHANNEL_SECRET = "";
const { verify } = require("./api/_line");
assert.strictEqual(verify(Buffer.from("{}"), "anything"), false, "ไม่มี secret ต้องปฏิเสธ");
```

### 5.4 สิ่งที่ **ไม่ควร** พยายามเทสต์ใน `smoke.js`

- `reply` / `push` — ต้อง mock `fetch` หรือยิง LINE จริง ไม่มีคุณค่าเท่ากับการทดสอบใน LINE 1 ครั้ง
- `requireUser` — ต้อง mock `fetch` ไปที่ `api.line.me/oauth2/v2.1/verify`
- ยอดเงินของ `api/run.js` — สูตรถูกเขียนฝังใน loop ของ `run.js` (บรรทัด 36–37) ไม่มีฟังก์ชันให้เรียก ถ้าจะเทสต์จริงต้องแยกฟังก์ชันคำนวณออกมาก่อน ซึ่งเป็นการเปลี่ยนโค้ด production เพื่อเทสต์ — ชั่งน้ำหนักก่อนทำ
- 413 (รูปเกิน 3MB) — ต้องสร้าง base64 ขนาด 4MB ขึ้นไปในหน่วยความจำ ไม่คุ้มกับ smoke test

## 6. Manual test matrix — endpoint ต่อ endpoint

ทั้งหมดนี้ยิงใส่ **deployment จริง** (ไม่มี dev server ในเรพ) ตั้งตัวแปรใน PowerShell ก่อน:

```powershell
$B = "https://<โดเมนของ deployment>"
$S = "<SEED_TOKEN>"
$O = @{ "x-seed-token" = $S }
$J = @{ "x-seed-token" = $S; "Content-Type" = "application/json" }
```

<!-- VERIFY: โดเมนจริงของ deployment ไม่มีในเรพ; HANDOFF.md ระบุ https://line-app-iota.vercel.app แต่ไม่ได้ยืนยันจาก Vercel -->
<!-- VERIFY: การรัน API ในเครื่อง (vercel dev) ยังไม่มีใครยืนยันว่าใช้กับ Blob OIDC ได้ — matrix นี้จึงออกแบบมาสำหรับ deployment -->

### 6.0 เอา token จากไหน (3 แบบ)

| แบบ | ใช้กับ | ได้ตัวตนเป็น | ข้อจำกัด |
|---|---|---|---|
| `x-seed-token: <SEED_TOKEN>` | ทุก endpoint ที่เรียก `requireUser` (`/api/me`, `/api/bill`, `/api/slip`, `/api/slip-image`, `/api/rooms`, `/api/run`) | `OWNER_USER_ID` ถ้าตั้งไว้, ไม่งั้น `"dev"` | **ได้สิทธิ์เจ้าของเสมอ** → เทสต์เคส 403 ของผู้เช่าไม่ได้ |
| `Authorization: Bearer <idToken>` | endpoint เดียวกัน | LINE userId จริงจาก `sub` | ต้องเอา idToken จาก LIFF ที่ล็อกอินแล้ว |
| header `x-seed-token` | `/api/dev?do=seed`, `/api/dev?do=sendbill` | ไม่มีตัวตน | ใช้ได้เฉพาะ `vercel dev` / preview ที่เปิด `ALLOW_SEED_BYPASS` · production ตอบ 404 |

**วิธีทดสอบเคส "ผู้ใช้ทั่วไป" (non-owner) โดยไม่ต้องมี LINE:** `requireUser` คืน `OWNER_USER_ID || "dev"` (บรรทัด 19) และ `isOwner` เป็น `false` เมื่อ `OWNER_USER_ID` ว่าง → ถ้า **ถอด `OWNER_USER_ID` ออกแล้ว redeploy** ตัว bypass จะกลายเป็น `"dev"` ซึ่งไม่ใช่เจ้าของ ทำให้เทสต์ 403 ของ `/api/rooms`, `/api/run`, `/api/bill` (ห้องอื่น) ได้ อย่าลืมใส่ค่ากลับแล้ว redeploy อีกครั้ง (env ถูกอ่านตอน module load — ต้อง deploy ใหม่ถึงจะมีผล)

<!-- VERIFY: การเอา idToken จริงของผู้เช่าออกมา (เช่นเปิด LIFF ในเบราว์เซอร์เดสก์ท็อปแล้วเรียก liff.getIDToken() ใน devtools) ไม่มีขั้นตอนในเรพ และขึ้นกับ scope openid ที่ตั้งใน LINE Developers Console --> 

### 6.1 `GET /api/config`

| เคส | คำสั่ง | คาดหวัง | ดูอะไร |
|---|---|---|---|
| ปกติ | `curl.exe -s $B/api/config` | `200` `{"liffId":"2012575885-..."}` | ต้องไม่ใช่ `null` — ถ้า `null` แปลว่า `LIFF_ID` ไม่ได้ตั้ง/ยังไม่ redeploy |
| ไม่ต้อง auth | เหมือนข้างบน (ไม่แนบ header) | ยัง `200` | endpoint เดียวที่ตั้งใจเปิดสาธารณะ |
| method อื่น | `curl.exe -s -X POST $B/api/config` | `200` | โค้ดไม่ตรวจ method — เป็น quirk ที่รู้ไว้ |

### 6.2 `GET /api/me`

| เคส | คำสั่ง | คาดหวัง | ดูอะไร |
|---|---|---|---|
| ไม่มี token | `curl.exe -s -i $B/api/me` | `401` `{"error":{"code":"UNAUTHORIZED",...}}` | ต้องไม่มี `userId` หลุดออกมา |
| มี bypass | `curl.exe -s -H "x-seed-token: $S" $B/api/me` | `200` `{"userId":"U...","owner":true,"room":null}` | `userId` ต้องเท่ากับ `OWNER_USER_ID` |
| หลังผูกห้อง | สแกน QR หน้าห้อง 203 แล้วเรียกซ้ำ | `200` `room":"203"` | ยืนยันว่า `user-room:<userId>` ถูกเขียน |
| cache | `curl.exe -s -D - -o NUL -H "x-seed-token: $S" $B/api/me` | มี `Cache-Control: no-store` | header ต้องมาก่อน `requireUser` (ไม่สำคัญต่อผล แต่เป็นรูปแบบที่ทีมยึด) |

### 6.3 `GET /api/bill?room=203`

| เคส | คำสั่ง | คาดหวัง | ดูอะไร |
|---|---|---|---|
| มีบิล | `curl.exe -s -H "x-seed-token: $S" "$B/api/bill?room=203"` | `200` + `room, period, rent, water, elec, total, due, status, hasSlip` | `total` ต้องเท่ากับ `rent+water+elec`; `hasSlip` เป็น `false` ถ้ายังไม่แนบ |
| ห้องที่ไม่มีบิล | `...?room=999` | `404` `NOT_FOUND` | ข้อความ "ไม่พบบิลของห้อง 999" |
| ไม่ส่ง room และยังไม่ผูก | `curl.exe -s -H "x-seed-token: $S" $B/api/bill` (ตอน bypass เป็น `"dev"`) | `400` `VALIDATION` | ต้องระบุ room หรือผูกห้องก่อน |
| ห้องที่ไม่ได้ผูก (non-owner) | ใช้ตัวตน `"dev"` แล้ว `...?room=203` | `403` `FORBIDDEN` | นี่คือการทดสอบ tenant isolation — **ต้องถอด `OWNER_USER_ID` ก่อน** ไม่งั้นจะผ่านตลอด |
| cache | `curl.exe -s -D - -o NUL -H "x-seed-token: $S" "$B/api/bill?room=203"` | `Cache-Control: no-store` | สถานะบิลเปลี่ยนหลังแนบสลิป ห้าม cache |

### 6.4 `POST /api/slip`

```powershell
curl.exe -s -X POST $B/api/slip -H "x-seed-token: $S" -H "Content-Type: application/json" --data-binary '{"room":"203","note":"โอนแล้ว"}'
```

| เคส | คาดหวัง | ดูอะไร |
|---|---|---|
| ไม่แนบรูป | `200` `{"ok":true,"status":"pending","total":<ยอด>,"hasSlip":false}` | `status` เปลี่ยนเป็น `pending`; ไม่มีการเขียนไฟล์สลิป |
| แนบรูป data URL (JPEG/PNG/WEBP) | `200` `hasSlip:true` | ไฟล์ถูกเขียนที่ `slips/203-<ts>.<ext>` — นามสกุลตาม mime (`jpeg` → `jpg`, png/webp คงเดิม); เจ้าของต้องได้รับการ์ด "ยืนยันการชำระ" |
| mime อื่น (เช่น `image/gif`) | `400` `VALIDATION` "รูปต้องเป็น JPEG/PNG/WEBP" | regex ที่บรรทัด 31 ปฏิเสธก่อน decode |
| บิล `paid` แล้ว | `409` `INVALID_STATE` "บิลนี้ชำระแล้ว" | ต้องทำให้บิลเป็น `paid` ก่อนด้วย postback (ข้อ 7) — ไม่มี API อื่นที่ตั้ง `paid` ได้ |
| ใหญ่กว่า 3 MiB | `413` `TOO_LARGE` | ทำได้ยากผ่าน curl เพราะหน้า LIFF ย่อรูปเหลือ ≤1280px/quality 0.8 ก่อนส่ง |
| เรียกด้วย GET | `405` `{"error":"POST only"}` | error เป็น string ไม่ใช่ envelope — หน้า LIFF จะโชว์ `HTTP 405` |
| ห้องที่ไม่ได้ผูก (non-owner) | `403` `FORBIDDEN` | ต้องทดสอบด้วยตัวตน `"dev"` |

หลังยิงสำเร็จ ตรวจฝั่งข้อมูลด้วย `GET /api/bill?room=203` → `status` ต้องเป็น `pending` และ `slipPath` มีค่า (ถ้าแนบรูป)

### 6.5 `GET /api/slip-image?room=203`

| เคส | คำสั่ง | คาดหวัง | ดูอะไร |
|---|---|---|---|
| มีสลิป | `curl.exe -s -D - -o slip.jpg -H "x-seed-token: $S" "$B/api/slip-image?room=203"` | `200` + `Content-Type: image/*` | เปิดไฟล์ `slip.jpg` ต้องเห็นรูปจริง; header ต้องมี `Cache-Control: private, no-store` |
| บิลยังไม่มี `slipPath` | `...?room=201` | `404` `NOT_FOUND` "ยังไม่มีสลิป" | |
| owner ไม่ส่ง `room` | `$B/api/slip-image` | `404` (ไม่ใช่ 403) | เพราะ owner ข้ามการเช็ก `bound` แล้วไปหา `bill:` (ห้องว่าง) ไม่เจอ |
| tenant ไม่ส่ง `room` (non-owner) | เหมือนข้างบนด้วยตัวตน `"dev"` | `403` `FORBIDDEN` | `bound !== ""` → ปฏิเสธ |
| tenant ขอห้องอื่น | ตัวตน `"dev"` + `?room=203` | `403` | การทดสอบสำคัญที่สุดของ endpoint นี้ |

### 6.6 `GET /api/rooms`

| เคส | คำสั่ง | คาดหวัง | ดูอะไร |
|---|---|---|---|
| owner | `curl.exe -s -H "x-seed-token: $S" $B/api/rooms` | `200` `{period, rooms:[12 ห้อง]}` | แต่ละห้องมี `config{rent,waterRate,elecRate}`, `meter`, `bill`, `tenant` (เป็น `null` ได้) |
| non-owner | ตัวตน `"dev"` | `403` `FORBIDDEN` "เฉพาะเจ้าของหอ" | ต้องถอด `OWNER_USER_ID` ก่อน |
| จำนวนห้อง | ดูความยาว array | เท่ากับ `ROOMS` (default 12) | ถ้าเปลี่ยน env `ROOMS` ต้อง redeploy |
| ช้าแค่ไหน | จับเวลา | ~4 read ต่อห้อง (default 48 reads) | ช้าเพราะอ่าน Blob ทีละ key — ถ้าเพิ่มห้องเยอะจะชัด |

### 6.7 `POST /api/run`

```powershell
curl.exe -s -X POST $B/api/run -H "x-seed-token: $S" -H "Content-Type: application/json" --data-binary '{"period":"2026-12","due":"2026-12-16","readings":[{"room":"203","water":6,"elec":40}]}'
```

| เคส | คาดหวัง | ดูอะไร |
|---|---|---|
| ปกติ (มีผู้เช่าผูกห้อง) | `200` `{ok, period, due, rooms:[{room,total,pushed:true}]}` | `total` = `rent + water*waterRate + elec*elecRate` (ปัดด้วย `Math.round`) |
| ห้องที่ไม่มีผู้เช่า | `200` + `pushed:false` | ไม่มี `room-user:<room>` → ไม่ push |
| `readings` หาย/ไม่ใช่ array/ว่าง | `400` `VALIDATION` "ต้องส่ง readings" | |
| ไม่มี `period` และไม่ได้ตั้ง `BILL_PERIOD` | `400` `VALIDATION` "ต้องระบุ period" | เช็กก่อนถึง loop |
| ค่ามิเตอร์เสีย (`"water":"abc"`) | `200` + `{room, error:"ค่ามิเตอร์ไม่ถูกต้อง"}` | **ทั้ง request ยัง 200** — ต้องอ่าน `rooms[]` ทีละตัว ไม่ใช่ดูแค่ status |
| เรียกด้วย GET | `405` | |
| บิลเดิมถูกทับไหม | รันซ้ำด้วย period เดิม | บิลถูกเขียนทับทั้งใบ, `status` กลับเป็น `unpaid` แม้เพิ่ง `paid` — ประวัติหาย (ตามดีไซน์) |

### 6.8 `POST /api/dev?do=seed&token=...`

| เคส | คำสั่ง | คาดหวัง | ดูอะไร |
|---|---|---|---|
| token ถูก | `curl.exe -s -X POST "$B/api/dev?do=seed&token=$S"` | `200` `{ok, period:"2026-11", rooms:[12]}` | หน่วยน้ำ/ไฟมาจากสูตร `4+(i%4)` / `28+(i%6)*7` |
| token ผิด/ไม่ส่ง | `-X POST "$B/api/dev?do=seed&token=wrong"` | `403` `FORBIDDEN` "ต้องมี token" | ถ้าได้ 200 แปลว่า `SEED_TOKEN` ไม่ได้ตั้ง — ห้ามใช้ production |
| idempotent | รันสองครั้ง | ครั้งที่สองไม่ทับ `room:<room>` ที่มีอยู่ | `bill:<room>` ถูกทับทุกครั้ง |
| GET | `$B/api/dev?do=seed&token=$S` | `405` | |

ตัวอย่างยอดที่ควรเห็นถ้า Blob ยังว่าง: ห้อง `203` (index 2) → rent `3500`, น้ำ 6 หน่วย `150`, ไฟ 42 หน่วย `294`, รวม `3944`; ห้อง `201` (index 0) → rent `3220`, รวม `3516`

### 6.9 `POST /api/dev?do=sendbill&token=...`

```powershell
curl.exe -s -X POST "$B/api/dev?do=sendbill&token=$S" -H "Content-Type: application/json" --data-binary '{"to":"U<userId>","room":"203"}'
```

| เคส | คาดหวัง | ดูอะไร |
|---|---|---|
| ปกติ | `200` `{ok:true, sent:"203", total:<ยอด>}` | ต้องมีคนได้รับการ์ดจริงใน LINE (ถ้า userId ผิดจะไม่ error — LINE ตอบ 200 แต่ไม่มีใครเห็น) |
| ไม่ส่ง `to` หรือ `room` | `400` `VALIDATION` | |
| ห้องที่ไม่มีบิล | `404` `NOT_FOUND` | |
| token ผิด | `403` | |
| LINE ล่ม/token หมดอายุ | **ไม่มี try/catch** ในไฟล์นี้ | `push()` throw → response ไม่ใช่ JSON envelope (คาดว่า 500 จาก platform) — ต่างจาก `/api/run` และ `/api/slip` ที่กลืน error |

<!-- VERIFY: รูปแบบ response ของ Vercel function ที่ throw ออกจาก handler (sendbill) ไม่ได้ระบุในเรพ — คาดว่าเป็น 500 แบบ HTML/plain text ไม่ใช่ JSON -->

### 6.10 `POST /api/webhook`

ต้องคำนวณ signature เอง — ใช้ Node (มี `fetch` ในตัวตั้งแต่ Node 18):

```bash
# ต้องตั้ง env LINE_CHANNEL_SECRET ใน shell ก่อน
node -e "const c=require('crypto');const b=JSON.stringify({events:[]});const s=c.createHmac('sha256',process.env.LINE_CHANNEL_SECRET).update(b).digest('base64');fetch('https://<โดเมน>/api/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':s},body:b}).then(r=>r.text()).then(console.log)"
```

| เคส | คาดหวัง | ดูอะไร |
|---|---|---|
| signature ถูก + `{"events":[]}` | `200` `{"ok":true}` | ปลอดภัยที่สุดในการทดสอบ เพราะไม่มี event ให้ทำงาน |
| signature ผิด | `401` `{"error":"bad signature"}` | **ตรวจ signature ก่อน parse JSON** → body จะเสียก็ได้ผล 401 เหมือนกัน |
| ไม่ส่ง signature | `401` | |
| signature ถูก แต่ body ไม่ใช่ JSON | `400` `{"error":"invalid json"}` | |
| เรียกด้วย GET | `405` `{"error":"POST only"}` | |
| ปุ่ม Verify ใน LINE Developers Console | ต้องขึ้น success | ถ้าไม่ผ่าน ดูว่า URL ลงท้าย `/api/webhook` และ `LINE_CHANNEL_SECRET` ตรงกับ channel |

<!-- VERIFY: พฤติกรรมของปุ่ม Verify ใน LINE Developers Console (ส่ง request ว่างและต้องได้ 200) เป็นพฤติกรรมของ LINE ไม่ได้ระบุในเรพ -->

หลังยิง event จริง ให้ตรวจ state ด้วย `curl.exe -s -H "x-seed-token: $S" "$B/api/bill?room=203"` (สถานะต้องเปลี่ยนตาม event) เพราะ webhook ตอบ `200` เสมอเมื่อ parse ผ่าน — **200 ไม่ได้แปลว่า event ทำงานสำเร็จ** ดู `console.error("event failed", ...)` ใน Vercel logs ด้วย

## 7. LINE end-to-end script (ต้องมีคนจริง 2 คน)

สิ่งที่ต้องเตรียม:
- LINE OA ของหอ (HANDOFF ระบุชื่อ `P'CAT HOUSE` / `@218nhslf`) ที่ผูก LIFF แล้ว และ **เปิด webhook**
- LIFF app ที่ endpoint `https://<โดเมน>/liff/bill.html`, size Tall, **scope `openid` ติ๊กแล้ว**
- บัญชี LINE 2 บัญชี: เจ้าของ (ต้องเป็น `OWNER_USER_ID` เป๊ะ) และผู้เช่า
- มีบิลของห้องนั้นอยู่ก่อน (`/api/dev?do=seed` หรือ `/api/run`)

<!-- VERIFY: ชื่อ OA, LIFF id และการตั้งค่า scope openid มาจาก HANDOFF.md/README ไม่ได้ตรวจกับ LINE Developers Console ในรอบนี้ -->

| # | ใคร | ทำอะไร | ผลที่ต้องเห็น | เกิดอะไรขึ้นเบื้องหลัง |
|---|---|---|---|---|
| 1 | ผู้เช่า | เพิ่มเพื่อน OA (กดเพิ่มเพื่อน) | ข้อความต้อนรับ: "สวัสดีครับ 👋 ระบบบิลของหอพัก … พิมพ์ “บิล”" | event `follow` → เขียน `user:<userId>` |
| 2 | ผู้เช่า | พิมพ์ `บิล` (ยังไม่ผูก) | "ยังไม่ได้ผูกห้องครับ — สแกน QR หน้าห้องที่เจ้าของหอให้มา" | อ่าน `user-room:<userId>` ไม่เจอ |
| 3 | คนอื่น | สแกน QR ห้อง 203 หลังผู้เช่าผูกแล้ว | "ห้อง 203 มีผู้เช่าผูกไว้แล้ว…" (`409 ROOM_TAKEN`) | ไม่เขียนอะไร · ผู้เช่าเดิมยังได้บิล |
| 4 | ผู้เช่า | สแกน QR หน้าห้อง 203 | หน้า LIFF "ผูกกับห้อง 203 แล้ว" · เจ้าของได้ข้อความแจ้ง | เขียน `user-room:<userId>` และ `room-user:203` |
| 5 | ผู้เช่า | พิมพ์ `บิล` | การ์ด Flex: "ห้อง 203", ยอดรวม, ครบกำหนด, ปุ่ม "ดูบิล / แนบสลิป" | `billBubble()` ถูกส่งผ่าน `reply()` |
| 6 | ผู้เช่า | กดปุ่มในการ์ด | LIFF เปิด, ล็อกอิน, เห็นหน้า "ห้อง 203", pill "ยังไม่ชำระ", ปุ่ม "แนบสลิป & แจ้งชำระ" | `liff.init` → `getIDToken()` → `GET /api/me` → `GET /api/bill` |
| 7 | ผู้เช่า | เลือกรูปสลิป → กดแนบ | "แจ้งชำระแล้ว — รอเจ้าของหอยืนยัน", pill เปลี่ยนเป็น "รอตรวจสอบ" | `POST /api/slip` → `status:"pending"` + push การ์ดหาเจ้าของ |
| 8 | เจ้าของ | เปิดแชท | การ์ด "ห้อง 203 แจ้งชำระ" + ยอด + ปุ่ม "ยืนยันการชำระ" (และ "ดูสลิป" ถ้ามี `LIFF_ID`) | `confirmBubble()` ถูก push จาก `api/slip.js` |
| 9 | เจ้าของ | กด "ยืนยันการชำระ" | "ยืนยันห้อง 203 แล้ว ✅" | event `postback` → `bill:203.status = "paid"` + `paidAt` |
| 10 | ผู้เช่า | รอ/เปิดแชท | ข้อความ "ห้อง 203 ชำระเงินแล้ว ✅ เจ้าของหอยืนยันเรียบร้อย" | `push` หา `room-user:203` (ข้ามถ้าเป็นคนเดียวกับผู้กด) |
| 11 | ผู้เช่า | เปิด LIFF อีกครั้ง | pill "ชำระแล้ว", note "ใบเสร็จออกแล้ว", ปุ่มแนบสลิป disabled | `status === "paid"` ในหน้าเว็บ |
| 12 | เจ้าของ | กด "ยืนยันการชำระ" ซ้ำ | "ห้อง 203 ยืนยันไปแล้วครับ" | guard `if (bill.status === "paid")` |
| 13 | เจ้าของ | เปิด LIFF → หน้าจดมิเตอร์ (`?tab=meter`) | เห็น 12 ห้อง, ช่องน้ำ/ไฟ, ปุ่ม "ออกบิล … บาท" | `GET /api/rooms` |
| 14 | เจ้าของ | กรอกหน่วย → กดออกบิล | "ออกบิลรอบ 2026-12 แล้ว 1 ห้อง · ส่งการ์ด 1 ห้อง" | `POST /api/run` → บิลใหม่ `unpaid` + push การ์ดรอบใหม่ |
| 15 | ผู้เช่า | ดูการ์ดรอบใหม่ | การ์ดยอดใหม่ (การ์ดเก่าไม่เปลี่ยน) | Flex message แก้ย้อนหลังไม่ได้ |
| 16 | เจ้าของ | กด "ดูสลิป" ในหน้าจดมิเตอร์ | เห็นรูปสลิปของห้องนั้น | `GET /api/slip-image?room=...` |

จุดที่พลาดบ่อย (มาจากโค้ดและ HANDOFF):

- **QR ผูกได้เฉพาะห้องที่ยังว่าง** — ถ้าได้ `ROOM_TAKEN` ให้เจ้าของกด "เปลี่ยนผู้เช่า" ในหน้า QR ของห้องก่อน · test อัตโนมัติอยู่ใน `node smoke-handlers.js`
- **การ์ดยืนยันส่งหา `OWNER_USER_ID` เท่านั้น** — ถ้าเจ้าของไม่ได้รับ ให้เช็ก env นี้และ `LINE_CHANNEL_ACCESS_TOKEN`
- **webhook ตอบ 200 เสมอ** แม้ event ล้มเหลว → อย่าดูแค่ status ให้ดูข้อความที่ผู้ใช้ได้รับและ Vercel logs
- **การ์ดเก่าไม่ถูกแก้** — เปลี่ยนยอด/ลิงก์แล้วต้องส่งการ์ดใหม่
- **LIFF ขึ้น "ใช้งานไม่ได้"** → มักเป็น `liffId` เป็น `null` (`/api/config`) หรือไม่ได้เปิด scope `openid`
- **ขั้น 10 อาจไม่เกิด** ถ้าเจ้าของกับผู้เช่าเป็น LINE บัญชีเดียวกัน (`tenant !== userId` เป็นเงื่อนไข)

## 8. พื้นที่ที่ยังไม่มีใครทดสอบ (และความเสี่ยง)

### 8.1 `x-seed-token` — auth bypass ที่ตั้งใจไว้

`api/_auth.js` บรรทัด 17–20: ถ้า header ตรงกับ `SEED_TOKEN` จะข้ามการตรวจ idToken ทั้งหมดแล้วคืน `OWNER_USER_ID` (หรือ `"dev"`)

- ไม่มีเทสต์ใด ๆ ทั้งอัตโนมัติและ manual ที่ยืนยันว่า **production ปิด bypass นี้แล้ว**
- ความเสี่ยง: ใครถือ token เรียก API ในนามเจ้าของได้ทุก endpoint; token ยังเดินทางใน query string ของ `/api/dev?do=seed` และ `/api/dev?do=sendbill` → ติดใน access log ของ Vercel
- วิธีเช็กขั้นต่ำ: `curl.exe -s -o NUL -w "%{http_code}" -H "x-seed-token: wrong" $B/api/me` ต้องได้ `401` และตั้ง `SEED_TOKEN` เป็นค่ายาว/สุ่ม ถ้าจะใช้กับหอจริงให้ลบบล็อกนั้นออกแล้ว redeploy

<!-- VERIFY: สถานะจริงบน production ว่าตอนนี้ SEED_TOKEN ตั้งไว้หรือไม่ และ bypass ยังเปิดอยู่ไหม — ไม่มีไฟล์ในเรพยืนยัน ต้องดู Environment Variables ใน Vercel -->

### 8.2 การเข้าถึงรูปสลิปแบบ private

- `slip-image.js` กันด้วย `requireUser` + `bound === room` (หรือ owner) แต่ **ไม่มีเทสต์อัตโนมัติ** และไม่มีเทสต์ว่า blob URL ตรง ๆ เข้าถึงไม่ได้
- ความเสี่ยง: ถ้าเปลี่ยน `access: "private"` เป็น `"public"` ใน `_store.js`/`slip.js` โดยไม่ตั้งใจ รูปสลิปจะกลายเป็น URL ที่เดาได้ (path เป็น `slips/<room>-<timestamp>.<ext>` — เดา timestamp ยากแต่ไม่ใช่ความลับ)
- วิธีเช็กขั้นต่ำ: เรียก `?room=<ห้องอื่น>` ด้วยตัวตนผู้เช่า ต้องได้ `403`; เอา URL ของ blob (ถ้าหารู้) เปิดในเบราว์เซอร์โดยไม่แนบ token ต้องไม่เห็นรูป
- ยังไม่มีใครทดสอบว่า owner เห็นสลิปได้ทุกห้องจริง และผู้เช่าเห็นได้เฉพาะห้องตัวเอง

### 8.3 Race conditions

ข้อมูลทุกก้อนเป็น "อ่าน–แก้–เขียน" ทั้งไฟล์ (`_store.js` ไม่มี transaction/lock) จุดที่แข่งกันได้จริง:

| สถานการณ์ | ผลที่อาจเกิด | เทสต์ที่มี |
|---|---|---|
| ผู้เช่ากดแนบสลิป 2 ครั้งพร้อมกัน | สอง request อ่านบิล `unpaid` คนละรอบ แล้วเขียนทับ → `slipPath` เหลืออันเดียว, มีการ push การ์ดเจ้าของ 2 ใบ | ❌ ไม่มี |
| เจ้าของกดยืนยันพร้อมกัน 2 เครื่อง | ทั้งคู่ผ่าน guard `status !== "paid"` → push ผู้เช่า 2 ครั้ง, `paidAt` ทับกัน | ❌ ไม่มี |
| `/api/run` ออกรอบใหม่ระหว่างที่ผู้เช่าแนบสลิป | บิลถูกเขียนทับเป็น `unpaid` หลัง `pending` → สลิปที่แนบหายจากสถานะ | ❌ ไม่มี |
| 2 คนสแกน QR ห้องว่างเดียวกันพร้อมกันเป๊ะ | Blob ไม่มี lock → คนหลังอาจทับคนแรก (เจ้าของได้ข้อความแจ้งทั้งสองครั้ง) | ⚠️ เหลือความเสี่ยงต่ำ · ห้องที่มีคนผูกแล้วแย่งไม่ได้ (`smoke-handlers.js`) |

ทั้งหมดนี้ยอมรับได้ในบริบทหอเล็ก ๆ (1 เจ้าของ, ผู้เช่าไม่กี่คน) แต่ **ต้องรู้ว่ามันมี** ก่อนขยายใช้งาน — ไม่มีทางทดสอบซ้ำได้ด้วยมืออย่างน่าเชื่อถือ ถ้าจะแก้จริงต้องเพิ่ม idempotency key หรือย้ายไป DB ที่มี conditional write

### 8.4 Webhook ไม่มี idempotency

ไม่มี `webhookEventId` ถูกเก็บ → LINE retry (เมื่อตอบช้า/ไม่ถึง 200 ภายในเวลาที่ LINE กำหนด) จะทำให้ event ทำงานซ้ำ เช่น `follow` เขียน `user:` ซ้ำ (ไม่เสียหาย) แต่ postback confirm ซ้ำจะ push ผู้เช่าเพิ่ม (guard `paid` ช่วยได้บางส่วน) ไม่มีเทสต์ใดครอบคลุมเรื่องนี้

### 8.5 postback `action=confirm` ไม่ตรวจว่าเป็นเจ้าของ

`webhook.js` ไม่เทียบ `event.source.userId` กับ `OWNER_USER_ID` — ใครก็ส่ง postback นี้ได้ถ้ามี signature ของ LINE (คือต้องผ่านแชท) ผลคือผู้เช่าที่รู้ format `action=confirm&room=203` อาจยืนยันบิลเองได้ผ่านช่องทางที่ระบบไม่ได้ป้องกันไว้

- ไม่มีเทสต์, ไม่มี guard
- วิธีทดสอบด้วยมือ: ส่ง postback จากบัญชีผู้เช่า (ทำได้ยากจาก UI เพราะไม่มีการ์ดนั้น) — ถ้าทำได้จะเห็นบิลเป็น `paid` → ยืนยันช่องโหว่
- จัดเป็นความเสี่ยงระดับ **ต้องแก้ก่อนใช้กับหอจริง**

### 8.6 เรื่องอื่นที่ยังไม่ครอบคลุม

| เรื่อง | สถานะ |
|---|---|
| ขนาดรูป > 3 MiB (`413`) | ไม่มีเทสต์; หน้า LIFF ย่อรูปก่อนส่งจนแทบไม่ถึง limit |
| `data:` URL ที่ base64 เสีย | regex ผ่านแต่ `Buffer.from` ได้ byte เพี้ยน → เขียน Blob แล้วรูปเปิดไม่ได้ |
| เปลี่ยน env แล้วค่าไม่เปลี่ยน | ต้อง redeploy (env อ่านตอน module load) — ไม่มีเทสต์/คำเตือนในระบบ |
| Node version | `engines: ">=20"` แต่ทดสอบจริงบน `v26.13.0` — ยังไม่มีใครรันบน 20.x |
| หน้า LIFF บน LINE จริง (ขนาดหน้าจอ/กล้อง) | manual เท่านั้น |
| Blob quota / ไฟล์สลิปเก่าสะสม | ไม่มีการลบไฟล์เก่า (`slipPath` เปลี่ยนแต่ไฟล์เดิมอยู่) — ไม่มีเทสต์ ไม่มีงานล้าง |
| ไม่มี CI | regression ถูกจับได้แค่เมื่อมีคนรัน `node smoke.js` และทดสอบมือ |

## 9. Checklist ก่อน deploy (สั้นและใช้จริง)

1. `node smoke.js` ผ่าน และ exit code = 0
2. ถ้าแตะ `_line.js` / `_rooms.js` → มี assert ใหม่ใน `smoke.js` (หรืออย่างน้อยรันคำสั่งในข้อ 5.1/5.2 ด้วยมือ)
3. ถ้าแตะ endpoint → ยิงเคสหลัก + เคส error 1 ข้อจาก matrix ข้อ 6 บน deployment
4. ถ้าแตะ webhook/LINE → ทำ E2E ข้อ 7 อย่างน้อยขั้น 4→9
5. ตรวจว่าไม่ได้ทิ้ง `x-seed-token` ไว้ในที่ที่ผู้ใช้เห็น และไม่พิมพ์ `SEED_TOKEN` ลงแชท/สกรีนช็อต
6. จำไว้ว่า **การแก้ env ต้อง redeploy** ก่อนสรุปว่ายังพัง

## เอกสารที่เกี่ยวข้อง

- [`DEVELOPMENT.md`](./DEVELOPMENT.md) — code style, shared module contract, code review checklist
- [`API.md`](./API.md) — endpoint, error envelope, สิทธิ์ที่ตรวจ/ไม่ตรวจ (แหล่งของ matrix ข้อ 6)
- [`CONFIGURATION.md`](./CONFIGURATION.md) — env ทุกตัวและผลของการไม่ตั้ง
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — data flow, state machine ของบิล, ข้อจำกัดเรื่อง race
- [`../HANDOFF.md`](../HANDOFF.md) — กับดักที่เจอมาแล้ว, งานที่ยังเหลือ
