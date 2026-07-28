# Deploy ThaiGame.org บน Coolify แบบง่ายที่สุด

วิธีที่แนะนำคือ GitHub Repository + Docker Compose

1. อัปโหลดไฟล์ทั้งหมดขึ้น GitHub ให้ `compose.yaml` อยู่หน้าแรกของ Repository
2. ใน Coolify เลือก `New Resource` → `Public Repository`
3. วาง URL Repository แล้วเลือก Build Pack เป็น `Docker Compose`
4. Compose Location ใช้ `/compose.yaml`
5. ตั้ง Environment Variables:
   - `SITE_URL=https://thaigame.org`
   - `SESSION_SECRET=` ค่าสุ่มยาวอย่างน้อย 64 ตัวอักษร
   - `ADMIN_EMAIL=` อีเมลที่ใช้ Login เป็น Admin
   - `ADMIN_PASSWORD=` รหัสผ่าน Admin ที่แข็งแรง
   - `ADMIN_NAME=อาจารย์ ดร.วศิน ภิรมย์`
   - `MAX_UPLOAD_MB=10`
   - `SEED_DEMO_DATA=true`
6. กด Deploy
7. ใน Service `app` ตั้ง Domain เป็น `https://thaigame.org:3000`
8. ตั้ง DNS A Record ของ `@` ให้ชี้ไป IP เครื่อง Coolify
9. ทดสอบ `https://thaigame.org/health`
10. Login ที่ `/login` แล้วเข้า `/admin`

เลข `:3000` ในช่อง Domain ใช้บอก Coolify ว่าจะส่ง Traffic เข้า Port ใด ผู้ชมยังเปิด `https://thaigame.org` ตามปกติ

ข้อมูลและรูปอยู่ใน Named Volume `thaigame_data` ห้ามลบ Volume ตอน Redeploy และควร Backup ไปยัง S3 หรืออีกเครื่องเป็นประจำ
