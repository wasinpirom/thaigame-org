# ThaiGame.org โดย ดร.วศิน ภิรมย์

เว็บข่าวเกมไทย (AI-assisted) และคลังผลงานเกมไทยแบบ Self-hosted สำหรับ Deploy บน Coolify ใช้งานฟรี

> โอเพนซอร์สเพื่อการศึกษา (MIT License) — Node.js + Express + EJS + SQLite, ระบบดึง RSS, AI เขียนข่าวด้วย LLM แบบ self-hosted, ปฏิทิน Game Jam และ Deploy ด้วย Dockerfile บน Coolify
> ติดต่อ / แจ้งปัญหา: LINE OA @wasin

## แนวคิด

เว็บข่าวเกมไทยแบบ **AI ล้วน** ไม่มีระบบสมาชิกหรือให้คนลงเกมเอง ผู้สร้างเกมแค่เผยแพร่ผลงานบน itch.io (แท็ก thailand) หรือ YouTube แล้ว AI จะตามเก็บมาเล่าเป็นข่าวภาษาไทย มีเพียงแอดมินที่ล็อกอินเพื่อตรวจและอนุมัติข่าว

## ความสามารถ

- ดึงข้อมูลอัตโนมัติจาก RSS/Atom, itch.io ตามแท็ก, ช่อง/Playlist YouTube (ไม่ต้องใช้ key) และค้นหา YouTube ด้วยคำ (ต้องมี `YOUTUBE_API_KEY`)
- กรองด้วยคำสำคัญรายแหล่ง และกันข่าวซ้ำด้วย URL
- AI (Qwen2.5 7B ผ่าน Ollama/OpenAI-compatible API) เขียนข่าวภาษาไทยทีละ 1 งาน มีโควตาต่อวัน
- ทุกข่าวเข้า "รออนุมัติ" ก่อน แอดมินแก้ไข เผยแพร่ ไม่อนุมัติ ปักหมุด หรือให้ AI เขียนใหม่ได้
- เพิ่มลิงก์คอร์ส (Udemy, Zenva ฯลฯ) หรือคลิป YouTube เองได้ ระบบดึงชื่อ/รูป/คำอธิบายให้
- หน้าใหม่: `/news`, `/videos`, `/learn`, `/contact`, `/news/rss.xml`
- แอดมิน: `/admin/news` (อนุมัติ), `/admin/feed` (รายการดิบ), `/admin/sources` (แหล่งข่าว + ทดสอบ AI), `/admin/news/add`
- **ปฏิทิน Game Jam** (`/jams`): ดึงจาก itch.io/jams ทุก 12 ชม. นับถอยหลังแบบเรียลไทม์ ปฏิทินรายเดือน แถบเด่นบนหน้าแรก ติดป้ายงานไทยอัตโนมัติ แอดมินปักหมุด/ซ่อน/เพิ่มงานในไทยเองได้ที่ `/admin/jams`
- แบนเนอร์ KWAY.app (เปิดแท็บใหม่) และช่องทางติดต่อ LINE OA @wasin ทุกหน้า

## Deploy

อ่าน [DEPLOY-COOLIFY.md](DEPLOY-COOLIFY.md)

วิธีที่แนะนำ: Coolify `Private Repository (with GitHub App)` → เลือก `Docker Compose` → ใช้ `/compose.yaml` (ไม่ต้องใช้ token)

สร้าง `SESSION_SECRET` ได้ด้วย:

```bash
openssl rand -hex 32
```

บัญชี Admin ถูกสร้างตอนฐานข้อมูลเริ่มครั้งแรกจาก `ADMIN_EMAIL`, `ADMIN_PASSWORD` และ `ADMIN_NAME`

## ข้อมูลถาวร

Volume `thaigame_data` ถูก Mount ที่ `/app/storage`

- `/app/storage/thaigame.sqlite` ฐานข้อมูลข่าว แหล่งข่าว Game Jam และ Session แอดมิน
- `/app/storage/uploads` รูปข่าวที่ระบบดาวน์โหลดมาเก็บ

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


## License

โค้ดใช้สัญญาอนุญาต MIT นำไปศึกษา ดัดแปลง และใช้งานต่อได้ ยกเว้นชื่อ ThaiGame.org โลโก้ แบนเนอร์ KWAY.app และภาพของ ดร.วศิน ภิรมย์ ที่ไม่รวมอยู่ในสัญญาอนุญาตนี้
