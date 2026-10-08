const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const store = new Map(), files = new Map();
let items = [], revision = 0, conflictOnce = false, loseResponseOnce = false;
const clone = value => JSON.parse(JSON.stringify(value));
const utilPath = require.resolve('../lib/util');
require.cache[utilPath] = { id: utilPath, filename: utilPath, loaded: true, exports: {
  user: () => 'test@example.com',
  h: fn => async (req, res) => { try { await fn(req, res); } catch(e) { res.status(e.status || 500).json({ error: e.message }); } },
  get: async key => store.has(key) ? clone(store.get(key)) : null,
  set: async (key, value) => store.set(key, clone(value)),
  rd: async (cmd, key) => cmd === 'DEL' ? store.delete(key) : undefined
} };
Object.assign(process.env, { GITHUB_TOKEN: 'test', GITHUB_OWNER: 'owner', GITHUB_REPO: 'repo' });
const response = (status, data) => ({ ok: status < 400, status, json: async () => clone(data) });
global.fetch = async (url, options = {}) => {
  const body = options.body && JSON.parse(options.body);
  if (url.includes('articles/index.json')) {
    if (!body) return response(200, { sha: String(revision), content: Buffer.from(JSON.stringify(items)).toString('base64') });
    if (conflictOnce) {
      conflictOnce = false;
      items[0].files.push({ id: 'concurrent', name: 'concurrent.pdf', size: 1 });
      revision++;
      return response(409, { message: 'Index changed concurrently' });
    }
    if (body.sha !== String(revision)) return response(409, { message: 'SHA conflict' });
    items = JSON.parse(Buffer.from(body.content, 'base64').toString()); revision++;
    return response(200, {});
  }
  const path = url.split('/contents/')[1]?.split('?')[0];
  if (body) {
    if (files.has(path)) return response(422, { message: 'File already exists' });
    const bytes = Buffer.from(body.content, 'base64');
    const sha = crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
    files.set(path, { sha, bytes }); return response(200, { sha });
  }
  if (files.has(path)) return response(200, { sha: files.get(path).sha, size: files.get(path).bytes.length });
  return response(404, {});
};
const handler = require('../api/articles');
async function request(act, body) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; } };
  await handler({ method: act ? 'POST' : 'GET', query: { act }, body, headers: {} }, res);
  return res;
}
(async () => {
  const draft = { title: 'Minh chứng', year: '2026', status: 'Đang chuẩn bị', scopus: 'Q1', wos: '-' };
  const created = await request('save', draft), id = created.data.id;
  const uploadId = crypto.randomUUID();
  const longName='EXPLAINABLE ARTIFICIAL INTELLIGENCE '.repeat(4)+'.pdf';
  const parts = ['first', 'second', 'third'];
  for (let chunk = 0; chunk < 2; chunk++) {
    const r = await request('upload', { id, uploadId, chunk, count: 3, name: longName, data: Buffer.from(parts[chunk]).toString('base64') });
    assert.equal(r.data.pending, true);
  }
  conflictOnce = true;
  const last = await request('upload', { id, uploadId, chunk: 2, count: 3, name: longName, data: Buffer.from(parts[2]).toString('base64') });
  assert.equal(last.statusCode, 200);
  const attachment=last.data.items[0].files.find(f=>f.id===uploadId);assert.equal(attachment.name,longName);assert((process.cwd()+'/'+attachment.path).length<260);assert(attachment.path.endsWith('.pdf'));
  assert.equal(last.data.items[0].files.filter(f => f.id === uploadId).length, 1);
  assert(last.data.items[0].files.some(f => f.id === 'concurrent'));
  assert.equal(store.size, 0);
  const replay = await request('upload', { id, uploadId, chunk: 2, count: 3, name: longName, data: Buffer.from(parts[2]).toString('base64') });
  assert(replay.data.items[0].files.some(f => f.id === uploadId));
  assert.equal(store.size, 0);
  assert.equal([...files.values()][0].bytes.toString(), parts.join(''));

  const nodes = new Map(), notices = [];
  const $ = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', querySelectorAll: () => [], close() { this.closed = true; } });
    return nodes.get(selector);
  };
  class FileReader {
    readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = 'data:application/octet-stream;base64,' + Buffer.from(bytes).toString('base64'); this.onload(); }, () => this.onerror()); }
  }
  const context = { $, console, crypto: crypto.webcrypto, FileReader, AbortController, Blob,
    document: { querySelectorAll: () => [] }, esc: String, chip: String, ic: () => '', formatBytes: String,
    toast: msg => notices.push(msg),
    setTimeout: (fn, ms) => { if (ms < 55000) queueMicrotask(fn); return 1; }, clearTimeout() {},
    api: async (url, options = {}) => {
      const act = new URL(url, 'https://test').searchParams.get('act');
      const res = await request(act, options.body);
      if (res.statusCode >= 400) throw Error(res.data.error);
      return res.data;
    },
    fetch: async (url, options) => {
      const res = await request('upload', JSON.parse(options.body));
      if (loseResponseOnce && res.data.items) { loseResponseOnce = false; throw new TypeError('Response lost after commit'); }
      return response(res.statusCode, res.data);
    }
  };
  vm.createContext(context); vm.runInContext(fs.readFileSync('public/articles.js', 'utf8'), context);
  vm.runInContext('articleDialog=()=>{};articles=()=>{}', context);
  context.draft = clone({ ...draft, id, files: items[0].files });
  vm.runInContext('A.draft=draft', context);
  const makeFile = (name, length) => Object.assign(new Blob([Buffer.alloc(length, 7)]), { name });
  context.selected = [makeFile('small.pdf', 50), makeFile('too-large.pdf', 21 * 1024 * 1024), makeFile('multi-part.zip', 3 * 1024 * 1024 + 10), makeFile('last.pdf', 80)];
  vm.runInContext("articleAddFiles(selected,'evidence')", context);
  assert.equal(vm.runInContext('A.uploads.length', context), 3);
  assert(notices.some(n => n.includes('too-large.pdf')));
  loseResponseOnce = true;
  await vm.runInContext('articleSave()', context);
  assert.equal(vm.runInContext('A.uploads.length', context), 0);
  assert.equal(vm.runInContext('A.busy', context), false);
  for (const name of ['small.pdf', 'multi-part.zip', 'last.pdf']) assert.equal(items[0].files.filter(f => f.name === name).length, 1);
  assert(!items[0].files.some(f => f.name === 'too-large.pdf'));
  assert($('#article-dialog').closed);

  // Expired temporary chunks force a complete replay before declaring success.
  context.selected=[makeFile('expired-parts.zip',2*1024*1024+10)];
  vm.runInContext("articleAddFiles(selected,'evidence')",context);
  let expired=false;
  context.fetch=async(url,options)=>{const body=JSON.parse(options.body);if(body.chunk===1&&!expired){store.clear();expired=true}const r=await request('upload',body);return response(r.statusCode,r.data)};
  await vm.runInContext('articleSave()',context);
  assert.equal(vm.runInContext('A.uploads.length',context),0);
  assert.equal(items[0].files.filter(f=>f.name==='expired-parts.zip').length,1);

  // A final pending response is not permission to discard the file or show success.
  context.selected = [makeFile('pending.pdf', 100)];
  vm.runInContext("articleAddFiles(selected,'evidence')", context);
  context.fetch = async () => response(200, { pending: true });
  await vm.runInContext('articleSave()', context);
  assert.equal(vm.runInContext('A.uploads.length', context), 1);
  assert.equal(vm.runInContext('A.uploads[0].next', context), 0);
  assert.equal(vm.runInContext('A.busy', context), false);
  assert($('#article-save-status').textContent.includes('1 tệp chưa tải'));
  console.log('Passed: mixed file sizes, multi-file/multi-chunk uploads, lost response retry, duplicate prevention, concurrent index merge, pending confirmation, retained retry queue.');
})().catch(error => { console.error(error); process.exitCode = 1; });
