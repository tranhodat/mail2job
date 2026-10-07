const crypto = require('crypto');
const E = process.env;
const base = () => {
  if (E.BASE_URL) return E.BASE_URL;
  const host = E.VERCEL_PROJECT_PRODUCTION_URL || E.VERCEL_URL;
  if (!host) return 'http://localhost:3000';
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
  return `${local ? 'http' : 'https'}://${host}`;
};

// ---- Mã hóa & phiên đăng nhập (cookie HttpOnly) ----
const key = () => crypto.createHash('sha256').update(E.SESSION_SECRET || '').digest();
const enc = t => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv); const d = Buffer.concat([c.update(t, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), d]).toString('base64url'); };
const dec = s => { const b = Buffer.from(s, 'base64url'), d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); };
const cookie = (req, n) => ((req.headers.cookie || '').split('; ').find(c => c.startsWith(n + '=')) || '').slice(n.length + 1);
const user = req => { try { const s = JSON.parse(dec(cookie(req, 's'))); return s.x > Date.now() ? s.e : null; } catch { return null; } };
const h = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(500).json({ error: e.message }); } };

// ---- Lưu trữ: Upstash Redis (REST) ----
const redisConfig = () => {
  const url = E.UPSTASH_REDIS_REST_URL || E.KV_REST_API_URL;
  const token = E.UPSTASH_REDIS_REST_TOKEN || E.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Redis chưa được cấu hình. Hãy đặt UPSTASH_REDIS_REST_URL và UPSTASH_REDIS_REST_TOKEN trong .env.local hoặc Vercel Environment Variables.');
  return { url, token };
};
const rd = async (...cmd) => {
  const { url, token } = redisConfig();
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error('Redis REST lỗi ' + r.status);
  return (await r.json()).result;
};
const get = async k => { const v = await rd('GET', k); return v ? JSON.parse(v) : null; };
const set = (k, v) => rd('SET', k, JSON.stringify(v));

// ---- Gmail ----
async function token(e) {
  const u = await get('u:' + e);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: E.GOOGLE_CLIENT_ID, client_secret: E.GOOGLE_CLIENT_SECRET, refresh_token: dec(u.rt), grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('Quyền truy cập đã hết hạn, hãy đăng nhập lại Google');
  return j.access_token;
}
const g = async (t, path, o = {}) => {
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + path, { ...o, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error('Gmail API lỗi ' + r.status);
  return r.json();
};
const hdr = (m, n) => (m.payload.headers.find(x => x.name.toLowerCase() === n) || {}).value || '';
const parts = (p, o = { text: '', att: [] }) => {
  if (p.filename && p.body && p.body.attachmentId) o.att.push(p.filename);
  else if (p.mimeType === 'text/plain' && p.body && p.body.data) o.text += Buffer.from(p.body.data, 'base64url').toString('utf8');
  (p.parts || []).forEach(x => parts(x, o)); return o;
};
const norm = m => { const o = parts(m.payload); return { id: m.id, threadId: m.threadId, from: hdr(m, 'from'), sub: hdr(m, 'subject') || '(Không tiêu đề)', date: hdr(m, 'date'), snippet: m.snippet, body: o.text.slice(0, 4000), att: o.att }; };
const mail = async (e, id) => norm(await g(await token(e), 'messages/' + id + '?format=full'));
const raw = (to, sub, body) => Buffer.from(`To: ${to}\r\nSubject: =?UTF-8?B?${Buffer.from(sub).toString('base64')}?=\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`).toString('base64url');

// ---- Claude ----
async function ai(system, user, max = 1000) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: E.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: max, system, messages: [{ role: 'user', content: user }] }) });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'AI lỗi');
  return j.content.map(c => c.text || '').join('');
}

// ---- Xử lý công việc: đọc thư -> AI soạn -> lưu nháp -> (duyệt) gửi ----
const log = (t, m) => t.log.push({ at: new Date().toISOString(), m });
async function run(e, t) {
  try {
    t.error = null; const tk = await token(e);
    const m = norm(await g(tk, 'messages/' + t.mid + '?format=full'));
    t.step = 1; t.pct = 25; log(t, `Đã đọc thư của ${m.from}${m.att.length ? `, có ${m.att.length} tệp đính kèm` : ''}`);
    t.draft = await ai('Bạn là trợ lý email chuyên nghiệp. Viết bản trả lời ngắn gọn, lịch sự, cùng ngôn ngữ với thư gốc. Chỉ trả về nội dung thư, không thêm tiêu đề.', `Thư gốc:\nTừ: ${m.from}\nChủ đề: ${m.sub}\n\n${m.body}\n\nChỉ dẫn thêm: ${t.note || 'không có'}`);
    t.step = 2; t.pct = 50; log(t, 'AI đã soạn nội dung trả lời');
    const d = await g(tk, 'drafts', { method: 'POST', body: JSON.stringify({ message: { threadId: m.threadId, raw: raw(t.to, 'Re: ' + m.sub.replace(/^re:\s*/i, ''), t.draft) } }) });
    t.draftId = d.id; t.step = 3; t.pct = 75; log(t, `Đã lưu bản nháp vào Gmail, chờ bạn duyệt để gửi đến ${t.to}`);
  } catch (x) { t.error = x.message; log(t, 'Lỗi: ' + x.message); }
}
async function send(e, t) {
  try { const tk = await token(e); await g(tk, 'drafts/send', { method: 'POST', body: JSON.stringify({ id: t.draftId }) }); t.step = 4; t.pct = 100; t.error = null; log(t, 'Đã gửi thư đến ' + t.to); }
  catch (x) { t.error = x.message; log(t, 'Lỗi: ' + x.message); }
}

module.exports = { base, enc, dec, cookie, user, h, get, set, token, g, norm, mail, ai, run, send, log };
