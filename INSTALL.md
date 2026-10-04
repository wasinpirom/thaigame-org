# ติดตั้ง ThaiGame.org บน Coolify แบบ Dockerfile (สั้นที่สุด)

1. อัปโหลดไฟล์ทั้งหมดขึ้น GitHub repo `thaigame-org` (ให้ `Dockerfile` อยู่หน้าแรกของ repo)
2. Coolify → **+ New** → **Private Repository (with GitHub App)** → เลือก `thaigame-org` / `main`
3. **Build Pack: `Dockerfile`**
4. **Ports Exposes: `3000`**
5. **Domains:** `https://thaigame.org`
6. **Persistent Storage** → + Add → Volume → Destination Path: `/app/storage`
7. **Environment Variables** (ใส่แค่ 2 ตัวก็ใช้งานได้):
   ```
   ADMIN_EMAIL=อีเมลแอดมิน
   ADMIN_PASSWORD=รหัสผ่านแข็งแรง
   ```
   ถ้าจะเปิดระบบข่าว AI ให้ใส่เพิ่มอีก 1 ตัว:
   ```
   LLM_BASE_URL=http://host.docker.internal:11434/v1
   ```
   แล้วใส่ช่อง **Custom Docker Options**: `--add-host=host.docker.internal:host-gateway`
8. กด **Deploy** → เปิด `https://thaigame.org/login`

ค่าอื่นทั้งหมดมีค่าเริ่มต้นให้แล้ว (SESSION_SECRET สร้างเองอัตโนมัติและเก็บไว้ใน `/app/storage`) ดูตัวแปรเพิ่มเติมได้ใน `.env.example`
