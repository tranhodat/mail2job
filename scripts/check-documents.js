const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { Writable } = require('node:stream');
const MB = 1024 * 1024, redis = new Map(), blobs = new Map(), trees = new Map(), commits = new Map();
let current = 'initial', authenticated = true, lostUploadResponse = false;
trees.set('initial-tree', {}); commits.set(current, { tree: { sha: 'initial-tree' } });
const clone = value => JSON.parse(JSON.stringify(value));
const utilPath = require.resolve('../lib/util');
require.cache[utilPath] = { id: utilPath, filename: utilPath, loaded: true, exports: {
  user: () => authenticated ? 'test@example.com' : null,
  h: fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } },
  get: async key => redis.has(key) ? clone(redis.get(key)) : null,
  set: async (key, value) => redis.set(key, clone(value)),
  rd: async (cmd, key) => cmd === 'DEL' ? redis.delete(key) : undefined
} };
Object.assign(process.env, { GITHUB_TOKEN: 'test', GITHUB_OWNER: 'owner', GITHUB_REPO: 'repo' });
const result = (status, data) => ({ status, ok: status < 400, json: async () => clone(data) });
global.fetch = async (url, options = {}) => {
  const path = url.split('/repos/owner/repo/')[1], b = options.body && JSON.parse(options.body);
  if (path.startsWith('contents/')) {
    const filePath = decodeURIComponent(path.slice(9).split('?')[0]), tree = trees.get(commits.get(current).tree.sha), sha = tree[filePath];
    if (!sha) return result(404, { message: 'Not Found' });
    const bytes = blobs.get(sha);
    if (options.headers.Accept === 'application/vnd.github.raw') return { ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }) };
    return result(200, { sha, content: bytes.toString('base64') });
  }
  if (path === 'git/blobs') {
    const bytes = Buffer.from(b.content, b.encoding === 'base64' ? 'base64' : 'utf8');
    const sha = crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
    blobs.set(sha, bytes); return result(201, { sha });
  }
  if (path.startsWith('git/ref/heads/')) return result(200, { object: { sha: current } });
  if (path.startsWith('git/commits/')) return result(200, commits.get(path.slice('git/commits/'.length)));
  if (path === 'git/trees') {
    const tree = { ...trees.get(b.base_tree) };
    for (const change of b.tree) { if (change.sha === null) delete tree[change.path]; else tree[change.path] = change.sha; }
    const sha = crypto.randomUUID(); trees.set(sha, tree); return result(201, { sha });
  }
  if (path === 'git/commits') { const sha = crypto.randomUUID(); commits.set(sha, { tree: { sha: b.tree }, parents: b.parents }); return result(201, { sha }); }
  if (path.startsWith('git/refs/heads/')) { assert.equal(commits.get(b.sha).parents[0], current); current = b.sha; return result(200, {}); }
  throw Error('Unexpected GitHub path: ' + path);
};
const handlers = { documents: require('../api/documents'), 'phd-doc': require('../api/phd-doc') };
async function request(space, act, body = {}, method = 'POST', query = {}) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
  await handlers[space]({ method, query: { act, ...query }, body, headers: {} }, res);
  return res;
}
async function upload(space, size, name) {
  const id = crypto.randomUUID(), count = Math.max(1, Math.ceil(size / MB)); let last;
  for (let chunk = 0; chunk < count; chunk++) {
    last = await request(space, 'upload', { uploadId: id, chunk, count, size, name, type: 'application/pdf', data: Buffer.alloc(Math.min(MB, size - chunk * MB), 7).toString('base64') });
    assert.equal(last.statusCode, 200);
  }
  assert.equal(last.data.file.size, size); return id;
}
(async () => {
  authenticated = false; assert.equal((await request('phd-doc', 'save')).statusCode, 401); authenticated = true;
  const original = await request('documents', 'save', { title: 'Documents cũ', category: 'Văn bản', files: [{ name: 'old.pdf', data: Buffer.from('old').toString('base64') }] });
  assert.equal(original.statusCode, 200);
  const originalId = original.data.id;
  const longName='Nghiên cứu '.repeat(14)+'.pdf';
  const largeId = await upload('phd-doc', 50 * MB, longName);
  const profileId = crypto.randomUUID();
  const saved = await request('phd-doc', 'save', { createId: profileId, title: 'PhD 50 MB', category: 'Quyết định', uploadIds: [largeId] });
  assert.equal(saved.statusCode, 200); assert.equal(saved.data.items[0].files[0].size, 50 * MB);
  assert(saved.data.items[0].files[0].path.startsWith('phd-doc/files/'));
  assert.equal(saved.data.items[0].files[0].name,longName);assert((process.cwd()+'/'+saved.data.items[0].files[0].path).length<260);assert(saved.data.items[0].files[0].path.endsWith('.pdf'));
  assert.equal((await request('documents', undefined, {}, 'GET')).data.items[0].id, originalId);
  assert.equal((await request('documents', 'save', { title: 'Cross store', category: 'Văn bản', uploadIds: [largeId] })).statusCode, 400);
  const tooLarge = await request('documents', 'upload', { uploadId: crypto.randomUUID(), chunk: 0, count: 51, size: 50 * MB + 1, data: '' });
  assert.equal(tooLarge.statusCode, 400);
  const smallId = await upload('phd-doc', 1, 'one-byte.pdf');
  assert.equal((await request('phd-doc', 'save', { id: profileId, title: 'Over total', category: 'Quyết định', uploadIds: [smallId] })).statusCode, 413);
  const repeated = await request('phd-doc', 'save', { createId: profileId, title: 'PhD 50 MB', category: 'Quyết định', uploadIds: [largeId] });
  assert.equal(repeated.data.items.length, 1); assert.equal(repeated.data.items[0].files.length, 1);
  // Large downloads use streaming rather than a serverless response buffer.
  let downloaded = 0;
  const stream = new Writable({ write(chunk, encoding, callback) { downloaded += chunk.length; callback(); } });
  stream.setHeader = () => {}; stream.status = () => stream; stream.json = data => { throw Error(JSON.stringify(data)); };
  await handlers['phd-doc']({ method: 'GET', query: { act: 'file', id: largeId, download: '1' }, headers: {} }, stream);
  assert.equal(downloaded, 50 * MB);

  const nodes = new Map(), notices = [];
  const $ = selector => { if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', value: '', classList: { add() {}, remove() {} }, querySelectorAll: () => [], showModal() {}, close() {}, focus() {} }); return nodes.get(selector); };
  class FileReader { readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = 'data:application/octet-stream;base64,' + Buffer.from(bytes).toString('base64'); this.onload(); }, () => this.onerror()); } }
  const context = { $, S: { documents: { items: [] }, documentStores: {}, docSpace: 'phd-doc', v: 'phd-doc', docCategory: 'Văn bản', docSearch: '' },
    crypto: crypto.webcrypto, FileReader, AbortController, Map, console, Blob, esc: String, ic: () => '', formatBytes: String, toast: m => notices.push(m), document: { querySelectorAll: () => [] },
    setTimeout: (fn, ms) => { if (ms < 55000) queueMicrotask(fn); return 1; }, clearTimeout() {},
    api: async (url, options = {}) => { const parsed = new URL(url, 'https://test'); const r = await request(parsed.pathname.slice(5), parsed.searchParams.get('act'), options.body, options.body ? 'POST' : 'GET'); if (r.statusCode >= 400) throw Error(r.data.error); return r.data; },
    fetch: async (url, options) => { const parsed = new URL(url, 'https://test'); const r = await request(parsed.pathname.slice(5), 'upload', JSON.parse(options.body)); if (lostUploadResponse && r.data.file) { lostUploadResponse = false; throw TypeError('Response lost'); } return result(r.statusCode, r.data); }
  };
  vm.createContext(context);
  const html = fs.readFileSync('public/index.html', 'utf8');
  vm.runInContext(html.slice(html.indexOf('const documentEndpoint='), html.indexOf('function stats()')), context);
  vm.runInContext('openDocumentDialog()', context);
  assert($('#doc-dialog').innerHTML.includes('50 MB'));
  context.files = [Object.assign(new Blob([Buffer.alloc(4 * MB + 10)]), { name: 'new.pdf' })];
  $('#doc-upload').onchange({ target: { files: context.files } });
  vm.runInContext("S.docTitle='Tài liệu PhD';S.docCategoryDraft='Văn bản'", context);
  lostUploadResponse = true;
  await vm.runInContext('saveDocumentDialog()', context);
  assert.equal(vm.runInContext('S.docBusy', context), false);
  assert(notices.includes('Đã lưu hồ sơ vào GitHub'));
  assert($('#main').innerHTML.includes('PhD-Doc'));
  assert($('#main').innerHTML.includes('/api/phd-doc?act=file'));
  assert.equal((await request('documents', undefined, {}, 'GET')).data.items.length, 1);
  assert.equal((await request('phd-doc', undefined, {}, 'GET')).data.items.length, 2);
  await request('phd-doc', 'delete', { id: profileId });
  assert.equal((await request('documents', undefined, {}, 'GET')).data.items[0].id, originalId);
  console.log('Passed: 50 MB upload/download, total limit, separate stores, existing Documents, profile retry, lost upload response, PhD UI and delete isolation.');
})().catch(e => { console.error(e); process.exitCode = 1; });
