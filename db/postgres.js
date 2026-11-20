'use strict';
// PostgreSQL adapter for the original Street Admin query contracts.
// Every request runs in its own AsyncLocalStorage context; a transaction
// holds a single PG connection and serializes critical mutations by shop.
const {Pool}=require('pg');
const {AsyncLocalStorage}=require('node:async_hooks');
const fs=require('node:fs');
const path=require('node:path');
const storage=new AsyncLocalStorage();
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL ausente. Configure PostgreSQL antes de iniciar.');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:Number(process.env.PGPOOL_MAX||8),
  connectionTimeoutMillis:10000,idleTimeoutMillis:30000,application_name:'street-admin',
  ssl: process.env.PGSSL_MODE==='require' ? {rejectUnauthorized:true}: undefined});
pool.on('error',e=>console.error(JSON.stringify({level:'error',event:'pg_pool',message:e.message})));
function prepare(sql){
  let index=0;
  const statement=sql.replace(/\?/g,()=>'$'+(++index));
  const query=async(args)=>{
    const ctx=storage.getStore();
    const executor=ctx?.client||pool;
    return executor.query(statement,args);
  };
  return {
    get:async(...args)=>(await query(args)).rows[0],
    all:async(...args)=>(await query(args)).rows,
    run:async(...args)=>({changes:(await query(args)).rowCount})
  };
}
async function begin(shopId){
 const ctx=storage.getStore();if(!ctx)throw Error('Sem contexto de requisição');
 if(ctx.client)throw Error('Transação aninhada não permitida');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  if(shopId)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',[shopId]);
  ctx.client=client;
 }catch(e){try{await client.query('ROLLBACK');}catch{}client.release();throw e;}
}
async function endTransaction(command){
 const ctx=storage.getStore();if(!ctx?.client)return;
 const client=ctx.client;ctx.client=null;
 try{await client.query(command);}finally{client.release();}
}
const commit=()=>endTransaction('COMMIT');
const rollback=()=>endTransaction('ROLLBACK');
const withRequest=fn=>storage.run({client:null},fn);
const health=async()=>{await pool.query('SELECT 1');};
async function initialize(){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(6741901)');
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const files=fs.readdirSync(path.join(__dirname,'migrations')).filter(f=>/^\d+_.+\.sql$/.test(f)).sort();
  for(const file of files){
    const exists=await client.query('SELECT 1 FROM schema_migrations WHERE name=$1',[file]);
    if(exists.rows.length)continue;
    await client.query(fs.readFileSync(path.join(__dirname,'migrations',file),'utf8'));
    await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[file]);
  }
  await client.query('COMMIT');
 }catch(e){try{await client.query('ROLLBACK');}catch{}throw e;}finally{client.release();}
}
const close=()=>pool.end();
module.exports={prepare,begin,commit,rollback,withRequest,health,initialize,close};
