 'use strict';
// STREET ADMIN 1.2 — versão original JavaScript adaptada a PostgreSQL.
// Exige Node.js 22+ e DATABASE_URL; no Render acessível SOMENTE via HTTPS.
const http=require('node:http'),https=require('node:https'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const database=require('./db/postgres.js');
const Pix=require('./public/pix.js');
const WINDOWS_DATA=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'STREET-ADMIN-PORTABLE','data');
const PORT=Number(process.env.PORT||8787), DATA=path.resolve(process.env.STREET_ADMIN_DATA_DIR||(process.platform==='win32'?WINDOWS_DATA:path.join(__dirname,'data')));

// Controles exclusivos do Windows, disponíveis somente no navegador LOCAL do PC
// e para o administrador autenticado. A VPN nunca pode acioná-los.
const WINDOWS_AUTOSTART_MARK='STREET ADMIN AUTOSTART V2';
const WINDOWS_AUTOSTART_NAME='StreetAdmin-AutoStart.vbs';
function windowsLocalRequest(req){
 const addr=req.socket.remoteAddress||'';
 const origin=req.headers.origin;
 return process.platform==='win32' && (addr==='127.0.0.1'||addr==='::1'||addr==='::ffff:127.0.0.1') &&
  !req.headers['x-forwarded-proto'] && !req.headers['x-street-admin-remote'] &&
  (!origin||origin==='http://127.0.0.1:'+PORT) &&
  String(req.headers.host||'')==='127.0.0.1:'+PORT;
}
function windowsStartupPath(){
 if(!process.env.APPDATA)throw Error('Pasta APPDATA não encontrada.');
 return path.join(process.env.APPDATA,'Microsoft','Windows','Start Menu','Programs','Startup',WINDOWS_AUTOSTART_NAME);
}
function windowsLauncherPath(){return path.resolve(__dirname,'..','..','Windows','INICIAR-STREET-ADMIN-NETBIRD.vbs');}
function windowsStartupInfo(){
 const file=windowsStartupPath();
 if(!fs.existsSync(file))return {enabled:false};
 const content=fs.readFileSync(file,'utf8');
 if(!content.includes(WINDOWS_AUTOSTART_MARK))throw Error('Arquivo de inicialização não pertence ao Street Admin.');
 const enabled=content.includes(windowsLauncherPath().replace(/"/g,'""'));
 return {enabled,otherLocation:!enabled};
}
function windowsSetStartup(enabled){
 const file=windowsStartupPath();
 if(!enabled){
  if(fs.existsSync(file)){
   if(!fs.readFileSync(file,'utf8').includes(WINDOWS_AUTOSTART_MARK))throw Error('Arquivo de inicialização não pertence ao Street Admin.');
   fs.unlinkSync(file);
  }
  return {enabled:false};
 }
 const launcher=windowsLauncherPath();
 if(!fs.existsSync(launcher))throw Error('Iniciador NetBird não localizado. Extraia o ZIP inteiro antes de ativar.');
 const literal=launcher.replace(/"/g,'""');
 const content=`' ${WINDOWS_AUTOSTART_MARK}\r\nOption Explicit\r\nDim sh,fs,launcher\r\nSet sh=CreateObject("WScript.Shell")\r\nSet fs=CreateObject("Scripting.FileSystemObject")\r\nlauncher="${literal}"\r\nIf fs.FileExists(launcher) Then sh.Run Chr(34) & sh.ExpandEnvironmentStrings("%SystemRoot%\\System32\\wscript.exe") & Chr(34) & " " & Chr(34) & launcher & Chr(34) & " --autostart",0,False\r\n`;
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,content,{encoding:'utf8',flag:'w'});
 return {enabled:true};
}
// Gateway e backend têm processos separados. Este arquivo com identificador aleatório
// permite encerrar somente a sessão correta, sem matar outros processos Node.
const WINDOWS_RUNTIME=path.join(DATA,'.street-admin-windows-runtime.json');
const WINDOWS_STOP=path.join(DATA,'.street-admin-windows-stop.json');
function windowsRequestStop(){
 if(!fs.existsSync(WINDOWS_RUNTIME))return false;
 const runtime=JSON.parse(fs.readFileSync(WINDOWS_RUNTIME,'utf8'));
 if(typeof runtime.session!=='string'||!/^[0-9a-f]{48}$/.test(runtime.session))return false;
 fs.writeFileSync(WINDOWS_STOP,JSON.stringify({session:runtime.session}),{mode:0o600});
 return true;
}

const q={
 user:database.prepare('SELECT * FROM users WHERE email=?'),
 session:database.prepare('SELECT s.shop_id,s.user_id,s.expires_at,u.name,u.email,u.role,u.permissions,u.active,sh.name AS shop_name FROM sessions s JOIN users u ON u.id=s.user_id JOIN shops sh ON sh.id=s.shop_id WHERE s.token_hash=? AND u.active=1'),
 find:database.prepare('SELECT * FROM records WHERE shop_id=? AND entity_type=? AND entity_id=?'),
 duplicate:database.prepare('SELECT seq,version FROM operations WHERE shop_id=? AND op_id=?'),
 put:database.prepare(`INSERT INTO records(shop_id,entity_type,entity_id,data_json,version,deleted,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(shop_id,entity_type,entity_id) DO UPDATE SET data_json=excluded.data_json,version=excluded.version,deleted=excluded.deleted,updated_at=excluded.updated_at`),
 log:database.prepare('INSERT INTO operations(shop_id,op_id,entity_type,entity_id,action,data_json,version,device_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)'),
 rows:database.prepare('SELECT data_json FROM records WHERE shop_id=? AND entity_type=? AND deleted=0'),
 pull:database.prepare('SELECT * FROM operations WHERE shop_id=? AND seq>? ORDER BY seq LIMIT 1000'),
 export:database.prepare('SELECT * FROM records WHERE shop_id=?'),
 auditInsert:database.prepare('INSERT INTO audit_log(shop_id,user_id,user_name,action,entity_type,entity_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)'),
 auditList:database.prepare('SELECT seq,user_name,action,entity_type,entity_id,before_json,after_json,created_at FROM audit_log WHERE shop_id=? AND seq<? ORDER BY seq DESC LIMIT ?'),
 staffList:database.prepare("SELECT id,name,email,role,permissions,active,created_at FROM users WHERE shop_id=? ORDER BY name"),
 staffGet:database.prepare("SELECT * FROM users WHERE shop_id=? AND id=?"),
};
const types=new Set(['product','customer','expense','sale','stockmove','cashopen','cashclose','financeplan','withdrawal','shopprofile','promotion']);
const uuid=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const PERMISSION_KEYS=['sales:create','sales:view','products:read','products:write','stock:read','stock:write','customers:read','customers:write','expenses:read','expenses:write','reports:read'];
const STAFF_DEFAULT=['sales:create','sales:view','products:read','stock:read','customers:read'];
function parsePermissions(text){try{const p=JSON.parse(text||'{}');return p&&typeof p==='object'?p:{}}catch{return {}}}
function safePermissions(value){const raw=Array.isArray(value)?Object.fromEntries(value.map(p=>[p,true])):(value&&typeof value==='object'?value:{});const out={};for(const k of PERMISSION_KEYS)out[k]=raw[k]===true; if(out['sales:create']){out['products:read']=true;out['stock:read']=true;}if(out['products:write'])out['products:read']=true;if(out['stock:write']){out['stock:read']=true;out['products:read']=true;}if(out['customers:write'])out['customers:read']=true;if(out['expenses:write'])out['expenses:read']=true;if(out['stock:read'])out['products:read']=true;if(out['reports:read']){out['sales:view']=true;out['expenses:read']=true;out['products:read']=true;out['stock:read']=true;}return out;}
function permitted(user,key){return user.role==='owner'||safePermissions(parsePermissions(user.permissions))[key]===true;}
function canWrite(user,type){if(['financeplan','withdrawal','shopprofile','promotion'].includes(type))return user.role==='owner';const key={sale:'sales:create',cashopen:'sales:create',cashclose:'sales:create',product:'products:write',stockmove:'stock:write',customer:'customers:write',expense:'expenses:write'}[type];return !!key&&permitted(user,key);}
function canRead(user,type){if(['cashopen','cashclose'].includes(type))return permitted(user,'sales:create')||permitted(user,'sales:view');if(type==='promotion')return permitted(user,'products:read')||permitted(user,'sales:create');if(type==='shopprofile')return permitted(user,'sales:view')||permitted(user,'sales:create');if(['financeplan','withdrawal'].includes(type))return user.role==='owner';const key={sale:'sales:view',cashopen:'sales:create',cashclose:'sales:create',product:'products:read',stockmove:'stock:read',customer:'customers:read',expense:'expenses:read'}[type];return !!key&&permitted(user,key);}
async function logAudit(user,action,type,id,before,after){(await q.auditInsert.run(user.shop_id,user.user_id,user.name,action,type,id,before===undefined?null:JSON.stringify(before),after===undefined?null:JSON.stringify(after),now()));}
function safeUser(user){return {userId:user.user_id,role:user.role,permissions:user.role==='owner'?Object.fromEntries(PERMISSION_KEYS.map(p=>[p,true])):safePermissions(parsePermissions(user.permissions))};}
function filteredOperation(user,record){
 const data=JSON.parse(record.data_json||'{}');
 if(canRead(user,record.entity_type))return {seq:record.seq,opId:record.op_id,entityType:record.entity_type,entityId:record.entity_id,action:record.action,data,version:record.version,deviceId:record.device_id,createdAt:record.created_at};
 // Dados mínimos para o cálculo do saldo em estoque, sem mostrar informações financeiras.
 if(record.entity_type==='sale'&&permitted(user,'products:read'))return {seq:record.seq,opId:record.op_id,entityType:'sale',entityId:record.entity_id,action:record.action,data:{id:record.entity_id,status:data.status==='cancelled'?'cancelled':'completed',items:(data.items||[]).map(i=>({productId:i.productId,quantity:i.quantity})),_inventoryOnly:true},version:record.version,deviceId:'',createdAt:record.created_at};
 if(record.entity_type==='stockmove'&&permitted(user,'products:read'))return {seq:record.seq,opId:record.op_id,entityType:'stockmove',entityId:record.entity_id,action:record.action,data:{id:record.entity_id,productId:data.productId,quantity:data.quantity,_inventoryOnly:true},version:record.version,deviceId:'',createdAt:record.created_at};
 return null;
}

const hash=t=>crypto.createHash('sha256').update(t).digest('hex');
function pwd(password,salt){return crypto.scryptSync(password,salt,64).toString('hex');}
async function rows(shop,type){return (await q.rows.all(shop,type)).map(x=>JSON.parse(x.data_json));}
async function inventory(shop,id){const r=(await q.find.get(shop,'product',id));if(!r||r.deleted)return null;const p=JSON.parse(r.data_json);return Number(p.stock||0)+(await rows(shop,'stockmove')).filter(m=>m.productId===id).reduce((n,m)=>n+Number(m.quantity||0),0)-(await rows(shop,'sale')).filter(s=>s.status!=='cancelled').reduce((n,s)=>n+(Array.isArray(s.items)?s.items.filter(i=>i.productId===id).reduce((a,i)=>a+Number(i.quantity||0),0):0),0);}
async function validate(shop,op,user){
 if(!op||typeof op.opId!=='string'||!op.opId||op.opId.length>100||typeof op.entityId!=='string'||!op.entityId||op.entityId.length>100||!types.has(op.entityType)||!['upsert','delete'].includes(op.action))return 'invalid';
 if(JSON.stringify(op).length>300000)return 'invalid';const d=op.data||{};
 if(op.entityType==='sale'&&op.action==='upsert'){
  if(!Array.isArray(d.items)||!d.items.length||!Number.isFinite(Number(d.total))||Number(d.total)<0||d.status==='cancelled'||d.cancelledAt||d.cancelledByUserId||d.cancelReason)return 'invalid';
  const totals=new Map();let subtotalCents=0;
  if(d.items.length>250||!Number.isFinite(Number(d.discount||0))||Number(d.discount||0)<0)return 'invalid';
  for(const i of d.items){
   const qty=Number(i.quantity),price=Number(i.price);
   if(!i.productId||!Number.isInteger(qty)||qty<=0||qty>100000||!Number.isFinite(price)||price<0)return 'invalid';
   const product=(await q.find.get(shop,'product',i.productId));
   if(!product||product.deleted||Math.round(Number(JSON.parse(product.data_json).price)*100)!==Math.round(price*100))return 'price_conflict';
   subtotalCents+=Math.round(price*100)*qty;totals.set(i.productId,(totals.get(i.productId)||0)+qty);
  }
  const discountCents=Math.round(Number(d.discount||0)*100),totalCents=Math.round(Number(d.total)*100);
  if(!Number.isSafeInteger(subtotalCents)||discountCents>subtotalCents||totalCents!==subtotalCents-discountCents)return 'invalid';
  if(d.payment==='Dinheiro'){
   const received=Math.round(Number(d.received)*100),change=Math.round(Number(d.change)*100);
   if(!Number.isSafeInteger(received)||received<totalCents||change!==received-totalCents)return 'invalid';
  }
  for(const [id,n] of totals){const available=(await inventory(shop,id));if(available===null||available<n)return 'insufficient_stock';}
 }
 if(op.entityType==='stockmove'&&op.action==='upsert'){if(!d.productId||!Number.isInteger(Number(d.quantity))||Number(d.quantity)===0||Math.abs(Number(d.quantity))>1000000||!String(d.reason||'').trim())return 'invalid';const available=(await inventory(shop,d.productId));if(available===null||available+Number(d.quantity)<0)return 'insufficient_stock';}
 if(op.entityType==='product'&&op.action==='upsert'&&(!String(d.name||'').trim()||!Number.isFinite(Number(d.stock||0))||(!Number.isInteger(Number(d.stock||0))||Number(d.stock||0)<0)||!Number.isFinite(Number(d.price))||Number(d.price)<0||!Number.isFinite(Number(d.cost||0))||Number(d.cost||0)<0))return 'invalid';
 if(op.entityType==='product'&&op.action==='upsert'){const old=(await q.find.get(shop,'product',op.entityId));if(old&&!old.deleted&&Number(JSON.parse(old.data_json).stock||0)!==Number(d.stock||0))return 'invalid';if(!old&&Number(d.stock||0)>0&&!permitted(user,'stock:write'))return 'forbidden';}
 if(op.entityType==='expense'&&op.action==='upsert'&&(!String(d.description||'').trim()||!Number.isFinite(Number(d.amount))||Number(d.amount)<=0))return 'invalid';

 if(['cashopen','cashclose'].includes(op.entityType)){
  const day=String(d.date||'');
  const validDate=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(day)&&!Number.isNaN(Date.parse(day+'T12:00:00Z'));
  const moneyValue=op.entityType==='cashopen'?d.amount:d.counted;
  const unit=Math.round(Number(moneyValue)*100);
  if(op.action!=='upsert'||!validDate||op.entityId!==day||d.id!==day||!Number.isFinite(Number(moneyValue))||!Number.isSafeInteger(unit)||unit<0||unit>1000000000||Math.abs(Number(moneyValue)*100-unit)>0.00001||typeof(d.notes||'')!=='string'||String(d.notes||'').length>200)return 'invalid';
  const existing=(await q.find.get(shop,op.entityType,day));
  if(op.entityType==='cashopen'){
   if((await q.find.get(shop,'cashclose',day))?.deleted===0)return 'immutable';
   if(existing&&!existing.deleted&&user.role!=='owner')return 'forbidden';
  }else{
   if(existing&&!existing.deleted)return 'immutable';
   const opening=(await q.find.get(shop,'cashopen',day));
   if(!opening||opening.deleted)return 'opening_required';
  }
 }
 if(op.entityType==='financeplan'){
  if(op.action!=='upsert'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(d.month||''))||op.entityId!==d.month)return 'invalid';
  for(const key of ['otherIncome','otherCost','reserve','takePercent','feePercent','minMarginPercent','taxPercent','overheadPercent','fixedPerItem','maxDiscountPercent','desiredSalary']){
   if(!Number.isFinite(Number(d[key]??0))||Number(d[key]??0)<0||Number(d[key]??0)>(key.endsWith('Percent')?100:1e9))return 'invalid';
  }
 }
 if(op.entityType==='promotion'&&op.action==='upsert'){
  const dateOk=v=>/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(v||''))&&!Number.isNaN(Date.parse(v+'T12:00:00Z'));
  if(typeof d.name!=='string'||!d.name.trim()||d.name.length>100||!Number.isFinite(Number(d.percent))||Number(d.percent)<=0||Number(d.percent)>100||typeof d.active!=='boolean'||!dateOk(d.startDate)||!dateOk(d.endDate)||d.startDate>d.endDate)return 'invalid';
 }
 if(op.entityType==='shopprofile'){
  if(op.action!=='upsert'||op.entityId!=='company'||d.id!=='company')return 'invalid';
  for(const field of ['businessName','cnpj','address','city','phone','email']){
   if(typeof(d[field]||'')!=='string'||String(d[field]||'').length>180)return 'invalid';
  }
  const cnpj=String(d.cnpj||'').replace(/\D/g,'');
  if(d.cnpj&&(!/^\d{14}$/.test(cnpj)||cnpj!==d.cnpj))return 'invalid';
  if(!String(d.businessName||'').trim())return 'invalid';
  if(d.pix!==undefined){try{const normalized=Pix.normalize(d.pix);if(JSON.stringify(normalized)!==JSON.stringify(d.pix))return 'invalid';}catch{return 'invalid';}}
  if(d.logoData!==undefined&&(typeof d.logoData!=='string'||(d.logoData.length>0&&(!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d.logoData)||d.logoData.length>=95000))))return 'invalid';
 }
 if(op.entityType==='withdrawal'&&op.action==='upsert'){
  if(!/^\d{4}-(0[1-9]|1[0-2])-[0-3]\d$/.test(String(d.date||''))||!Number.isFinite(Number(d.amount))||Number(d.amount)<=0||Number(d.amount)>1e9||String(d.notes||'').length>200)return 'invalid';
 }
 if(op.entityType==='cashopen'&&op.action==='delete')return 'immutable';
 if(op.entityType==='withdrawal'&&op.action==='delete'&&!(await q.find.get(shop,'withdrawal',op.entityId)))return 'invalid';
 if(op.entityType==='product'&&op.action==='delete'&&((await rows(shop,'stockmove')).some(m=>m.productId===op.entityId)||(await rows(shop,'sale')).some(s=>Array.isArray(s.items)&&s.items.some(i=>i.productId===op.entityId))))return 'invalid';
 if(op.entityType==='shopprofile'&&op.action==='delete')return 'immutable';if(['stockmove','sale','cashclose'].includes(op.entityType)&&(op.action==='delete'||(await q.find.get(shop,op.entityType,op.entityId))))return 'immutable';return null;
}
async function push(user,ops){const shop=user.shop_id,results=[];await database.begin(shop);try{for(const op of ops){const dup=op?.opId&&(await q.duplicate.get(shop,op.opId));if(dup){results.push({opId:op.opId,status:'duplicate',version:dup.version});continue;}if(!canWrite(user,op?.entityType)){results.push({opId:op?.opId||null,status:'forbidden'});continue;}const bad=(await validate(shop,op,user));if(bad){results.push({opId:op?.opId||null,status:bad});continue;}const current=(await q.find.get(shop,op.entityType,op.entityId)),base=Number(op.baseVersion||0);if((!current&&base!==0)||(current&&base!==current.version)){results.push({opId:op.opId,status:'conflict',serverVersion:current?.version||0});continue;}const v=(current?.version||0)+1,deleted=op.action==='delete'?1:0;
 const trustedData=(op.entityType==='sale'&&!deleted)?{...op.data,status:'completed',cancelledAt:null,cancelReason:'',cancelledByUserId:'',cancelledByName:'',soldByUserId:user.user_id,soldByName:user.name,items:await Promise.all(op.data.items.map(async i=>({
  ...i,cost:Number(JSON.parse((await q.find.get(shop,'product',i.productId)).data_json).cost||0)
 })))}:op.data;
 const serialized=deleted?(current?.data_json||JSON.stringify(op.data||{})):JSON.stringify(trustedData||{}),date=now();(await q.put.run(shop,op.entityType,op.entityId,serialized,v,deleted,date));(await q.log.run(shop,op.opId,op.entityType,op.entityId,op.action,serialized,v,String(op.deviceId||'unknown'),date));(await logAudit(user,op.action,op.entityType,op.entityId,current?JSON.parse(current.data_json):null,deleted?null:JSON.parse(serialized)));results.push({opId:op.opId,status:'accepted',version:v});}await database.commit();return results;}catch(e){await database.rollback();throw e;}}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function fail(res,status,message){json(res,status,{error:message});}
async function body(req,maxBytes=5*1024*1024){const parts=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>maxBytes)throw Error('Requisição muito grande');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');}
const attempts=new Map();function limited(key){const t=Date.now(),item=attempts.get(key)||{start:t,count:0};if(t-item.start>15*60*1000){item.start=t;item.count=0;}item.count++;attempts.set(key,item);if(attempts.size>12000){for(const [k,v] of attempts){if(t-v.start>15*60*1000)attempts.delete(k);}if(attempts.size>12000)attempts.delete(attempts.keys().next().value);}return item.count>20;}
async function auth(req){const value=(req.headers.authorization||'').match(/^Bearer ([0-9a-f]{64})$/i);if(!value)return null;const s=(await q.session.get(hash(value[1])));if(!s||s.expires_at<Date.now())return null;return s;}
async function newSession(shop,user){const token=crypto.randomBytes(32).toString('hex');(await database.prepare('INSERT INTO sessions(token_hash,shop_id,user_id,expires_at) VALUES(?,?,?,?)').run(hash(token),shop,user,Date.now()+30*24*3600*1000));return token;}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const registrationEnabled=()=>process.env.ALLOW_REGISTRATION==='true'||(process.env.NODE_ENV!=='production'&&process.env.ALLOW_REGISTRATION!=='false');
const handleRequest=(req,res)=>database.withRequest(async()=>{try{
 const u=new URL(req.url,'http://localhost');const route=u.pathname;if(process.env.NODE_ENV==='production'&&req.headers['x-forwarded-proto']!=='https')return fail(res,403,'Conexão HTTPS obrigatória.');
 if(route.startsWith('/api/')){
  if(req.method==='GET'&&route==='/api/config')return json(res,200,{registrationEnabled:registrationEnabled(),app:'STREET ADMIN',version:'1.2.0'});
  if(req.method==='GET'&&route==='/api/health'){await database.health();return json(res,200,{ok:true,version:'1.2.0',app:'STREET ADMIN Contas',lanHttpsPort:(process.env.STREET_ADMIN_TLS_PFX||process.env.STREET_ADMIN_TLS_KEY)?PORT:null,lanIp:(process.env.STREET_ADMIN_TLS_PFX||process.env.STREET_ADMIN_TLS_KEY)?(process.env.STREET_ADMIN_LAN_IP||null):null,lanLauncherMode:process.env.STREET_ADMIN_LAN_LAUNCHER||null});}
  if(req.method==='POST'&&route==='/api/auth/register'){if(!registrationEnabled())return fail(res,403,'Cadastros públicos estão desativados.');
   if(limited('register:'+req.socket.remoteAddress))return fail(res,429,'Muitas tentativas. Tente depois.');
   const d=await body(req),email=String(d.email||'').trim().toLowerCase(),password=String(d.password||''),name=String(d.shopName||'').trim();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>180||password.length<10||password.length>200||!name||name.length>100)return fail(res,400,'Informe nome da loja, e-mail válido e senha com pelo menos 10 caracteres.');
   if((await q.user.get(email)))return fail(res,409,'Este e-mail já possui uma conta.');
   const shop=uuid(),user=uuid(),salt=crypto.randomBytes(16).toString('hex');await database.begin(shop);try{(await database.prepare('INSERT INTO shops(id,name,created_at) VALUES(?,?,?)').run(shop,name,now()));(await database.prepare('INSERT INTO users(id,shop_id,email,name,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?)').run(user,shop,email,'Administrador',pwd(password,salt),salt,now()));await database.commit();}catch(e){await database.rollback();throw e;}
   return json(res,201,{token:(await newSession(shop,user)),shopId:shop,shopName:name,email,userName:'Administrador',userId:user,role:'owner',permissions:Object.fromEntries(PERMISSION_KEYS.map(p=>[p,true]))});
  }
  if(req.method==='POST'&&route==='/api/auth/login'){
   if(limited('login:'+req.socket.remoteAddress))return fail(res,429,'Muitas tentativas. Tente depois.');
   const d=await body(req),email=String(d.email||'').trim().toLowerCase(),password=String(d.password||''),user=(await q.user.get(email));
   const valid=user&&user.active===1&&password.length<=200&&crypto.timingSafeEqual(Buffer.from(user.password_hash,'hex'),Buffer.from(pwd(password,user.password_salt),'hex'));
   if(!valid)return fail(res,401,'E-mail ou senha inválidos.');
   const shop=(await database.prepare('SELECT name FROM shops WHERE id=?').get(user.shop_id));return json(res,200,{token:(await newSession(user.shop_id,user.id)),shopId:user.shop_id,shopName:shop.name,email:user.email,userName:user.name,userId:user.id,role:user.role||'owner',permissions:user.role==='staff'?safePermissions(parsePermissions(user.permissions)):Object.fromEntries(PERMISSION_KEYS.map(p=>[p,true]))});
  }
  const a=(await auth(req));if(!a)return fail(res,401,'Faça login para acessar sua loja.');
  if(req.method==='GET'&&route==='/api/auth/me')return json(res,200,{shopId:a.shop_id,shopName:a.shop_name,email:a.email,userName:a.name,...safeUser(a)});

  if(route.startsWith('/api/windows/')){if(process.env.NODE_ENV==='production')return fail(res,403,'Controle local indisponível na nuvem.');
   if(!windowsLocalRequest(req))return fail(res,403,'Controles disponíveis apenas no próprio PC Windows.');
   if(a.role!=='owner')return fail(res,403,'Somente o administrador pode controlar o servidor.');
   if(req.method==='GET'&&route==='/api/windows/status'){
    const startup=windowsStartupInfo();
    return json(res,200,{...startup,started:true,computerOnly:true});
   }
   if(req.method==='POST'&&route==='/api/windows/autostart'){
    const value=await body(req);
    if(typeof value.enabled!=='boolean')return fail(res,400,'Informe enabled: true ou false.');
    return json(res,200,{ok:true,...windowsSetStartup(value.enabled)});
   }
   if(req.method==='POST'&&route==='/api/windows/shutdown'){
    const gatewaySignalled=windowsRequestStop();
    json(res,200,{ok:true,gatewaySignalled,message:'Servidor encerrando no computador.'});
    setTimeout(async()=>{try{await database.close();}catch{}process.exit(0);},650).unref();
    return;
   }
   return fail(res,405,'Ação não disponível.');
  }

  // Exclusão definitiva de uma loja inteira (e não só da conta do administrador).
  // A operação é irreversível no servidor: confirme a senha, o nome da loja e a frase exata.
  // Lojas diferentes compartilham o PostgreSQL; exclusão autenticada limita-se ao shop_id informado.
  if(req.method==='DELETE'&&route==='/api/shop'){
   if(a.role!=='owner')return fail(res,403,'Somente administradores podem excluir a loja inteira.');
   const d=await body(req),password=String(d.password||''),confirmName=String(d.shopName||''),phrase=String(d.confirmPhrase||'');
   const owner=(await q.staffGet.get(a.shop_id,a.user_id));
   const existingShop=(await database.prepare('SELECT name FROM shops WHERE id=?').get(a.shop_id));
   if(!owner||!existingShop)return fail(res,404,'Loja não encontrada.');
   if(password.length<1||password.length>200||confirmName!==existingShop.name||phrase!=='EXCLUIR LOJA')
    return fail(res,400,'Confirme exatamente o nome da loja, a frase EXCLUIR LOJA e a senha atual.');
   const expected=Buffer.from(owner.password_hash,'hex'),actual=Buffer.from(pwd(password,owner.password_salt),'hex');
   if(expected.length!==actual.length||!crypto.timingSafeEqual(expected,actual))
    return fail(res,403,'Senha atual incorreta.');
   // secure_delete zera conteúdo lógico dos registros excluídos do banco SQLite.
   /* PostgreSQL uses MVCC; no SQLite pragma. */
   await database.begin(a.shop_id);
   try{
    (await database.prepare('DELETE FROM sessions WHERE shop_id=?').run(a.shop_id));
    (await database.prepare('DELETE FROM records WHERE shop_id=?').run(a.shop_id));
    (await database.prepare('DELETE FROM operations WHERE shop_id=?').run(a.shop_id));
    (await database.prepare('DELETE FROM audit_log WHERE shop_id=?').run(a.shop_id));
    (await database.prepare('DELETE FROM users WHERE shop_id=?').run(a.shop_id));
    const result=(await database.prepare('DELETE FROM shops WHERE id=?').run(a.shop_id));
    if(result.changes!==1)throw Error('Loja não foi excluída.');
    await database.commit();
   }catch(e){await database.rollback();throw e;}
   // Não há backup automático: a exportação é oferecida ao administrador antes de confirmar.
   /* PostgreSQL controls WAL independently. */
   return json(res,200,{ok:true,deletedShopId:a.shop_id,message:'Loja e todas as contas e registros excluídos do servidor.'});
  }

  if(req.method==='PATCH'&&route==='/api/shop'){
   if(a.role!=='owner')return fail(res,403,'Somente administradores podem alterar o nome da loja.');
   const d=await body(req),name=String(d.name||'').trim();if(!name||name.length>100)return fail(res,400,'Nome da loja inválido.');
   const oldName=a.shop_name;
   await database.begin(a.shop_id);try{(await database.prepare('UPDATE shops SET name=? WHERE id=?').run(name,a.shop_id));(await logAudit(a,'update','shop',a.shop_id,{name:oldName},{name}));await database.commit();}catch(e){await database.rollback();throw e;}
   return json(res,200,{ok:true,shopName:name});
  }
  if(req.method==='PATCH'&&route==='/api/auth/profile'){
   const d=await body(req),name=String(d.name||'').trim();
   if(!name||name.length>100)return fail(res,400,'Nome inválido.');
   const changing=Boolean(d.newPassword);const user=(await q.staffGet.get(a.shop_id,a.user_id));
   if(changing){const old=String(d.currentPassword||''),fresh=String(d.newPassword||'');if(old.length>200||fresh.length<10||fresh.length>200||!crypto.timingSafeEqual(Buffer.from(user.password_hash,'hex'),Buffer.from(pwd(old,user.password_salt),'hex')))return fail(res,400,'Senha atual inválida ou nova senha com menos de 10 caracteres.');}
   await database.begin(a.shop_id);try{
    (await database.prepare('UPDATE users SET name=? WHERE id=? AND shop_id=?').run(name,a.user_id,a.shop_id));
    if(changing){const salt=crypto.randomBytes(16).toString('hex');(await database.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=?').run(pwd(String(d.newPassword),salt),salt,a.user_id));(await database.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(a.user_id,hash(req.headers.authorization.slice(7))));}
    (await logAudit(a,'update','profile',a.user_id,{name:a.name},{name,passwordChanged:changing}));await database.commit();
   }catch(e){await database.rollback();throw e;}
   return json(res,200,{ok:true,userName:name});
  }

  // Exclusão da própria conta: senha atual obrigatória e loja preservada.
  if(req.method==='DELETE'&&route==='/api/auth/account'){
   const d=await body(req),password=String(d.password||''),confirmEmail=String(d.confirmEmail||'').trim().toLowerCase();
   const account=(await q.staffGet.get(a.shop_id,a.user_id));
   if(!account||confirmEmail!==account.email||password.length>200||!password||
      !crypto.timingSafeEqual(Buffer.from(account.password_hash,'hex'),Buffer.from(pwd(password,account.password_salt),'hex')))
    return fail(res,400,'E-mail de confirmação ou senha atual incorretos.');
   if(account.role==='owner'){
    const otherOwners=(await database.prepare("SELECT count(*) AS n FROM users WHERE shop_id=? AND role='owner' AND active=1 AND id<>?").get(a.shop_id,a.user_id)).n;
    if(otherOwners<1)return fail(res,409,'Antes de excluir sua conta, cadastre outro administrador ativo. A exclusão da loja inteira não é realizada aqui.');
   }
   await database.begin(a.shop_id);try{
    const before={id:account.id,name:account.name,email:account.email,role:account.role};
    (await database.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id));
    (await database.prepare('DELETE FROM users WHERE id=? AND shop_id=?').run(account.id,a.shop_id));
    (await logAudit(a,'delete','account',account.id,before,{accountDeleted:true,shopPreserved:true}));
    await database.commit();
   }catch(e){await database.rollback();throw e;}
   return json(res,200,{ok:true,message:'Sua conta foi excluída. A loja, as vendas e os relatórios foram preservados.'});
  }

  // Cancelar só pelo servidor: mantém a venda original, a auditoria e restaura o saldo de estoque.
  if(req.method==='POST'&&/^\/api\/sales\/[^/]+\/cancel$/.test(route)){
   if(a.role!=='owner')return fail(res,403,'Somente administradores podem cancelar vendas.');
   const saleId=decodeURIComponent(route.slice('/api/sales/'.length,-'/cancel'.length));
   if(!saleId||saleId.length>100)return fail(res,400,'Identificador inválido.');
   const d=await body(req),reason=String(d.reason||'').trim();
   if(reason.length<5||reason.length>240)return fail(res,400,'Informe o motivo do cancelamento (5 a 240 caracteres).');
   await database.begin(a.shop_id);try{
    const old=(await q.find.get(a.shop_id,'sale',saleId));
    if(!old||old.deleted){await database.rollback();return fail(res,404,'Venda não encontrada nesta loja ou ainda não sincronizada.');}
    const previous=JSON.parse(old.data_json);
    if(previous.status==='cancelled'){await database.rollback();return fail(res,409,'Esta venda já está cancelada.');}
    const next={...previous,status:'cancelled',cancelledAt:now(),cancelReason:reason,cancelledByUserId:a.user_id,cancelledByName:a.name};
    const v=old.version+1,serialized=JSON.stringify(next),date=now();
    (await q.put.run(a.shop_id,'sale',saleId,serialized,v,0,date));
    (await q.log.run(a.shop_id,uuid(),'sale',saleId,'upsert',serialized,v,'server-cancel',date));
    (await logAudit(a,'cancel','sale',saleId,previous,next));
    await database.commit();
    return json(res,200,{ok:true,saleId,status:'cancelled',cancelledAt:next.cancelledAt});
   }catch(e){try{await database.rollback();}catch{}throw e;}
  }
  if(req.method==='POST'&&route==='/api/auth/logout'){const token=req.headers.authorization.slice(7);(await database.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token)));return json(res,200,{ok:true});}
  if(req.method==='POST'&&route==='/api/sync/push'){const d=await body(req);const ops=Array.isArray(d.operations)?d.operations.slice(0,500):[];return json(res,200,{results:(await push(a,ops))});}
  if(req.method==='GET'&&route==='/api/sync/pull'){const since=Math.max(0,Number(u.searchParams.get('since'))||0),ops=(await q.pull.all(a.shop_id,since));return json(res,200,{operations:ops.map(x=>filteredOperation(a,x)).filter(Boolean),cursor:ops.length?ops.at(-1).seq:since,hasMore:ops.length===1000});}
  if(req.method==='GET'&&route==='/api/staff'){
   if(a.role!=='owner')return fail(res,403,'Somente o administrador pode gerenciar a equipe.');
   return json(res,200,{staff:(await q.staffList.all(a.shop_id)).map(u=>({id:u.id,name:u.name,email:u.email,role:u.role,permissions:u.role==='owner'?Object.fromEntries(PERMISSION_KEYS.map(p=>[p,true])):safePermissions(parsePermissions(u.permissions)),active:!!u.active,createdAt:u.created_at}))});
  }
  if(req.method==='POST'&&route==='/api/staff'){
   if(a.role!=='owner')return fail(res,403,'Somente o administrador pode gerenciar a equipe.');
   const d=await body(req),name=String(d.name||'').trim(),email=String(d.email||'').trim().toLowerCase(),password=String(d.password||''),role=d.role==='owner'?'owner':'staff';
   if(!name||name.length>100||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>180||password.length<10||password.length>200)return fail(res,400,'Informe nome, e-mail válido e senha com 10 a 200 caracteres.');
   if((await q.user.get(email)))return fail(res,409,'Este e-mail já está cadastrado.');
   const id=uuid(),salt=crypto.randomBytes(16).toString('hex'),perms=safePermissions(d.permissions||Object.fromEntries(STAFF_DEFAULT.map(x=>[x,true])));
   await database.begin(a.shop_id);try{
    (await database.prepare("INSERT INTO users(id,shop_id,email,name,password_hash,password_salt,created_at,role,permissions,active) VALUES(?,?,?,?,?,?,?,?,?,1)").run(id,a.shop_id,email,name,pwd(password,salt),salt,now(),role,JSON.stringify(perms)));
    (await logAudit(a,'create','staff',id,null,{id,name,email,role,permissions:role==='owner'?'all':perms,active:true}));await database.commit();
   }catch(e){await database.rollback();throw e;}
   return json(res,201,{ok:true,id});
  }
  if(req.method==='DELETE'&&route.startsWith('/api/staff/')){
   if(a.role!=='owner')return fail(res,403,'Somente o administrador pode excluir contas.');
   const id=route.slice('/api/staff/'.length),old=(await q.staffGet.get(a.shop_id,id));
   if(!old)return fail(res,404,'Usuário não encontrado nesta loja.');
   if(id===a.user_id)return fail(res,400,'Você não pode excluir sua própria conta de administrador.');
   if(old.role==='owner'){const count=(await database.prepare("SELECT count(*) AS n FROM users WHERE shop_id=? AND role='owner' AND active=1").get(a.shop_id)).n;if(old.active&&count<=1)return fail(res,400,'A loja precisa manter um administrador ativo.');}
   const before={id,name:old.name,email:old.email,role:old.role,active:!!old.active};
   await database.begin(a.shop_id);try{
    (await database.prepare('DELETE FROM sessions WHERE user_id=?').run(id));
    (await database.prepare('DELETE FROM users WHERE shop_id=? AND id=?').run(a.shop_id,id));
    (await logAudit(a,'delete','staff',id,before,null));
    await database.commit();
   }catch(e){await database.rollback();throw e;}
   return json(res,200,{ok:true,message:'Conta excluída; histórico de vendas preservado.'});
  }
  if(req.method==='PATCH'&&route.startsWith('/api/staff/')){
   if(a.role!=='owner')return fail(res,403,'Somente o administrador pode gerenciar a equipe.');
   const id=route.slice('/api/staff/'.length),old=(await q.staffGet.get(a.shop_id,id));if(!old)return fail(res,404,'Usuário não encontrado.');
   const d=await body(req),name=String(d.name||'').trim(),password=String(d.password||''),perms=safePermissions(d.permissions||{}),active=d.active!==false,role=d.role==='owner'?'owner':'staff';
   if(old.id===a.user_id&&(role!=='owner'||!active))return fail(res,400,'Não é possível retirar o próprio acesso de administrador.');
   if(old.role==='owner'&&(role!=='owner'||!active)){const owners=(await database.prepare("SELECT count(*) AS n FROM users WHERE shop_id=? AND role='owner' AND active=1").get(a.shop_id)).n;if(owners<=1)return fail(res,400,'A loja precisa manter um administrador ativo.');}
   if(!name||name.length>100||(password&&(password.length<10||password.length>200)))return fail(res,400,'Nome inválido ou senha com menos de 10 caracteres.');
   const before={id,name:old.name,email:old.email,role:old.role,permissions:old.role==='owner'?'all':safePermissions(parsePermissions(old.permissions)),active:!!old.active};
   await database.begin(a.shop_id);try{
    (await database.prepare('UPDATE users SET name=?,permissions=?,active=?,role=? WHERE id=?').run(name,JSON.stringify(perms),active?1:0,role,id));
    if(password){const salt=crypto.randomBytes(16).toString('hex');(await database.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=?').run(pwd(password,salt),salt,id));}
    if(!active||password||role!==old.role)(await database.prepare('DELETE FROM sessions WHERE user_id=?').run(id));
    (await logAudit(a,'update','staff',id,before,{id,name,email:old.email,role,permissions:role==='owner'?'all':perms,active,passwordChanged:!!password}));await database.commit();
   }catch(e){await database.rollback();throw e;}
   return json(res,200,{ok:true});
  }
  if(req.method==='GET'&&route==='/api/audit'){
   if(a.role!=='owner')return fail(res,403,'Somente o administrador pode consultar o histórico.');
   const before=Math.max(1,Math.floor(Number(u.searchParams.get('before'))||Number.MAX_SAFE_INTEGER)),limit=Math.min(100,Math.max(1,Math.floor(Number(u.searchParams.get('limit'))||50)));
   return json(res,200,{events:(await q.auditList.all(a.shop_id,before,limit)).map(x=>({...x,before:x.before_json?JSON.parse(x.before_json):null,after:x.after_json?JSON.parse(x.after_json):null,before_json:undefined,after_json:undefined}))});
  }
  // Backup de registros: importa no CNPJ/nome/conta da loja DESTINO, sem alterar sua identidade.
  // Faz merge conservador: adiciona registros ausentes, nunca altera ou apaga os existentes.
  // IDs estáveis permitem repetir a importação sem duplicar vendas, estoque ou despesas.
  if(req.method==='GET'&&route==='/api/export'){
   if(a.role!=='owner')return fail(res,403,'Acesso restrito ao administrador.');
   const data=(await q.export.all(a.shop_id)).map(r=>({entity_type:r.entity_type,entity_id:r.entity_id,deleted:r.deleted,data:JSON.parse(r.data_json)}));
   res.setHeader('Content-Disposition','attachment; filename="street-admin-backup-dados.json"');
   return json(res,200,{format:'street-admin-backup-dados-v5',shopId:a.shop_id,shopName:a.shop_name,exportedAt:now(),containsAccounts:false,records:data});
  }
  if(req.method==='POST'&&route==='/api/import'){
   if(a.role!=='owner')return fail(res,403,'Acesso restrito ao administrador.');
   const d=await body(req,25*1024*1024);
   const formats=['street-admin-backup-dados-v5','street-admin-backup-portavel-v4','street-admin-backup-conta-v3','street-admin-backup-v1'];
   if(!d||!formats.includes(d.format)||!Array.isArray(d.records)||d.records.length>50000)
    return fail(res,400,'Arquivo não é um backup válido da loja.');
   if(d.format!=='street-admin-backup-v1'&&(typeof d.shopId!=='string'||!d.shopId))
    return fail(res,400,'Backup sem identificação da loja de origem.');
   const foreign=d.format==='street-admin-backup-v1'||d.shopId!==a.shop_id;
   const password=String(d.restorePassword||'');
   const administrator=(await q.staffGet.get(a.shop_id,a.user_id));
   if(!administrator||!password||password.length>200||!crypto.timingSafeEqual(Buffer.from(administrator.password_hash,'hex'),Buffer.from(pwd(password,administrator.password_salt),'hex')))
    return fail(res,403,'Para importar, informe a senha atual do administrador.');
   if(String(d.confirmTargetShopName||'')!==a.shop_name||String(d.confirmPhrase||'')!=='IMPORTAR DADOS')
    return fail(res,400,'Confirme o nome da loja atual e IMPORTAR DADOS.');
   // shopprofile representa endereço, CNPJ e nome usados nos recibos. Nunca transferir de outra loja.
   const skippedTypes=foreign?new Set(['shopprofile']):new Set();
   const seen=new Set(),inputProducts=new Map();
   for(const r of d.records){
    if(!r||!types.has(r.entity_type)||typeof r.entity_id!=='string'||!r.entity_id||r.entity_id.length>128||
       !r.data||typeof r.data!=='object'||Array.isArray(r.data)||
       (r.data.id!=null&&r.data.id!==r.entity_id)||JSON.stringify(r.data).length>300000||
       ![undefined,null,0,1,true,false].includes(r.deleted))return fail(res,400,'Backup possui registros inválidos. Nada foi importado.');
    const key=r.entity_type+':'+r.entity_id;
    if(seen.has(key))return fail(res,400,'Backup possui IDs repetidos. Nada foi importado.');
    seen.add(key);
    if(r.entity_type==='product')inputProducts.set(r.entity_id,r);
   }
   // Se um produto com o MESMO ID tem identidade diferente, importar vendas/movimentos
   // associados poderia mexer no estoque de outro item. Bloquear integralmente neste caso.
   for(const [id,p] of inputProducts){
    const old=(await q.find.get(a.shop_id,'product',id));
    if(!old)continue;
    const existing=JSON.parse(old.data_json);
    const aName=String(existing.name||'').trim().toLocaleLowerCase('pt-BR');
    const bName=String(p.data.name||'').trim().toLocaleLowerCase('pt-BR');
    if(aName!==bName)return fail(res,409,'Conflito de produto com identificador já usado. Nada foi importado.');
   }
   // Nunca inserir movimento/venda apontando para um produto que não existe nem
   // no backup nem na loja atual (inclusive tombstones usados pelo histórico).
   const knownProducts=new Set((await database.prepare("SELECT entity_id FROM records WHERE shop_id=? AND entity_type='product'").all(a.shop_id)).map(p=>p.entity_id));
   const productAvailable=id=>typeof id==='string'&&(inputProducts.has(id)||knownProducts.has(id));
   for(const r of d.records){
    if(r.deleted)continue;
    if(r.entity_type==='stockmove'&&!productAvailable(r.data.productId))
     return fail(res,400,'Backup possui entrada de estoque sem produto correspondente. Nada foi importado.');
    if(r.entity_type==='sale'&&(!Array.isArray(r.data.items)||r.data.items.some(i=>!productAvailable(i?.productId))))
     return fail(res,400,'Backup possui venda sem produto correspondente. Nada foi importado.');
   }
   let imported=0,skipped=0,identitySkipped=0;
   await database.begin(a.shop_id);
   try{
    for(const r of d.records){
     if(skippedTypes.has(r.entity_type)){identitySkipped++;continue;}
     // Mesmo quando o backup traz uma versão mais recente, NÃO sobrescrever dados
     // editados, vendas ou configurações da loja de destino. Tampouco propagamos deletes
     // para registros da loja atual (apenas arquivos históricos ausentes são inseridos).
     if((await q.find.get(a.shop_id,r.entity_type,r.entity_id))){skipped++;continue;}
     const serialized=JSON.stringify(r.data),date=now();
     (await q.put.run(a.shop_id,r.entity_type,r.entity_id,serialized,1,r.deleted?1:0,date));
     (await q.log.run(a.shop_id,uuid(),r.entity_type,r.entity_id,r.deleted?'delete':'upsert',serialized,1,'backup-import',date));
     imported++;
    }
    (await logAudit(a,'import','backup',uuid(),null,{imported,skipped,identitySkipped,sourceShopId:d.shopId||null,sourceShopName:d.shopName||null,foreign,mode:'merge_without_overwrite'}));
    await database.commit();
   }catch(e){await database.rollback();return fail(res,409,e.message||'Não foi possível importar os dados.');}
   return json(res,200,{ok:true,imported,skipped,identitySkipped,fromAnotherShop:foreign,shopName:a.shop_name,accountsRestored:false,mode:'merge_without_overwrite'});
  }
  return fail(res,404,'API não encontrada');
 }
 if(req.method!=='GET'&&req.method!=='HEAD')return fail(res,405,'Método não permitido');
 const filepath=path.resolve(__dirname,'public','.'+decodeURIComponent(route==='/'?'/index.html':route)),root=path.resolve(__dirname,'public');if(!filepath.startsWith(root+path.sep))return fail(res,403,'Acesso negado');if(!fs.existsSync(filepath)||!fs.statSync(filepath).isFile())return fail(res,404,'Arquivo não encontrado');res.writeHead(200,{'Content-Type':mime[path.extname(filepath)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'"});if(req.method==='HEAD')res.end();else fs.createReadStream(filepath).pipe(res);
 }catch(e){console.error(JSON.stringify({level:'error',event:'request_failed',message:e?.message||'unknown'}));if(!res.headersSent)fail(res,500,'Erro interno.');else res.end();}});
const HOST=process.env.STREET_ADMIN_LISTEN_HOST||'0.0.0.0';
const tlsPfx=process.env.STREET_ADMIN_TLS_PFX;
const tlsPemKey=process.env.STREET_ADMIN_TLS_KEY;
const tlsPemCert=process.env.STREET_ADMIN_TLS_CERT;
async function startServer(){await database.initialize();
if(tlsPfx || (tlsPemKey && tlsPemCert)){
 // HTTPS em toda a rede local; HTTP da aplicação SOMENTE no próprio PC.
 // Ambos usam o MESMO processo, MESMO banco e MESMAS rotas.
 const tlsOptions={minVersion:'TLSv1.2'};
 if(tlsPemKey && tlsPemCert){
  tlsOptions.key=fs.readFileSync(tlsPemKey);
  tlsOptions.cert=fs.readFileSync(tlsPemCert);
 }else{
  const passFile=process.env.STREET_ADMIN_TLS_PASS_FILE;
  if(!passFile)throw new Error('STREET_ADMIN_TLS_PASS_FILE ausente');
  tlsOptions.pfx=fs.readFileSync(tlsPfx);
  tlsOptions.passphrase=fs.readFileSync(passFile,'utf8').trim();
 }
 const tlsServer=https.createServer(tlsOptions,handleRequest);
 tlsServer.listen(PORT,HOST,()=>console.log(`STREET ADMIN HTTPS LAN: https://${HOST}:${PORT}`));
 const httpPort=Number(process.env.STREET_ADMIN_HTTP_PORT||17879);
 http.createServer(handleRequest).listen(httpPort,'127.0.0.1',()=>console.log(`STREET ADMIN PC: http://127.0.0.1:${httpPort}`));
 // Endpoint HTTP isolado para o perfil PUBLICO de confianca no iPhone.
 // NUNCA serve a API, senhas, banco, PFX ou chave privada em HTTP na rede.
 const profilePath=process.env.STREET_ADMIN_IOS_PROFILE;
 const bootstrapPort=Number(process.env.STREET_ADMIN_BOOTSTRAP_PORT||17878);
 const fingerprint=String(process.env.STREET_ADMIN_CERT_FINGERPRINT||'nao informado').replace(/[^a-fA-F0-9]/g,'');
 const bootstrap=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end();}
  if(pathname==='/instalar-street-admin.mobileconfig'&&profilePath&&fs.existsSync(profilePath)){
   res.writeHead(200,{'Content-Type':'application/x-apple-aspen-config','Content-Disposition':'attachment; filename="instalar-street-admin.mobileconfig"'});
   if(req.method==='HEAD')return res.end();return fs.createReadStream(profilePath).pipe(res);
  }
  if(pathname!=='/'){res.writeHead(404);return res.end('Pagina nao encontrada');}
  const page=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Street Admin - certificado iPhone</title><style>body{font:17px system-ui;background:#121315;color:white;padding:24px;max-width:600px;margin:auto;line-height:1.6}a{display:block;background:#2e8261;color:white;padding:16px;border-radius:9px;text-align:center;text-decoration:none;font-weight:bold}code{overflow-wrap:anywhere;color:#a6f6d0}</style><h1>Street Admin - iPhone</h1><p>Essa pagina entrega <b>somente</b> o certificado publico do seu PC. Depois de autorizar o certificado, abra o aplicativo em HTTPS.</p><a href="/instalar-street-admin.mobileconfig">1. Baixar perfil de certificado</a><p>2. No iPhone: Ajustes &gt; Perfil Baixado &gt; Instalar. Depois: Ajustes &gt; Geral &gt; Sobre &gt; Ajustes de Confianca de Certificados &gt; habilitar confianca total.</p><p>3. Volte ao Safari e abra: <code>https://${process.env.STREET_ADMIN_LAN_IP||'IP-DO-PC'}:${PORT}/</code> &gt; Compartilhar &gt; Adicionar a Tela de Inicio.</p><p>Impressao digital SHA1 da raiz para conferencia no PC: <code>${fingerprint}</code></p><p>Use apenas na sua rede privada; nao encaminhe portas no roteador.</p></html>`;
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end(req.method==='HEAD'?'':page);
 });
 bootstrap.listen(bootstrapPort,HOST,()=>console.log(`Certificado publico no iPhone: http://${HOST}:${bootstrapPort}`));
}else{
 // Servidor HTTP para proxy HTTPS do Render e desenvolvimento controlado.
 const server=http.createServer(handleRequest);
 server.listen(PORT,HOST,()=>{
  const actualPort=server.address().port;
  console.log(`STREET ADMIN — http://${HOST}:${actualPort} — autenticação habilitada`);
  if(process.parentPort&&typeof process.parentPort.postMessage==='function')process.parentPort.postMessage({type:'street-ready',port:actualPort});
 });
 process.once('SIGTERM',()=>{const timer=setTimeout(()=>process.exit(1),25000);timer.unref();server.close(async()=>{await database.close();clearTimeout(timer);});});
}

}
if(require.main===module)startServer().catch(e=>{console.error(JSON.stringify({level:"fatal",event:"startup",message:e.message}));process.exitCode=1;});
module.exports={startServer,handleRequest};
