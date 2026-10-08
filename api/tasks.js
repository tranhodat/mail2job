const U = require('../lib/util');
const trim = a => a.slice(0, 300).map((t, i) => i > 40 ? { ...t, draft: undefined } : t);
const parseRecipients = value => {
  const addresses = String(value || '').split(/[;,]/).map(address => address.trim()).filter(Boolean);
  if (!addresses.length || addresses.some(address => !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(address))) return { error: 'Nhập địa chỉ email hợp lệ, nhiều địa chỉ ngăn cách bằng dấu phẩy' };
  const unique = [...new Map(addresses.map(address => [address.toLowerCase(), address])).values()];
  if (unique.length > 50) return { error: 'Tối đa 50 địa chỉ email cho mỗi thư' };
  return { value: unique.join(', ') };
};
const parseFiles = files => {
  if (!Array.isArray(files)) return { error: 'Danh sách tệp không hợp lệ', status: 400 };
  if (files.length > 5) return { error: 'Tối đa 5 tệp đính kèm', status: 400 };
  let totalBytes = 0;
  const clean = [];
  for (const file of files) {
    if (!file || typeof file !== 'object') return { error: 'Tệp đính kèm không hợp lệ', status: 400 };
    const data = String(file.data || '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return { error: 'Dữ liệu tệp đính kèm không hợp lệ', status: 400 };
    totalBytes += Buffer.from(data, 'base64').length;
    clean.push({
      name: String(file.name || 'tep-dinh-kem').split(/[\\/]/).pop().replace(/[\r\n\u0000-\u001f]/g, '').slice(0, 180) || 'tep-dinh-kem',
      type: String(file.type || 'application/octet-stream').replace(/[\r\n]/g, '').slice(0, 120),
      data
    });
  }
  if (totalBytes > 3 * 1024 * 1024) return { error: 'Tổng dung lượng tệp không được vượt quá 3 MB', status: 413 };
  return { files: clean, totalBytes };
};
const fileMeta = files => (files || []).map(({ name, type }, index) => ({ id: String(index), name, type }));
module.exports = U.h(async (req, res) => {
  const e = U.user(req); if (!e) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const { act, id } = req.query; let ts = (await U.get('t:' + e)) || [];
  if (req.method === 'GET') return res.json(ts.map(t => ({ ...t, files: fileMeta(t.files) })));
  if (!act) {
    const b = req.body || {}, m = await U.mail(e, b.mid);
    const recipients = parseRecipients(b.to || 'datth@vlute.edu.vn');
    if (recipients.error) return res.status(400).json({ error: recipients.error });
    const reply = String(b.reply || '').trim();
    if (!reply) return res.status(400).json({ error: 'Vui lòng nhập nội dung thư trả lời' });
    const parsed = parseFiles(b.files || []);
    if (parsed.error) return res.status(parsed.status).json({ error: parsed.error });
    const t = { id: Date.now().toString(36), mid: m.id, sub: m.sub, from: m.from, to: recipients.value, reply, att: m.att, files: parsed.files, runAt: b.runAt || new Date().toISOString(), step: 0, pct: 0, log: [] };
    U.log(t, b.runAt ? 'Đã lên lịch xử lý' : 'Bắt đầu xử lý ngay');
    ts.unshift(t); ts = trim(ts);
    if (new Date(t.runAt) <= new Date()) await U.run(e, t);
    await U.set('t:' + e, ts); return res.json({ ...t, files: fileMeta(t.files) });
  }
  const t = ts.find(x => x.id === id); if (!t) return res.status(404).json({ error: 'Không tìm thấy công việc' });
  if (act === 'edit') {
    if (t.completed || t.step === 4) return res.status(409).json({ error: 'Không thể sửa công việc đã hoàn thành hoặc đã gửi' });
    const b = req.body || {}, recipients = parseRecipients(b.to), reply = String(b.reply || '').trim();
    if (recipients.error) return res.status(400).json({ error: recipients.error });
    if (!reply) return res.status(400).json({ error: 'Vui lòng nhập nội dung thư' });
    const parsed = parseFiles(b.files || []);
    if (parsed.error) return res.status(parsed.status).json({ error: parsed.error });
    const oldFiles = t.draftId ? await U.draftFiles(e, t.draftId) : (t.files || []);
    const keep = new Set(Array.isArray(b.keepFiles) ? b.keepFiles.map(String) : oldFiles.map((_, index) => String(index)));
    const keptFiles = oldFiles.filter((_, index) => keep.has(String(index)));
    const files = [...keptFiles, ...parsed.files], totalBytes = files.reduce((total, file) => total + Buffer.from(file.data || '', 'base64').length, 0);
    if (files.length > 5) return res.status(400).json({ error: 'Tối đa 5 tệp đính kèm' });
    if (totalBytes > 3 * 1024 * 1024) return res.status(413).json({ error: 'Tổng dung lượng tệp không được vượt quá 3 MB' });
    const prepareDraft = Boolean(t.draftId) || t.step === 3 || new Date(t.runAt) <= new Date();
    if (t.draftId) await U.g(await U.token(e), 'drafts/' + t.draftId, { method: 'DELETE' });
    t.to = recipients.value; t.reply = reply; t.files = files;
    t.draft = undefined; t.draftId = undefined; t.step = 0; t.pct = 0; t.error = null;
    U.log(t, 'Đã cập nhật nội dung công việc');
    if (prepareDraft) await U.run(e, t);
  }
  if (act === 'run') await U.run(e, t);
  if (act === 'send' && !t.completed) {
    if (!t.draftId) await U.run(e, t);
    if (t.draftId && t.step === 3) await U.send(e, t);
  }
  if (act === 'complete' && !t.completed) {
    t.completed = true;
    t.completedAt = new Date().toISOString();
    U.log(t, 'Đã đánh dấu hoàn thành công việc');
  }
  if (act === 'delete') ts = ts.filter(x => x.id !== id);
  await U.set('t:' + e, trim(ts)); res.json({ ...t, files: fileMeta(t.files) });
});
