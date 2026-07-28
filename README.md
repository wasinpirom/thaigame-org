# ThaiGame.org

เว็บรวมผลงานเกมไทยแบบ Self-hosted สำหรับ Deploy บน Coolify

## ความสามารถ

- สมัครสมาชิก เข้าสู่ระบบ และเปลี่ยนรหัสผ่าน
- โปรไฟล์เปิด/ปิดสาธารณะ พร้อมอีเมล LINE ID เบอร์โทร เว็บไซต์และ Social
- เพิ่ม แก้ไข และลบเกม พร้อมหมวดและแพลตฟอร์ม
- ภาพปก 1 ภาพ และ Screenshot รวมไม่เกิน 20 ภาพ ภาพละไม่เกิน 10 MB
- ตรวจไฟล์และแปลงภาพ JPG/PNG/WebP เป็น WebP
- Embed YouTube สูงสุด 3 วิดีโอ
- ลิงก์ซื้อ ดาวน์โหลด หรือทดลองเล่นบนเว็บภายนอก
- ค้นหาและกรองเกม
- Admin แก้ไข ซ่อน เผยแพร่ ลบเกม และระงับสมาชิก
- SQLite + Persistent Volume, CSRF, rate limit, security headers, sitemap และ health check
- ข้อมูลตัวอย่าง 3 เกมที่ Admin แก้ไขหรือลบได้

## Deploy

อ่าน [DEPLOY-COOLIFY.md](DEPLOY-COOLIFY.md)

วิธีที่ง่ายที่สุด: อัปโหลดโฟลเดอร์นี้ขึ้น GitHub → Coolify `Public Repository` → เลือก `Docker Compose` → ใช้ `/compose.yaml`

สร้าง `SESSION_SECRET` ได้ด้วย:

```bash
openssl rand -hex 32
```

บัญชี Admin ถูกสร้างตอนฐานข้อมูลเริ่มครั้งแรกจาก `ADMIN_EMAIL`, `ADMIN_PASSWORD` และ `ADMIN_NAME`

## ข้อมูลถาวร

Volume `thaigame_data` ถูก Mount ที่ `/app/storage`

- `/app/storage/thaigame.sqlite` ฐานข้อมูลสมาชิก เกม และ Session
- `/app/storage/uploads` รูปที่สมาชิกอัปโหลด

SQLite เหมาะกับแอป 1 Instance ห้ามเปิดหลาย Replica หากโตมากค่อยย้ายไป PostgreSQL และ S3-compatible storage

## ทดสอบในเครื่อง

```bash
npm install
cp .env.example .env
npm test
npm start
```

หรือใช้ Docker:

```bash
docker compose up -d --build
```

สำหรับทดสอบ Docker ในเครื่อง ให้เพิ่ม `ports: - "3000:3000"` ใต้ Service `app` ชั่วคราว

## ก่อนเปิดจริง

- แก้หน้าเงื่อนไขให้มีผู้ให้บริการ อีเมลรับแจ้งละเมิด และนโยบาย PDPA จริง
- ตั้ง Backup ของ Volume และทดลอง Restore
- ใช้รหัสผ่าน Admin ที่แข็งแรงและเก็บ `SESSION_SECRET` เป็น Secret ใน Coolify
- หากเปิดรับคนทั่วไปจำนวนมาก ควรเพิ่ม Email verification, CAPTCHA และระบบลืมรหัสผ่านผ่าน SMTP
