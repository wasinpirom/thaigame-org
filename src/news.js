// Public news/video/learn pages + admin approval, raw feed queue and source management.
const H = require("./helpers");
const { KINDS, SOURCE_TYPES } = require("./newsdb");
const { fetchSource } = require("./feeds");
const { writeArticle, testLlm, cfg, cacheImage } = require("./ai");
const { pageInfo } = require("./fetcher");

const PER_PAGE = 18;

function registerNews(app, { db, uploads, admin, csrf, flash, worker, siteUrl }) {
  // reset jobs interrupted by a restart
  db.prepare("UPDATE feed_items SET status='queued' WHERE status='processing'").run();

  const published = (where = "1=1", params = [], limit = PER_PAGE, offset = 0) =>
    db.prepare(`SELECT * FROM articles WHERE status='published' AND ${where} ORDER BY featured DESC, published_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const countPublished = (where = "1=1", params = []) => db.prepare(`SELECT COUNT(*) n FROM articles WHERE status='published' AND ${where}`).get(...params).n;
  const page = (q) => Math.max(1, Math.min(500, parseInt(q, 10) || 1));
  const pendingCount = () => db.prepare("SELECT COUNT(*) n FROM articles WHERE status='pending'").get().n;
  const back = (req, fallback) => { const r = String(req.body?.back || ""); return r.startsWith("/admin") ? r : fallback; };
  app.locals.latestNews = (kind, n = 6) => published(kind ? "kind=?" : "kind IN ('thai_game','devnews')", kind ? [kind] : [], n);

  // ---------- public ----------
  app.get("/news", (req, res) => {
    const kind = ["thai_game", "devnews"].includes(req.query.kind) ? req.query.kind : "";
    const q = H.text(req.query.q, 100), p = page(req.query.page);
    const c = [kind ? "kind=?" : "kind IN ('thai_game','devnews')"], params = kind ? [kind] : [];
    if (q) { c.push("(title LIKE ? OR excerpt LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
    const total = countPublished(c.join(" AND "), params);
    res.render("news/index", { metaTitle: kind ? KINDS[kind].label : "ข่าวเกมไทยและวงการพัฒนาเกม", metaDescription: "ข่าวเกมใหม่จากนักพัฒนาไทย เครื่องมือ และนวัตกรรมการพัฒนาเกม เรียบเรียงโดย AI ตรวจโดยบรรณาธิการ", articles: published(c.join(" AND "), params, PER_PAGE, (p - 1) * PER_PAGE), kind, query: q, page: p, pages: Math.max(1, Math.ceil(total / PER_PAGE)), total });
  });
  app.get("/news/rss.xml", (_q, res) => {
    const items = published("1=1", [], 30);
    res.type("application/rss+xml").send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>ThaiGame.org – ข่าวเกมไทย</title><link>${siteUrl}/news</link><description>ข่าวเกมไทยและวงการพัฒนาเกม โดย ดร.วศิน ภิรมย์</description><language>th</language>${items.map(a => `<item><title>${H.esc(a.title)}</title><link>${siteUrl}/news/${a.slug}</link><guid>${siteUrl}/news/${a.slug}</guid><pubDate>${new Date(a.published_at || a.created_at).toUTCString()}</pubDate><description>${H.esc(a.excerpt)}</description></item>`).join("")}</channel></rss>`);
  });
  app.get("/news/:slug", (req, res) => {
    const a = db.prepare("SELECT * FROM articles WHERE slug=?").get(req.params.slug);
    const isAdmin = req.user?.role === "admin";
    if (!a || (a.status !== "published" && !isAdmin)) return res.status(404).render("404", { metaTitle: "ไม่พบข่าว" });
    if (a.status === "published") db.prepare("UPDATE articles SET views=views+1 WHERE id=?").run(a.id);
    const related = published("kind=? AND id<>?", [a.kind, a.id], 4);
    res.render("news/show", { metaTitle: a.title, metaDescription: a.excerpt, metaImage: a.image_url.startsWith("/") ? a.image_url : "", article: a, related, isAdmin, noindex: a.status !== "published" });
  });
  app.get("/videos", (req, res) => {
    const p = page(req.query.page), total = countPublished("kind='video'");
    res.render("news/videos", { metaTitle: "วิดีโอเกมไทย", metaDescription: "สัมภาษณ์ รีวิว และข่าวเกมไทยจาก YouTube", articles: published("kind='video'", [], PER_PAGE, (p - 1) * PER_PAGE), page: p, pages: Math.max(1, Math.ceil(total / PER_PAGE)) });
  });
  app.get("/learn", (req, res) => {
    const p = page(req.query.page), total = countPublished("kind='course'");
    res.render("news/learn", { metaTitle: "คอร์สและแหล่งเรียนรู้สร้างเกม", metaDescription: "รวมคอร์สสร้างเกม เครื่องมือ และ resource ที่น่าสนใจสำหรับนักพัฒนาไทย", articles: published("kind='course'", [], PER_PAGE, (p - 1) * PER_PAGE), page: p, pages: Math.max(1, Math.ceil(total / PER_PAGE)) });
  });
  app.get("/contact", (_q, r) => r.render("contact", { metaTitle: "ติดต่อ ลงโฆษณา และแจ้งปัญหา", metaDescription: "ติดต่อ ดร.วศิน ภิรมย์ ผ่าน LINE OA @wasin" }));

  // ---------- admin: articles ----------
  const adminNav = (res, extra = {}) => Object.assign(res.locals, { pendingCount: pendingCount(), queueCount: db.prepare("SELECT COUNT(*) n FROM feed_items WHERE status IN ('queued','processing')").get().n, ...extra });

  app.get("/admin/news", admin, (req, res) => {
    const status = ["pending", "published", "rejected"].includes(req.query.status) ? req.query.status : "pending";
    const kind = Object.hasOwn(KINDS, req.query.kind) ? req.query.kind : "";
    adminNav(res);
    res.render("admin/news", { metaTitle: "อนุมัติข่าว", noindex: true, status, kind, articles: db.prepare(`SELECT * FROM articles WHERE status=? ${kind ? "AND kind=?" : ""} ORDER BY created_at DESC LIMIT 200`).all(...[status, kind].filter(Boolean)), worker: workerInfo() });
  });
  app.post("/admin/news/bulk", admin, csrf, (req, res) => {
    const ids = H.array(req.body.ids).map(Number).filter(Boolean), action = req.body.action, t = new Date().toISOString();
    if (action === "publish") ids.forEach(id => db.prepare("UPDATE articles SET status='published',published_at=CASE WHEN published_at='' THEN ? ELSE published_at END,updated_at=? WHERE id=?").run(t, t, id));
    if (action === "reject") ids.forEach(id => db.prepare("UPDATE articles SET status='rejected',updated_at=? WHERE id=?").run(t, id));
    if (action === "delete") ids.forEach(id => db.prepare("DELETE FROM articles WHERE id=?").run(id));
    flash(req, "success", `ดำเนินการ ${ids.length} รายการแล้ว`); res.redirect(back(req, "/admin/news"));
  });
  app.post("/admin/news/:id/status", admin, csrf, (req, res) => {
    const s = ["published", "rejected", "pending"].includes(req.body.status) ? req.body.status : "pending", t = new Date().toISOString();
    db.prepare("UPDATE articles SET status=?,published_at=CASE WHEN ?='published' AND published_at='' THEN ? ELSE published_at END,updated_at=? WHERE id=?").run(s, s, t, t, req.params.id);
    flash(req, "success", s === "published" ? "เผยแพร่แล้ว" : s === "rejected" ? "ไม่อนุมัติแล้ว" : "ย้ายกลับไปรออนุมัติ"); res.redirect(back(req, "/admin/news"));
  });
  app.post("/admin/news/:id/feature", admin, csrf, (req, res) => { db.prepare("UPDATE articles SET featured=1-featured WHERE id=?").run(req.params.id); res.redirect(back(req, "/admin/news?status=published")); });
  app.post("/admin/news/:id/delete", admin, csrf, (req, res) => { db.prepare("DELETE FROM articles WHERE id=?").run(req.params.id); flash(req, "success", "ลบข่าวแล้ว"); res.redirect(back(req, "/admin/news")); });
  app.post("/admin/news/:id/rewrite", admin, csrf, (req, res) => {
    const a = db.prepare("SELECT * FROM articles WHERE id=?").get(req.params.id);
    if (!a?.item_id) { flash(req, "error", "ข่าวนี้ไม่มีข้อมูลต้นทางให้ AI เขียนใหม่"); return res.redirect("/admin/news"); }
    db.prepare("DELETE FROM articles WHERE id=?").run(a.id);
    db.prepare("UPDATE feed_items SET status='queued',error='',updated_at=? WHERE id=?").run(new Date().toISOString(), a.item_id);
    flash(req, "success", "ส่งให้ AI เขียนใหม่แล้ว จะกลับมาอยู่ในรายการรออนุมัติเมื่อเขียนเสร็จ"); res.redirect("/admin/news");
  });
  const articleForm = (b) => ({ title: H.text(b.title, 200), excerpt: H.text(b.excerpt, 300), body: H.text(b.body, 20000), kind: Object.hasOwn(KINDS, b.kind) ? b.kind : "thai_game", image_url: H.text(b.image_url, 2048), source_url: H.externalUrl(b.source_url), source_name: H.text(b.source_name, 140), provider: H.text(b.provider, 140), video_id: H.youtubeId(b.video_url) || "" });
  app.get("/admin/news/:id/edit", admin, (req, res) => {
    const a = db.prepare("SELECT * FROM articles WHERE id=?").get(req.params.id); if (!a) return res.status(404).render("404", { metaTitle: "ไม่พบข่าว" });
    adminNav(res); res.render("admin/news-edit", { metaTitle: "แก้ไขข่าว", noindex: true, article: a, errors: [] });
  });
  app.post("/admin/news/:id/edit", admin, csrf, (req, res) => {
    const a = db.prepare("SELECT * FROM articles WHERE id=?").get(req.params.id); if (!a) return res.status(404).render("404", { metaTitle: "ไม่พบข่าว" });
    const f = articleForm(req.body), e = [];
    if (f.title.length < 5) e.push("หัวข้อสั้นเกินไป"); if (f.body.length < 30) e.push("เนื้อหาสั้นเกินไป");
    if (f.image_url && !f.image_url.startsWith("/uploads/") && !H.externalUrl(f.image_url)) e.push("ลิงก์รูปไม่ถูกต้อง");
    if (e.length) { adminNav(res); return res.status(422).render("admin/news-edit", { metaTitle: "แก้ไขข่าว", noindex: true, article: { ...a, ...f }, errors: e }); }
    const t = new Date().toISOString(), publish = req.body.publish === "1";
    db.prepare("UPDATE articles SET title=?,excerpt=?,body=?,kind=?,image_url=?,source_url=?,source_name=?,provider=?,video_id=?,status=CASE WHEN ?=1 THEN 'published' ELSE status END,published_at=CASE WHEN ?=1 AND published_at='' THEN ? ELSE published_at END,updated_at=? WHERE id=?")
      .run(f.title, f.excerpt || H.excerpt(f.body, 190), f.body, f.kind, f.image_url, f.source_url, f.source_name, f.provider, f.video_id || a.video_id, publish ? 1 : 0, publish ? 1 : 0, t, t, a.id);
    flash(req, "success", publish ? "บันทึกและเผยแพร่แล้ว" : "บันทึกแล้ว"); res.redirect(publish ? `/news/${a.slug}` : "/admin/news");
  });

  // ---------- admin: raw feed items ----------
  app.get("/admin/feed", admin, (req, res) => {
    const status = ["new", "queued", "error", "skipped", "done"].includes(req.query.status) ? req.query.status : "new";
    adminNav(res);
    const items = db.prepare(`SELECT i.*,s.name source_name FROM feed_items i LEFT JOIN news_sources s ON s.id=i.source_id WHERE ${status === "queued" ? "i.status IN ('queued','processing')" : "i.status=?"} ORDER BY i.published_at DESC, i.id DESC LIMIT 200`).all(...(status === "queued" ? [] : [status]));
    res.render("admin/feed", { metaTitle: "รายการจากแหล่งข่าว", noindex: true, status, items, worker: workerInfo() });
  });
  app.post("/admin/feed/bulk", admin, csrf, async (req, res) => {
    const ids = H.array(req.body.ids).map(Number).filter(Boolean), action = req.body.action, t = new Date().toISOString();
    if (action === "queue") ids.forEach(id => db.prepare("UPDATE feed_items SET status='queued',error='',updated_at=? WHERE id=?").run(t, id));
    if (action === "skip") ids.forEach(id => db.prepare("UPDATE feed_items SET status='skipped',updated_at=? WHERE id=?").run(t, id));
    if (action === "direct") for (const id of ids.slice(0, 20)) { try { await writeArticle(db, uploads, id, { useAi: false }); } catch { /* recorded on item */ } }
    flash(req, "success", action === "queue" ? `ส่ง ${ids.length} รายการให้ AI เขียนแล้ว` : action === "direct" ? "สร้างเป็นข่าวแบบไม่ใช้ AI แล้ว (อยู่ในรายการรออนุมัติ)" : `ดำเนินการ ${ids.length} รายการแล้ว`);
    res.redirect(back(req, "/admin/feed"));
  });

  // ---------- admin: add link manually (course / video / news) ----------
  app.get("/admin/news/add", admin, (_q, res) => { adminNav(res); res.render("admin/news-add", { metaTitle: "เพิ่มลิงก์", noindex: true, form: { kind: "course", use_ai: "1" }, errors: [] }); });
  app.post("/admin/news/add", admin, csrf, async (req, res) => {
    const f = { url: H.externalUrl(req.body.url), kind: Object.hasOwn(KINDS, req.body.kind) ? req.body.kind : "course", title: H.text(req.body.title, 300), summary: H.text(req.body.summary, 4000), image_url: H.externalUrl(req.body.image_url), provider: H.text(req.body.provider, 140), use_ai: req.body.use_ai === "1" ? "1" : "" };
    const e = []; if (!f.url) e.push("กรุณาใส่ลิงก์ที่ถูกต้อง");
    const vid = H.youtubeId(f.url);
    if (!e.length && (!f.title || !f.summary || !f.image_url) && !vid) {
      try { const p = await pageInfo(f.url); f.title ||= H.text(p.title, 300); f.summary ||= H.text(p.description || p.text, 4000); f.image_url ||= H.externalUrl(p.image); f.provider ||= H.text(p.siteName, 140); }
      catch (err) { if (!f.title) e.push(`ดึงข้อมูลจากลิงก์ไม่ได้ (${err.message}) กรุณากรอกชื่อและคำอธิบายเอง`); }
    }
    if (vid) { f.kind = req.body.kind === "course" ? "course" : "video"; f.image_url ||= `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`; }
    if (!e.length && !f.title) e.push("กรุณาใส่ชื่อเรื่อง");
    if (e.length) { adminNav(res); return res.status(422).render("admin/news-add", { metaTitle: "เพิ่มลิงก์", noindex: true, form: { ...req.body, ...f }, errors: e }); }
    const t = new Date().toISOString();
    const r = db.prepare("INSERT INTO feed_items(source_id,kind,guid,url,title,summary,image_url,author,video_id,provider,published_at,status,created_at,updated_at) VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(f.kind, `manual:${H.token(6)}`, f.url, f.title, f.summary, f.image_url, "", vid, f.provider, t, f.use_ai ? "queued" : "new", t, t);
    if (!f.use_ai) { try { await writeArticle(db, uploads, Number(r.lastInsertRowid), { useAi: false }); } catch (err) { flash(req, "error", err.message); return res.redirect("/admin/feed?status=error"); } }
    flash(req, "success", f.use_ai ? "เพิ่มแล้ว AI จะเขียนให้และส่งเข้ารายการรออนุมัติ" : "เพิ่มแล้ว อยู่ในรายการรออนุมัติ");
    res.redirect("/admin/news");
  });

  // ---------- admin: sources ----------
  const sourceForm = (b) => ({ name: H.text(b.name, 120), type: Object.hasOwn(SOURCE_TYPES, b.type) ? b.type : "rss", url: H.text(b.url, 1000), kind: Object.hasOwn(KINDS, b.kind) ? b.kind : "thai_game", keywords: H.text(b.keywords, 500), auto_ai: b.auto_ai === "1" ? 1 : 0, active: b.active === "1" ? 1 : 0, interval_min: Math.max(30, Math.min(10080, parseInt(b.interval_min, 10) || 360)), note: H.text(b.note, 300) });
  const validSource = (f) => { const e = []; if (f.name.length < 2) e.push("กรุณาใส่ชื่อแหล่งข่าว"); if (f.type === "rss" && !H.externalUrl(f.url)) e.push("URL ของ RSS ไม่ถูกต้อง"); if (f.type === "youtube" && !/^(UC[\w-]{22}|@[\w.-]+|https?:\/\/)/.test(f.url)) e.push("ใส่ลิงก์ช่อง YouTube, @handle หรือ channel ID (UC...)"); if (f.type === "youtube_search" && f.url.length < 2) e.push("ใส่คำค้นหา"); return e; };
  app.get("/admin/sources", admin, (_q, res) => {
    adminNav(res);
    res.render("admin/sources", { metaTitle: "แหล่งข่าว", noindex: true, sources: db.prepare("SELECT s.*,(SELECT COUNT(*) FROM feed_items i WHERE i.source_id=s.id) item_count FROM news_sources s ORDER BY s.kind,s.name").all(), form: { type: "rss", kind: "thai_game", interval_min: 360, active: 1 }, errors: [], sourceTypes: SOURCE_TYPES, worker: workerInfo(), youtubeKey: Boolean(process.env.YOUTUBE_API_KEY) });
  });
  app.post("/admin/sources", admin, csrf, (req, res) => {
    const f = sourceForm(req.body), e = validSource(f);
    if (e.length) { adminNav(res); return res.status(422).render("admin/sources", { metaTitle: "แหล่งข่าว", noindex: true, sources: db.prepare("SELECT s.*,0 item_count FROM news_sources s ORDER BY s.kind,s.name").all(), form: f, errors: e, sourceTypes: SOURCE_TYPES, worker: workerInfo(), youtubeKey: Boolean(process.env.YOUTUBE_API_KEY) }); }
    const t = new Date().toISOString();
    db.prepare("INSERT INTO news_sources(name,type,url,kind,keywords,auto_ai,active,interval_min,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(f.name, f.type, f.url, f.kind, f.keywords, f.auto_ai, f.active, f.interval_min, f.note, t, t);
    flash(req, "success", "เพิ่มแหล่งข่าวแล้ว กด 'ดึงตอนนี้' เพื่อทดสอบ"); res.redirect("/admin/sources");
  });
  app.post("/admin/sources/fetch-all", admin, csrf, async (req, res) => {
    let added = 0, errors = 0;
    for (const s of db.prepare("SELECT * FROM news_sources WHERE active=1").all()) { const r = await fetchSource(db, s); added += r.added; if (r.error) errors++; }
    flash(req, errors ? "error" : "success", `ดึงข้อมูลแล้ว ได้รายการใหม่ ${added} รายการ${errors ? ` (ผิดพลาด ${errors} แหล่ง)` : ""}`); res.redirect("/admin/sources");
  });
  app.post("/admin/sources/:id/fetch", admin, csrf, async (req, res) => {
    const s = db.prepare("SELECT * FROM news_sources WHERE id=?").get(req.params.id); if (!s) return res.redirect("/admin/sources");
    const r = await fetchSource(db, s);
    flash(req, r.error ? "error" : "success", r.error ? `${s.name}: ${r.error}` : `${s.name}: ได้รายการใหม่ ${r.added} รายการ (ส่งให้ AI ${r.queued})`); res.redirect("/admin/sources");
  });
  app.post("/admin/sources/:id/update", admin, csrf, (req, res) => {
    const s = db.prepare("SELECT * FROM news_sources WHERE id=?").get(req.params.id); if (!s) return res.redirect("/admin/sources");
    const f = sourceForm({ ...s, auto_ai: String(s.auto_ai), active: String(s.active), ...req.body }), e = validSource(f);
    if (e.length) { flash(req, "error", e.join(" / ")); return res.redirect("/admin/sources"); }
    db.prepare("UPDATE news_sources SET name=?,type=?,url=?,kind=?,keywords=?,auto_ai=?,active=?,interval_min=?,note=?,updated_at=? WHERE id=?").run(f.name, f.type, f.url, f.kind, f.keywords, f.auto_ai, f.active, f.interval_min, f.note, new Date().toISOString(), s.id);
    flash(req, "success", "บันทึกแหล่งข่าวแล้ว"); res.redirect("/admin/sources");
  });
  app.post("/admin/sources/:id/delete", admin, csrf, (req, res) => { db.prepare("DELETE FROM news_sources WHERE id=?").run(req.params.id); flash(req, "success", "ลบแหล่งข่าวแล้ว"); res.redirect("/admin/sources"); });

  // ---------- admin: AI ----------
  app.post("/admin/ai/test", admin, csrf, async (req, res) => {
    try { const r = await testLlm(); flash(req, "success", `เชื่อมต่อ ${cfg().model} ได้ (${r.seconds} วินาที): ${r.reply}`); }
    catch (e) { flash(req, "error", `เชื่อมต่อ AI ไม่ได้: ${e.message} — ตรวจ LLM_BASE_URL`); }
    res.redirect(back(req, "/admin/sources"));
  });
  app.post("/admin/ai/run", admin, csrf, (req, res) => { worker?.runAi?.().catch(() => {}); flash(req, "success", "สั่งให้ AI เริ่มงานถัดไปแล้ว"); res.redirect(back(req, "/admin/feed?status=queued")); });

  function workerInfo() {
    const c = cfg(), day = new Date().toISOString().slice(0, 10);
    return { model: c.model, baseUrl: c.baseUrl, enabled: c.enabled, autoPublish: c.autoPublish, dailyLimit: c.dailyLimit, usedToday: Number(db.prepare("SELECT value FROM settings WHERE key=?").get("ai_count_" + day)?.value || 0), busy: Boolean(worker?.busy), lastError: worker?.lastError || "", lastRun: worker?.lastRun || "", lastDurationSec: worker?.lastDurationSec || 0 };
  }
  app.locals.newsAdminStats = () => ({ pending: pendingCount(), published: countPublished(), queued: db.prepare("SELECT COUNT(*) n FROM feed_items WHERE status IN ('queued','processing')").get().n, fresh: db.prepare("SELECT COUNT(*) n FROM feed_items WHERE status='new'").get().n, sources: db.prepare("SELECT COUNT(*) n FROM news_sources WHERE active=1").get().n, ai: workerInfo() });
  return { cacheImage };
}

module.exports = { registerNews };
