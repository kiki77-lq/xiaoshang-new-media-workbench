import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { localDelivery,git,command } from '../helpers/local-delivery.js';
import { launchDirect,rejectedDirect,until,post,backupGate } from '../helpers/process-lease.js';

const success=result=>assert.equal(result.code,0,result.output);

test('managed server excludes another port before secrets and migrations, while different data runs',async t=>{
  const f=await localDelivery(t);success(await f.script('install'));const token=f.read('secrets.json');
  fs.writeFileSync(path.join(f.repo,'app/server/db/migrations/005_lease_probe.sql'),'CREATE TABLE lease_probe (id TEXT);');
  await rejectedDirect(f);
  const db=new DatabaseSync(path.join(f.data,'workbench.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='lease_probe'").get().n,0);}finally{db.close();}
  assert.equal(f.read('secrets.json'),token);
  const other=await launchDirect(f,{data:path.join(f.root,'independent-data')});
  try{assert.equal(other.ready,true,other.output);assert.equal((await f.health()).schemaVersion,4);}finally{await other.stop();}
});

test('standalone prepare owns its data until DB close and blocks another real prepare process',async t=>{
  const f=await localDelivery(t);success(await f.script('install'));success(await f.cli('stop'));
  const holder=await launchDirect(f,{prepare:true});
  try{assert.equal(holder.ready,true,holder.output);await rejectedDirect(f,{prepare:true});await holder.closePrepared();}
  finally{await holder.stop();}
  const next=await launchDirect(f);try{assert.equal(next.ready,true,next.output);}finally{await next.stop();}
});

test('unmanaged direct server excludes managed installation on another port without being killed',async t=>{
  const f=await localDelivery(t);success(await f.script('install'));success(await f.cli('stop'));
  const direct=await launchDirect(f);
  try {
    assert.equal(direct.ready,true,direct.output);
    const result=await f.script('install');assert.notEqual(result.code,0,result.output);
    assert.equal((await fetch(`http://127.0.0.1:${direct.port}/api/v1/health`)).status,200);
  } finally {await direct.stop();}
  success(await f.cli('start'));
});

test('real restore DB close and rebind retain the service lease until shutdown',async t=>{
  const f=await localDelivery(t);success(await f.script('install'));await f.remember();
  const backup=await post(f,'/backups');await post(f,'/inspirations',{rawText:'TEMP post-backup'});
  const verified=await post(f,`/backups/${backup.id}/verify`);
  const restored=await post(f,`/backups/${backup.id}/restore`,{confirmationToken:verified.confirmationToken,confirmText:'恢复'});
  assert.equal(restored.restored,true);await rejectedDirect(f);
  success(await f.cli('stop'));
  const next=await launchDirect(f);try{assert.equal(next.ready,true,next.output);}finally{await next.stop();}
});

test('updater holds the stopped backup window and pending journal rejects direct starts',async t=>{
  const f=await localDelivery(t);
  f.release({'app/server/services/backup-service.js':backupGate(f)});git(f.repo,'pull','--ff-only');
  success(await f.script('install'));await f.remember();const next=f.release();
  const gate=path.join(f.root,'backup-release');
  const updating=f.script('update',{LEASE_BACKUP_GATE:gate});
  try {
    await until(()=>fs.existsSync(`${gate}.entered`));
    assert.equal(fs.existsSync(path.join(f.data,'local-runtime/service.json')),false);
    await rejectedDirect(f);
    const journal=JSON.parse(f.read('local-runtime/update.json'));
    // Even an operation-authorized preparer cannot enter while the updater
    // owns the kernel lease. This distinguishes ownership from journal checks.
    await rejectedDirect(f,{prepare:true,operationId:journal.id},/DATA_IN_USE/);
  } finally {fs.writeFileSync(gate,'release');success(await updating);}
  assert.equal((await f.health()).gitSha,next);
});

test('rollback DB replacement is leased and still resumes the old healthy service',async t=>{
  const f=await localDelivery(t);success(await f.script('install'));await f.remember();const old=await f.health();
  f.release({'app/server/db/migrations/005_partial.sql':'CREATE TABLE partial_lease_probe (id TEXT);','app/server/db/migrations/006_bad.sql':'INVALID SQL;'});
  const gate=path.join(f.root,'restore-release'),hook=path.join(f.root,'restore-hook.mjs');
  fs.writeFileSync(hook,`import fs from 'node:fs';
const copy=fs.copyFileSync;
fs.copyFileSync=function(source,target,...args){
  if(String(target).includes('local-runtime/restore-')){
    fs.writeFileSync(${JSON.stringify(gate+'.entered')},'entered');
    while(!fs.existsSync(${JSON.stringify(gate)}))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);
  }
  return copy.call(this,source,target,...args);
};`);
  const updating=f.script('update',{NODE_OPTIONS:`--import=${pathToFileURL(hook).href}`});
  let result;
  try {
    await until(()=>fs.existsSync(`${gate}.entered`));
    await rejectedDirect(f);
    const journal=JSON.parse(f.read('local-runtime/update.json'));
    await rejectedDirect(f,{prepare:true,operationId:journal.id},/DATA_IN_USE/);
  } finally {fs.writeFileSync(gate,'release');result=await updating;}
  assert.notEqual(result.code,0,result.output);assert.match(result.output,/ROLLED_BACK_HEALTHY/);
  assert.equal((await f.health()).gitSha,old.gitSha);assert.equal((await f.health()).schemaVersion,4);
});

test('OS releases a crashed process lease and migration failure releases its lease',async t=>{
  const f=await localDelivery(t);success(await f.script('install'));success(await f.cli('stop'));
  const first=await launchDirect(f);assert.equal(first.ready,true,first.output);await first.stop('SIGKILL');
  const second=await launchDirect(f);try{assert.equal(second.ready,true,second.output);}finally{await second.stop();}
  const bad=path.join(f.repo,'app/server/db/migrations/005_bad.sql');fs.writeFileSync(bad,'INVALID SQL;');
  const failed=await launchDirect(f);try{assert.equal(failed.ready,false);assert.notEqual(failed.code,0);}finally{await failed.stop();}
  fs.unlinkSync(bad);success(await f.cli('start'));
});

test('journal appearing immediately after native lease acquisition blocks initialization',async t=>{
  const f=await localDelivery(t),hook=path.join(f.root,'journal-hook.mjs');
  success(await command(f.repo,['npm','ci','--prefix','app','--ignore-scripts','--no-audit','--no-fund']));
  const journal=path.join(f.data,'local-runtime/update.json');
  fs.writeFileSync(hook,`import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';
const exec=DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);
 if(/BEGIN\\s+EXCLUSIVE/i.test(sql)){fs.writeFileSync(${JSON.stringify(journal)},JSON.stringify({id:'racing-update',state:'pending',phase:'stopping'}));}
 return result;};`);
  await rejectedDirect(f,{env:{NODE_OPTIONS:`--import=${pathToFileURL(hook).href}`}},/PENDING_UPDATE/);
  assert.equal(fs.existsSync(path.join(f.data,'secrets.json')),false);
  assert.equal(fs.existsSync(path.join(f.data,'workbench.sqlite')),false);
});

test('operation-authorized candidate refuses a missing protected DB instead of initializing an empty replacement',async t=>{
  const f=await localDelivery(t);success(await f.script('install'));await f.remember();success(await f.cli('stop'));
  const token=f.read('secrets.json');
  fs.renameSync(path.join(f.data,'workbench.sqlite'),path.join(f.data,'saved.sqlite'));
  fs.writeFileSync(path.join(f.data,'local-runtime/update.json'),JSON.stringify({id:'candidate-handoff',state:'pending',phase:'candidate'}));
  await rejectedDirect(f,{prepare:true,operationId:'candidate-handoff'},/PREVIOUS_DATABASE_MISSING/);
  assert.equal(fs.existsSync(path.join(f.data,'workbench.sqlite')),false);assert.equal(f.read('secrets.json'),token);
});
