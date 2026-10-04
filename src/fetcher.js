// Safe outbound HTTP: timeout, size cap, http(s) only, blocks private/internal addresses (SSRF guard).
const dns = require("node:dns").promises;
const net = require("node:net");

const UA = "Mozilla/5.0 (compatible; ThaiGameBot/1.0; +https://thaigame.org/about)";

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith("::ffff:")) return privateIp(x.slice(7));
  return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80");
}

async function assertPublic(urlString) {
  const u = new URL(urlString);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("อนุญาตเฉพาะ http/https");
  if (process.env.ALLOW_PRIVATE_FETCH === "true") return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => privateIp(a.address))) throw new Error("ไม่อนุญาตให้ดึงข้อมูลจากที่อยู่ภายใน");
  return u;
}

async function safeFetch(url, { timeout = 20000, maxBytes = 3 * 1024 * 1024, accept = "*/*", headers = {}, binary = false } = {}) {
  let current = String(url);
  for (let hop = 0; hop < 6; hop++) {
    await assertPublic(current);
    const res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(timeout), headers: { "user-agent": UA, accept, "accept-language": "th,en;q=0.8", ...headers } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { current = new URL(res.headers.get("location"), current).toString(); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length") || 0);
    if (len && len > maxBytes) throw new Error("ไฟล์ใหญ่เกินกำหนด");
    const chunks = []; let size = 0;
    for await (const c of res.body) { size += c.length; if (size > maxBytes) throw new Error("ไฟล์ใหญ่เกินกำหนด"); chunks.push(c); }
    const buf = Buffer.concat(chunks);
    return { url: current, contentType: res.headers.get("content-type") || "", body: binary ? buf : buf.toString("utf8") };
  }
  throw new Error("redirect มากเกินไป");
}

const decode = (s) => String(s || "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const stripHtml = (s) => decode(String(s || "").replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

function meta(html, names) {
  for (const n of names) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${n}["']`, "i");
    const m = html.match(re1) || html.match(re2); if (m && m[1].trim()) return decode(m[1].trim());
  }
  return "";
}

// Fetch a web page and pull title / description / image / readable paragraphs (for the AI writer).
async function pageInfo(url) {
  const r = await safeFetch(url, { accept: "text/html,application/xhtml+xml", maxBytes: 4 * 1024 * 1024 });
  const html = r.body;
  const title = meta(html, ["og:title", "twitter:title"]) || decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").trim();
  const description = meta(html, ["og:description", "description", "twitter:description"]);
  let image = meta(html, ["og:image", "og:image:url", "twitter:image"]);
  try { if (image) image = new URL(image, r.url).toString(); } catch { image = ""; }
  const siteName = meta(html, ["og:site_name"]);
  const main = (html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<main[\s\S]*?<\/main>/i) || [html])[0];
  const paras = [...main.matchAll(/<(p|h2|h3|li)[^>]*>([\s\S]*?)<\/\1>/gi)].map(m => stripHtml(m[2])).filter(t => t.length > 40);
  return { url: r.url, title, description, image, siteName, text: paras.join("\n").slice(0, 6000) };
}

module.exports = { safeFetch, pageInfo, stripHtml, decode, assertPublic, privateIp, UA };
