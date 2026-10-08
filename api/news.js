const U = require('../lib/util');
const OK = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i; // chặn localhost/IP (SSRF)
const decode = value => String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, code) => {
  if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[code.toLowerCase()] || match;
}).replace(/\s+/g, ' ').trim();
const field = (block, name) => {
  const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, 'i'));
  return match ? decode(match[1]) : '';
};
const attr = (tag, name) => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? decode(match[2]) : '';
};
const safeLink = (link, base) => {
  try { const url = new URL(link, base); return url.protocol === 'https:' ? url.toString() : ''; }
  catch { return ''; }
};
const tag = title => /security|hack|malware|lỗ hổng|bảo mật/i.test(title) ? 'Bảo mật' : /chip|processor|semiconductor|gpu|cpu/i.test(title) ? 'Chip' : /android|iphone|mobile|di động/i.test(title) ? 'Di động' : /cloud|đám mây/i.test(title) ? 'Đám mây' : /ai|artificial intelligence|trí tuệ nhân tạo/i.test(title) ? 'AI' : 'Khác';
function feedItems(body, base, source) {
  const entries = [...body.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map(match => {
    const block = match[2], atom = match[1].toLowerCase() === 'entry';
    const linkTag = (block.match(/<link\b[^>]*>/i) || [])[0] || '';
    const link = atom ? attr(linkTag, 'href') : field(block, 'link');
    const title = field(block, 'title');
    const summary = field(block, atom ? 'summary' : 'description') || field(block, 'content:encoded') || field(block, 'content');
    const date = field(block, 'pubDate') || field(block, 'published') || field(block, 'updated');
    return { source, title, summary: summary.slice(0, 500), url: safeLink(link, base), date: Number.isNaN(Date.parse(date)) ? new Date().toISOString() : new Date(date).toISOString() };
  }).filter(item => item.title && item.url);
  return entries;
}
async function fetchSource(source) {
  const url = new URL('https://' + source);
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 MailAssistant', accept: 'text/html,application/atom+xml,application/rss+xml,application/xml' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  let items = feedItems(body, url, source);
  if (!items.length) {
    const links = [...body.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]);
    const feed = links.map(link => ({ type: attr(link, 'type'), href: attr(link, 'href') })).find(link => /rss|atom|xml/i.test(link.type));
    const feedUrl = feed && safeLink(feed.href, url);
    if (feedUrl && new URL(feedUrl).hostname === url.hostname) {
      const feedResponse = await fetch(feedUrl, { headers: { 'user-agent': 'Mozilla/5.0 MailAssistant', accept: 'application/atom+xml,application/rss+xml,application/xml' }, signal: AbortSignal.timeout(10000) });
      if (feedResponse.ok) items = feedItems(await feedResponse.text(), feedUrl, source);
    }
  }
  if (!items.length) {
    const articles = [...body.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/gi)].map(match => match[1]);
    items = articles.map(block => {
      const title = field(block, 'h1') || field(block, 'h2') || field(block, 'h3');
      const anchor = (block.match(/<a\b[^>]*>/i) || [])[0] || '';
      const time = (block.match(/<time\b[^>]*>/i) || [])[0] || '';
      return { source, title, summary: (field(block, 'p') || title).slice(0, 500), url: safeLink(attr(anchor, 'href'), url), date: attr(time, 'datetime') || new Date().toISOString() };
    }).filter(item => item.title && item.url);
  }
  return items.slice(0, 10).map(item => ({ ...item, tag: tag(item.title) }));
}
module.exports = U.h(async (req, res) => {
  const e = U.user(req); if (!e) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const k = 'n:' + e; let n = (await U.get(k)) || { sources: ['techcrunch.com', 'theverge.com'], items: [], saved: [] };
  n.saved ||= [];
  if (req.method === 'POST') {
    if (req.body && req.body.sources) n.sources = req.body.sources.filter(s => OK.test(s)).slice(0, 10);
    if (req.query.act === 'save') {
      const url = String(req.body && req.body.url || '');
      if (req.body && req.body.saved) {
        const item = n.items.find(article => article.url === url);
        if (!item) return res.status(404).json({ error: 'Không tìm thấy bản tin để lưu' });
        n.saved = [item, ...n.saved.filter(article => article.url !== url)].slice(0, 100);
      } else {
        n.saved = n.saved.filter(article => article.url !== url);
      }
      await U.set(k, n);
      return res.json(n);
    }
    if (req.query.act === 'gen') {
      const results = await Promise.all(n.sources.map(async source => {
        try { return await fetchSource(source); }
        catch { return []; }
      }));
      n.items = [...new Map(results.flat().map(item => [item.url, item])).values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 50);
    }
    await U.set(k, n);
  }
  res.json(n);
});
