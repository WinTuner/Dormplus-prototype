# Security policy

## เวอร์ชันที่ดูแล

เฉพาะ state ของ branch `master` และ deployment production สองตัว:

| ส่วน | ที่อยู่ production |
|---|---|
| LINE app + LIFF | https://line-app-iota.vercel.app |
| Backend API | https://line-backend-ten.vercel.app |

branch อื่นและ preview deployment ไม่ได้รับการดูแล

## แจ้งช่องโหว่

**อย่าเปิด issue สาธารณะ** สำหรับช่องโหว่ที่ยังไม่ถูกแก้ ใช้ช่องทาง private:

1. GitHub → แท็บ **Security** → **Report a vulnerability** (private advisory)
2. ถ้าใช้ช่องทางนั้นไม่ได้ ให้เปิด issue สั้น ๆ ว่า "ขอช่องทางติดต่อเรื่องความปลอดภัย" โดยไม่ลงรายละเอียด

จะตอบกลับภายใน 7 วัน และแจ้งความคืบหน้าจนปิดเรื่อง

## ขอบเขต

อยู่ในขอบเขต:

- `line-app/` (ฟังก์ชัน `/api/*`, หน้า `liff/bill.html`, cron, ที่เก็บข้อมูล R2/Blob)
- `backend/` (FastAPI, migrations, RLS, webhook signature, auth/session)
- deployment production ทั้งสองตัวข้างต้น

ไม่อยู่ในขอบเขต:

- บริการของบุคคลที่สาม (LINE, SlipOK, Vercel, Cloudflare R2, Neon) — แจ้งผู้ให้บริการนั้นโดยตรง
- การทดสอบที่สร้างภาระ (flood/DoS) และการยิงคำขอไปยัง LINE OA จริงของผู้ใช้
- ข้อจำกัดที่ออกแบบไว้ เช่น rate limit, การไม่ยืนยันบิลอัตโนมัติเมื่อสลิปตรวจไม่ได้, การไม่เพิ่มเพื่อน OA ให้อัตโนมัติ
- ข้อมูลตัวอย่าง/ทดสอบ และหน้า demo

## สิ่งที่ทำไว้แล้ว

- ไม่มี credential ใน git — ค่าจริงอยู่ใน Vercel Environment Variables, สคริปต์อ่านรหัสจาก `stdin` หรือ env
- webhook ตรวจ `X-Line-Signature` (HMAC-SHA256 ของ raw body) และกัน event ซ้ำด้วย `webhookEventId`
- tenant อ่านได้เฉพาะข้อมูลห้องตัวเอง (RLS + `since` ของผู้เช่าปัจจุบัน)
- การเขียนที่แตะเงิน (ปิดบิล, ตีกลับ, ยกเลิก, จอง `transRef`) ใช้ compare-and-set
- ปุ่ม/endpoint ของเจ้าของหอตรวจ role ทุกครั้ง ไม่ได้พึ่ง UI
