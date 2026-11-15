# เปรียบเทียบผู้ให้บริการตรวจสลิปโอนเงิน (Slip Verification API) — สำหรับหอพัก 42 ห้อง

> วันที่เข้าถึงแหล่งข้อมูลทั้งหมด: **16 พฤศจิกายน 2026**
> ราคาทุกตัวเลขคัดลอกตามที่เขียนบนหน้าทางการ ณ วันนั้น (THB)
> เกณฑ์ตัดสินมาจาก acceptance criteria ของสินค้า: amount / receiver account / transRef (กันใช้ซ้ำ) / date-time / ครอบคลุมทุกธนาคาร + PromptPay

---

## 1. คำตอบสั้น

**แนะนำ: EasySlip — แพ็กเกจ Start 99 บาท/เดือน (ตรวจได้ 250 ครั้ง)** เพราะเป็นราคาต่ำสุดในกลุ่มผู้ให้บริการที่มีตัวตนชัดเจน (บริษัท อีซี่สลิป จำกัด, DBD registered), เอกสาร API ครบและตรงกับสิ่งที่ต้องใช้ที่สุด — มี `matchAmount` และ `matchAccount` ให้ระบบเป็นคนเทียบยอด/บัญชีผู้รับให้ ไม่ต้องเอาเลขบัญชีที่ถูก mask มาเทียบเอง, คืน `transRef` + `date` + `isDuplicate` ครบใน response เดียว

**รองชนะเลิศ: SlipOK — OK BASIC 0 บาท/เดือน (100 สลิป)** ซึ่งจริง ๆ ถูกที่สุดในตลาดและฟีเจอร์ครบ แต่มีเหตุกังวลเรื่องสุขอนามัยความปลอดภัยของเว็บ (ดู §4.3) จึงควรใช้เมื่อ "ต้องเป็นศูนย์บาทจริง ๆ" และควรลองคุย support ก่อน

**ไม่แนะนำให้ต่อ API ธนาคารตรง** (KBank/SCB) สำหรับหอพักขนาดนี้ — KBank รับเฉพาะนิติบุคคลและต้องผ่าน partner onboarding, SCB เป็น "Contact Sale"

---

## 2. ตารางเทียบ

### 2.1 ราคาและโควตา (หน้า pricing ทางการ, 16 พ.ย. 2026)

| ผู้ให้บริการ | แพ็กเกจที่เหมาะกับ ~45 สลิป/เดือน | ราคา | โควตา | เกินโควตา | VAT | ฟรี |
|---|---|---|---|---|---|---|
| **EasySlip** | Start | **99 บาท/เดือน** | 250 ครั้ง / 30 วัน | ไม่มี — ระบบหยุดเมื่อหมดโควตา (403 `QUOTA_EXCEEDED`) | ไม่ระบุบนหน้าว่า inclusive | Tester ฟรี 7 วัน / 50 ครั้ง |
| **SlipOK** | OK BASIC | **0 บาท/เดือน** | 100 สลิป/เดือน | 1.00 บาท/รายการ (Basic) | ไม่ระบุ | คือแพ็กเกจฟรี |
| **SlipOK** | OK START | 350 บาท/เดือน | 500 สลิป | 0.70 บาท/รายการ | ไม่ระบุ | — |
| **Check-Slip** (Hyphen Plus) | Trial | **99 บาท/เดือน** | 150 สลิป | 1.000 บาท/สลิป | **รวม VAT 7% แล้ว** (ระบุชัด) | ฟรี 50 สลิป / ร้าน + trial 7 วัน |
| **CheckSlips / "SlipVerify"** | Starter (ฟรี) | **0 บาท** | 100 สลิป/เดือน, **สูงสุด 10 สลิป/วัน** | ไม่มีส่วนเกิน — ตอบ 429 | ไม่ระบุ | คือแพ็กเกจฟรี (ไม่ต้องผูกบัตร) |
| **CheckSlips / "SlipVerify"** | Growth | 799 บาท / 30 วัน | 3,000 สลิป | ไม่มี | ไม่ระบุ | — |
| **UP2Slip** | จ่ายตามจริง | **1.00 บาท/ครั้ง** | ไม่มีรายเดือน | — | ไม่ระบุ | ไม่พบ free tier |
| **SlipOK** (ขนาดใหญ่) | OK SME / ENTERPRISE / GOLD | 600 / 1,000 / 2,580 | 1,000 / 2,000 / 6,000 | 0.60 / 0.50 / 0.43 | ไม่ระบุ | — |
| **EasySlip** (ขนาดใหญ่) | Basic / Starter / Beginner | 350 / 700 / 1,200 | 1,000 / 2,500 / 4,500 | ไม่มีส่วนเกิน | ไม่ระบุ | — |
| **KBank Slip Verification** | — | **ไม่เปิดเผยราคา** (credit-based, ต้อง onboard partner) | — | — | — | — |
| **SCB Slip Verification** | — | **"Contact Sale"** | — | — | — | — |

หมายเหตุ SlipOK: หน้าเว็บมีตัวเลือกระยะสัญญา 3/6/12/24 เดือน ลด 10/20/30/40% (เช่น OK START 12 เดือน = 245 บาท/เดือน) — แต่อย่าซื้อรายปีสำหรับหอพัก เพราะโควตา Basic ไม่ยกยอด

หมายเหตุ EasySlip: หน้า `easyslip.com/api-products` และ `developer.easyslip.com/product` แสดงราคาตรงกัน (99/250, 350/1,000, 700/2,500, 1,200/4,500, 1,500/6,000, 3,500/17,500, 5,000/35,000)

**"per call" นับอะไร** — ต่างกันและมีผลกับต้นทุนจริง:
- **EasySlip**: ทุก call นับ 1 transaction **รวมสลิปที่หมดอายุ สลิปปลอม และสลิปที่ไม่มีอยู่จริง** (ข้อ 2.3.1 ใน Terms) → ลูกค้าส่งสลิปผิด/เก่ามา 3 ครั้ง = เสีย 3 ครั้ง
- **SlipOK**: นับสลิปถูกต้อง + สลิปปลอม **แต่สลิปซ้ำไม่นับเป็นรายการใหม่** (FAQ)
- **Check-Slip / UP2Slip**: UP2Slip คิดเฉพาะ "รายการที่เช็คสำเร็จ"

### 2.2 ครอบคลุมธนาคาร / QR

| ผู้ให้บริการ | ขอบเขตที่ประกาศบนหน้าทางการ | รูปแบบ input |
|---|---|---|
| EasySlip | "18+ Banks" — KBANK, SCB, BBL, KTB, BAY, TTB และอื่น; มีตาราง **slip age ต่อธนาคาร** (SCB/KMA/TTB/GSB 7 วัน, KBANK/KTB/BBL/PromptPay 30 วัน) | QR payload, image, base64, URL |
| SlipOK | "รองรับสลิปจากทุกธนาคารทั่วประเทศ" + โลโก้ KBank/SCB/KTB/BBL/TTB/BAY/GSB/LH/UOB/Citi/SCB/Standard Chartered + PromptPay | `data` (QR string), `files` (JPG/JPEG/PNG/JFIF/WEBP), `url` |
| Check-Slip | KBank, SCB, BBL, KTB, BAY, TTB, GSB, **PromptPay** (มีหน้าแยกต่อธนาคาร) | image (JPG/PNG/WebP ≤5 MB), QR, LINE |
| CheckSlips | KBANK, SCB, BBL, KTB, TTB, BAY, GSB + PromptPay (QR ธุรกรรม และ QR แบบลิงก์) | image JPEG/PNG/WebP (≤5 MB), QR, ref |
| KBank / SCB | เฉพาะธุรกรรมที่วิ่งผ่านโครงข่ายของธนาคารนั้น (SCB ระบุชัดว่าเป็น QR30 / QR CS, ต้องใช้ `transRef`) | QR payload / transRef |

**ข้อจำกัดที่สำคัญมากและมักถูกมองข้าม:** การ verify สลิปทำได้เฉพาะช่วงที่ธนาคารยังเก็บข้อมูลอยู่ — SCB EASY, KMA, TTB, GSB, Kept, KKP, Dime! **เพียง 7 วัน**; KBANK/KTB/BBL/PromptPay 30 วัน (ตาราง EasySlip). แปลว่า "สลิปเก่า 2 เดือน" จะไม่ผ่านการตรวจไม่ว่าจะใช้เจ้าไหน — ต้องบังคับให้ผู้เช่าจ่ายแล้วส่งสลิปภายในไม่กี่วัน

### 2.3 ฟิลด์ที่คืนกลับ (ครบ 5 ข้อหรือไม่)

| ผู้ให้บริการ | amount | receiver account | transRef | date/time | ครอบคลุมธนาคาร+PP |
|---|---|---|---|---|---|
| **EasySlip v2** | `amountInSlip` + `isAmountMatched` (ส่ง `matchAmount`) | `receiver.account.bank.account` (masked) + **`matchedAccount`** เมื่อส่ง `matchAccount:true` (เทียบบัญชีที่ลงทะเบียนไว้ให้) | `rawSlip.transRef` | `rawSlip.date` (ISO 8601 +07:00) | ✅ |
| **SlipOK** | `amount` (+ ส่ง `amount` ไปเทียบได้) | `receiver.account.value` (**masked**, เช่น `xxx-x-x3109-x`), `receivingBank` | `transRef` | `transDate` (yyyyMMdd) + `transTime` + `transTimestamp` | ✅ |
| Check-Slip | มี (ไม่เปิดเผย schema สาธารณะ — ต้องอ่าน Postman docs) | มีการตรวจผู้รับ | ระบุว่ามี | ระบุว่ามี | ✅ |
| CheckSlips | ผลแยก "ยอด / ผู้รับ / ซ้ำ" | เทียบบัญชีที่ตั้งไว้ (โหมด "ตรวจบัญชีร้าน") | มี (ตรวจก่อนประมวลผล) | มี | ✅ |
| UP2Slip | `amount` | `receiver{...}` | `transactionId` | ไม่ชัด | ✅ (ตามที่ประกาศ) |

จุดที่ต้องออกแบบให้ดี: **ทั้ง EasySlip และ SlipOK คืนเลขบัญชีผู้รับแบบ mask** ถ้าเอาไป `===` กับเลขบัญชีหอพักจะไม่ตรงตลอด — EasySlip แก้ปัญหานี้ให้ที่ฝั่ง server (`matchedAccount` + name similarity 85%) ซึ่งเป็นเหตุผลหลักที่ผมให้ EasySlip ชนะในทางวิศวกรรม

### 2.4 การกันสลิปซ้ำ (dedupe)

| ผู้ให้บริการ | กลไก | ข้ามลูกค้า/ร้านอื่นหรือไม่ |
|---|---|---|
| EasySlip | `checkDuplicate: true` → `isDuplicate` | **ต่อ branch**: สลิปเดิม branch เดิม = cached, **ไม่หักโควตา**; คนละ branch = หักโควตาแต่ยังตอบ `isDuplicate: true` (ยืนยันจากตาราง Duplicate Handling) |
| SlipOK | ต้องส่ง `log: true` ถึงจะเก็บยอดและตรวจซ้ำ (**ถ้าไม่ส่ง = ตรวจอย่างเดียว ไม่กันซ้ำ!**) | API doc อธิบายแบบ per-ร้าน; แต่ blog ทางการอ้างว่าเป็น **cross-merchant** ("ร้านค้ากว่า 35,000 ราย … 48 ล้านใบ") — เป็นคำกล่าวอ้างการตลาด ไม่มีใน API reference |
| Check-Slip | ตรวจสลิปซ้ำเป็นฟีเจอร์หลัก | ไม่ระบุขอบเขต |
| CheckSlips | "ตรวจประวัติสลิปซ้ำก่อนส่งให้ผู้ให้บริการ" | per tenant (ไม่ยืนยัน) |
| UP2Slip | "ตรวจสอบการส่งซองซ้ำ" (ระบุชัดเฉพาะ TrueWallet) | ไม่ระบุ |

> ⚠️ กับดัก SlipOK: ถ้าลืมส่ง `log:true` ระบบจะ **ไม่ตรวจสลิปซ้ำเลย** ตามเอกสาร — สลิปใบเดียวใช้จ่าย 2 บิลได้

### 2.5 API shape / auth / limit / sandbox / data

| หัวข้อ | EasySlip | SlipOK | Check-Slip | CheckSlips |
|---|---|---|---|---|
| Endpoint | `POST https://api.easyslip.com/v2/verify/bank` | `POST https://api.slipok.com/api/line/apikey/<BRANCH_ID>` | REST (schema อยู่ใน Postman docs) | `POST https://api.checkslips.com/v1/verify` (async) |
| Auth | `Authorization: Bearer <key>` (+ IP whitelist ได้) | header `x-authorization: <key>` | API key | `X-Tenant-ID` + `Authorization: Bearer` |
| Sync/async | sync (มี async/batch/webhook เพิ่ม) | sync | — | async + webhook HMAC-SHA256 |
| ไฟล์ | ≤4 MB, JPEG/PNG/GIF/WebP | JPG/JPEG/PNG/JFIF/WEBP | ≤5 MB, JPG/PNG/WebP | JPEG/PNG/WebP |
| Rate limit | **ไม่พบหน้า rate-limit สาธารณะ** (ลิงก์ในเมนูวนกลับหน้าแรก) | ไม่ระบุ | ไม่ระบุ | เกินโควตา → 429 |
| Sandbox | มีแยกคีย์/โควตาต่อ branch (ไม่มีราคา sandbox ที่ประกาศ) | ไม่ระบุ | มี Sandbox key (ไม่หักโควตาจริง แต่ไม่ตรวจจริง) | มี Sandbox key (ยอดจำลอง ไม่หักโควตา) |
| เก็บภาพสลิป | Terms §8: ส่งข้อมูลต่อธนาคารคู่สัญญา + cloud/subcontractor; เก็บข้อมูลบัญชี ≤6 เดือนหลังยกเลิก | FAQ: เก็บประวัติ **ตลอดไป ไม่มีการลบ**; ประกาศ PDPA | ภาพเก็บตาม privacy policy (ไม่ได้เปิดเผยระยะเวลา) | เก็บสถิติ/PII **30 วัน** แล้วลบอัตโนมัติ; ส่งภาพให้ third-party processor (Gemini Vision) |
| สมัครเอง | ได้ (email/phone + KYC ก่อนใช้จริง) — จ่ายผ่าน **PromptPay QR** (ไม่มีบัตรเครดิต) | ได้ — ผ่าน LINE `@slipok` (ไม่มีหน้า checkout บัตรเครดิต) | ได้ — Google login, จ่ายผ่าน PromptPay | ได้ — สมัครฟรี, จ่าย PromptPay แล้วเปิดสิทธิ์ทันที |

---

## 3. เหตุผลเชิงผลิตภัณฑ์: ทำไมตัวเลขนี้ไม่ใช่เรื่องเงิน

### 3.1 ปริมาณจริง

42 ห้อง แต่มีคนจ่ายจริง ~40–50 ครั้ง/เดือน (รวมคนจ่ายช้า/จ่ายสองรอบ/ส่งสลิปซ้ำ) → **540–600 ครั้ง/ปี**

### 3.2 ต้นทุนจริงที่ 45 สลิป/เดือน

| ทางเลือก | ต่อเดือน | ต่อปี | ต่อสลิป |
|---|---|---|---|
| SlipOK OK BASIC | **0 บาท** | **0 บาท** | 0 |
| EasySlip Start | 99 บาท | 1,188 บาท | 2.20 บาท |
| Check-Slip Trial | 99 บาท (รวม VAT) | 1,188 บาท | 2.20 บาท |
| CheckSlips Starter (ฟรี) | 0 บาท | 0 บาท | 0 |
| UP2Slip | ~45 บาท | ~540 บาท | 1.00 บาท |
| จ้างคนตรวจเอง (ขั้นต่ำ 15,000 บาท/เดือน) | 15,000 บาท | 180,000 บาท | 333 บาท |

ถ้าค่าเช่าเฉลี่ย 3,000 บาท/ห้อง × 42 = 126,000 บาท/เดือน → **99 บาท = 0.08% ของรายรับ** และน้อยกว่าความเสียหายจากสลิปปลอม 1 ใบ (3,000 บาท) ถึง 30 เท่า

**ข้อสรุปเชิงตัวเลข: อย่าเลือกผู้ให้บริการจากราคา** เพราะทุกเจ้าอยู่ในช่วง 0–2.2 บาท/สลิป ซึ่งถูกกว่าค่าแรงและถูกกว่าความเสียหายที่จะเกิดจากสลิปปลอมมาก เลือกจาก "ใครทำให้เราเขียนโค้ดน้อยที่สุด และเชื่อถือได้มากที่สุด"

### 3.3 สิ่งที่เปลี่ยนเกมจริงสำหรับ 42 ห้อง

1. **จำนวนสลิปต่อเดือนต่ำมาก** (1–3 ใบ/วัน) → แพ็กเกจฟรี 100 ใบ/เดือนของ SlipOK และ CheckSlips พอทั้งหมด → ชั้นราคาไม่ใช่ตัวตัดสิน
2. **ต้นทุนจริงคือเวลาที่ owner ต้องนั่งดู** — ถ้า API ไม่ให้ `isAmountMatched`/`matchedAccount` แบบสำเร็จรูป ต้องเขียน logic เทียบเลขบัญชีที่ mask เอง ซึ่งเป็น bug ที่แพง
3. **ต้องบังคับ "ส่งสลิปภายใน 7 วัน"** เพราะสลิปจาก SCB/KMA/TTB/GSB ตรวจได้แค่ 7 วัน — ถ้าปล่อยให้จ่ายช้าแล้วส่งสลิปเดือนก่อน ระบบจะตอบ `SLIP_NOT_FOUND` ซึ่งแปลว่า "ตรวจไม่ได้" ไม่ใช่ "ปลอม" → ต้องมี fallback เป็นการอนุมัติด้วยมือ อย่าให้ระบบ auto-reject
4. **อย่าลืม `checkDuplicate`/`log`** — มิฉะนั้นสลิปเดียวจ่ายได้หลายบิล ซึ่งเป็นเคสที่แพงที่สุดของหอพัก (ผู้เช่าคนเดียวส่งสลิปเดิมซ้ำทุกเดือน)

---

## 4. ความเสี่ยง, PDPA และ data handling

### 4.1 PDPA — หอพักเป็น data controller

สลิปมีชื่อ-นามสกุลผู้โอน, เลขบัญชี (mask), ยอด, เวลา, เลขอ้างอิง → เป็นข้อมูลส่วนบุคคล ต้องมีฐานทางกฎหมาย (สัญญาเช่า/ปฏิบัติตามสัญญา), แจ้ง privacy notice, และ **เก็บเท่าที่จำเป็น**

คำแนะนำที่ลดความเสี่ยงที่สุดในทางปฏิบัติ:
- **อย่าเก็บไฟล์ภาพสลิปใน storage ของเรา** เก็บเฉพาะ field ที่ต้องใช้: `transRef`, `amount`, `paidAt`, `receiverAccountSuffix`, `provider`, `verificationId`
- ตั้ง retention 6–12 เดือนพอ (เท่าอายุสัญญาเช่า/รอบบัญชี) แล้วลบ; ถ้าผู้ให้บริการเก็บให้อยู่แล้ว ก็อ้างอิง id แทน
- ถ้าส่งข้อมูลให้ผู้ให้บริการต่างประเทศ (เช่น processor ที่ใช้ Gemini Vision) ต้องแจ้งใน privacy notice ว่าเป็น cross-border transfer ตาม PDPA ม.28–29

### 4.2 data handling ของแต่ละเจ้า (ตามที่ประกาศเอง)

| เจ้า | สิ่งที่ประกาศ |
|---|---|
| **EasySlip** | Terms §8: ข้อมูลอาจถูกส่งต่อ "ธนาคารคู่สัญญา", cloud provider และผู้รับจ้างช่วง; เก็บบัญชี/ประวัติ ≤6 เดือนหลังยกเลิก (§5.2); ห้ามใช้กับ gambling/crypto (§11.2) — หอพักไม่ติดข้อนี้ |
| **SlipOK** | FAQ: เก็บประวัติการตรวจ "ตลอดไป ไม่มีการลบ" — ดีต่อ audit, แย่ต่อ data minimization; ประกาศว่าปฏิบัติตาม PDPA; ระบุว่าไม่ส่งข้อมูลให้บุคคลอื่นโดยไม่ยินยอม |
| **CheckSlips** | Privacy: เก็บสถิติ/PII 30 วันแล้วลบทิ้งอัตโนมัติ, AES-256-GCM, TLS 1.3, ภาพสลิป "จัดเก็บตามระยะเวลาเก็บรักษาที่บริการกำหนด" (ไม่ระบุตัวเลข), ส่งภาพให้ third-party processor, มีช่องทางใช้สิทธิ PDPA ทาง LINE, ปรับปรุงล่าสุด 18 ต.ค. 2026 |
| **Check-Slip** | มี privacy policy แยก แต่ไม่ได้เปิดเผยระยะเวลาเก็บในหน้าหลัก |

### 4.3 สัญญาณความน่าเชื่อถือที่ "หลักฐานจริง" ชี้

- **EasySlip**: นิติบุคคลชัด — "บริษัท อีซี่สลิป จำกัด", โลโก้ "DBD registered", เอกสาร API มี changelog/version, Terms ระบุวันที่ปรับปรุง 1 ม.ค. 2024, ประกาศ uptime 99.9% (เป็น **คำกล่าวอ้าง** ไม่มี status page ให้ตรวจ)
- **SlipOK**: ใหญ่ที่สุดในตลาด (อ้าง 15,000–35,000 ร้าน, สลิปสะสม 14–48 ล้านใบ, เริ่มปี 2022) — **แต่ ณ วันที่เข้าถึง (16 พ.ย. 2026) หน้า `slipok.com/about-us/` และ `slipok.com/faq/` มีเนื้อหา SEO สแปมการพนันภาษาไทย/อิตาลี/ดัตช์แทรกอยู่กลางหน้า** (ข้อความขายเว็บพนัน + ลิงก์ออกนอก) ลักษณะนี้ชี้ว่าเว็บ WordPress ถูกฝังสแปม/ถูกบุกรุก และไม่ถูกดูแล — เป็นสัญญาณสุขอนามัยความปลอดภัย (security hygiene) ที่แย่สำหรับผู้ให้บริการที่จะถือภาพสลิปของผู้อาศัย **ยังไม่พบหลักฐานว่า API (`api.slipok.com`) ได้รับผลกระทบ** แต่ถ้าเจ้าของสินค้าเคยเลิกใช้เจ้าหนึ่งเพราะ "ไม่น่าไว้ใจ" เรื่องนี้ต้องชั่งน้ำหนัก
- **Check-Slip**: มีที่อยู่บริษัทจริง (บริษัท ไฮเฟน พลัส จำกัด, ปทุมธานี), เบอร์โทร 3 เบอร์, SDK 5 ภาษา, ตัวเลขการใช้งานบนหน้าเว็บ (4.6 ล้านสลิปสะสม) — แต่ schema API ไม่เปิดเผยบนหน้าเว็บ (ต้องเปิด Postman)
- **CheckSlips/SlipVerify**: แบรนด์ใหม่ (© 2026), ไม่มีข้อมูลนิติบุคคลบนหน้าเว็บ, ไม่ระบุที่อยู่/เบอร์โทร (ติดต่อทาง LINE เท่านั้น) — ฟีเจอร์ดีและ privacy policy เขียนดี แต่ **ยังไม่มี operating history ให้ตรวจ** จึงไม่ควรเป็นเจ้าเดียวของหอพัก
- **ไม่มีเจ้าของรายใดมี public status page** ให้ตรวจ uptime ย้อนหลังได้ (ตรวจแล้วทั้ง 4 ราย) → SLA ทั้งหมดเป็นเพียงคำโฆษณา

### 4.4 ความเสี่ยงอื่นที่ต้องรู้

| ความเสี่ยง | ผลกระทบ | ทางลด |
|---|---|---|
| สลิปเก่า > 7 วัน (SCB/KMA/TTB/GSB) | ตรวจไม่ได้ → false negative | UX บังคับ "โอนแล้วส่งสลิปทันที" + fallback ตรวจมือ |
| ผู้ให้บริการปิดตัว/เปลี่ยนราคา | ระบบพังกลางเดือน | ห่อ provider ไว้หลัง interface เดียว + เก็บ `transRef` ของเราเอง เพื่อย้ายเจ้าได้ |
| dedupe ข้ามร้านเป็นเพียงคำกล่าวอ้าง | สลิปที่เคยใช้ร้านอื่นอาจไม่ถูกจับ | เก็บ `transRef` ใน DB ของเราเอง unique index — นี่คือด่านที่เชื่อถือได้ที่สุด |
| SlipOK `log:false` โดยไม่ตั้งใจ | ไม่กันสลิปซ้ำเลย | ตั้ง default `log:true` + assert ในเทสต์ |
| Terms ห้ามบางธุรกิจ (EasySlip §11.2) | ถ้าใช้ผิดวัตถุถูกระงับโดยไม่คืนเงิน | หอพักไม่เข้าข่าย |

---

## 5. สิ่งที่ยืนยันไม่ได้ (ต้องถามผู้ขายก่อนตัดสินใจ)

1. **VAT ของ EasySlip และ SlipOK** — ไม่มีหน้าไหนระบุว่าราคารวมหรือไม่รวม VAT 7% (มีแต่ Check-Slip ที่เขียนชัดว่า "รวมภาษีมูลค่าเพิ่มแล้ว (VAT 7%)") → ตัวเลข 99 และ 350 อาจเป็น 105.93 และ 374.50 จริง
2. **Rate limit ต่อนาที/วินาที** ของ EasySlip, SlipOK, Check-Slip — ไม่มีเอกสารสาธารณะ (หน้า rate-limit ของ EasySlip ในเมนูวนกลับหน้าแรก)
3. **ราคา sandbox/test mode** — ไม่มีเจ้าไหนประกาศ (EasySlip/CheckSlip/CheckSlips มี sandbox key แต่ไม่บอกว่าคิดเงินไหม)
4. **ราคาจริงของ KBank Slip Verification** — หน้า API Portal ไม่แสดงราคา; ตัวเลข "1.5 credit ต่อ 1 สลิป" ที่พบมาจากบทความบุคคลที่สาม (thunder.in.th) **ไม่ใช่หน้าทางการ → ไม่ยืนยัน**
5. **เงื่อนไขการสมัครของ KBank** — ยืนยันได้แค่ว่า "รองรับผู้ใช้งานนิติบุคคลเท่านั้น" และต้องขอ partner account; ไม่ทราบค่าธรรมเนียม/ระยะเวลา onboard
6. **Bangkok Bank (BBL)** — ไม่พบหน้าผลิตภัณฑ์ slip-verification สาธารณะของ BBL (ค้นแล้วไม่เจอ); ที่พบมี KBank และ SCB (และ Krungsri ที่ถูกอ้างถึงในบทความอื่นแต่ยังไม่ยืนยันหน้าทางการ)
7. **"OpenSlip"** — ค้นแล้วไม่พบผู้ให้บริการไทยชื่อนี้ที่มีเว็บไซต์/เอกสารจริง จึงตัดออกจากการเปรียบเทียบ (อาจเป็นชื่อที่เข้าใจผิด)
8. **ระยะเวลาเก็บภาพสลิปของ EasySlip และ Check-Slip** — Terms EasySlip ระบุแค่ข้อมูลบัญชี ≤6 เดือนหลังยกเลิก ไม่ได้ระบุว่าภาพสลิปเก็บนานแค่ไหน
9. **dedupe ข้ามร้านของ SlipOK** — เป็นคำกล่าวอ้างในบทความการตลาด ไม่มีใน API reference และไม่มีเอกสารยืนยัน
10. **ตัวเลขลูกค้า/ปริมาณสลิป** (SlipOK 15,000–35,000 ร้าน, EasySlip, CheckSlip 4.6 ล้านสลิป) — เป็น self-reported ทั้งหมด ตรวจสอบอิสระไม่ได้
11. **Uptime จริง** — ไม่มี status page สาธารณะของเจ้าใดเลย; "99.9%" เป็นคำโฆษณา
12. **ความเสียหายของ SlipOK จากสแปมบนเว็บ** — ยืนยันได้แค่ว่าเนื้อหาแปลกปลอมปรากฏบนหน้าทางการ 2 หน้า ณ วันที่เข้าถึง ไม่สามารถยืนยันได้ว่าเป็น compromise ของทั้งระบบหรือแค่ plugin SEO
13. **การชำระด้วยบัตรเครดิต** — ไม่มีเจ้าไหนในลิสต์รองรับบัตรเครดิตแบบ self-serve; ทุกเจ้าจ่ายผ่าน PromptPay QR (EasySlip ระบุใน Terms §4.2)
14. **UP2Slip** — ไม่พบข้อมูลนิติบุคคล, free tier, หรือยอดเติมขั้นต่ำ; จุดเด่นคือ 1 บาท/ครั้งแบบ pay-per-use แต่ความน่าเชื่อถือยังประเมินไม่ได้

---

## 6. แหล่งอ้างอิง (เข้าถึง 16 พ.ย. 2026)

**EasySlip**
- ราคา/แพ็กเกจ: https://developer.easyslip.com/product และ https://easyslip.com/api-products
- เอกสาร API v2 (response fields, `matchAccount`, `checkDuplicate`, duplicate handling table, 4 MB limit): https://document.easyslip.com/en/v2/verify/bank/
- ภาพรวม v2 / error codes: https://document.easyslip.com/en/v2/
- อายุสลิปต่อธนาคาร: https://document.easyslip.com/en/reference/slip-age-support
- เริ่มใช้งาน + KYC: https://document.easyslip.com/en/guide/getting-started
- ข้อตกลงการให้บริการ (การนับ transaction §2.3.1, เก็บข้อมูล §5.2, PDPA §8, ข้อห้าม §11.2): https://easyslip.com/terms-of-use
- หน้าแรก/บริษัท: https://easyslip.com/

**SlipOK**
- ราคาและแพ็กเกจ: https://slipok.com/our-service/
- เอกสาร Check Slip (endpoint, header, response fields, `log`, `amount`): https://slipok.com/api-documentation/check-slip/
- FAQ (การนับรายการ, สลิปซ้ำไม่นับ, เก็บข้อมูลตลอดไป, ยกเลิก 30 วัน): https://slipok.com/faq/
- เกี่ยวกับเรา (ตัวเลขลูกค้า; **มีเนื้อหา spam แทรก**): https://slipok.com/about-us/
- บทความยืนยัน cross-merchant duplicate detection (คำกล่าวอ้าง): https://slipok.com/วิธีเชื่อมต่อ-api-ตรวจสลิป

**Check-Slip (Hyphen Plus)**
- ราคา (รวม VAT, ฟรี 50 สลิป): https://check-slip.com/pricing
- หน้าแรก + รายชื่อธนาคาร + ที่อยู่บริษัท: https://check-slip.com/

**CheckSlips (brand: SlipVerify)**
- ราคา/โควตา/ฟรี 100 สลิป 10/วัน: https://checkslips.com/pricing
- คู่มือ integration (`/v1/verify`, headers, async): https://checkslips.com/integration-docs
- Privacy Policy (30 วัน, AES-256-GCM, third-party processor, PDPA): https://checkslips.com/privacy
- หน้าแรก (Gemini Vision OCR, image forensics, banks): https://www.checkslips.com/

**ธนาคาร**
- KBank Slip Verification (นิติบุคคลเท่านั้น, ไม่มีราคาบนหน้า): https://apiportal.kasikornbank.com/product/public/All/Slip%20Verification/Introduction
- SCB Slip Verification (QR30/QR CS, OAuth, Contact Sale): https://developer.scb/ และ https://developer.scb/assets/documents/documentation/qr-payment/thai-qr.html

**อื่น ๆ**
- UP2Slip (1.00 บาท/ครั้ง, endpoint, response): https://up2slip.com/
- SlipVerify Gateway อีกแบรนด์ (237solutions) — ฟรี 100/เดือน, Starter 199/500: https://slip-verify.237solutions.tech/
- SlipMate (อ้างอิง KBank API ผ่าน middleware): https://slipmate.ai/
