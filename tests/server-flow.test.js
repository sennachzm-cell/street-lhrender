'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {Readable}=require('node:stream');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function fixture(environment={}){
 const shops=new Map(),users=new Map(),sessions=new Map(),records=new Map(),operations=[],audits=[];
 const row=(sql,args)=>{
  if(sql.startsWith('SELECT * FROM users WHERE email='))return [...users.values()].find(x=>x.email===args[0]);
  if(sql.startsWith('SELECT s.shop_id')){
   const ss=sessions.get(args[0]);if(!ss)return;const u=users.get(ss.user_id),shop=shops.get(ss.shop_id);
   return u&&shop?{...ss,...u,user_id:u.id,shop_id:shop.id,shop_name:shop.name}:undefined;
  }
  if(sql.startsWith('SELECT name FROM shops'))return shops.get(args[0]);
  if(sql.startsWith('SELECT * FROM records WHERE'))return records.get(`${args[0]}:${args[1]}:${args[2]}`);
  if(sql.startsWith('SELECT seq,version FROM operations'))return operations.find(x=>x.shop_id===args[0]&&x.op_id===args[1]);
  return undefined;
 };
 const many=(sql,args)=>{
  if(sql.startsWith('SELECT data_json FROM records'))return [...records.values()].filter(x=>x.shop_id===args[0]&&x.entity_type===args[1]&&!x.deleted).map(x=>({data_json:x.data_json}));
  if(sql.startsWith('SELECT * FROM operations WHERE shop_id'))return operations.filter(x=>x.shop_id===args[0]&&Number(x.seq)>args[1]);
  return [];
 };
 const run=(sql,args)=>{
  if(sql.startsWith('INSERT INTO shops(')){const [id,name,created_at]=args;shops.set(id,{id,name,created_at});}
  else if(sql.startsWith('INSERT INTO users(')){const [id,shop_id,email,name,password_hash,password_salt,created_at]=args;users.set(id,{id,shop_id,email,name,password_hash,password_salt,created_at,role:'owner',permissions:'{}',active:1});}
  else if(sql.startsWith('INSERT INTO sessions(')){const [token_hash,shop_id,user_id,expires_at]=args;sessions.set(token_hash,{token_hash,shop_id,user_id,expires_at});}
  else if(sql.startsWith('INSERT INTO records(')){const [shop_id,entity_type,entity_id,data_json,version,deleted,updated_at]=args;records.set(`${shop_id}:${entity_type}:${entity_id}`,{shop_id,entity_type,entity_id,data_json,version,deleted,updated_at});}
  else if(sql.startsWith('INSERT INTO operations(')){const [shop_id,op_id,entity_type,entity_id,action,data_json,version,device_id,created_at]=args;operations.push({shop_id,op_id,entity_type,entity_id,action,data_json,version,device_id,created_at,seq:operations.length+1});}
  else if(sql.startsWith('INSERT INTO audit_log('))audits.push(args);
  return {changes:1};
 };
 const db={
  prepare(sql){return {get:async(...args)=>row(sql,args),all:async(...args)=>many(sql,args),run:async(...args)=>run(sql,args)};},
  async begin(){},async commit(){},async rollback(){},async health(){},async close(){},async initialize(){},
  withRequest(fn){return fn();}
 };
 const obj={exports:{}};
 const req=name=>name==='./db/postgres.js'?db:name.startsWith('./')?require(path.join(root,name)):require(name);
 const code=fs.readFileSync(path.join(root,'server.js'),'utf8');
 vm.runInNewContext(code,{module:obj,exports:obj.exports,require:req,__dirname:root,process:{...process,env:{...process.env,NODE_ENV:'test',...environment}},Buffer,URL,console,setTimeout,clearTimeout},{filename:'server.js'});
 async function request(method,url,payload,token){
  const str=payload?JSON.stringify(payload):'';
  const readable=Readable.from(str?[Buffer.from(str)]:[]);
  readable.method=method;readable.url=url;readable.socket={remoteAddress:'127.0.0.1'};
  readable.headers=token?{authorization:'Bearer '+token,host:'127.0.0.1:8787'}:{host:'127.0.0.1:8787'};
  if(environment.NODE_ENV==='production')readable.headers['x-forwarded-proto']='https';
  let status=200,result='';
  const res={writeHead(s){status=s;},end(s){result=s||'';}};
  await obj.exports.handleRequest(readable,res);
  return {status,data:JSON.parse(result||'{}')};
 }
 return {request,shops,users,operations,audits};
}
test('registro, login, sincronização real de produto e idempotência via rotas originais',async()=>{
 const f=fixture();
 const account=await f.request('POST','/api/auth/register',{email:'loja@example.com',password:'senha_segura_1234',shopName:'LH STREET'});
 assert.equal(account.status,201);
 assert.equal(f.shops.size,1);
 const login=await f.request('POST','/api/auth/login',{email:'loja@example.com',password:'senha_segura_1234'});
 assert.equal(login.status,200);
 const token=login.data.token;
 const op={opId:crypto.randomUUID(),entityType:'product',entityId:'produto-1',action:'upsert',deviceId:'teste',baseVersion:0,data:{id:'produto-1',name:'Camiseta LH',stock:5,price:99.9,cost:30}};
 const push=await f.request('POST','/api/sync/push',{operations:[op]},token);
 assert.equal(push.status,200);assert.equal(push.data.results[0].status,'accepted');
 const repeated=await f.request('POST','/api/sync/push',{operations:[op]},token);
 assert.equal(repeated.data.results[0].status,'duplicate');
 const pull=await f.request('GET','/api/sync/pull?since=0',null,token);
 assert.equal(pull.data.operations[0].data.name,'Camiseta LH');
 assert.equal(f.operations.length,1);
 assert.equal(f.audits.length,1);
 const sale={opId:crypto.randomUUID(),entityType:'sale',entityId:'venda-1',action:'upsert',deviceId:'celular',baseVersion:0,
  data:{id:'venda-1',date:'2026-11-18',items:[{productId:'produto-1',quantity:3,price:99.9}],total:299.7,discount:0,payment:'Pix'}};
 const sold=await f.request('POST','/api/sync/push',{operations:[sale]},token);
 assert.equal(sold.data.results[0].status,'accepted');
 const saleTooMuch={...sale,opId:crypto.randomUUID(),entityId:'venda-2',data:{...sale.data,id:'venda-2'}};
 const outOfStock=await f.request('POST','/api/sync/push',{operations:[saleTooMuch]},token);
 assert.equal(outOfStock.data.results[0].status,'insufficient_stock');
 assert.equal(f.operations.length,2);
 assert.equal(f.audits.length,2);
});

// Public registration is disabled by default in production; UI reads the same feature gate.
test('produção mantém cadastro público fechado sem ALLOW_REGISTRATION=true',async()=>{
 const f=fixture({NODE_ENV:'production',ALLOW_REGISTRATION:''});
 const config=await f.request('GET','/api/config');
 assert.equal(config.status,200);assert.equal(config.data.registrationEnabled,false);
 const denied=await f.request('POST','/api/auth/register',{email:'nova@example.com',password:'senha_segura_123',shopName:'Loja'});
 assert.equal(denied.status,403);assert.equal(f.shops.size,0);
 const enabled=fixture({NODE_ENV:'production',ALLOW_REGISTRATION:'true'});
 assert.equal((await enabled.request('GET','/api/config')).data.registrationEnabled,true);
});

test('fundo de troco, fechamento e rejeição de caixa não aberto',async()=>{
 const f=fixture();
 const created=await f.request('POST','/api/auth/register',{email:'caixa@example.com',password:'senha_segura_1234',shopName:'Loja'});
 const token=created.data.token;
 const date='2026-11-19';
 const closing={opId:crypto.randomUUID(),entityType:'cashclose',entityId:date,action:'upsert',baseVersion:0,deviceId:'pc',data:{id:date,date,counted:200,notes:''}};
 const denied=await f.request('POST','/api/sync/push',{operations:[closing]},token);
 assert.equal(denied.data.results[0].status,'opening_required');
 const opening={opId:crypto.randomUUID(),entityType:'cashopen',entityId:date,action:'upsert',baseVersion:0,deviceId:'pc',data:{id:date,date,amount:200,notes:'Fundo de troco'}};
 const accepted=await f.request('POST','/api/sync/push',{operations:[opening]},token);
 assert.equal(accepted.data.results[0].status,'accepted');
 const closed=await f.request('POST','/api/sync/push',{operations:[closing]},token);
 assert.equal(closed.data.results[0].status,'accepted');
 assert.equal(f.operations.length,2);
});
