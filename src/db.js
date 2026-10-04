const fs = require("node:fs");
const path = require("node:path");
const session = require("express-session");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const { slug } = require("./helpers");
const { initNews } = require("./newsdb");
const { initJams } = require("./jams");
const now = () => new Date().toISOString();

function init(storageDir) {
  fs.mkdirSync(storageDir, { recursive: true });
  const db = new Database(path.join(storageDir, "thaigame.sqlite"));
  db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON"); db.pragma("busy_timeout = 5000");
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
    profile_public INTEGER NOT NULL DEFAULT 0, bio TEXT NOT NULL DEFAULT '', avatar_path TEXT NOT NULL DEFAULT '',
    website_url TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL DEFAULT '', line_id TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '', facebook_url TEXT NOT NULL DEFAULT '', x_url TEXT NOT NULL DEFAULT '',
    youtube_url TEXT NOT NULL DEFAULT '', itch_url TEXT NOT NULL DEFAULT '', steam_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active', accepted_terms_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE, title_th TEXT NOT NULL, title_en TEXT NOT NULL DEFAULT '',
    short_description TEXT NOT NULL, short_description_en TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL, description_en TEXT NOT NULL DEFAULT '', developer_name TEXT NOT NULL DEFAULT '',
    release_date TEXT NOT NULL DEFAULT '', platforms TEXT NOT NULL DEFAULT '[]', categories TEXT NOT NULL DEFAULT '[]',
    ai_usage TEXT NOT NULL DEFAULT '',
    cover_path TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'published', admin_note TEXT NOT NULL DEFAULT '',
    featured INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS screenshots (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE, path TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE, youtube_id TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS game_links (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE, label TEXT NOT NULL, url TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, event_type TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL, end_date TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL, registration_url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'published',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS event_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    attendee_name TEXT NOT NULL, attendee_email TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expire INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_games_status ON games(status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_games_user ON games(user_id);
  CREATE INDEX IF NOT EXISTS idx_events_status_date ON events(status, start_date);
  CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);`);
  const cols = db.prepare("PRAGMA table_info(games)").all().map(c => c.name);
  if (!cols.includes("short_description_en")) db.prepare("ALTER TABLE games ADD COLUMN short_description_en TEXT NOT NULL DEFAULT ''").run();
  if (!cols.includes("description_en")) db.prepare("ALTER TABLE games ADD COLUMN description_en TEXT NOT NULL DEFAULT ''").run();
  if (!cols.includes("ai_usage")) db.prepare("ALTER TABLE games ADD COLUMN ai_usage TEXT NOT NULL DEFAULT ''").run();
  initNews(db); initJams(db); bootstrap(db); return db;
}
function bootstrap(db) {
  const mail = String(process.env.ADMIN_EMAIL || "admin@thaigame.org").trim().toLowerCase();
  const pass = String(process.env.ADMIN_PASSWORD || "");
  const found = db.prepare("SELECT id FROM users WHERE email=?").get(mail);
  if (found) { db.prepare("UPDATE users SET role='admin' WHERE id=?").run(found.id); return; }
  if (!pass) { if (process.env.NODE_ENV === "production") throw new Error("ADMIN_PASSWORD is required"); return; }
  const t = now();
  db.prepare(`INSERT INTO users(email,password_hash,display_name,role,profile_public,bio,contact_email,accepted_terms_at,created_at,updated_at)
    VALUES(?,?,?,'admin',1,?,?,?, ?,?)`).run(mail, bcrypt.hashSync(pass, 12), process.env.ADMIN_NAME || "ผู้ดูแล ThaiGame.org", "ผู้ดูแลพื้นที่ประชาสัมพันธ์ผลงานเกมไทย", mail, t, t, t);
}
class Store extends session.Store {
  constructor(db) { super(); this.db=db; this.getS=db.prepare("SELECT sess,expire FROM sessions WHERE sid=?"); this.setS=db.prepare("INSERT INTO sessions(sid,sess,expire) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expire=excluded.expire"); this.delS=db.prepare("DELETE FROM sessions WHERE sid=?"); }
  get(sid, cb) { try { const r=this.getS.get(sid); if(!r||r.expire<Date.now()){if(r)this.delS.run(sid);return cb(null,null);} cb(null,JSON.parse(r.sess)); } catch(e){cb(e);} }
  set(sid,s,cb=()=>{}) { try { const ex=s.cookie?.expires?new Date(s.cookie.expires).getTime():Date.now()+1209600000; this.setS.run(sid,JSON.stringify(s),ex); cb(null); }catch(e){cb(e);} }
  touch(sid,s,cb){this.set(sid,s,cb);} destroy(sid,cb=()=>{}){try{this.delS.run(sid);cb(null);}catch(e){cb(e);}}
}
module.exports = { init, Store };
