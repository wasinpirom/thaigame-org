// Pull items from RSS/Atom, YouTube channels and YouTube search into feed_items.
const Parser = require("rss-parser");
const { safeFetch, stripHtml } = require("./fetcher");
const H = require("./helpers");

const parser = new Parser({
  customFields: {
    item: [["media:group", "mediaGroup"], ["media:thumbnail", "mediaThumb"], ["media:content", "mediaContent"], ["yt:videoId", "ytVideoId"], ["enclosure", "enclosure"], ["content:encoded", "contentEncoded"]]
  }
});

const MAX_PER_FETCH = 20;
const errMsg = (e) => [e.message, e.cause?.code, e.cause?.message].filter(Boolean).join(" – ");
const firstImage = (html) => { const m = String(html || "").match(/<img[^>]+src=["']([^"']+)["']/i); return m ? m[1] : ""; };
const attr = (node, key) => node?.$?.[key] || node?.[0]?.$?.[key] || "";

function normalizeRss(item) {
  const mg = item.mediaGroup || {};
  const ytId = item.ytVideoId || (String(item.id || "").startsWith("yt:video:") ? String(item.id).slice(9) : "") || H.youtubeId(item.link || "");
  const image = attr(mg["media:thumbnail"], "url") || attr(item.mediaThumb, "url") || attr(item.mediaContent, "url") || (item.enclosure?.type?.startsWith("image") ? item.enclosure.url : "") || firstImage(item.contentEncoded || item.content) || (ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : "");
  const descNode = mg["media:description"];
  const desc = (Array.isArray(descNode) ? descNode[0] : descNode) || item.contentSnippet || stripHtml(item.contentEncoded || item.content || item.summary || "");
  return {
    guid: String(item.guid || item.id || item.link || item.title || "").slice(0, 500),
    url: H.externalUrl(item.link || ""),
    title: H.text(stripHtml(item.title || ""), 300),
    summary: H.text(typeof desc === "string" ? desc : desc?._ || "", 4000),
    image_url: H.externalUrl(image),
    author: H.text(item.creator || item.author || item["dc:creator"] || "", 140),
    video_id: ytId ? String(ytId).slice(0, 11) : "",
    published_at: item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : "")
  };
}

// Accepts UC… id, /channel/UC… URL, a feeds URL, or an @handle / channel page (resolved via the page HTML).
async function youtubeFeedUrl(input) {
  const v = String(input || "").trim();
  if (/^UC[\w-]{22}$/.test(v)) return `https://www.youtube.com/feeds/videos.xml?channel_id=${v}`;
  if (/youtube\.com\/feeds\/videos\.xml/.test(v)) return v;
  const m = v.match(/youtube\.com\/channel\/(UC[\w-]{22})/); if (m) return `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`;
  const pl = v.match(/[?&]list=([\w-]+)/); if (pl) return `https://www.youtube.com/feeds/videos.xml?playlist_id=${pl[1]}`;
  const page = v.startsWith("@") ? `https://www.youtube.com/${v}` : v;
  const html = (await safeFetch(page, { accept: "text/html" })).body;
  const id = (html.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/) || [])[1];
  if (!id) throw new Error("หา channel ID ไม่เจอ ลองใส่ลิงก์แบบ youtube.com/channel/UC...");
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
}

async function youtubeSearch(query) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("ยังไม่ได้ตั้ง YOUTUBE_API_KEY");
  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  Object.entries({ part: "snippet", type: "video", order: "date", maxResults: "15", q: query, regionCode: "TH", relevanceLanguage: "th", key }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await safeFetch(u.toString(), { accept: "application/json" });
  const data = JSON.parse(r.body);
  if (data.error) throw new Error(data.error.message || "YouTube API error");
  return (data.items || []).filter(x => x.id?.videoId).map(x => ({
    guid: `yt:${x.id.videoId}`, url: `https://www.youtube.com/watch?v=${x.id.videoId}`,
    title: H.text(stripHtml(x.snippet.title), 300), summary: H.text(stripHtml(x.snippet.description), 4000),
    image_url: x.snippet.thumbnails?.high?.url || `https://i.ytimg.com/vi/${x.id.videoId}/hqdefault.jpg`,
    author: H.text(x.snippet.channelTitle, 140), video_id: x.id.videoId, published_at: x.snippet.publishedAt || ""
  }));
}

async function readSource(source) {
  if (source.type === "youtube_search") return youtubeSearch(source.url);
  const url = source.type === "youtube" ? await youtubeFeedUrl(source.url) : source.url;
  const r = await safeFetch(url, { accept: "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.5" });
  const feed = await parser.parseString(r.body);
  return (feed.items || []).map(normalizeRss);
}

function matchesKeywords(item, keywords) {
  const words = String(keywords || "").split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
  if (!words.length) return true;
  const hay = `${item.title} ${item.summary}`.toLowerCase();
  return words.some(w => hay.includes(w));
}

// Returns { added, queued }. First fetch of a source only queues the newest few for AI to avoid flooding the CPU.
async function fetchSource(db, source, { firstQueue = Number(process.env.FIRST_FETCH_QUEUE || 3) } = {}) {
  const t = new Date().toISOString();
  try {
    const items = (await readSource(source))
      .filter(i => i.title && (i.url || i.video_id) && i.guid)
      .filter(i => matchesKeywords(i, source.keywords))
      .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
      .slice(0, MAX_PER_FETCH);
    const isFirst = !source.last_fetched_at;
    const ins = db.prepare(`INSERT OR IGNORE INTO feed_items(source_id,kind,guid,url,title,summary,image_url,author,video_id,published_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const dupUrl = db.prepare("SELECT 1 FROM feed_items WHERE url<>'' AND url=?");
    let added = 0, queued = 0;
    db.transaction(() => items.forEach((i, idx) => {
      if (i.url && dupUrl.get(i.url)) return;
      const status = source.auto_ai && (!isFirst || idx < firstQueue) ? "queued" : "new";
      const r = ins.run(source.id, source.kind, i.guid, i.url, i.title, i.summary, i.image_url, i.author, i.video_id, i.published_at, status, t, t);
      if (r.changes) { added++; if (status === "queued") queued++; }
    }))();
    db.prepare("UPDATE news_sources SET last_fetched_at=?,last_status=?,last_error='',updated_at=? WHERE id=?").run(t, `ok: ใหม่ ${added} รายการ`, t, source.id);
    return { added, queued };
  } catch (e) {
    db.prepare("UPDATE news_sources SET last_fetched_at=?,last_status='error',last_error=?,updated_at=? WHERE id=?").run(t, H.text(errMsg(e), 500), t, source.id);
    return { added: 0, queued: 0, error: errMsg(e) };
  }
}

module.exports = { fetchSource, readSource, youtubeFeedUrl, matchesKeywords, normalizeRss };
