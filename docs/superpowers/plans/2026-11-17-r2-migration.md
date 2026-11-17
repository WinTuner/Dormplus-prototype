# ย้าย `line-app` ไป Cloudflare R2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: ใช้ `superpowers:subagent-driven-development` หรือ `superpowers:executing-plans` เพื่อทำตามแผนทีละ task · ขั้นตอนใช้ checkbox (`- [ ]`) เพื่อติดตาม

**Goal:** ย้ายข้อมูลทั้งหมดของ `line-app` (คีย์ `kv/*.json` + รูป `slips/*`) จาก Vercel Blob ไป Cloudflare R2 โดยไม่ให้ผู้ใช้เห็นข้อมูลหาย และถอยกลับได้ใน 5 นาที

**Architecture:** โค้ดรองรับสอง backend อยู่แล้ว — `api/_store.js` เลือก R2 เมื่อมี `R2_BUCKET` ไม่งั้นใช้ Blob (พาธเดิมทั้งสองฝั่ง) การย้ายจึงเป็น "คัดลอกข้อมูล → ตั้ง env → redeploy" ไม่มีการแก้โค้ด · ใช้สคริปต์ `line-app/scripts/migrate-blob-to-r2.js` ซึ่งรันซ้ำได้ (เขียนทับด้วยข้อมูลเดียวกัน)

**Tech Stack:** Cloudflare R2 (S3 API), `aws4fetch`, Vercel Blob (`@vercel/blob`), Vercel env + redeploy, `node`

**Spec:** [`docs/DEPLOYMENT.md` §3.2](../../DEPLOYMENT.md) (runbook ที่ merge แล้วใน PR #80) · โค้ด: `line-app/api/_store.js`, `line-app/api/_store-r2.js`, `line-app/scripts/migrate-blob-to-r2.js`

## Global Constraints

- ห้ามแก้โค้ดในรอบนี้ — ถ้าต้องแก้ แปลว่ามีบั๊ก ให้หยุดและแก้เป็น PR แยกก่อน
- `R2_BUCKET` ต้องไม่ถูกตั้งบน production จนกว่าการคัดลอกรอบสุดท้ายจะเสร็จ (โค้ดสลับทันทีที่เห็นตัวแปรนี้)
- ต้องมี env ครบทั้ง 4 ตัวเมื่อสลับ: `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — ขาดตัวใดตัวหนึ่ง `createStore()` โยน error → ทุก endpoint เป็น 500
- ห้ามลบ Blob store หรือ token ก่อนผ่านไป 7 วัน
- ช่วงสลับต้องเป็นเวลาที่คนใช้น้อย (แนะนำ 01:00–02:00 เวลาไทย ซึ่ง cron 02:00 UTC = 09:00 ไทย ยังไม่ทำงาน)
- ทุกคำสั่งที่ต้องใช้ credential รันบนเครื่องคุณเท่านั้น (ผมไม่มี credential ใน session นี้)

## Review Focus

- **ข้อมูลที่เขียนระหว่างคัดลอกกับสลับ** — ถ้ามีคนแนบสลิป/ออกบิลในช่วงนั้น ข้อมูลจะอยู่บน Blob แต่ระบบอ่าน R2 → ต้องคัดลอกรอบสองให้ชิดเวลาสลับที่สุด
- **รูปสลิป (`slips/*`)** — ถ้าคัดลอกแต่ `kv/` ผู้ใช้จะแนบสลิปใหม่ได้แต่ดูสลิปเก่าไม่ได้ (404) → ต้องคัดลอกทั้งสอง prefix
- **`slip-image.js`** — ต้องคืนรูปได้หลังสลับ (ทดสอบด้วยรูปจริง 1 รูป ไม่ใช่แค่ 200)
- **ความหน่วง** — ทุก read เปลี่ยนเป็น HTTP ไป Cloudflare → วัด `/api/rooms` ก่อน/หลัง
- **`R2_BUCKET` ค้างใน Preview** — ถ้าตั้งเฉพาะ Production แต่ Preview ไม่มี ระบบ Preview จะยังเขียนลง Blob (แยกข้อมูลสองที่) → ตั้งให้ตรงกันหรือปิด Preview ของ branch นั้น

---

### Task 0: Pre-flight — รู้สถานะจริงก่อนแตะอะไร

**Files:** ไม่มี (อ่านเท่านั้น)

- [ ] **Step 1: ยืนยันว่า production ยังใช้ Blob**

```bash
cd line-app
vercel env ls production | grep -E "R2_|BLOB_STORE"
```

Expected: เห็น `BLOB_STORE_ID` และ **ไม่เห็น** `R2_BUCKET`

- [ ] **Step 2: บันทึกจำนวน ops ปัจจุบันไว้เทียบ**

Vercel dashboard → Project `line-app` → Usage → Blob: จดตัวเลข Simple Requests วันนี้
Expected: ตัวเลขหลักพัน (ก่อนแก้ fan-out) หรือหลักร้อย (หลัง PR #80)

- [ ] **Step 3: ดูจำนวน/ขนาดข้อมูลจริง (dry run)**

```bash
cd line-app
BLOB_READ_WRITE_TOKEN=<token ที่สร้างใน Task 1> node scripts/migrate-blob-to-r2.js --dry
```

Expected:
```text
kv/ N ไฟล์
slips/ M ไฟล์
จะคัดลอก N+M ไฟล์ · X.Y MB
โหมด --dry: ไม่ได้เขียนอะไรลง R2
```
จด N, M, X.Y ไว้ในรายงาน — ใช้ยืนยันตอนคัดลอกจริงว่ารอบสองได้จำนวนเท่ากัน

- [ ] **Step 4: วัด baseline ของหน้าเจ้าของ**

```bash
curl -s -o /dev/null -w "%{time_total}\n" https://<line-app-domain>/api/config
```
Expected: < 0.5s (ตัวเลขนี้คือ baseline หลังสลับต้องไม่แย่ลงเกิน ~20%)

---

### Task 1: เตรียม credential (ต้องทำด้วยมือ — ผมทำแทนไม่ได้)

**Files:** ไม่มี

- [ ] **Step 1: สร้าง R2 bucket**

Cloudflare dashboard → R2 → Create bucket → ชื่อ `domplus-<ชื่อหอ>` · region: **APAC** (Auto)
Expected: bucket ใหม่ ยังว่าง

- [ ] **Step 2: สร้าง S3 API token ของ bucket**

R2 → Manage R2 API Tokens → Create API token → permission **Object Read & Write** → scope เฉพาะ bucket นั้น
Expected: ได้ 3 ค่า — `Access Key ID`, `Secret Access Key`, และ Account ID (อยู่มุมขวาของหน้า R2)

- [ ] **Step 3: สร้าง Blob read/write token สำหรับสคริปต์คัดลอกเท่านั้น**

Vercel → Project `line-app` → Storage → Blob store → Tokens → Create **Read & Write**
Expected: ได้ `vercel_blob_rw_...`
เหตุผล: runtime ใช้ OIDC แต่สคริปต์ที่รันบนเครื่องอ่าน OIDC ไม่ได้

- [ ] **Step 4: จดค่าไว้ใน password manager (ไม่ใช่ในไฟล์ในเรพ)**

Expected: มี 5 ค่า — `BLOB_READ_WRITE_TOKEN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`

---

### Task 2: คัดลอกรอบแรก (bulk) — ทำได้เลย ไม่กระทบผู้ใช้

**Files:** ไม่มี (รันสคริปต์)

- [ ] **Step 1: คัดลอกทุกไฟล์**

```bash
cd line-app
export BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
export R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=domplus-...
node scripts/migrate-blob-to-r2.js
```

Expected: จำนวน `kv/` และ `slips/` **เท่ากับ** ตอน `--dry` และขึ้นบรรทัดสรุป `คัดลอกแล้ว N+M ไฟล์ · X.Y MB`

- [ ] **Step 2: ตรวจว่า R2 มีของจริง**

Cloudflare dashboard → R2 → bucket → Objects
Expected: เห็น `kv/` และ `slips/` พร้อมจำนวนไฟล์เท่ากัน

- [ ] **Step 3: สุ่มตรวจ 1 คีย์และ 1 รูป**

```bash
# คีย์ JSON: ดูว่าอ่านได้และหน้าตาเหมือน Blob
BLOB_READ_WRITE_TOKEN=... R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=... \
  node -e "const s=require('./api/_store-r2').createStore();s.getText('kv/dorm.json').then(t=>console.log(t))"
```
Expected: JSON ของการตั้งค่าหอ (หรือ `null` ถ้าหอยังไม่เคยตั้งค่า)

- [ ] **Step 4: หยุดพัก — ยังไม่ตั้ง env ใด ๆ บน Vercel**

Expected: production ยังทำงานบน Blob ตามปกติ

---

### Task 3: ช่วงสลับ (ทำต่อเนื่อง ~15 นาที ช่วง 01:00–02:00 เวลาไทย)

**Files:** ไม่มี

- [ ] **Step 1: แจ้งเจ้าของหอ/ผู้ช่วยว่าจะมีช่วงระบบนิ่ง ~10 นาที (ถ้าจำเป็น)**

Expected: ไม่มีคนกดแนบสลิป/ออกบิลระหว่างนี้

- [ ] **Step 2: คัดลอก delta รอบสอง (สคริปต์รันซ้ำได้)**

```bash
cd line-app
node scripts/migrate-blob-to-r2.js
```
Expected: จำนวนไฟล์เท่าเดิมหรือมากกว่าเล็กน้อย (ไฟล์ใหม่ที่เพิ่งเกิด) — ไม่มี error

- [ ] **Step 3: ตั้ง env ทั้ง 4 ตัวบน Production (และ Preview ถ้าใช้ preview deploy)**

```bash
cd line-app
vercel env add R2_BUCKET production            # ใส่ domplus-...
vercel env add R2_ACCOUNT_ID production
vercel env add R2_ACCESS_KEY_ID production
vercel env add R2_SECRET_ACCESS_KEY production
```
Expected: `vercel env ls production` เห็นครบ 4 ตัว

- [ ] **Step 4: Redeploy production**

```bash
vercel --prod
```
หรือ Vercel dashboard → Deployments → … → Redeploy (ใช้ build เดิม)
Expected: deployment ใหม่สถานะ Ready
เหตุผล: Vercel ผูก env กับ deployment — ต้อง redeploy ค่าใหม่จึงมีผล

- [ ] **Step 5: ตรวจว่าโค้ดเลือก R2 จริง**

```bash
vercel env ls production | grep R2_BUCKET
curl -s https://<line-app-domain>/api/config
```
Expected: env มีค่า · `/api/config` ตอบ 200 พร้อม `liffId` (ถ้า 500 → env ขาดตัวใดตัวหนึ่ง ให้ย้อน Task 4 ทันที)

---

### Task 4: ตรวจหลังสลับ (ต้องผ่านทุกข้อ ไม่งั้น rollback)

**Files:** ไม่มี

- [ ] **Step 1: smoke ภายนอก**

```bash
node scripts/prod-smoke.mjs
```
Expected: ผ่านทั้ง 14 ข้อ (exit 0)

- [ ] **Step 2: เปิด LIFF ของห้องที่มีบิลค้าง**

มือถือ → เปิด LIFF จากเมนู → เห็นบิล + ยอด + QR
Expected: ข้อมูลเหมือนก่อนสลับ (ไม่มี "ยังไม่มีบิลรอบนี้" ทั้งที่ควรมี)

- [ ] **Step 3: ดูสลิปเก่า 1 รูป (สำคัญ — พิสูจน์ว่า `slips/*` ครบ)**

หน้าเจ้าของ → "สลิปรอตรวจ" → กด "ดูสลิป"
Expected: รูปขึ้น ไม่ใช่ 404 และไม่ใช่ภาพเปล่า
ถ้า 404 → แปลว่า `slips/` ยังไม่ครบ: `node scripts/migrate-blob-to-r2.js --only=slips` แล้วลองใหม่

- [ ] **Step 4: ทดสอบเขียน 1 ครั้ง**

แนบสลิปใหม่ 1 ครั้งจากห้องทดสอบ แล้วดูว่าไฟล์ไปโผล่ใน R2 (`slips/` มีไฟล์ใหม่) และหน้าเจ้าของเห็น
Expected: เขียนลง R2 สำเร็จ · Blob ไม่มีไฟล์ใหม่

- [ ] **Step 5: วัดความหน่วงเทียบ baseline**

```bash
curl -s -o /dev/null -w "%{time_total}\n" https://<line-app-domain>/api/config
```
Expected: ไม่แย่ลงเกิน ~20% จาก Task 0 Step 4 (ถ้าแย่กว่านั้น: บันทึกไว้เป็น follow-up ไม่ต้อง rollback เพราะเป็นเรื่อง latency ไม่ใช่ข้อมูล)

---

### Task 5: Rollback (ถ้า Task 4 ข้อ 1–4 ข้อใดตก)

**Files:** ไม่มี

- [ ] **Step 1: ถอด `R2_BUCKET` ออก**

```bash
cd line-app
vercel env rm R2_BUCKET production
vercel --prod
```
Expected: ระบบกลับไปอ่าน Blob ภายใน ~2 นาที

- [ ] **Step 2: ตรวจว่าใช้งานได้**

```bash
node scripts/prod-smoke.mjs
```
Expected: exit 0 และบิล/สลิปกลับมาเห็นครบ

- [ ] **Step 3: บันทึกว่าข้อมูลช่วงสั้น ๆ ที่เขียนลง R2 จะไม่กลับไป Blob**

Expected: ถ้ามีการแนบสลิป/ออกบิลระหว่างที่อยู่บน R2 ให้คัดลอกไฟล์/คีย์เหล่านั้นกลับ (สคริปต์เดียวกันแต่สลับทิศ) หรือยอมรับว่าข้อมูลช่วงนั้นหาย — ต้องตัดสินตอนนั้น

---

### Task 6: ปิดงาน (ทำใน 24 ชม. หลังสลับสำเร็จ)

**Files:**
- Modify: `docs/DEPLOYMENT.md` (§3.2 เพิ่มวันที่ย้ายจริง + ชื่อ bucket)
- Modify: `README.md` (ถ้าตารางสถานะระบุ Blob อยู่)

- [ ] **Step 1: ยืนยันว่า Blob หยุดโต**

Vercel → Usage → Blob: Simple Requests ของวันนี้ต้องไม่เพิ่มขึ้น (เทียบ Task 0 Step 2)
Expected: เพิ่มขึ้นเฉพาะจาก cron/ปลายทางที่ยังไม่ได้ย้าย (ถ้ามี)

- [ ] **Step 2: ยืนยันว่า R2 รับงานจริง**

Cloudflare → R2 → Metrics: Class A/B operations มีตัวเลขและยังต่ำกว่าโควตาฟรีมาก
Expected: หลักร้อย–หลักพัน/วัน

- [ ] **Step 3: ลบ Blob read/write token ที่สร้างใน Task 1 (เก็บ OIDC ไว้เหมือนเดิม)**

Expected: `vercel env ls` ไม่มี token นั้นแล้ว · runtime ใช้ OIDC ต่อได้

- [ ] **Step 4: ตั้งปฏิทินเตือน 7 วันเพื่อลบ Blob store**

Expected: มี reminder — ระหว่างนี้ Blob คือ backup เย็น

- [ ] **Step 5: อัปเดตเอกสาร + PR**

```bash
git checkout -b docs/r2-migrated
# แก้ docs/DEPLOYMENT.md §3.2: วันที่ย้าย, ชื่อ bucket, region
git add docs/DEPLOYMENT.md README.md
git commit -m "docs: record the R2 migration"
```

Expected: PR เขียวและ merge — เอกสารบอกความจริงว่ารันอยู่บน R2 แล้ว

---

## ลำดับเวลาโดยสรุป (พรุ่งนี้)

| เวลา | งาน | ใคร | ใช้เวลา |
|---|---|---|---|
| ก่อนเที่ยง | Task 0–1 (pre-flight + credential) | คุณ | 20 นาที |
| บ่าย | Task 2 (bulk copy + สุ่มตรวจ) | คุณ (ผมช่วยสั่ง/อ่านผลได้) | 15–40 นาที ตามขนาดข้อมูล |
| 01:00–02:00 | Task 3 (delta + env + redeploy) | คุณ | 15 นาที |
| ต่อเนื่อง | Task 4 (ตรวจ 5 ข้อ) | คุณ + ผมช่วยอ่านผล | 15 นาที |
| เช้าวันถัดไป | Task 5/6 (rollback ถ้าจำเป็น หรือปิดงาน) | คุณ | 10 นาที |

## สิ่งที่ผมทำให้ได้ทันทีเมื่อคุณพร้อม

- รัน Task 0 Step 3 (`--dry`) ได้ทันทีถ้าคุณส่ง `BLOB_READ_WRITE_TOKEN` มาให้ใน session (ไม่แนะนำให้แปะในแชท — ควรรันเอง)
- อ่าน output ของแต่ละ step แล้วบอกว่าผ่าน/ไม่ผ่าน
- แก้เอกสาร (Task 6 Step 5) และเปิด PR ให้
