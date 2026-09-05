import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomUUID,createHash } from 'node:crypto';
import { phase5Server } from '../helpers/phase5-api.js';
import { DatabaseSync } from 'node:sqlite';
import { createBackup } from '../../server/services/backup-service.js';
import { runMigrations } from '../../server/db/migrate.js';
import { openDatabase } from '../../server/db/connection.js';

const post=(s,url,body={},key=randomUUID())=>s.call(url,{method:'POST',body,key});
async function fixture(t){const s=await phase5Server(t);const backup=await post(s,'/backups');assert.equal(backup.status,201);return {...s,backup:backup.data};}
test('HTTP backup verify confirmation restore rebinds every route and preserves token, replay and new writes',async t=>{
  const s=await fixture(t), id=s.backup.id;
  const tokenFile=fs.readFileSync(s.config.secretsPath,'utf8');
  assert.equal(s.backup.verified,true);assert.ok(s.backup.sizeBytes>0);assert.ok(!JSON.stringify(s.backup).includes(s.paths.dataDir));
  await post(s,'/inspirations',{rawText:'虚构恢复后消失'});
  assert.equal((await post(s,`/backups/${id}/restore`,{})).status,400);
  const verified=await post(s,`/backups/${id}/verify`);
  assert.equal(verified.status,200);
  const body={confirmationToken:verified.data.confirmationToken,confirmText:'恢复'},key=randomUUID();
  const restored=await post(s,`/backups/${id}/restore`,body,key);
  assert.equal(restored.status,200,JSON.stringify(restored));assert.equal(restored.data.health.database,'ok');
  assert.equal(restored.data.preRestoreBackup.reason,'pre-restore');
  assert.equal((await s.call('/inspirations')).data.items.length,0);
  assert.equal((await post(s,`/backups/${id}/restore`,body,key)).data.preRestoreBackup.id,restored.data.preRestoreBackup.id);
  assert.equal((await post(s,`/backups/${id}/restore`,body)).status,409);
  for(const url of ['/health','/meta','/settings','/contents','/dashboard','/observations','/reports','/analytics/overview?month=2026-09','/calendar-events?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z'])assert.equal((await s.call(url)).status,200,url);
  assert.equal((await post(s,'/inspirations',{rawText:'虚构新句柄写入'})).status,201);
  assert.equal((await post(s,'/backups')).status,201);
  assert.equal(fs.readFileSync(s.config.secretsPath,'utf8'),tokenFile);
});
test('backup creation is async idempotent and verify rejects tampered files and foreign manifest references',async t=>{
  const s=await phase5Server(t),key=randomUUID();
  const results=await Promise.all([post(s,'/backups',{},key),post(s,'/backups',{},key)]);
  assert.equal(results[0].status,201);assert.equal(results[1].data.id,results[0].data.id);
  const id=results[0].data.id,file=path.join(s.config.backupsDir,`${id}.sqlite`);
  const verified=await post(s,`/backups/${id}/verify`);assert.equal(verified.status,200);
  fs.appendFileSync(file,'tampered');
  assert.equal((await post(s,`/backups/${id}/restore`,{confirmationToken:verified.data.confirmationToken,confirmText:'恢复'})).status,400);
  const manifest=path.join(s.config.backupsDir,`${id}.sqlite.json`),stored=JSON.parse(fs.readFileSync(manifest));
  fs.writeFileSync(manifest,JSON.stringify({...stored,sqliteFile:'../workbench.sqlite'}));
  assert.equal((await post(s,`/backups/${id}/verify`)).status,400);
  assert.equal((await s.call('/health')).status,200);
  const second=await post(s,'/backups');const secondFile=path.join(s.config.backupsDir,`${second.data.id}.sqlite`);
  fs.unlinkSync(secondFile);fs.symlinkSync(s.config.dbPath,secondFile);
  assert.equal((await post(s,`/backups/${second.data.id}/verify`)).status,400);
});
test('restore drains already accepted partial HTTP writes and rejects new requests before closing native DB',async t=>{
  const s=await fixture(t),verified=await post(s,`/backups/${s.backup.id}/verify`);
  const body=JSON.stringify({rawText:'虚构在途写入'});
  let complete;
  const response=new Promise((resolve,reject)=>{
    const req=http.request(`${s.baseUrl}/api/v1/inspirations`,{method:'POST',headers:{Origin:s.baseUrl,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Idempotency-Key':randomUUID()}},res=>{let data='';res.on('data',v=>data+=v);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));});
    req.on('error',reject);req.write(body.slice(0,10));complete=()=>req.end(body.slice(10));
  });
  await new Promise(resolve=>setImmediate(resolve));
  // A health round trip ensures the partial request's headers reached the server.
  await s.call('/health');
  const restore=post(s,`/backups/${s.backup.id}/restore`,{confirmationToken:verified.data.confirmationToken,confirmText:'恢复'});
  let gated=false;
  for(let i=0;i<100;i++){if((await s.call('/health')).status===503){gated=true;break;}}
  complete();
  assert.equal(gated,true);assert.equal((await response).status,201);
  const result=await restore;assert.equal(result.status,200,JSON.stringify(result));
  // Protective backup is taken after draining, so it contains the completed in-flight write.
  const pre=result.data.preRestoreBackup;
  const check=await post(s,`/backups/${pre.id}/verify`);
  assert.equal((await post(s,`/backups/${pre.id}/restore`,{confirmationToken:check.data.confirmationToken,confirmText:'恢复'})).status,200);
  assert.equal((await s.call('/inspirations')).data.items[0].rawText,'虚构在途写入');
});
test('post-swap health failure rolls back and reopens previous active handle for GET and POST',async t=>{
  const s=await fixture(t);
  await post(s,'/inspirations',{rawText:'虚构需要保留的当前数据'});
  const verified=await post(s,`/backups/${s.backup.id}/verify`);
  const original=fs.renameSync;
  t.mock.method(fs,'renameSync',(from,to)=>{
    const result=original(from,to);
    if(to===s.config.dbPath&&String(from).includes('.restore-')) {
      // Real file mutation after staged verification simulates a disk/swap corruption.
      fs.writeFileSync(to,'corrupted staged data');
    }
    return result;
  });
  const result=await post(s,`/backups/${s.backup.id}/restore`,{confirmationToken:verified.data.confirmationToken,confirmText:'恢复'});
  assert.equal(result.status,500);
  assert.equal((await s.call('/inspirations')).data.items[0].rawText,'虚构需要保留的当前数据');
  assert.equal((await post(s,'/inspirations',{rawText:'虚构回滚后写入'})).status,201);
});

test('concurrent restore retries with the same key do not deadlock request draining',async t=>{
  const s=await fixture(t),v=await post(s,`/backups/${s.backup.id}/verify`),key=randomUUID();
  const body={confirmationToken:v.data.confirmationToken,confirmText:'恢复'};
  const responses=await Promise.all([post(s,`/backups/${s.backup.id}/restore`,body,key),post(s,`/backups/${s.backup.id}/restore`,body,key)]);
  assert.equal(responses[0].status,200,JSON.stringify(responses));
  // A retry arriving after maintenance starts may receive 503; a completed replay must be identical.
  assert.ok([200,503].includes(responses[1].status));
  assert.equal((await post(s,`/backups/${s.backup.id}/restore`,body,key)).data.preRestoreBackup.id,responses[0].data.preRestoreBackup.id);
});

test('restore rolls back when audit fails after the new handle is rebound',async t=>{
  const s=await phase5Server(t);
  s.db.exec("CREATE TRIGGER fictional_restore_failure BEFORE INSERT ON audit_log WHEN NEW.action='backup.restore' BEGIN SELECT RAISE(ABORT,'fictional audit failure'); END");
  const b=await post(s,'/backups');assert.equal(b.status,201);
  s.db.exec('DROP TRIGGER fictional_restore_failure');
  await post(s,'/inspirations',{rawText:'虚构审计失败前状态'});
  const v=await post(s,`/backups/${b.data.id}/verify`);
  assert.equal((await post(s,`/backups/${b.data.id}/restore`,{confirmationToken:v.data.confirmationToken,confirmText:'恢复'})).status,500);
  assert.equal((await s.call('/inspirations')).data.items[0]?.rawText,'虚构审计失败前状态');
});

test('known older backup is staged and migrated; forged old/future schema or missing required table is rejected',async t=>{
  const s=await phase5Server(t),oldDir=path.join(s.paths.projectRoot,'old-migrations');fs.mkdirSync(oldDir);
  for(const name of ['001_core.sql','002_inspiration_title_origin.sql','003_metrics_reviews.sql'])fs.copyFileSync(new URL(`../../server/db/migrations/${name}`,import.meta.url),path.join(oldDir,name));
  const old=new DatabaseSync(path.join(s.paths.projectRoot,'old.sqlite'));
  runMigrations(old,{migrationDir:oldDir});
  const manifest=await createBackup({db:old,dataDir:s.config.dataDir,reason:'manual',appVersion:'0.1.0'});old.close();
  const id=manifest.sqliteFile.slice(0,-7),v=await post(s,`/backups/${id}/verify`);
  assert.equal(v.status,200);
  assert.equal((await post(s,`/backups/${id}/restore`,{confirmationToken:v.data.confirmationToken,confirmText:'恢复'})).data.health.schemaVersion,4);
  assert.equal((await s.call('/settings')).status,200);
  const bad=new DatabaseSync(manifest.sqlitePath);bad.exec('DROP TABLE observations');bad.close();
  const stored=JSON.parse(fs.readFileSync(manifest.manifestPath,'utf8'));
  fs.writeFileSync(manifest.manifestPath,JSON.stringify({...stored,sha256:createHash('sha256').update(fs.readFileSync(manifest.sqlitePath)).digest('hex')}));
  assert.equal((await post(s,`/backups/${id}/verify`)).status,400);
});

test('restore confirmation expires at five minutes and is bound to backup id and checksum',async t=>{
  const s=await fixture(t),id=s.backup.id;
  const verified=await post(s,`/backups/${id}/verify`);
  const now=Date.now;
  t.mock.method(Date,'now',()=>now()+300001);
  assert.equal((await post(s,`/backups/${id}/restore`,{confirmationToken:verified.data.confirmationToken,confirmText:'恢复'})).status,409);
  t.mock.restoreAll();
  const second=await post(s,'/backups'),v=await post(s,`/backups/${id}/verify`);
  assert.equal((await post(s,`/backups/${second.data.id}/restore`,{confirmationToken:v.data.confirmationToken,confirmText:'恢复'})).status,409);
  const manifestFile=path.join(s.config.backupsDir,`${id}.sqlite.json`),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  const dbFile=path.join(s.config.backupsDir,manifest.sqliteFile),db=new DatabaseSync(dbFile);
  db.prepare('UPDATE contents SET title=?').run('虚构已变更有效数据库');db.close();
  fs.writeFileSync(manifestFile,JSON.stringify({...manifest,sha256:createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex')}));
  assert.equal((await post(s,`/backups/${id}/restore`,{confirmationToken:v.data.confirmationToken,confirmText:'恢复'})).status,400);
  assert.equal((await s.call('/contents')).data.items[0].title,'纯虚构 FUV 结构测试作品');
});

test('source change during staging copy fails exact checksum before current handle is closed',async t=>{
  const s=await fixture(t),v=await post(s,`/backups/${s.backup.id}/verify`);
  await post(s,'/inspirations',{rawText:'虚构复制前原状'});
  const copy=fs.copyFileSync;
  t.mock.method(fs,'copyFileSync',(from,to,...args)=>{
    if(String(to).includes('.restore-')){
      const changed=new DatabaseSync(from);changed.prepare('UPDATE contents SET title=?').run('虚构竞争更新');changed.close();
    }
    return copy(from,to,...args);
  });
  const result=await post(s,`/backups/${s.backup.id}/restore`,{confirmationToken:v.data.confirmationToken,confirmText:'恢复'});
  assert.equal(result.status,500);
  assert.equal((await s.call('/inspirations')).data.items[0].rawText,'虚构复制前原状');
  assert.equal((await post(s,'/inspirations',{rawText:'仍能写入'})).status,201);
});

for(const failure of ['original','partial-family','promotion'])test(`restore reopens old handle after ${failure} rename failure`,async t=>{
  const s=await fixture(t),v=await post(s,`/backups/${s.backup.id}/verify`);
  await post(s,'/inspirations',{rawText:'虚构文件操作故障前数据'});
  const rename=fs.renameSync;let failed=false;
  t.mock.method(fs,'renameSync',(from,to)=>{
    if(!failed&&((failure==='original'&&from===s.config.dbPath)||(failure==='promotion'&&to===s.config.dbPath&&String(from).includes('.restore-'))||(failure==='partial-family'&&from===`${s.config.dbPath}-wal`))){failed=true;throw new Error('fictional rename failure');}
    const result=rename(from,to);
    if(failure==='partial-family'&&from===s.config.dbPath)fs.writeFileSync(`${s.config.dbPath}-wal`,Buffer.alloc(0));
    return result;
  });
  assert.equal((await post(s,`/backups/${s.backup.id}/restore`,{confirmationToken:v.data.confirmationToken,confirmText:'恢复'})).status,500);
  assert.equal(failed,true);
  assert.equal((await s.call('/inspirations')).data.items[0].rawText,'虚构文件操作故障前数据');
  assert.equal((await post(s,'/inspirations',{rawText:'虚构故障后写入'})).status,201);
});

test('future schema and migration checksum drift are rejected before confirmation',async t=>{
  for(const future of [true,false]){
    const s=await fixture(t),id=s.backup.id,file=path.join(s.config.backupsDir,`${id}.sqlite`),manifestFile=`${file}.json`;
    const db=new DatabaseSync(file);
    if(future)db.prepare('INSERT INTO schema_migrations VALUES (99,?,?,?)').run('future','unknown','2026-09-05T00:00:00Z');
    else db.prepare('UPDATE schema_migrations SET checksum=? WHERE version=1').run('unknown');
    db.close();
    const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
    fs.writeFileSync(manifestFile,JSON.stringify({...manifest,schemaVersion:future?99:4,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
    assert.equal((await post(s,`/backups/${id}/verify`)).status,400);
    assert.equal((await s.call('/health')).data.schemaVersion,4);
  }
});

test('external receipt persistence failure is covered by restore rollback',async t=>{
  const s=await fixture(t),v=await post(s,`/backups/${s.backup.id}/verify`);
  await post(s,'/inspirations',{rawText:'虚构日志失败前状态'});
  const write=fs.writeFileSync;
  t.mock.method(fs,'writeFileSync',(file,data,...args)=>{
    if(String(file).includes('/operations/')&&typeof data==='string'&&data.includes('"state":"complete"'))throw new Error('fictional receipt failure');
    return write(file,data,...args);
  });
  assert.equal((await post(s,`/backups/${s.backup.id}/restore`,{confirmationToken:v.data.confirmationToken,confirmText:'恢复'})).status,500);
  assert.equal((await s.call('/inspirations')).data.items[0]?.rawText,'虚构日志失败前状态');
});

test('failed native database initialization closes the allocated handle',async t=>{
  const s=await phase5Server(t),exec=DatabaseSync.prototype.exec;let failedHandle;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql.includes('PRAGMA journal_mode = WAL')){failedHandle=this;throw new Error('fictional pragma failure');}
    return exec.call(this,sql);
  });
  assert.throws(()=>openDatabase({dbPath:path.join(s.paths.projectRoot,'failed-open.sqlite')}),/fictional/);
  assert.equal(failedHandle.isOpen,false);
});

for(const cleanupFailure of [false,true])test(`double disk failure keeps API in maintenance even with cleanup failure=${cleanupFailure}`,async t=>{
  const s=await fixture(t),v=await post(s,`/backups/${s.backup.id}/verify`),rename=fs.renameSync;
  t.mock.method(fs,'renameSync',(from,to)=>{
    if(to===s.config.dbPath)throw new Error('fictional disk unavailable');
    return rename(from,to);
  });
  if(cleanupFailure){
    const unlink=fs.unlinkSync;
    t.mock.method(fs,'unlinkSync',file=>{if(String(file).includes('.restore-'))throw new Error('fictional cleanup unavailable');return unlink(file);});
  }
  assert.equal((await post(s,`/backups/${s.backup.id}/restore`,{confirmationToken:v.data.confirmationToken,confirmText:'恢复'})).status,500);
  assert.equal((await s.call('/health')).status,503);
  assert.equal((await post(s,'/inspirations',{rawText:'不应写入'})).status,503);
});
