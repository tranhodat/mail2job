const crypto = require('crypto');
const U = require('../lib/util');
const CATEGORIES = ['Văn bản', 'Quyết định', 'Giấy tờ khác'];
const INDEX_PATH = 'documents/index.json';
const MAX_BYTES = 3 * 1024 * 1024;

function config() {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    throw new Error('Documents chưa được cấu hình. Hãy đặt GITHUB_TOKEN, GITHUB_OWNER và GITHUB_REPO trong .env.local hoặc Vercel Environment Variables.');
  }
  return { token: GITHUB_TOKEN, owner: GITHUB_OWNER, repo: GITHUB_REPO, branch: process.env.GITHUB_BRANCH || 'main' };
}

const pathPart = value => String(value).split('/').map(encodeURIComponent).join('/');
async function github(path, method = 'GET', body) {
  const c = config();
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.message || `GitHub API lỗi ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return result;
}

async function readIndex() {
  const c = config();
  try {
    const result = await github(`contents/${pathPart(INDEX_PATH)}?ref=${encodeURIComponent(c.branch)}`);
    return { sha: result.sha, items: JSON.parse(Buffer.from(result.content, 'base64').toString('utf8')) };
  } catch (error) {
    if (error.status === 404) return { sha: null, items: [] };
    throw error;
  }
}

async function commitTree(message, changes) {
  const c = config();
  const branchPath = c.branch.split('/').map(encodeURIComponent).join('/');
  const ref = await github(`git/ref/heads/${branchPath}`);
  const parent = await github(`git/commits/${ref.object.sha}`);
  const tree = await github('git/trees', 'POST', { base_tree: parent.tree.sha, tree: changes });
  const commit = await github('git/commits', 'POST', { message, tree: tree.sha, parents: [ref.object.sha] });
  await github(`git/refs/heads/${branchPath}`, 'PATCH', { sha: commit.sha, force: false });
}

function cleanFiles(files) {
  if (!Array.isArray(files)) return { error: 'Danh sách tệp không hợp lệ', status: 400 };
  if (files.length > 10) return { error: 'Tối đa 10 tệp cho mỗi hồ sơ', status: 400 };
  let total = 0;
  const clean = [];
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || typeof file.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) {
      return { error: 'Tệp tải lên không hợp lệ', status: 400 };
    }
    const bytes = Buffer.from(file.data, 'base64');
    total += bytes.length;
    clean.push({ name: file.name.split(/[\\/]/).pop().replace(/[\r\n\u0000-\u001f]/g, '').slice(0, 180) || 'tep-dinh-kem', type: String(file.type || 'application/octet-stream').replace(/[\r\n]/g, '').slice(0, 120), data: file.data, bytes });
  }
  if (total > MAX_BYTES) return { error: 'Tổng dung lượng tệp mỗi hồ sơ tối đa 3 MB do giới hạn tải lên của ứng dụng', status: 413 };
  return { files: clean };
}

module.exports = U.h(async (req, res) => {
  if (!U.user(req)) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const c = config(), action = req.query.act;
  if (req.method === 'GET') {
    const index = await readIndex();
    if (action === 'file') {
      const file = index.items.flatMap(item => item.files || []).find(item => item.id === req.query.id);
      if (!file) return res.status(404).json({ error: 'Không tìm thấy tệp' });
      const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${pathPart(file.path)}?ref=${encodeURIComponent(c.branch)}`, {
        headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' }
      });
      if (!response.ok) return res.status(response.status).json({ error: 'Không tải được tệp từ GitHub' });
      const name = encodeURIComponent(file.name).replace(/'/g, '%27');
      res.setHeader('Content-Type', file.type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`);
      return res.send(Buffer.from(await response.arrayBuffer()));
    }
    return res.json({ items: index.items });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Phương thức không được hỗ trợ' });
  const index = await readIndex(), body = req.body || [];
  if (action === 'delete') {
    const item = index.items.find(entry => entry.id === body.id);
    if (!item) return res.status(404).json({ error: 'Không tìm thấy hồ sơ' });
    const items = index.items.filter(entry => entry.id !== item.id);
    const blob = await github('git/blobs', 'POST', { content: JSON.stringify(items, null, 2), encoding: 'utf-8' });
    const changes = (item.files || []).map(file => ({ path: file.path, mode: '100644', type: 'blob', sha: null }));
    changes.push({ path: INDEX_PATH, mode: '100644', type: 'blob', sha: blob.sha });
    await commitTree(`Delete document profile ${item.title}`, changes);
    return res.json({ items });
  }

  if (action !== 'save') return res.status(400).json({ error: 'Thao tác không hợp lệ' });
  const title = String(body.title || '').trim().slice(0, 160), number = String(body.number || '').trim().slice(0, 100), category = String(body.category || '');
  if (!title) return res.status(400).json({ error: 'Vui lòng nhập tên hồ sơ' });
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Loại hồ sơ không hợp lệ' });
  const old = index.items.find(item => item.id === body.id);
  if (body.id && !old) return res.status(404).json({ error: 'Không tìm thấy hồ sơ cần sửa' });
  const uploaded = cleanFiles(body.files || []);
  if (uploaded.error) return res.status(uploaded.status).json({ error: uploaded.error });
  const keep = new Set(Array.isArray(body.keepFiles) ? body.keepFiles.map(String) : (old?.files || []).map(file => file.id));
  const kept = (old?.files || []).filter(file => keep.has(file.id));
  if (!kept.length && !uploaded.files.length) return res.status(400).json({ error: 'Hãy đính kèm ít nhất một tệp' });
  const totalBytes = kept.reduce((sum, file) => sum + file.size, 0) + uploaded.files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (totalBytes > MAX_BYTES) return res.status(413).json({ error: 'Tổng dung lượng tệp mỗi hồ sơ tối đa 3 MB do giới hạn tải lên của ứng dụng' });

  const id = old?.id || crypto.randomUUID(), changes = [], added = [];
  for (const file of uploaded.files) {
    const fileId = crypto.randomUUID(), path = `documents/files/${id}/${fileId}-${file.name}`;
    const blob = await github('git/blobs', 'POST', { content: file.data, encoding: 'base64' });
    changes.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    added.push({ id: fileId, name: file.name, type: file.type, size: file.bytes.length, path, sha: blob.sha });
  }
  const removed = (old?.files || []).filter(file => !keep.has(file.id));
  changes.push(...removed.map(file => ({ path: file.path, mode: '100644', type: 'blob', sha: null })));
  const item = { id, title, number, category, createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), files: [...kept, ...added] };
  const items = old ? index.items.map(entry => entry.id === id ? item : entry) : [item, ...index.items];
  const indexBlob = await github('git/blobs', 'POST', { content: JSON.stringify(items, null, 2), encoding: 'utf-8' });
  changes.push({ path: INDEX_PATH, mode: '100644', type: 'blob', sha: indexBlob.sha });
  await commitTree(`${old ? 'Update' : 'Add'} document profile ${title}`, changes);
  return res.json({ items });
});