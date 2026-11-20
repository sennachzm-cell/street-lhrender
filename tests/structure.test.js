'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(base,n),'utf8');
test('preserva páginas e rotas principais da versão JavaScript',()=>{
 const frontend=read('public/app.js');
 const server=read('server.js');
 for(const feature of ['products','sales','customers','expenses','reports','staff','register'])assert.match(frontend,new RegExp(feature));
 for(const api of ['/api/auth/login','/api/sync/pull','/api/sync/push','/api/staff','/api/export','/api/import'])assert.ok(server.includes(api),api);
});
test('não usa diálogos nativos e toast só confirma persistência',()=>{
 const frontend=read('public/app.js');
 assert.doesNotMatch(frontend,/(?:\bwindow\.)?\b(?:alert|confirm|prompt)\s*\(/);
 assert.match(frontend,/await syncNow\(true\);\s*const stillQueued=/);
 assert.match(frontend,/Alteração pendente/);
});
test('configuração do Render e frontend LH Street presentes',()=>{
 const config=read('render.yaml');
 assert.match(config,/healthCheckPath: \/api\/health/);
 assert.match(config,/property: connectionString/);
 assert.match(config,/plan: 0\.1c-256mb/);
 assert.match(read('public/index.html'),/lh-street-identity.css/);
 for(const name of ['lh-street-logo.webp','lh-street-mark.webp','lh-street-texture.webp'])assert.ok(fs.existsSync(path.join(base,'public',name)));
 assert.match(config,/region: virginia/g);
 assert.match(read('public/lh-street-identity.css'),/--lh-electric/);
});
test('UI e gateway local preservam marca sem interface fictícia ou assets remotos',()=>{
 const html=read('public/index.html');
 assert.match(html,/street-identity-hero/);
 assert.doesNotMatch(html,/workspace-preview-graph/);
 assert.match(read('windows/local-gateway.js'),/Local frontend assets are authoritative/);
 assert.doesNotMatch(read('windows/local-gateway.js'),/LOCAL_ASSETS/);
 assert.match(read('public/app.js'),/lastModalFocus/);
 assert.match(read('server.js'),/Content-Security-Policy/);
});
test('migrations não apagam tabelas nem bancos',()=>{
 const sql=read('db/migrations/001_initial.sql');
 for(const name of ['users','shops','records','operations','audit_log'])assert.match(sql,new RegExp(`CREATE TABLE IF NOT EXISTS ${name}`));
 assert.doesNotMatch(sql,/\b(DROP|TRUNCATE)\b/i);
});
test('adaptador PG parametriza consultas e mantém transação por requisição',async()=>{
 const events=[];
 class FakeClient{
  async query(sql,params){events.push({sql,params});return {rows:[{id:'r1'}],rowCount:1};}
  release(){events.push({sql:'RELEASE'});}
 }
 class FakePool{
  on(){}
  connect(){return Promise.resolve(new FakeClient());}
  async query(sql,params){events.push({sql,params});return {rows:[{id:'r1'}],rowCount:1};}
  end(){return Promise.resolve();}
 }
 const content=read('db/postgres.js');
 const moduleObj={exports:{}};
 const req=n=>n==='pg'?{Pool:FakePool}:require(n);
 const context={module:moduleObj,exports:moduleObj.exports,require:req,__dirname:path.join(base,'db'),process:{...process,env:{...process.env,DATABASE_URL:'postgres://test'}},console};
 vm.runInNewContext(content,context,{filename:'postgres.js'});
 const d=moduleObj.exports;
 const row=await d.prepare('SELECT * FROM records WHERE shop_id=? AND entity_id=?').get('loja','abc');
 assert.equal(row.id,'r1');
 assert.ok(events.some(e=>e.sql.includes('shop_id=$1 AND entity_id=$2')&&e.params[0]==='loja'));
 await d.withRequest(async()=>{
  await d.begin('loja');
  await d.prepare('UPDATE records SET version=? WHERE entity_id=?').run(3,'abc');
  await d.commit();
 });
 assert.ok(events.some(e=>e.sql.includes('pg_advisory_xact_lock')));
 assert.ok(events.some(e=>e.sql==='COMMIT'));
 assert.ok(events.some(e=>e.sql==='RELEASE'));
});
