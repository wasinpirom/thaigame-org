// Embedded Ollama: when the Docker image ships the `ollama` binary (EMBEDDED_OLLAMA=true) the app starts it,
// downloads the model once into the persistent volume, and keeps it running. No extra Coolify settings needed.
const { spawn } = require("node:child_process");
const fs = require("node:fs");

const status = { enabled: false, state: "off", message: "", progress: 0, model: "" };

const host = () => (process.env.OLLAMA_HOST || "127.0.0.1:11434").replace(/^https?:\/\//, "");
const api = (p) => `http://${host()}${p}`;
const wanted = () => process.env.EMBEDDED_OLLAMA === "true" && (!process.env.LLM_BASE_URL || /127\.0\.0\.1|localhost/.test(process.env.LLM_BASE_URL));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function up() { try { return (await fetch(api("/api/version"), { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } }

async function hasModel(model) {
  try {
    const r = await (await fetch(api("/api/tags"), { signal: AbortSignal.timeout(5000) })).json();
    const base = model.includes(":") ? model : `${model}:latest`;
    return (r.models || []).some(m => m.name === base || m.model === base);
  } catch { return false; }
}

async function pull(model, log) {
  status.state = "pulling"; status.message = `กำลังดาวน์โหลดโมเดล ${model} (ครั้งแรกครั้งเดียว)`; status.progress = 0;
  const res = await fetch(api("/api/pull"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, stream: true }) });
  if (!res.ok) throw new Error(`pull HTTP ${res.status}`);
  let buf = "", lastLog = 0;
  for await (const chunk of res.body) {
    buf += Buffer.from(chunk).toString("utf8");
    let i; while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.error) throw new Error(j.error);
      if (j.total && j.completed) status.progress = Math.round(j.completed / j.total * 100);
      if (Date.now() - lastLog > 30000) { lastLog = Date.now(); log.log(`[ollama] ${j.status || ""} ${status.progress}%`); }
    }
  }
}

function start(log = console) {
  if (!wanted() || status.enabled) return status;
  status.enabled = true; status.model = process.env.LLM_MODEL || "qwen2.5:7b";
  const bin = process.env.OLLAMA_BIN || "ollama";
  try { if (process.env.OLLAMA_MODELS) fs.mkdirSync(process.env.OLLAMA_MODELS, { recursive: true }); } catch { /* ignore */ }
  let child = null, stopped = false;
  const env = { ...process.env, OLLAMA_HOST: host(), OLLAMA_KEEP_ALIVE: process.env.OLLAMA_KEEP_ALIVE || "5m", OLLAMA_NUM_PARALLEL: process.env.OLLAMA_NUM_PARALLEL || "1", OLLAMA_MAX_LOADED_MODELS: "1" };
  const launch = () => {
    if (stopped) return;
    status.state = "starting"; status.message = "กำลังเปิด Ollama";
    child = spawn(bin, ["serve"], { env, stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.on("data", d => { const s = d.toString(); if (/error|panic/i.test(s)) log.error("[ollama]", s.trim().slice(0, 300)); });
    child.on("error", e => { status.state = "error"; status.message = `เปิด Ollama ไม่ได้: ${e.message}`; });
    child.on("exit", code => { if (stopped) return; status.state = "error"; status.message = `Ollama หยุดทำงาน (code ${code}) กำลังเปิดใหม่`; setTimeout(launch, 10000).unref?.(); });
  };
  launch();
  (async () => {
    for (let i = 0; i < 60 && !(await up()); i++) await sleep(1000);
    if (!(await up())) { status.state = "error"; status.message = "Ollama ไม่ตอบสนอง"; return; }
    try {
      if (!(await hasModel(status.model))) await pull(status.model, log);
      status.state = "ready"; status.message = `พร้อมใช้งาน (${status.model})`; status.progress = 100;
      log.log(`[ollama] ready: ${status.model}`);
    } catch (e) { status.state = "error"; status.message = `ดาวน์โหลดโมเดลไม่สำเร็จ: ${e.message}`; log.error("[ollama]", e.message); }
  })();
  status.stop = () => { stopped = true; child?.kill(); };
  const bye = (sig) => { status.stop(); if (sig) process.exit(0); };
  process.once("SIGTERM", () => bye(true)); process.once("SIGINT", () => bye(true)); process.once("exit", () => bye(false));
  return status;
}

// AI worker asks this before each job: external LLM → always try; embedded → only once the model is ready.
const ready = () => !status.enabled || status.state === "ready";

module.exports = { start, status, ready, wanted };
