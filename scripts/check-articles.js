const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const store = new Map();
let saved = [], revision = 0, authenticated = true;
const utilPath = require.resolve('../lib/util');
require.cache[utilPath] = { id: utilPath, filename: utilPath, loaded: true, exports: {
  user: () => authenticated ? 'test@example.com' : null,
  h: fn => async (req,res) => { try { await fn(req,res); } catch(e) { res.status(500).json({error:e.message}); } },
  get: async key => store.get(key), set: async (key,value) => store.set(key,value), rd: async (cmd,key) => cmd === 'DEL' ? store.delete(key) : undefined
} };
Object.assign(process.env,{GITHUB_TOKEN:'test',GITHUB_OWNER:'owner',GITHUB_REPO:'repo'});
global.fetch = async (url,opts) => {
  const body = opts.body && JSON.parse(opts.body);
  if (opts.method === 'GET' && url.includes('articles/index.json')) return {ok:true,json:async()=>({sha:String(revision),content:Buffer.from(JSON.stringify(saved)).toString('base64')})};
  if (opts.method === 'PUT' && url.endsWith('articles/index.json')) {assert.equal(body.sha,String(revision));saved=JSON.parse(Buffer.from(body.content,'base64').toString());revision++;}
  return {ok:true,json:async()=>({sha:'file'})};
};
const handler=require('../api/articles');
async function call(act,body={},method='POST'){const res={code:200,status(c){this.code=c;return this},json(data){this.data=data;return this}};await handler({method,query:{act},body,headers:{}},res);return res}
(async()=>{
  authenticated=false;assert.equal((await call('save')).code,401);authenticated=true;
  const draft={title:'Nghiên cứu <script>',year:'2026',status:'Đang chuẩn bị',scopus:'Q1',wos:'SCIE',code:'print(1)',notes:'**Ghi chú**'};
  assert.equal((await call('save',{...draft,title:''})).code,400);
  assert.equal((await call('save',{...draft,year:'oops'})).code,400);
  const created=await call('save',draft);assert.equal(created.code,200);const id=created.data.id;
  const uploadId='11111111-1111-4111-8111-111111111111';
  const first=await call('upload',{id,uploadId,chunk:0,count:2,name:'proof.pdf',data:Buffer.from('hello').toString('base64')});assert.equal(first.data.pending,true);
  const last=await call('upload',{id,uploadId,chunk:1,count:2,name:'proof.pdf',data:Buffer.from('world').toString('base64')});assert.equal(last.data.items[0].files[0].size,10);
  const edited=await call('save',{...draft,id,keepFiles:[]});assert.equal(edited.data.items[0].files.length,0);assert.equal(edited.data.items[0].code,'print(1)');
  assert.equal((await call('import',{items:[draft,{...draft,year:'bad'}]})).code,400);assert.equal(saved.length,1);
  assert.equal((await call('import',{items:[draft]})).data.items.length,2);
  assert.equal((await call('delete',{id})).data.items.length,1);
  const elements=new Map();const $=s=>{if(!elements.has(s))elements.set(s,{innerHTML:'',textContent:'',value:'',focus(){},setSelectionRange(){},showModal(){}});return elements.get(s)};
  const context={$,document:{querySelectorAll:()=>[]},esc:t=>String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),chip:t=>String(t),ic:()=>'',formatBytes:n=>n+' B',console,crypto:require('node:crypto').webcrypto};vm.createContext(context);vm.runInContext(fs.readFileSync('public/articles.js','utf8'),context);vm.runInContext(`A.items=[${JSON.stringify({...draft,id,files:[]})}];articles();articleOpen(A.items[0]);for(let i=0;i<4;i++){A.tab=i;articleDialog();}`,context);assert(!$('#main').innerHTML.includes('<script>'));assert($('#article-dialog').innerHTML.includes('Liên kết tham khảo'));
  console.log('Passed: authentication, validation, create/edit/delete, atomic import validation, chunk upload, tab rendering, escaping.');
})().catch(e=>{console.error(e);process.exitCode=1});
