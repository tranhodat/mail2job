const U = require('../lib/util');
const strip = h => h.replace(/<(script|style|nav|footer)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 2500);
const OK = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i; // chặn localhost/IP (SSRF)
module.exports = U.h(async (req, res) => {
  const e = U.user(req); if (!e) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const k = 'n:' + e; let n = (await U.get(k)) || { sources: ['techcrunch.com', 'theverge.com'], items: [] };
  if (req.method === 'POST') {
    if (req.body && req.body.sources) n.sources = req.body.sources.filter(s => OK.test(s)).slice(0, 10);
    if (req.query.act === 'gen') {
      const pages = await Promise.all(n.sources.map(async s => {
        try { const r = await fetch('https://' + s, { headers: { 'user-agent': 'Mozilla/5.0 MailAssistant' }, signal: AbortSignal.timeout(8000) }); return `## ${s}\n` + strip(await r.text()); }
        catch { return `## ${s}\n(không tải được)`; }
      }));
      const out = await U.ai('Bạn là biên tập viên tin công nghệ. Từ nội dung các trang, viết 2 bản tin ngắn cho mỗi nguồn bằng tiếng Việt. Chỉ trả về JSON hợp lệ: [{"source":"","tag":"AI|Bảo mật|Chip|Di động|Đám mây|Khác","title":"","summary":"1-2 câu"}]. Không bịa thông tin ngoài nội dung được cung cấp.', pages.join('\n\n'), 2500);
      n.items = JSON.parse(out.match(/\[[\s\S]*\]/)[0]).map(i => ({ ...i, date: new Date().toISOString() }));
    }
    await U.set(k, n);
  }
  res.json(n);
});
