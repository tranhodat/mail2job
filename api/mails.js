const U = require('../lib/util');
module.exports = U.h(async (req, res) => {
  const e = U.user(req); if (!e) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const tk = await U.token(e), l = await U.g(tk, 'messages?maxResults=15&q=in:inbox');
  const ms = await Promise.all((l.messages || []).map(x => U.g(tk, 'messages/' + x.id + '?format=full')));
  res.json(ms.map(U.norm));
});
