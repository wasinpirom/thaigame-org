// ThaiGame.org – AI-curated Thai game news, videos, courses and Game Jam calendar.
// Only the admin logs in (to approve AI articles); there are no public member accounts.
const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const compression = require("compression");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const { init, Store } = require("./db");
const H = require("./helpers");
const { registerNews } = require("./news");
const { registerJams } = require("./jams");
const { startWorker } = require("./ai");
const { KINDS } = require("./newsdb");

const LINE_OA_ID = process.env.LINE_OA_ID || "@wasin";
const LINE_OA_URL = `https://line.me/R/ti/p/${encodeURIComponent(LINE_OA_ID)}`;
const KWAY_URL = process.env.KWAY_URL || "https://kway.app";

function createApp(options = {}) {
  const app = express(), root = path.resolve(__dirname, "..");
  const storage = options.storageDir || process.env.STORAGE_DIR || path.join(root, "storage"), uploads = path.join(storage, "uploads");
  fs.mkdirSync(uploads, { recursive: true });
  const db = options.db || init(storage);
  const siteUrl = String(process.env.SITE_URL || "https://thaigame.org").replace(/\/+$/, "");
  const assetVersion = process.env.ASSET_VERSION || String(Date.now());
  const secret = process.env.SESSION_SECRET || (() => { const f = path.join(storage, ".session_secret"); try { return fs.readFileSync(f, "utf8").trim(); } catch { const v = H.token(32); fs.writeFileSync(f, v, { mode: 0o600 }); return v; } })();

  app.set("trust proxy", 1); app.set("view engine", "ejs"); app.set("views", path.join(root, "views")); app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", "data:", "https:"], styleSrc: ["'self'"], scriptSrc: ["'self'"], frameSrc: ["https://www.youtube.com", "https://www.youtube-nocookie.com"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"] } }, crossOriginResourcePolicy: { policy: "same-origin" }, referrerPolicy: { policy: "strict-origin-when-cross-origin" } }));
  app.use(compression());
  app.use(express.static(path.join(root, "public"), { maxAge: "7d" }));
  app.use("/uploads", express.static(uploads, { maxAge: "30d", immutable: true }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(session({ name: "thaigame.sid", secret, store: new Store(db), resave: false, saveUninitialized: false, rolling: true, cookie: { httpOnly: true, sameSite: "lax", secure: siteUrl.startsWith("https://"), maxAge: 1209600000 } }));
  app.use((req, res, next) => {
    if (!req.session.csrf) req.session.csrf = H.token();
    req.user = req.session.uid ? db.prepare("SELECT * FROM users WHERE id=? AND status='active' AND role='admin'").get(req.session.uid) : null;
    if (req.session.uid && !req.user) delete req.session.uid;
    Object.assign(res.locals, { siteName: "ThaiGame.org", siteUrl, currentUser: req.user, csrfToken: req.session.csrf, currentPath: req.path, formatDate: H.date, excerpt: H.excerpt, flash: req.session.flash || null, assetVersion, newsKinds: KINDS, renderBody: H.renderBody, ago: H.ago, lineOaId: LINE_OA_ID, lineOaUrl: LINE_OA_URL, kwayUrl: KWAY_URL, isAdminPath: req.path.startsWith("/admin") });
    delete req.session.flash; next();
  });

  const limiter = rateLimit({ windowMs: 900000, limit: 20, legacyHeaders: false, standardHeaders: "draft-8", message: "ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที" });
  const flash = (req, type, message) => req.session.flash = { type, message };
  const csrf = (req, res, next) => H.sameToken(req.body?._csrf, req.session.csrf) ? next() : res.status(403).render("error", { metaTitle: "คำขอหมดอายุ", statusCode: 403, message: "กรุณาย้อนกลับและส่งแบบฟอร์มอีกครั้ง" });
  const admin = (req, res, next) => req.user ? next() : res.status(403).render("error", { metaTitle: "ไม่มีสิทธิ์", statusCode: 403, message: "หน้านี้สำหรับผู้ดูแลระบบ" });
  const returnTo = (v) => String(v || "").startsWith("/") && !String(v).startsWith("//") ? String(v) : "/admin";

  app.get("/health", (_q, r) => { try { db.prepare("SELECT 1").get(); r.json({ status: "ok" }); } catch { r.status(503).json({ status: "unavailable" }); } });

  // ---------- admin login (no public sign-up) ----------
  app.get("/login", (req, res) => req.user ? res.redirect("/admin") : res.render("auth/login", { metaTitle: "เข้าสู่ระบบผู้ดูแล", form: { email: "" }, errors: [], returnTo: returnTo(req.query.returnTo) }));
  app.post("/login", limiter, csrf, (req, res) => {
    const f = { email: H.email(req.body.email) }, u = db.prepare("SELECT * FROM users WHERE email=? AND role='admin'").get(f.email);
    const ok = u && u.status === "active" && bcrypt.compareSync(String(req.body.password || ""), u.password_hash);
    if (!ok) return res.status(401).render("auth/login", { metaTitle: "เข้าสู่ระบบผู้ดูแล", form: f, errors: ["อีเมลหรือรหัสผ่านไม่ถูกต้อง"], returnTo: returnTo(req.body.returnTo) });
    const go = returnTo(req.body.returnTo);
    req.session.regenerate(err => { if (err) throw err; req.session.uid = u.id; req.session.csrf = H.token(); req.session.flash = { type: "success", message: `ยินดีต้อนรับ ${u.display_name}` }; res.redirect(go); });
  });
  app.post("/logout", csrf, (req, res) => req.session.destroy(() => { res.clearCookie("thaigame.sid"); res.redirect("/"); }));

  // ---------- AI news, videos, courses, Game Jams ----------
  const worker = options.worker || startWorker(db, uploads);
  registerNews(app, { db, uploads, admin, csrf, flash, worker, siteUrl });
  registerJams(app, { db, admin, csrf, flash });
  app.locals.worker = worker;

  app.get("/", (_q, r) => {
    const n = (k) => db.prepare(`SELECT COUNT(*) n FROM articles WHERE status='published' AND kind ${k}`).get().n;
    r.render("home", {
      metaTitle: "ข่าวเกมไทย ปฏิทิน Game Jam และคอร์สสร้างเกม โดย ดร.วศิน ภิรมย์",
      metaDescription: "ThaiGame.org รวบรวมข่าวเกมใหม่จากนักพัฒนาไทย เครื่องมือพัฒนาเกม วิดีโอ คอร์ส และปฏิทิน Game Jam ด้วย AI อัปเดตอัตโนมัติ ใช้งานฟรี",
      heroNews: app.locals.latestNews(null, 3), jamBlock: app.locals.homeJams(),
      thaiNews: app.locals.latestNews("thai_game", 6), devNews: app.locals.latestNews("devnews", 6), videos: app.locals.latestNews("video", 4), courses: app.locals.latestNews("course", 4),
      stats: { news: n("IN ('thai_game','devnews')"), videos: n("='video'"), courses: n("='course'") }
    });
  });

  app.get("/admin", admin, (_q, r) => r.render("admin", { metaTitle: "ผู้ดูแลระบบ", noindex: true, newsStats: app.locals.newsAdminStats(), jamCount: db.prepare("SELECT COUNT(*) n FROM jams WHERE hidden=0 AND (end_at>=? OR start_at>=?)").get(new Date().toISOString(), new Date().toISOString()).n }));
  app.get("/about", (_q, r) => r.render("about", { metaTitle: "เกี่ยวกับ ThaiGame.org", metaDescription: "เว็บข่าวเกมไทยที่รวบรวมด้วย AI โดย ดร.วศิน ภิรมย์" }));
  app.get("/terms", (_q, r) => r.render("terms", { metaTitle: "เงื่อนไขและนโยบายเนื้อหา" }));

  // ---------- old URLs from the member-submission version ----------
  const moved = { "/games": "/news?kind=thai_game", "/developers": "/news?kind=thai_game", "/events": "/jams", "/register": "/", "/dashboard": "/admin", "/profile/edit": "/admin", "/en": "/", "/en/contact": "/contact" };
  app.get(/^\/(games|developers|events)(\/.*)?$/, (req, res) => res.redirect(301, moved["/" + req.params[0]]));
  app.get(/^\/en(\/.*)?$/, (req, res) => { const p = (req.params[0] || "").replace(/\/$/, ""); res.redirect(301, ["/about", "/terms", "/login"].includes(p) ? p : p === "/contact" ? "/contact" : "/"); });
  ["/register", "/dashboard", "/profile/edit"].forEach(p => app.get(p, (_q, r) => r.redirect(301, moved[p])));

  app.get("/robots.txt", (_q, r) => r.type("text").send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /login\nSitemap: ${siteUrl}/sitemap.xml\n`));
  app.get("/sitemap.xml", (_q, r) => {
    const news = db.prepare("SELECT slug,updated_at FROM articles WHERE status='published' ORDER BY published_at DESC LIMIT 5000").all();
    const fixed = ["", "/news", "/news?kind=thai_game", "/news?kind=devnews", "/jams", "/videos", "/learn", "/about", "/contact", "/terms"].map(p => `<url><loc>${H.esc(siteUrl + p)}</loc></url>`);
    r.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${fixed.join("")}${news.map(a => `<url><loc>${siteUrl}/news/${a.slug}</loc><lastmod>${a.updated_at.slice(0, 10)}</lastmod></url>`).join("")}</urlset>`);
  });

  app.use((_q, r) => r.status(404).render("404", { metaTitle: "ไม่พบหน้าที่ต้องการ" }));
  app.use((e, _req, res, _n) => { console.error(e); res.status(500).render("error", { metaTitle: "ระบบขัดข้อง", statusCode: 500, message: process.env.NODE_ENV === "production" ? "เกิดข้อผิดพลาด กรุณาลองใหม่" : e.message }); });
  app.locals.db = db; app.locals.storageDir = storage;
  return app;
}
module.exports = { createApp };
