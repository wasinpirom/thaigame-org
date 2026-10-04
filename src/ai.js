// AI writer (Qwen2.5 via any OpenAI-compatible server: Ollama, llama.cpp, vLLM) + background scheduler.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const H = require("./helpers");
const { pageInfo, safeFetch } = require("./fetcher");
const { fetchSource } = require("./feeds");
const ollama = require("./ollama");
const { fetchItchJams, jamsDue } = require("./jams");
const { KINDS, getSetting, setSetting } = require("./newsdb");

const cfg = () => ({
  baseUrl: String(process.env.LLM_BASE_URL || (process.env.EMBEDDED_OLLAMA === "true" ? `http://${(process.env.OLLAMA_HOST || "127.0.0.1:11434").replace(/^https?:\/\//, "")}/v1` : "http://host.docker.internal:11434/v1")).replace(/\/+$/, ""),
  model: process.env.LLM_MODEL || "qwen2.5:7b",
  apiKey: process.env.LLM_API_KEY || "",
  timeout: Number(process.env.LLM_TIMEOUT_MS || 900000),
  maxTokens: Number(process.env.LLM_MAX_TOKENS || 1100),
  dailyLimit: Number(process.env.AI_DAILY_LIMIT || 40),
  autoPublish: String(process.env.AUTO_PUBLISH || "false") === "true",
  enabled: String(process.env.AI_ENABLED || "true") !== "false"
});

async function chat(messages, opts = {}) {
  const c = cfg();
  const res = await fetch(`${c.baseUrl}/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(opts.timeout || c.timeout),
    headers: { "content-type": "application/json", ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}) },
    body: JSON.stringify({ model: c.model, messages, temperature: 0.4, max_tokens: opts.maxTokens || c.maxTokens, stream: false })
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const out = data.choices?.[0]?.message?.content;
  if (!out) throw new Error("LLM ไม่ส่งข้อความกลับมา");
  return out;
}

const SYSTEM = `คุณคือบรรณาธิการของเว็บไซต์ ThaiGame.org (โดย ดร.วศิน ภิรมย์) เว็บข่าวและคลังผลงานเกมไทย
หลักการ:
- เขียนภาษาไทยที่อ่านง่าย เป็นกันเอง แต่ถูกต้องแบบข่าว
- ใช้เฉพาะข้อเท็จจริงจากข้อมูลต้นทาง ห้ามแต่งตัวเลข ชื่อคน วันที่ ราคา หรือคำพูดที่ไม่มีในข้อมูล
- ถ้าข้อมูลน้อย ให้เขียนสั้นและบอกตรง ๆ ว่ารายละเอียดเพิ่มเติมดูได้ที่แหล่งต้นทาง
- เรียบเรียงใหม่ด้วยภาษาของตัวเอง ห้ามคัดลอกข้อความต้นฉบับยาว ๆ
- ชื่อเกม ชื่อเครื่องมือ ชื่อบริษัท ให้คงภาษาอังกฤษตามต้นฉบับ
- ห้ามใส่ลิงก์ ห้ามใช้ HTML`;

const TASK = {
  thai_game: "เขียนข่าวแนะนำเกมนี้ให้คนไทยรู้จัก: เกมคืออะไร เล่นอย่างไร จุดเด่น ผู้สร้างคือใคร (ถ้ามีข้อมูล) และเล่นหรือติดตามได้ที่ไหน ความยาว 3–5 ย่อหน้า",
  devnews: "สรุปและเล่าข่าวนี้เป็นภาษาไทยสำหรับนักพัฒนาเกมไทย อธิบายว่าคืออะไร มีอะไรใหม่ และ 'นักพัฒนาไทยได้ประโยชน์อย่างไร' ในย่อหน้าสุดท้าย ความยาว 3–5 ย่อหน้า",
  video: "เขียนแนะนำวิดีโอนี้สั้น ๆ ว่าเกี่ยวกับอะไร ใครควรดู และได้อะไรจากการดู ความยาว 2–3 ย่อหน้า (มีข้อมูลแค่ชื่อและคำอธิบายวิดีโอ ห้ามเดาเนื้อหาที่ไม่ได้ระบุ)",
  course: "เขียนแนะนำคอร์ส/บทเรียนนี้: สอนอะไร เหมาะกับใคร ใช้เครื่องมืออะไร และควรเรียนต่อยอดอย่างไร ความยาว 2–4 ย่อหน้า ห้ามระบุราคาถ้าไม่มีในข้อมูล"
};

function buildPrompt(kind, src) {
  return `${TASK[kind] || TASK.devnews}

ข้อมูลต้นทาง
ชื่อเรื่อง: ${src.title}
แหล่งที่มา: ${src.sourceName || "-"}
ผู้เขียน/ผู้สร้าง: ${src.author || "-"}
วันที่: ${src.published_at || "-"}
คำอธิบาย: ${H.text(src.summary, 2500) || "-"}
เนื้อหาจากหน้าเว็บ:
${H.text(src.text, 4500) || "-"}

ตอบตามรูปแบบนี้เท่านั้น:
หัวข้อ: <พาดหัวข่าวภาษาไทย ไม่เกิน 90 ตัวอักษร>
สรุป: <สรุป 1–2 ประโยค ไม่เกิน 200 ตัวอักษร>
เนื้อหา:
<เนื้อหาหลายย่อหน้า คั่นด้วยบรรทัดว่าง ใช้ "## " นำหน้าหัวข้อย่อยได้ ใช้ "- " ทำรายการได้>`;
}

function parseOutput(raw, fallbackTitle) {
  const s = String(raw).replace(/\r/g, "").replace(/```[a-z]*\n?|```/g, "").replace(/\*\*\s*(หัวข้อ|สรุป|เนื้อหา|title|summary|body)\s*([:：]?)\s*\*\*/gi, "$1$2").trim();
  const title = (s.match(/^(?:หัวข้อ|title)\s*[:：]\s*(.+)$/im) || [])[1];
  const excerpt = (s.match(/^(?:สรุป|summary)\s*[:：]\s*(.+)$/im) || [])[1];
  let body = (s.match(/^(?:เนื้อหา|body)\s*[:：]\s*\n?([\s\S]+)$/im) || [])[1];
  if (!body) body = s.split("\n").filter(l => !/^(หัวข้อ|สรุป|title|summary)\s*[:：]/i.test(l)).join("\n");
  body = body.replace(/^#\s+/gm, "## ").trim();
  return {
    title: H.text((title || fallbackTitle).replace(/^["“]|["”]$/g, ""), 200),
    excerpt: H.text(excerpt || H.excerpt(body.replace(/^##.*$/gm, ""), 190), 300),
    body: H.text(body, 20000)
  };
}

// Download and convert a remote image to local webp so pages don't depend on hotlinking.
async function cacheImage(url, uploads) {
  if (!url) return "";
  try {
    const r = await safeFetch(url, { binary: true, maxBytes: 8 * 1024 * 1024, accept: "image/*", timeout: 20000 });
    const dir = path.join(uploads, "news"); fs.mkdirSync(dir, { recursive: true });
    const name = `${crypto.randomUUID()}.webp`;
    await sharp(r.body, { failOn: "error", limitInputPixels: 60_000_000 }).rotate().resize({ width: 1400, height: 900, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(dir, name));
    return `/uploads/news/${name}`;
  } catch { return url; }
}

function uniqueSlug(db, title) {
  const base = /[a-z0-9]{3}/i.test(title) ? title : "news";
  let s = H.slug(base); while (db.prepare("SELECT 1 FROM articles WHERE slug=?").get(s)) s = H.slug(base); return s;
}

// Turn one feed item into an article (AI-written when useAi, otherwise a plain link card from the feed summary).
async function writeArticle(db, uploads, itemId, { useAi = true, articleId = null } = {}) {
  const item = db.prepare("SELECT i.*,s.name source_name FROM feed_items i LEFT JOIN news_sources s ON s.id=i.source_id WHERE i.id=?").get(itemId);
  if (!item) throw new Error("ไม่พบรายการ");
  const t = new Date().toISOString(), c = cfg();
  db.prepare("UPDATE feed_items SET status='processing',error='',updated_at=? WHERE id=?").run(t, item.id);
  try {
    let page = { text: "", image: "", description: "", siteName: "" };
    if (item.url && !item.video_id) { try { page = await pageInfo(item.url); } catch { /* feed data is enough */ } }
    const sourceName = item.provider || page.siteName || item.source_name || "";
    let out;
    if (useAi) {
      const raw = await chat([{ role: "system", content: SYSTEM }, { role: "user", content: buildPrompt(item.kind, { ...item, sourceName, text: page.text, summary: item.summary || page.description }) }]);
      out = parseOutput(raw, item.title);
      if (out.body.length < 80) throw new Error("AI เขียนเนื้อหาสั้นเกินไป");
    } else {
      const sum = item.summary || page.description || "";
      out = { title: H.text(item.title, 200), excerpt: H.excerpt(sum, 190), body: H.text(sum, 6000) || "ดูรายละเอียดเพิ่มเติมได้ที่แหล่งต้นทาง" };
    }
    const image = item.video_id ? (item.image_url || `https://i.ytimg.com/vi/${item.video_id}/hqdefault.jpg`) : await cacheImage(item.image_url || page.image, uploads);
    const status = c.autoPublish ? "published" : "pending";
    if (articleId) {
      db.prepare("UPDATE articles SET title=?,excerpt=?,body=?,ai_generated=?,ai_model=?,updated_at=? WHERE id=?").run(out.title, out.excerpt, out.body, useAi ? 1 : 0, useAi ? c.model : "", t, articleId);
    } else {
      db.prepare(`INSERT INTO articles(slug,kind,item_id,title,excerpt,body,image_url,video_id,source_url,source_name,author,provider,status,ai_generated,ai_model,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(uniqueSlug(db, item.title), item.kind, item.id, out.title, out.excerpt, out.body, image, item.video_id, item.url, sourceName, item.author, item.provider, status, useAi ? 1 : 0, useAi ? c.model : "", t, t, status === "published" ? t : "");
    }
    db.prepare("UPDATE feed_items SET status='done',updated_at=? WHERE id=?").run(new Date().toISOString(), item.id);
    if (useAi) { const day = t.slice(0, 10); setSetting(db, "ai_count_" + day, Number(getSetting(db, "ai_count_" + day, "0")) + 1); }
  } catch (e) {
    db.prepare("UPDATE feed_items SET status='error',error=?,updated_at=? WHERE id=?").run(H.text(e.message, 500), new Date().toISOString(), item.id);
    throw e;
  }
}

// One AI job at a time (CPU-friendly; shares the Ollama box with pasatalk).
function startWorker(db, uploads, log = console) {
  if (process.env.NODE_ENV !== "test" && cfg().enabled) ollama.start(log);
  const state = { busy: false, lastError: "", lastRun: "", lastDurationSec: 0, timers: [] };
  const c = cfg();
  async function aiTick() {
    if (state.busy || !cfg().enabled || !ollama.ready()) return;
    const day = new Date().toISOString().slice(0, 10);
    if (Number(getSetting(db, "ai_count_" + day, "0")) >= cfg().dailyLimit) return;
    const next = db.prepare("SELECT id FROM feed_items WHERE status='queued' ORDER BY id ASC LIMIT 1").get();
    if (!next) return;
    state.busy = true; const t0 = Date.now();
    try { await writeArticle(db, uploads, next.id, { useAi: true }); state.lastError = ""; }
    catch (e) { state.lastError = e.message; log.error("[ai]", e.message); }
    finally { state.busy = false; state.lastRun = new Date().toISOString(); state.lastDurationSec = Math.round((Date.now() - t0) / 1000); }
  }
  async function feedTick() {
    const due = db.prepare("SELECT * FROM news_sources WHERE active=1").all().filter(s => !s.last_fetched_at || Date.now() - new Date(s.last_fetched_at).getTime() >= s.interval_min * 60000);
    for (const s of due) { const r = await fetchSource(db, s); if (r.error) log.error(`[feeds] ${s.name}: ${r.error}`); }
    if (String(process.env.JAMS_ENABLED || "true") !== "false" && jamsDue(db)) { const r = await fetchItchJams(db); if (r.error) log.error(`[jams] ${r.error}`); }
  }
  state.runFeeds = feedTick; state.runAi = aiTick;
  if (String(process.env.NEWS_SCHEDULER || "true") !== "false" && process.env.NODE_ENV !== "test") {
    state.timers.push(setTimeout(() => feedTick().catch(e => log.error(e)), 30000));
    state.timers.push(setInterval(() => feedTick().catch(e => log.error(e)), 15 * 60000));
    state.timers.push(setInterval(() => aiTick().catch(e => log.error(e)), 60000));
    state.timers.forEach(t => t.unref?.());
  }
  state.config = c;
  state.stop = () => state.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
  return state;
}

async function testLlm() {
  const t0 = Date.now();
  const out = await chat([{ role: "user", content: "ตอบสั้น ๆ ว่า 'พร้อมใช้งาน'" }], { maxTokens: 20, timeout: 180000 });
  return { ok: true, reply: out.trim().slice(0, 100), seconds: Math.round((Date.now() - t0) / 100) / 10 };
}

module.exports = { chat, cfg, buildPrompt, parseOutput, writeArticle, startWorker, testLlm, cacheImage, KINDS };
