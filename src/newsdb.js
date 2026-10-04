// Schema + seed data for the news / AI content system.
const now = () => new Date().toISOString();

const KINDS = {
  thai_game: { label: "ข่าวเกมไทย", short: "เกมไทย", desc: "เกมใหม่และผลงานจากนักพัฒนาไทยที่เผยแพร่บนแพลตฟอร์มต่าง ๆ" },
  devnews: { label: "ข่าววงการพัฒนาเกม", short: "Dev News", desc: "เครื่องมือ เอนจิน และนวัตกรรมการพัฒนาเกมที่คนไทยควรรู้" },
  video: { label: "วิดีโอ", short: "วิดีโอ", desc: "สัมภาษณ์ รีวิว และข่าวเกมไทยจาก YouTube" },
  course: { label: "คอร์สและแหล่งเรียนรู้", short: "คอร์ส", desc: "คอร์สสร้างเกมและ resource ที่น่าสนใจ" }
};
const SOURCE_TYPES = {
  rss: "RSS / Atom feed",
  youtube: "YouTube channel (ฟรี ไม่ต้องใช้ API key)",
  youtube_search: "YouTube ค้นหาด้วยคำ (ต้องมี YOUTUBE_API_KEY)"
};

function initNews(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS news_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'rss',
    url TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'thai_game', keywords TEXT NOT NULL DEFAULT '',
    auto_ai INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, interval_min INTEGER NOT NULL DEFAULT 360,
    note TEXT NOT NULL DEFAULT '', last_fetched_at TEXT NOT NULL DEFAULT '', last_status TEXT NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS feed_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER REFERENCES news_sources(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'thai_game', guid TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '',
    video_id TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '', published_at TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new', error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(source_id, guid)
  );
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'thai_game',
    item_id INTEGER REFERENCES feed_items(id) ON DELETE SET NULL, title TEXT NOT NULL, excerpt TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '', video_id TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '', source_name TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', ai_generated INTEGER NOT NULL DEFAULT 1,
    ai_model TEXT NOT NULL DEFAULT '', featured INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
  CREATE INDEX IF NOT EXISTS idx_items_status ON feed_items(status, id);
  CREATE INDEX IF NOT EXISTS idx_items_url ON feed_items(url);
  CREATE INDEX IF NOT EXISTS idx_articles_pub ON articles(status, kind, published_at DESC);`);
  seedSources(db);
}

function seedSources(db) {
  if (db.prepare("SELECT value FROM settings WHERE key='sources_seeded'").get()) return;
  const t = now();
  const add = db.prepare(`INSERT INTO news_sources(name,type,url,kind,keywords,auto_ai,active,interval_min,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const rows = [
    ["itch.io – เกมใหม่แท็ก thailand", "rss", "https://itch.io/games/newest/tag-thailand.xml", "thai_game", "", 1, 1, 180, "เกมที่ผู้สร้างติดแท็ก thailand บน itch.io"],
    ["itch.io – เกมใหม่แท็ก thai", "rss", "https://itch.io/games/newest/tag-thai.xml", "thai_game", "", 1, 1, 180, "เกมที่ผู้สร้างติดแท็ก thai บน itch.io"],
    ["Google News – เกมไทย", "rss", "https://news.google.com/rss/search?q=%22%E0%B9%80%E0%B8%81%E0%B8%A1%E0%B9%84%E0%B8%97%E0%B8%A2%22+OR+%22%E0%B8%99%E0%B8%B1%E0%B8%81%E0%B8%9E%E0%B8%B1%E0%B8%92%E0%B8%99%E0%B8%B2%E0%B9%80%E0%B8%81%E0%B8%A1%E0%B9%84%E0%B8%97%E0%B8%A2%22&hl=th&gl=TH&ceid=TH:th", "thai_game", "", 0, 0, 360, "ข่าวจากสื่อไทยหลายสำนัก ปิดไว้ก่อน เปิดใช้เองได้ (ตรวจเงื่อนไขการใช้งานของ Google News)"],
    ["Godot Engine News", "rss", "https://godotengine.org/rss.xml", "devnews", "", 1, 1, 720, "ข่าวเอนจินโอเพนซอร์ส โพสต์ไม่บ่อย จึงให้ AI เขียนอัตโนมัติ"],
    ["Game Developer", "rss", "https://www.gamedeveloper.com/rss.xml", "devnews", "", 0, 1, 360, "ข่าวอุตสาหกรรมเกม มีหลายข่าวต่อวัน แอดมินเลือกข่าวให้ AI เขียน"],
    ["Blender News", "rss", "https://www.blender.org/feed/", "devnews", "", 0, 1, 720, "เครื่องมือ 3D ฟรีที่นักพัฒนาเกมใช้กันมาก"],
    ["Blognone – ข่าวเกม/เทคโนโลยีเกม", "rss", "https://www.blognone.com/atom.xml", "devnews", "เกม,Unity,Unreal,Godot,Steam,Nintendo,PlayStation,Xbox", 0, 1, 360, "ข่าวไอทีภาษาไทย กรองเฉพาะคำที่เกี่ยวกับเกม"],
    ["Zenva GameDev Academy", "rss", "https://gamedevacademy.org/feed/", "course", "", 0, 1, 1440, "บทเรียน/คอร์สสร้างเกมจาก Zenva"],
    ["YouTube – ค้นหา 'เกมไทย นักพัฒนา'", "youtube_search", "เกมไทย นักพัฒนาเกม", "video", "", 1, 0, 720, "ต้องตั้ง YOUTUBE_API_KEY ก่อนเปิดใช้"]
  ];
  db.transaction(() => {
    rows.forEach(r => add.run(...r, t, t));
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('sources_seeded','1')").run();
  })();
}

const getSetting = (db, k, d = "") => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value ?? d;
const setSetting = (db, k, v) => db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, String(v));

module.exports = { initNews, KINDS, SOURCE_TYPES, getSetting, setSetting };
