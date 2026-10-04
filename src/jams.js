// Game Jam calendar: pulls upcoming / running jams from itch.io/jams (+ manual entries by admin).
const H = require("./helpers");
const { safeFetch, decode, pageInfo } = require("./fetcher");
const { getSetting, setSetting } = require("./newsdb");

const THAI_WORDS = ["thai", "thailand", "bangkok", "ไทย", "กรุงเทพ", "siam", "สยาม"];

function initJams(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS jams (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL DEFAULT 'itch', ext_id TEXT NOT NULL,
    title TEXT NOT NULL, url TEXT NOT NULL, image_url TEXT NOT NULL DEFAULT '', host TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '', start_at TEXT NOT NULL DEFAULT '', end_at TEXT NOT NULL DEFAULT '',
    joined INTEGER NOT NULL DEFAULT 0, is_thai INTEGER NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(source, ext_id)
  );
  CREATE INDEX IF NOT EXISTS idx_jams_dates ON jams(hidden, start_at, end_at);`);
}

const iso = (v) => { if (!v) return ""; const s = String(v).trim().replace(" ", "T"); const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z"); return Number.isNaN(d.getTime()) ? "" : d.toISOString(); };
const isThai = (j) => THAI_WORDS.some(w => `${j.title} ${j.host} ${j.description}`.toLowerCase().includes(w));

// 1) embedded JSON (the calendar widget data), 2) fallback: HTML jam cells with ISO dates nearby.
function parseJamsHtml(html) {
  const out = new Map();
  const m = html.match(/"jams"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
  if (m) {
    try {
      JSON.parse(m[1]).forEach(j => {
        const url = j.url ? new URL(j.url, "https://itch.io").toString() : "";
        const slug = (url.match(/\/jam\/([\w-]+)/) || [])[1] || String(j.id || "");
        if (!slug || !j.title) return;
        out.set(slug, { ext_id: slug, title: H.text(decode(j.title), 200), url, start_at: iso(j.start_date), end_at: iso(j.end_date), joined: Number(j.joined || j.joined_count || 0), image_url: H.externalUrl(j.cover || j.cover_url || ""), host: H.text(j.host || "", 120) });
      });
    } catch { /* fall through to HTML */ }
  }
  if (!out.size) {
    const re = /href="(?:https:\/\/itch\.io)?\/jam\/([\w-]+)"[^>]*>([^<]{2,200})<\/a>/g; let a;
    while ((a = re.exec(html))) {
      const slug = a[1]; if (out.has(slug) || /^(?:entries|results|community|rate)$/.test(slug)) continue;
      let win = html.slice(a.index, a.index + 2500);
      const nextJam = win.slice(20).search(new RegExp(`/jam/(?!${slug}["/])[\\w-]+"`));
      if (nextJam >= 0) win = win.slice(0, nextJam + 20);
      const dates = [...win.matchAll(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/g)].map(x => iso(x[1])).filter(Boolean);
      const joined = Number(((win.match(/([\d,]+)\s*joined/i) || [])[1] || "0").replace(/,/g, ""));
      const img = (win.match(/(?:data-background_image|data-lazy_src|src)="(https:\/\/img\.itch\.zone\/[^"]+)"/) || [])[1] || "";
      const days = Number((win.match(/lasts?\s+(\d+)\s+day/i) || [])[1] || 0);
      let start = dates[0] || "", end = dates[1] || "";
      if (start && !end && days) end = new Date(new Date(start).getTime() + days * 86400000).toISOString();
      out.set(slug, { ext_id: slug, title: H.text(decode(a[2]).trim(), 200), url: `https://itch.io/jam/${slug}`, start_at: start, end_at: end, joined, image_url: img, host: "" });
    }
  }
  return [...out.values()].filter(j => j.title && j.start_at);
}

async function fetchItchJams(db) {
  const t = new Date().toISOString();
  try {
    const pages = ["https://itch.io/jams/upcoming", "https://itch.io/jams/in-progress", "https://itch.io/jams"];
    const all = new Map();
    for (const p of pages) { try { parseJamsHtml((await safeFetch(p, { accept: "text/html" })).body).forEach(j => all.set(j.ext_id, j)); } catch (e) { if (p === pages[2] && !all.size) throw e; } }
    if (!all.size) throw new Error("อ่านรายการ jam จากหน้า itch.io ไม่ได้ (หน้าเว็บอาจเปลี่ยนรูปแบบ)");
    const up = db.prepare(`INSERT INTO jams(source,ext_id,title,url,image_url,host,start_at,end_at,joined,is_thai,created_at,updated_at) VALUES('itch',?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source,ext_id) DO UPDATE SET title=excluded.title,url=excluded.url,image_url=CASE WHEN excluded.image_url<>'' THEN excluded.image_url ELSE jams.image_url END,start_at=excluded.start_at,end_at=CASE WHEN excluded.end_at<>'' THEN excluded.end_at ELSE jams.end_at END,joined=excluded.joined,is_thai=MAX(jams.is_thai,excluded.is_thai),updated_at=excluded.updated_at`);
    db.transaction(() => all.forEach(j => up.run(j.ext_id, j.title, j.url, j.image_url, j.host, j.start_at, j.end_at, j.joined, isThai(j) ? 1 : 0, t, t)))();
    // keep the table small: drop itch jams that ended more than 30 days ago
    db.prepare("DELETE FROM jams WHERE source='itch' AND featured=0 AND end_at<>'' AND end_at<?").run(new Date(Date.now() - 30 * 86400000).toISOString());
    setSetting(db, "jams_last_fetch", t); setSetting(db, "jams_last_status", `ok: ${all.size} jam`);
    return { count: all.size };
  } catch (e) {
    setSetting(db, "jams_last_fetch", t); setSetting(db, "jams_last_status", `error: ${e.message}`);
    return { count: 0, error: e.message };
  }
}

const jamsDue = (db) => { const last = getSetting(db, "jams_last_fetch", ""); return !last || Date.now() - new Date(last).getTime() > Number(process.env.JAMS_INTERVAL_HOURS || 12) * 3600000; };

// status helpers for views
function jamState(j, now = Date.now()) {
  const s = new Date(j.start_at).getTime(), e = j.end_at ? new Date(j.end_at).getTime() : s;
  if (now < s) return { key: "upcoming", label: "เร็ว ๆ นี้", until: s };
  if (now <= e) return { key: "running", label: "กำลังจัด", until: e };
  return { key: "ended", label: "จบแล้ว", until: e };
}
function relDays(ms, now = Date.now()) {
  const d = Math.round((ms - now) / 3600000);
  if (Math.abs(d) < 24) return `${Math.max(1, Math.abs(d))} ชั่วโมง`;
  return `${Math.round(Math.abs(d) / 24)} วัน`;
}
const bkk = (v, opt = { dateStyle: "medium", timeStyle: "short" }) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("th-TH", { ...opt, timeZone: "Asia/Bangkok" }).format(d); };

function registerJams(app, { db, admin, csrf, flash }) {
  const visible = (where, params = [], limit = 60) => db.prepare(`SELECT * FROM jams WHERE hidden=0 AND ${where} LIMIT ?`).all(...params, limit);
  const now = () => new Date().toISOString();
  app.locals.jamHelpers = { jamState, relDays, bkk };
  app.locals.homeJams = () => {
    const n = now();
    const list = visible("(end_at>=? OR (end_at='' AND start_at>=?)) ORDER BY is_thai DESC, featured DESC, CASE WHEN start_at<=? THEN 0 ELSE 1 END, start_at ASC", [n, n, n], 400);
    // spotlight: Thai/featured first, then nearest upcoming; keep variety
    const spotlight = [...list.filter(j => j.is_thai || j.featured), ...list.filter(j => !j.is_thai && !j.featured && j.start_at > n).sort((a, b) => a.start_at.localeCompare(b.start_at)), ...list.filter(j => !j.is_thai && !j.featured && j.start_at <= n).sort((a, b) => b.joined - a.joined)].slice(0, 6);
    return { spotlight, running: list.filter(j => j.start_at <= n).length, upcoming: list.filter(j => j.start_at > n).length };
  };

  app.get("/jams", (req, res) => {
    const n = now(), view = ["running", "upcoming", "thai"].includes(req.query.view) ? req.query.view : "all";
    const base = visible("(end_at>=? OR (end_at='' AND start_at>=?)) ORDER BY featured DESC, start_at ASC", [n, n], 600);
    const list = view === "running" ? base.filter(j => j.start_at <= n) : view === "upcoming" ? base.filter(j => j.start_at > n) : view === "thai" ? base.filter(j => j.is_thai) : base;
    // month calendar (Bangkok time)
    const mParam = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit" }).format(new Date());
    const [y, m] = mParam.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)), daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate(), lead = first.getUTCDay();
    const monthStart = new Date(Date.UTC(y, m - 1, 1) - 7 * 3600000).toISOString(), monthEnd = new Date(Date.UTC(y, m, 1) - 7 * 3600000).toISOString();
    const inMonth = db.prepare("SELECT * FROM jams WHERE hidden=0 AND start_at<? AND (CASE WHEN end_at='' THEN start_at ELSE end_at END)>=? ORDER BY is_thai DESC, featured DESC, joined DESC").all(monthEnd, monthStart);
    const dayKey = (v) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(v));
    const days = Array.from({ length: daysIn }, (_, i) => { const key = `${mParam}-${String(i + 1).padStart(2, "0")}`; return { n: i + 1, key, starts: inMonth.filter(j => dayKey(j.start_at) === key), ends: inMonth.filter(j => j.end_at && dayKey(j.end_at) === key) }; });
    const shift = (k) => { const d = new Date(Date.UTC(y, m - 1 + k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
    const events = db.prepare("SELECT * FROM events WHERE status='published' AND (end_date>=? OR start_date>=?) ORDER BY start_date ASC LIMIT 12").all(n.slice(0, 10), n.slice(0, 10));
    res.render("jams/index", { metaTitle: "ปฏิทิน Game Jam", metaDescription: "ปฏิทิน Game Jam ทั่วโลกและในไทย อัปเดตอัตโนมัติจาก itch.io พร้อมนับถอยหลัง", jams: list, view, counts: { all: base.length, running: base.filter(j => j.start_at <= n).length, upcoming: base.filter(j => j.start_at > n).length, thai: base.filter(j => j.is_thai).length }, cal: { label: new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric", timeZone: "UTC" }).format(first), lead, days, prev: shift(-1), next: shift(1), today: dayKey(new Date()) }, events, lastFetch: getSetting(db, "jams_last_fetch", "") });
  });

  // ---------- admin ----------
  app.get("/admin/jams", admin, (_q, res) => {
    res.locals.pendingCount = db.prepare("SELECT COUNT(*) n FROM articles WHERE status='pending'").get().n;
    res.render("admin/jams", { metaTitle: "จัดการ Game Jam", noindex: true, jams: db.prepare("SELECT * FROM jams ORDER BY hidden ASC, (end_at<?) ASC, start_at ASC LIMIT 400").all(now()), status: getSetting(db, "jams_last_status", "ยังไม่เคยดึง"), lastFetch: getSetting(db, "jams_last_fetch", ""), errors: [], form: {} });
  });
  app.post("/admin/jams/fetch", admin, csrf, async (req, res) => { const r = await fetchItchJams(db); flash(req, r.error ? "error" : "success", r.error ? `ดึง jam ไม่สำเร็จ: ${r.error}` : `อัปเดต ${r.count} jam จาก itch.io แล้ว`); res.redirect("/admin/jams"); });
  app.post("/admin/jams/:id/toggle", admin, csrf, (req, res) => {
    const f = ["featured", "hidden", "is_thai"].includes(req.body.field) ? req.body.field : null;
    if (f) db.prepare(`UPDATE jams SET ${f}=1-${f},updated_at=? WHERE id=?`).run(now(), req.params.id);
    res.redirect("/admin/jams");
  });
  app.post("/admin/jams/:id/delete", admin, csrf, (req, res) => { db.prepare("DELETE FROM jams WHERE id=?").run(req.params.id); res.redirect("/admin/jams"); });
  app.post("/admin/jams", admin, csrf, async (req, res) => {
    const f = { url: H.externalUrl(req.body.url), title: H.text(req.body.title, 200), host: H.text(req.body.host, 120), description: H.text(req.body.description, 2000), start: H.text(req.body.start, 16), end: H.text(req.body.end, 16), image_url: H.externalUrl(req.body.image_url), is_thai: req.body.is_thai === "1" ? 1 : 0 };
    const e = []; if (!f.url) e.push("กรุณาใส่ลิงก์ของ jam"); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(f.start)) e.push("กรุณาใส่วันเวลาเริ่ม");
    if (!e.length && (!f.title || !f.image_url)) { try { const p = await pageInfo(f.url); f.title ||= H.text(p.title, 200); f.image_url ||= H.externalUrl(p.image); f.description ||= H.text(p.description, 2000); } catch { if (!f.title) e.push("ดึงชื่อจากลิงก์ไม่ได้ กรุณาใส่ชื่อเอง"); } }
    if (e.length) { res.locals.pendingCount = 0; return res.status(422).render("admin/jams", { metaTitle: "จัดการ Game Jam", noindex: true, jams: db.prepare("SELECT * FROM jams ORDER BY start_at ASC LIMIT 400").all(), status: getSetting(db, "jams_last_status", ""), lastFetch: getSetting(db, "jams_last_fetch", ""), errors: e, form: req.body }); }
    const toIso = (v) => v ? new Date(`${v}:00+07:00`).toISOString() : "";
    db.prepare("INSERT INTO jams(source,ext_id,title,url,image_url,host,description,start_at,end_at,is_thai,featured,created_at,updated_at) VALUES('manual',?,?,?,?,?,?,?,?,?,1,?,?)").run(H.token(6), f.title, f.url, f.image_url, f.host, f.description, toIso(f.start), toIso(f.end), f.is_thai, now(), now());
    flash(req, "success", "เพิ่ม jam แล้ว (ปักหมุดให้อัตโนมัติ)"); res.redirect("/admin/jams");
  });
}

module.exports = { initJams, parseJamsHtml, fetchItchJams, jamsDue, registerJams, jamState, relDays, isThai };
