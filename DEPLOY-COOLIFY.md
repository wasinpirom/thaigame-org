# Deploy ThaiGame.org บน Coolify (Private Repository + GitHub App)

ไม่ต้องใช้ Personal Access Token และไม่ต้องฝาก token ไว้ใน URL ใด ๆ Coolify จะดึงโค้ดเองผ่าน GitHub App

## 1. เชื่อม Coolify กับ GitHub (ทำครั้งเดียว)

1. Coolify → **Sources** → **+ Add** → **GitHub App** → ตั้งชื่อ เช่น `wasin-github` → Continue
2. กด **Register Now** แล้วยืนยันการสร้าง App บนหน้า GitHub
3. เลือกติดตั้งที่ account `wasinpirom` → **Only select repositories** → เลือก `thaigame-org` → **Install**
4. กลับมาที่ Coolify แล้วตรวจว่า Source ขึ้นสถานะเชื่อมต่อแล้ว

## 2. สร้าง Resource

1. Projects → **+ New Project** (เช่น `thaigame`) → **+ New** → **Private Repository (with GitHub App)**
2. เลือก Source `wasin-github` → repo `thaigame-org` → branch `main`
3. Build Pack: **Docker Compose** · Base Directory: `/` · Docker Compose Location: `/compose.yaml`
4. กด Continue

## 3. Environment Variables

| ตัวแปร | ค่า | หมายเหตุ |
|---|---|---|
| `SITE_URL` | `https://thaigame.org` | |
| `SESSION_SECRET` | สุ่มด้วย `openssl rand -hex 32` | ติ๊ก Secret |
| `ADMIN_EMAIL` | อีเมลแอดมิน | |
| `ADMIN_PASSWORD` | รหัสผ่านแข็งแรง | ติ๊ก Secret |
| `ADMIN_NAME` | `อาจารย์ ดร.วศิน ภิรมย์` | |
| `LLM_BASE_URL` | ดูข้อ 4 | endpoint ของ Ollama แบบ OpenAI-compatible (ลงท้าย `/v1`) |
| `LLM_MODEL` | `qwen2.5:7b` | ชื่อเดียวกับที่ใช้ใน pasatalk |
| `AUTO_PUBLISH` | `false` | `false` = ทุกข่าวต้องให้แอดมินอนุมัติก่อน |
| `AI_DAILY_LIMIT` | `40` | จำนวนข่าวสูงสุดที่ AI เขียนต่อวัน |
| `YOUTUBE_API_KEY` | (ไม่บังคับ) | ใช้กับแหล่งข่าวประเภท "ค้นหา YouTube ด้วยคำ" |
| `JAMS_ENABLED` | `true` | ดึงปฏิทิน Game Jam จาก itch.io ทุก `JAMS_INTERVAL_HOURS` (12) ชม. |
| `LINE_OA_ID` | `@wasin` | |
| `KWAY_URL` | `https://kway.app` | ลิงก์ของแบนเนอร์ |

## 4. เชื่อมกับ Qwen2.5 7B ตัวเดียวกับ pasatalk

ใช้ Ollama ตัวเดียวกันได้เลย ไม่ต้องติดตั้งเพิ่ม เลือกให้ตรงกับวิธีที่ติดตั้ง Ollama ไว้:

**ก. Ollama ติดตั้งบนเครื่อง (systemd) เครื่องเดียวกับ Coolify**
- ตั้ง `OLLAMA_HOST=0.0.0.0:11434` ให้ Ollama (ผ่าน `systemctl edit ollama`) แล้ว restart
- ปิดพอร์ต 11434 จากภายนอกด้วย firewall (เช่น `ufw deny 11434`)
- `LLM_BASE_URL=http://host.docker.internal:11434/v1` (compose ตั้ง `extra_hosts` ไว้ให้แล้ว)

**ข. Ollama รันเป็น container/service ใน Coolify**
- เปิด **Connect to Predefined Network** ทั้งใน resource ของ Ollama และ ThaiGame แล้ว Redeploy
- `LLM_BASE_URL=http://<ชื่อ container ของ ollama>:11434/v1`

**ค. Ollama อยู่คนละเครื่อง**
- `LLM_BASE_URL=http://<IP>:11434/v1` และจำกัด firewall ให้เฉพาะ IP ของเครื่อง Coolify เข้าได้

แนะนำให้ตั้งค่า Ollama: `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_KEEP_ALIVE=30m` ระบบ ThaiGame จะส่งงานให้ AI ทีละ 1 ข่าว เพื่อไม่แย่ง CPU กับ pasatalk มากเกินไป

หลัง Deploy ให้ไปที่ `/admin/sources` แล้วกด **ทดสอบการเชื่อมต่อ AI** และไปที่ `/admin/jams` กด **ดึงจาก itch.io ตอนนี้** เพื่อโหลดปฏิทิน Game Jam ครั้งแรก

## 5. Domain และ Deploy

1. ใน service `app` ตั้ง Domain เป็น `https://thaigame.org:3000` (เลข 3000 บอก Coolify ว่าแอปฟังที่พอร์ตไหน ผู้ชมยังเข้า `https://thaigame.org` ตามปกติ)
2. กด **Deploy** แล้วทดสอบ `https://thaigame.org/health`
3. Login ที่ `/login` แล้วเข้า `/admin`
4. เปิด **Auto Deploy** ไว้ได้ ทุกครั้งที่ push ขึ้น `main` จะ deploy ใหม่เอง

ถ้าย้ายจาก resource เดิม: ทดสอบผ่าน URL ชั่วคราวของ Coolify ก่อน แล้วค่อยลบ Domain ออกจากตัวเก่าและใส่ในตัวใหม่ จากนั้นลบ resource เก่าที่ฝาก token ไว้

## 6. ข้อมูลถาวรและ Backup

- Named volume `thaigame_data` ถูก mount ที่ `/app/storage` (SQLite + รูปทั้งหมด)
- **Project ใหม่จะได้ volume ใหม่ที่ว่างเปล่า** ถ้าต้องการย้ายสมาชิก/เกมเดิม ให้คัดลอก `thaigame.sqlite` และโฟลเดอร์ `uploads` จาก volume เก่ามาใส่ volume ใหม่ก่อนเปิดใช้งานจริง
- ตั้ง Backup volume เป็นประจำ ห้ามลบ volume ตอน Redeploy
