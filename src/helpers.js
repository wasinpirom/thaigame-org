const crypto = require("node:crypto");

const CATEGORIES = {
  thai_developer: { label: "พัฒนาโดยคนไทย", short: "ทีมไทย", desc: "เกมที่มีคนไทยเป็นผู้พัฒนา ศิลปิน นักออกแบบ หรือทีมงานหลัก" },
  thai_traditional: { label: "การละเล่นไทย", short: "เกมไทยโบราณ", desc: "การละเล่น กีฬา หรือภูมิปัญญาไทยที่นำมาพัฒนาเป็นเกม" },
  thai_art: { label: "ศิลปะและวัฒนธรรมไทย", short: "ศิลปะแบบไทย", desc: "เกมที่มีงานภาพ เรื่องราว สถานที่ หรืออัตลักษณ์แบบไทย" }
};
const PLATFORMS = ["Windows", "macOS", "Linux", "Web", "Android", "iOS", "PlayStation", "Xbox", "Nintendo Switch", "VR", "อื่น ๆ"];
const text = (v, n = 5000) => String(v || "").trim().replace(/\0/g, "").slice(0, n);
const email = (v) => text(v, 254).toLowerCase();
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const array = (v) => Array.isArray(v) ? v : v ? [v] : [];
const jsonArray = (v) => { try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
const selected = (v, allowed) => [...new Set(array(v).map(String).filter((x) => allowed.includes(x)))];
function externalUrl(v) { try { const u = new URL(text(v, 2048)); return ["http:", "https:"].includes(u.protocol) ? u.toString() : ""; } catch { return ""; } }
function youtubeId(v) {
  const normalized = externalUrl(v); if (!normalized) return "";
  const u = new URL(normalized); const h = u.hostname.replace(/^www\./, "");
  if (h === "youtu.be") return (u.pathname.split("/").filter(Boolean)[0] || "").slice(0, 11);
  if (["youtube.com", "m.youtube.com"].includes(h)) {
    if (u.pathname === "/watch") return (u.searchParams.get("v") || "").slice(0, 11);
    const p = u.pathname.split("/").filter(Boolean); if (["embed", "shorts", "live"].includes(p[0])) return (p[1] || "").slice(0, 11);
  }
  return "";
}
function slug(v) {
  const base = text(v, 100).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "game";
  return `${base}-${crypto.randomBytes(3).toString("hex")}`;
}
const token = (n = 24) => crypto.randomBytes(n).toString("hex");
function sameToken(a, b) { if (!a || !b) return false; const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function date(v) { if (!v) return ""; const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(d); }
const excerpt = (v, n = 150) => { const s = text(v, 10000); return s.length > n ? `${s.slice(0, n).trim()}…` : s; };
module.exports = { CATEGORIES, PLATFORMS, array, date, email, excerpt, externalUrl, jsonArray, sameToken, selected, slug, text, token, validEmail, youtubeId };
