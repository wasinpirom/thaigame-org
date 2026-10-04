# ติดตั้ง ThaiGame.org บน Coolify (Dockerfile เดียว มี AI ในตัว)

1. Coolify → **+ New** → **Dockerfile** → วางเนื้อหาไฟล์ `Dockerfile.coolify`
2. **Ports Exposes:** `3000`
3. **Domains:** `https://thaigame.org`
4. **Persistent Storage** → Volume → Destination Path: `/app/storage` (เก็บฐานข้อมูล รูป และโมเดล AI)
5. **Environment Variables:** `ADMIN_EMAIL` และ `ADMIN_PASSWORD` (ไม่ต้องติ๊ก Build Variable)
6. **Deploy** → เข้า `https://thaigame.org/login`

AI (Ollama + Qwen2.5 7B) อยู่ในตัว ครั้งแรกระบบจะดาวน์โหลดโมเดลประมาณ 4.7 GB ลง volume (ครั้งเดียว) ดูความคืบหน้าได้ที่ `/admin`

- ต้องมี RAM ว่างประมาณ 6 GB ตอน AI เขียนข่าว (โมเดลจะถูกปล่อยจาก RAM หลังว่าง 5 นาที)
- ถ้าเครื่อง RAM น้อยหรือช้า ใส่ env `LLM_MODEL=qwen2.5:3b` (ประมาณ 2 GB เร็วกว่าราว 2 เท่า)
- ถ้าอยากใช้ Ollama ตัวอื่นแทน ใส่ env `LLM_BASE_URL=http://<host>:11434/v1` ระบบจะไม่เปิด Ollama ในตัว
