const U = require('../lib/util'); const E = process.env;
module.exports = U.h(async (req, res) => {
  const a = req.query.a, redir = U.base() + '/api/auth/callback';
  const secure = U.base().startsWith('https://') ? '; Secure' : '';
  if (a === 'login') {
    const st = require('crypto').randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', `st=${st}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=600`);
    return res.redirect(302, 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: E.GOOGLE_CLIENT_ID, redirect_uri: redir, response_type: 'code', access_type: 'offline', prompt: 'consent', state: st, scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose' }));
  }
  if (a === 'callback') {
    if (!req.query.code || req.query.state !== U.cookie(req, 'st')) return res.status(400).send('Phiên đăng nhập không hợp lệ');
    const t = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ code: req.query.code, client_id: E.GOOGLE_CLIENT_ID, client_secret: E.GOOGLE_CLIENT_SECRET, redirect_uri: redir, grant_type: 'authorization_code' }) })).json();
    if (!t.access_token) return res.status(400).send('Không đăng nhập được với Google');
    const p = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + t.access_token } })).json();
    const old = await U.get('u:' + p.email), rt = t.refresh_token ? U.enc(t.refresh_token) : old && old.rt;
    await U.set('u:' + p.email, { rt, name: p.name, pic: p.picture });
    const us = (await U.get('users')) || []; if (!us.includes(p.email)) await U.set('users', [...us, p.email]);
    res.setHeader('Set-Cookie', `s=${U.enc(JSON.stringify({ e: p.email, x: Date.now() + 6048e5 }))}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=604800`);
    return res.redirect(302, '/');
  }
  if (a === 'logout') { res.setHeader('Set-Cookie', 's=; Path=/; Max-Age=0'); return res.redirect(302, '/'); }
  const e = U.user(req); if (!e) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const u = await U.get('u:' + e); res.json({ email: e, name: u.name, pic: u.pic });
});
