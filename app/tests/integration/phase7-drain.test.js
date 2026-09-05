import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import sqlite from 'node:sqlite';

// Pause only the native backup boundary; exercise the actual HTTP, restore,
// database replacement and receipt implementations after the gate is released.
const gateSymbol=Symbol.for('workbench-test-native-backup-gate');
const hook=registerHooks({load(url,context,next){
  const loaded=next(url,context);
  if(url.endsWith('/server/services/backup-service.js'))return {...loaded,source:String(loaded.source).replace(
    'import { backup, DatabaseSync } from "node:sqlite";',
    'import { backup as nativeBackup, DatabaseSync } from "node:sqlite"; const backup=async(...args)=>{await globalThis[Symbol.for("workbench-test-native-backup-gate")]?.();return nativeBackup(...args);};')};
  return loaded;
}});
const {startTestServer}=await import('../helpers/test-server.js');
hook.deregister();

for(const timesOut of [false,true])test(`shutdown waits for disconnected restore through durable completion, timeout=${timesOut}`, {timeout:10000}, async t => {
  const s=await startTestServer(t);
  const post=async(route,body={})=>{
    const r=await fetch(`${s.baseUrl}/api/v1${route}`,{method:'POST',headers:{Origin:s.baseUrl,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(body)});
    assert.ok(r.ok);return (await r.json()).data;
  };
  await post('/inspirations',{rawText:'虚构备份内保留'});
  const backup=await post('/backups'),verified=await post(`/backups/${backup.id}/verify`);
  await post('/inspirations',{rawText:'虚构恢复后移除'});
  let enter,release;
  const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve);
  globalThis[gateSymbol]=async()=>{enter();await gate;};
  t.after(()=>{delete globalThis[gateSymbol];});
  const abort=new AbortController();
  const restore=fetch(`${s.baseUrl}/api/v1/backups/${backup.id}/restore`,{method:'POST',signal:abort.signal,
    headers:{Origin:s.baseUrl,'Content-Type':'application/json','Idempotency-Key':'fictional-disconnected-restore'},
    body:JSON.stringify({confirmationToken:verified.confirmationToken,confirmText:'恢复'})}).catch(()=>null);
  let draining,settled=false,drainError;
  try {
    await entered;abort.abort();await restore;
    draining=s.server.drain(timesOut?50:2000).then(()=>{settled=true;},error=>{drainError=error;});
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(settled,false,'closing the client socket must not release the restore job');
    assert.equal(s.server.database.isOpen,true,'database stays open until restore completes');
    if(timesOut){assert.equal(drainError?.message,'REQUEST_DRAIN_TIMEOUT');assert.equal((await fetch(`${s.baseUrl}/api/v1/health`)).status,503);}
  } finally {
    release();if(draining)await draining;
    if(timesOut)await s.server.drain(2000);
  }
  const db=new sqlite.DatabaseSync(s.config.dbPath,{readOnly:true});
  try {assert.equal(db.prepare('SELECT count(*) n FROM inspirations').get().n,1);} finally {db.close();}
  const receipts=fs.readdirSync(path.join(s.config.dataDir,'operations')).map(name=>JSON.parse(fs.readFileSync(path.join(s.config.dataDir,'operations',name),'utf8')));
  assert.ok(receipts.some(receipt=>receipt.state==='complete'&&receipt.result?.body?.restored===true));
});
