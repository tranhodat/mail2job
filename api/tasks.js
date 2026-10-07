const U = require('../lib/util');
const trim = a => a.slice(0, 300).map((t, i) => i > 40 ? { ...t, draft: undefined } : t);
module.exports = U.h(async (req, res) => {
  const e = U.user(req); if (!e) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const { act, id } = req.query; let ts = (await U.get('t:' + e)) || [];
  if (req.method === 'GET') return res.json(ts);
  if (!act) {
    const b = req.body || {}, m = await U.mail(e, b.mid);
    const t = { id: Date.now().toString(36), mid: m.id, sub: m.sub, from: m.from, to: b.to, att: m.att, note: b.note || '', runAt: b.runAt || new Date().toISOString(), step: 0, pct: 0, log: [] };
    U.log(t, b.runAt ? 'Đã lên lịch xử lý' : 'Bắt đầu xử lý ngay');
    ts.unshift(t); ts = trim(ts);
    if (new Date(t.runAt) <= new Date()) await U.run(e, t);
    await U.set('t:' + e, ts); return res.json(t);
  }
  const t = ts.find(x => x.id === id); if (!t) return res.status(404).json({ error: 'Không tìm thấy công việc' });
  if (act === 'run') await U.run(e, t);
  if (act === 'send' && t.draftId) await U.send(e, t);
  if (act === 'delete') ts = ts.filter(x => x.id !== id);
  await U.set('t:' + e, trim(ts)); res.json(t);
});
