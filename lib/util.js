const crypto = require('crypto');
const E = process.env;
const base = () => {
  if (E.BASE_URL) {
    let url;
    try { url = new URL(E.BASE_URL); }
    catch { throw new Error('BASE_URL không hợp lệ. Hãy dùng URL gốc, ví dụ https://ten-app.vercel.app'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('BASE_URL phải bắt đầu bằng http:// hoặc https://');
    if (['production', 'preview'].includes(E.VERCEL_ENV) && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname)) {
      throw new Error('BASE_URL trên Vercel không được là localhost. Hãy đặt URL Vercel HTTPS và đăng ký callback tương ứng trong Google Cloud Console.');
    }
    return url.origin;
  }
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
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const error = body.error || {};
    const reason = (error.errors || []).map(x => x.reason).filter(Boolean).join(', ');
    const message = String(error.message || '').slice(0, 300);
    throw new Error(`Gmail API lỗi ${r.status}${reason ? ` (${reason})` : ''}${message ? `: ${message}` : ''}`);
  }
  if (r.status === 204) return {};
  return r.json();
};
const hdr = (m, n) => (m.payload.headers.find(x => x.name.toLowerCase() === n) || {}).value || '';
const parts = (p, o = { text: '', att: [] }) => {
  if (p.filename && p.body && p.body.attachmentId) o.att.push(p.filename);
  else if (p.mimeType === 'text/plain' && p.body && p.body.data) o.text += Buffer.from(p.body.data, 'base64url').toString('utf8');
  (p.parts || []).forEach(x => parts(x, o)); return o;
};
const norm = m => { const o = parts(m.payload); return { id: m.id, threadId: m.threadId, from: hdr(m, 'from'), sub: hdr(m, 'subject') || '(Không tiêu đề)', date: hdr(m, 'date'), snippet: m.snippet, body: o.text.slice(0, 4000), att: o.att, unread: (m.labelIds || []).includes('UNREAD') }; };
const mail = async (e, id) => norm(await g(await token(e), 'messages/' + id + '?format=full'));
const raw = (to, sub, body, files = []) => {
  const headers = `To: ${String(to).replace(/[\r\n]/g, '')}\r\nSubject: =?UTF-8?B?${Buffer.from(String(sub).replace(/[\r\n]/g, '')).toString('base64')}?=\r\n`;
  if (!files.length) return Buffer.from(`${headers}Content-Type: text/plain; charset=UTF-8\r\n\r\n${body}`).toString('base64url');
  const boundary = 'mailwork-' + crypto.randomBytes(12).toString('hex');
  const bodyPart = `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}\r\n`;
  const attachments = files.map(file => {
    const name = String(file.name || 'tep-dinh-kem').replace(/[\r\n\u0000-\u001f]/g, '').slice(0, 180);
    const candidate = String(file.type || 'application/octet-stream');
    const type = /^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(candidate) ? candidate : 'application/octet-stream';
    const filename = encodeURIComponent(name).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    const encoded = Buffer.from(file.data, 'base64').toString('base64').replace(/.{76}/g, '$&\r\n').replace(/\r\n$/, '');
    return `--${boundary}\r\nContent-Type: ${type}; name*=UTF-8''${filename}\r\nContent-Disposition: attachment; filename*=UTF-8''${filename}\r\nContent-Transfer-Encoding: base64\r\n\r\n${encoded}\r\n`;
  }).join('');
  return Buffer.from(`${headers}MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${bodyPart}${attachments}--${boundary}--\r\n`).toString('base64url');
};

// ---- Xử lý công việc: đọc thư -> lưu nội dung đã nhập -> gửi ----
const log = (t, m) => t.log.push({ at: new Date().toISOString(), m });
async function run(e, t) {
  try {
    const reply = String(t.reply || t.draft || '').trim();
    if (!reply) throw new Error('Thiếu nội dung thư trả lời. Hãy mở lại công việc và nhập nội dung thư.');
    t.error = null; const tk = await token(e);
    const m = norm(await g(tk, 'messages/' + t.mid + '?format=full'));
    t.step = 1; t.pct = 25; log(t, `Đã đọc thư của ${m.from}${m.att.length ? `, có ${m.att.length} tệp đính kèm` : ''}`);
    t.draft = reply;
    t.step = 2; t.pct = 50; log(t, 'Đã dùng nội dung thư do bạn nhập');
    const d = await g(tk, 'drafts', { method: 'POST', body: JSON.stringify({ message: { threadId: m.threadId, raw: raw(t.to, 'Re: ' + m.sub.replace(/^re:\s*/i, ''), reply, t.files || []) } }) });
    t.files = (t.files || []).map(({ name, type }) => ({ name, type }));
    t.draftId = d.id; t.step = 3; t.pct = 75; log(t, `Đã tạo bản nháp gửi đến ${t.to}`);
  } catch (x) { t.error = x.message; log(t, 'Lỗi: ' + x.message); }
}
async function send(e, t) {
  try { const tk = await token(e); await g(tk, 'drafts/send', { method: 'POST', body: JSON.stringify({ id: t.draftId }) }); t.step = 4; t.pct = 100; t.error = null; log(t, 'Đã gửi thư đến ' + t.to); }
  catch (x) { t.error = x.message; log(t, 'Lỗi: ' + x.message); }
}

async function draftFiles(e, id) {
  const tk = await token(e), draft = await g(tk, 'drafts/' + id + '?format=full'), files = [];
  async function visit(part) {
    if (part.filename && part.body) {
      let data = part.body.data;
      if (part.body.attachmentId) {
        const attachment = await g(tk, `messages/${draft.message.id}/attachments/${part.body.attachmentId}`);
        data = attachment.data;
      }
      if (data) files.push({ name: part.filename, type: part.mimeType || 'application/octet-stream', data: Buffer.from(data, 'base64url').toString('base64') });
    }
    for (const child of part.parts || []) await visit(child);
  }
  await visit(draft.message.payload);
  return files;
}

module.exports = { rd, base, enc, dec, cookie, user, h, get, set, token, g, norm, mail, run, send, draftFiles, log };
