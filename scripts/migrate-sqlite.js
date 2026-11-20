'use strict';
// Use with the previous server STOPPED and a backup copy of its SQLite file.
// Does not modify the SQLite database. PostgreSQL target must be empty.
const {DatabaseSync}=require('node:sqlite');
const {Pool}=require('pg');
const fs=require('node:fs');
const path=require('node:path');
const file=process.argv[2];
if(!file||!fs.existsSync(file)){
 console.error('Uso: npm run migrate:sqlite -- "C:\\backup\\street-admin-contas.sqlite"');process.exit(2);
}
if(!process.env.DATABASE_URL){console.error('DATABASE_URL ausente.');process.exit(2);}
const db=new DatabaseSync(path.resolve(file),{readOnly:true});
const pg=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const tables={shops:['id','name','created_at'],users:['id','shop_id','email','name','password_hash','password_salt','created_at','role','permissions','active'],
 sessions:['token_hash','shop_id','user_id','expires_at'],
 records:['shop_id','entity_type','entity_id','data_json','version','deleted','updated_at'],
 operations:['seq','shop_id','op_id','entity_type','entity_id','action','data_json','version','device_id','created_at'],
 audit_log:['seq','shop_id','user_id','user_name','action','entity_type','entity_id','before_json','after_json','created_at']};
const defaults={role:'owner',permissions:'{}',active:1};
async function run(){
 const client=await pg.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(6741901)');
  for(const table of Object.keys(tables)){
   const data=db.prepare(`SELECT * FROM ${table}`).all();
   const target=await client.query(`SELECT COUNT(*)::integer AS n FROM ${table}`);
   if(target.rows[0].n!==0)throw Error(`O destino já possui dados em ${table}. Pare: não é seguro substituir nem misturar lojas.`);
   // Prevent partial import if any row cannot be represented in PG.
   const cols=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(x=>x.name));
   const fields=tables[table];
   for(const row of data){
    const values=fields.map(c=>cols.has(c)?row[c]:defaults[c]);
    if(values.some(v=>v===undefined))throw Error(`Campo ausente em ${table}`);
    const sql=`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map((_,i)=>'$'+(i+1)).join(',')})`;
    await client.query(sql,values);
   }
   console.log(JSON.stringify({table,read:data.length,inserted:data.length}));
  }
  for(const table of ['operations','audit_log']){
   await client.query(`SELECT setval(pg_get_serial_sequence($1,'seq'),GREATEST(COALESCE((SELECT MAX(seq) FROM ${table}),0),1),EXISTS(SELECT 1 FROM ${table}))`,[table]);
  }
  await client.query('COMMIT');
  console.log('Migração concluída. Compare contagens, faça login e teste vendas antes de usar em produção.');
 }catch(e){await client.query('ROLLBACK');console.error('Migração revertida:',e.message);process.exitCode=1;}finally{client.release();await pg.end();db.close();}
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
