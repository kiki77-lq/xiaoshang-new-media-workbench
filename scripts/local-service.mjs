import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { acquireDataLease } from '../app/server/services/data-lease.js';
import { writeJson, readJson, owned, stop, launch, control, health, freePort } from './local-runtime.mjs';

const root=fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const inside=(parent,child)=>child===parent||child.startsWith(`${parent}${path.sep}`);
function checkTree(target) {
  if(!fs.existsSync(target) && !fs.lstatSync(target,{throwIfNoEntry:false}))return;
  const stat=fs.lstatSync(target);
  if(stat.isSymbolicLink() || (!stat.isFile()&&!stat.isDirectory()) || (stat.isFile()&&stat.nlink!==1) || stat.uid!==process.getuid())throw new Error('UNSAFE_DATA');
  if(stat.isDirectory())for(const name of fs.readdirSync(target))checkTree(path.join(target,name));
}
function context() {
  if(Number(process.versions.node.split('.')[0])!==24)throw new Error('NODE_24_REQUIRED');
  if(fs.realpathSync(git('rev-parse','--show-toplevel'))!==root)throw new Error('INVALID_REPOSITORY');
  const requested=path.resolve(process.env.WORKBENCH_DATA_DIR||path.join(root,'data'));
  // Canonicalize existing ancestors (macOS /var -> /private/var is normal),
  // but reject a symlink at the requested data directory or anywhere below it.
  let ancestor=path.dirname(requested), suffix=path.basename(requested);
  while(!fs.existsSync(ancestor)){suffix=path.join(path.basename(ancestor),suffix);ancestor=path.dirname(ancestor);}
  const data=path.join(fs.realpathSync(ancestor),suffix);
  if(inside(data,root)||data===fs.realpathSync(os.homedir())||inside(path.join(root,'app'),data)||inside(path.join(root,'.git'),data))throw new Error('UNSAFE_DATA');
  if(git('ls-files','--','data','app/data'))throw new Error('TRACKED_DATA');
  if(inside(root,data)) {
    const relative=path.relative(root,data);
    if(git('ls-files','--',relative))throw new Error('TRACKED_DATA');
    try{git('check-ignore','--',`${relative}/local-runtime/service.json`);}catch{throw new Error('DATA_NOT_IGNORED');}
  }
  checkTree(data);
  const port=Number(process.env.WORKBENCH_PORT||5173);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('INVALID_PORT');
  if(process.env.WORKBENCH_HOST && process.env.WORKBENCH_HOST!=='127.0.0.1')throw new Error('LOOPBACK_REQUIRED');
  const gitDir=fs.realpathSync(path.resolve(root,git('rev-parse','--git-common-dir')));
  const bindingFile=path.join(gitDir,'workbench-installation.json');
  const binding=readJson(bindingFile);
  if(binding && binding.data!==data)throw new Error('INSTALLATION_DATA_MISMATCH');
  fs.mkdirSync(data,{recursive:true,mode:0o700});fs.chmodSync(data,0o700);
  const run=path.join(data,'local-runtime');fs.mkdirSync(run,{mode:0o700,recursive:true});
  return {root,data,port,run,bindingFile,serviceFile:path.join(run,'service.json'),journalFile:path.join(run,'update.json'),dbPath:path.join(data,'workbench.sqlite'),locks:[path.join(gitDir,'workbench-operation.lock'),path.join(run,'command.lock')]};
}
function lock(ctx) {
  const held=[];
  try {
    for(const dir of ctx.locks){
      try{fs.mkdirSync(dir,{mode:0o700});}catch{throw new Error('OPERATION_LOCKED: inspect status; unlock only after the owner exits');}
      held.push(dir);writeJson(path.join(dir,'owner.json'),{pid:process.pid,nonce:randomUUID(),data:ctx.data});
    }
    return ()=>{for(const dir of held.reverse()){fs.unlinkSync(path.join(dir,'owner.json'));fs.rmdirSync(dir);}};
  } catch(error){
    for(const dir of held.reverse())try{fs.unlinkSync(path.join(dir,'owner.json'));fs.rmdirSync(dir);}catch{console.error('LOCK_CLEANUP_FAILED: retained lock requires inspection');}
    throw error;
  }
}
function noPending(ctx) {
  const journal=readJson(ctx.journalFile);
  if(journal && !['complete','rolled-back'].includes(journal.state))throw new Error(`PENDING_UPDATE: inspect ${ctx.journalFile}; use node scripts/local-service.mjs recover`);
  if(fs.existsSync(path.join(ctx.run,'installed.json'))&&!fs.existsSync(ctx.dbPath))throw new Error('PREVIOUS_DATABASE_MISSING');
}
async function dependencies() {
  await new Promise((resolve,reject)=>{
    const child=spawn('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:path.join(root,'app'),stdio:'ignore'});
    child.on('error',()=>reject(new Error('DEPENDENCY_INSTALL_FAILED')));
    child.on('close',code=>code===0?resolve():reject(new Error('DEPENDENCY_INSTALL_FAILED')));
  });
}
async function activate(ctx,record,sha) {
  await health(record,sha);await control(record,'activate');
  writeJson(path.join(ctx.run,'installed.json'),{gitSha:sha});
  return {state:'healthy',gitSha:sha,url:`http://127.0.0.1:${record.port}`};
}
async function install(ctx, npm=true) {
  noPending(ctx);
  if(!readJson(ctx.bindingFile))writeJson(ctx.bindingFile,{data:ctx.data,originHash:originHash()});
  const sha=git('rev-parse','HEAD'), existing=await owned(ctx);
  if(existing) {
    if(existing.gitSha!==sha)throw new Error('RUNNING_CODE_MISMATCH: stop the owned service then start the checked-out release');
    return activate(ctx,existing,sha);
  }
  await freePort(ctx.port);
  if(npm)await dependencies();
  const record=await launch(ctx,sha);
  try {return await activate(ctx,record,sha);}
  catch(error) {
    // Retain the original failure even if cleanup itself cannot drain. Stop
    // only the worker this invocation launched, using its private identity.
    try{await control(record,'stop');}catch{console.error('START_CLEANUP_FAILED: owned worker remains in maintenance; inspect status');}
    throw error;
  }
}
function cleanTracked() {
  if(git('status','--porcelain','--untracked-files=no'))throw new Error('DIRTY_TRACKED');
}
function originHash() {
  try {return createHash('sha256').update(git('remote','get-url','--all','origin')).digest('hex');}
  catch {return null;}
}
function upstream(ctx) {
  const branch=git('symbolic-ref','--short','HEAD');
  const remote=git('config',`branch.${branch}.remote`), merge=git('config',`branch.${branch}.merge`);
  if(remote!=='origin'||!merge.startsWith('refs/heads/'))throw new Error('OWN_ORIGIN_UPSTREAM_REQUIRED');
  const urls=git('remote','get-url','--all','origin').split('\n');
  if(urls.length!==1||!urls[0]||urls[0].includes('upstream-skill'))throw new Error('OWN_ORIGIN_UPSTREAM_REQUIRED');
  const pinned=readJson(ctx.bindingFile)?.originHash;
  if(!pinned || pinned!==originHash())throw new Error('ORIGIN_CHANGED');
  return {branch,remote,merge,ref:`refs/remotes/origin/${merge.slice(11)}`};
}
function candidateSafe(ctx,sha) {
  const files=git('ls-tree','-r','--name-only',sha).split('\n');
  const relative=inside(root,ctx.data)?path.relative(root,ctx.data):null;
  if(files.some(f=>f==='data'||f.startsWith('data/')||f.startsWith('app/data/')||(relative&&(f===relative||f.startsWith(`${relative}/`)))))throw new Error('TRACKED_DATA_IN_CANDIDATE');
  // Include ignored untracked files: git checkout may otherwise overwrite them.
  const user=git('ls-files','--others','-z').split('\0').filter(Boolean);
  if(user.some(u=>files.some(f=>f===u||f.startsWith(`${u}/`)||u.startsWith(`${f}/`))))throw new Error('UNTRACKED_COLLISION');
  candidateDataIgnored(ctx,sha);
}
function candidateDataIgnored(ctx,sha) {
  // Evaluate the candidate's exact ignore blobs with Git, without checking out
  // code or changing live ignore rules, the index, or the running installation.
  const probe=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-ignore-check-'));
  try {
    execFileSync('git',['init','--quiet','--template=',probe],{stdio:'ignore'});
    for(const entry of git('ls-tree','-r','-z',sha).split('\0').filter(Boolean)) {
      const tab=entry.indexOf('\t'),name=entry.slice(tab+1);
      if(path.posix.basename(name)!=='.gitignore')continue;
      const [mode,type,oid]=entry.slice(0,tab).split(' ');
      if(!['100644','100755'].includes(mode)||type!=='blob')throw new Error('CANDIDATE_DATA_NOT_IGNORED: unsafe ignore file');
      const target=path.join(probe,name);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,execFileSync('git',['cat-file','blob',oid],{cwd:root,stdio:['ignore','pipe','pipe']}));
    }
    const directories=new Set(['data','app/data']);
    if(inside(root,ctx.data))directories.add(path.relative(root,ctx.data));
    for(const directory of directories) {
      fs.mkdirSync(path.join(probe,directory),{recursive:true});
      const targets=['','workbench.sqlite','workbench.sqlite-wal','workbench.sqlite-shm','secrets.json',
        'backups','backups/protection.sqlite','backups/protection.sqlite.json',
        'operations','operations/receipt.json','imports','imports/source.csv','logs','logs/server.log',
        'local-runtime','local-runtime/service.json','local-runtime/update.json',
        'local-runtime/installed.json','local-runtime/command.lock/owner.json','local-runtime/events.log'];
      for(const suffix of targets) {
        const target=path.posix.join(directory,suffix);
        // One target per invocation: check-ignore succeeds when ANY argument
        // is ignored, which is insufficient for protecting the whole family.
        try{execFileSync('git',['-c','core.excludesFile=/dev/null','check-ignore','--quiet','--no-index','--',target],{cwd:probe,stdio:'ignore'});}
        catch{throw new Error(`CANDIDATE_DATA_NOT_IGNORED: ${target}`);}
      }
    }
  } finally {
    try{fs.rmSync(probe,{recursive:true,force:true});}catch{console.error('IGNORE_PROBE_CLEANUP_FAILED: retained isolated ignore-check directory');}
  }
}
async function backupApi() {
  return import(pathToFileURL(path.join(root,'app/server/services/backup-service.js')));
}
function holdDataLease(ctx,journal) {
  ctx.dataLease ||= acquireDataLease({dataDir:ctx.data,operationId:journal.id});
}
function releaseDataLease(ctx) {
  ctx.dataLease?.release();ctx.dataLease=null;
}
async function protection(ctx,api) {
  if(!fs.existsSync(ctx.dbPath))throw new Error('PREVIOUS_DATABASE_MISSING');
  const db=new DatabaseSync(ctx.dbPath);
  try {
    const manifest=await api.createBackup({db,dataDir:ctx.data,reason:'pre-update',appVersion:'0.1.0'});
    if(!(await api.verifyBackup(manifest)).ok)throw new Error('BACKUP_INVALID');
    return manifest;
  } finally {db.close();}
}
async function restore(ctx,journal,api) {
  const manifest=journal.backup;
  if(!manifest||path.dirname(manifest.sqlitePath)!==path.join(ctx.data,'backups')||!(await api.verifyBackup(manifest)).ok)throw new Error('ROLLBACK_BACKUP_INVALID');
  const stage=path.join(ctx.run,`restore-${randomUUID()}.sqlite`);
  fs.copyFileSync(manifest.sqlitePath,stage,fs.constants.COPYFILE_EXCL);
  if(!(await api.verifyBackup({...manifest,sqlitePath:stage})).ok)throw new Error('ROLLBACK_STAGE_INVALID');
  const db=new DatabaseSync(stage,{readOnly:true});
  try {if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('ROLLBACK_STAGE_INVALID');}finally{db.close();}
  const stageFd=fs.openSync(stage,'r');try{fs.fsyncSync(stageFd);}finally{fs.closeSync(stageFd);}
  journal.phase='restoring';writeJson(ctx.journalFile,journal);
  const quarantined=path.join(ctx.data,'backups',`${randomUUID()}-failed-update.sqlite`);
  for(const suffix of ['','-wal','-shm'])if(fs.existsSync(`${ctx.dbPath}${suffix}`))fs.renameSync(`${ctx.dbPath}${suffix}`,`${quarantined}${suffix}`);
  fs.renameSync(stage,ctx.dbPath);
  for(const dir of [ctx.data,path.join(ctx.data,'backups'),ctx.run]) {
    const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
}
async function rollback(ctx,journal,api) {
  // Pre-promotion candidates have admitted no business request. A promotion
  // crash is forward-only: never restore an older DB over possibly new writes.
  if(journal.phase==='promotion')throw new Error('PROMOTION_REQUIRES_FORWARD_RECOVERY');
  await stop(ctx);holdDataLease(ctx,journal);cleanTracked();
  const current=git('rev-parse','HEAD');
  if(current!==journal.oldSha){
    if(current!==journal.newSha)throw new Error('CODE_CHANGED_DURING_UPDATE');
    candidateSafe(ctx,journal.oldSha);
    git('switch','-c',`codex/rollback-${randomUUID()}`,journal.oldSha);
    git('branch','--set-upstream-to',journal.upstream.ref);
  }
  // Explicit recovery may be invoked from broken candidate code: import the
  // backup API only after checking out the old release. Automatic rollback
  // already holds the old module loaded before pulling.
  api ||= await backupApi();
  if(journal.backup)await restore(ctx,journal,api);
  if(!fs.existsSync(ctx.dbPath))throw new Error('PREVIOUS_DATABASE_MISSING');
  await dependencies();
  releaseDataLease(ctx);
  const record=await launch(ctx,journal.oldSha,journal.id);
  // Persist the recovery outcome before enabling writes; an interrupted
  // activation can then safely be retried without reapplying the backup.
  journal.state='rolled-back';journal.phase='done';writeJson(ctx.journalFile,journal);
  await activate(ctx,record,journal.oldSha);
  return {state:'rolled-back',gitSha:journal.oldSha,resume:'bash scripts/update-local.sh',journal:ctx.journalFile};
}
async function update(ctx) {
  noPending(ctx);cleanTracked();
  const oldSha=git('rev-parse','HEAD'), up=upstream(ctx);
  try{git('fetch','--no-tags','origin');}catch{throw new Error('FETCH_FAILED');}
  const newSha=git('rev-parse',up.ref);
  try{git('merge-base','--is-ancestor',oldSha,newSha);}catch{throw new Error('NOT_FAST_FORWARD');}
  if(git('diff','--name-only','--diff-filter=DMRT',oldSha,newSha,'--','app/server/db/migrations'))throw new Error('MIGRATIONS_IMMUTABLE');
  candidateSafe(ctx,newSha);
  const existing=await owned(ctx);
  if(existing && existing.gitSha!==oldSha)throw new Error('RUNNING_CODE_MISMATCH');
  if(newSha===oldSha)return install(ctx,false);
  const api=await backupApi(); // Keep the old release's recovery primitives loaded.
  const journal={id:randomUUID(),state:'pending',phase:'stopping',oldSha,newSha,upstream:up};
  writeJson(ctx.journalFile,journal);
  try {
    await stop(ctx);
    holdDataLease(ctx,journal);
    journal.phase='backup';writeJson(ctx.journalFile,journal);
    journal.backup=await protection(ctx,api);journal.phase='protected';writeJson(ctx.journalFile,journal);
    cleanTracked();candidateSafe(ctx,newSha);
    // Pull the verified immutable commit; a second network fetch must not
    // introduce uninspected files if origin advances during this operation.
    git('pull','--ff-only','--no-rebase','origin',newSha);
    if(git('rev-parse','HEAD')!==newSha)throw new Error('UPSTREAM_CHANGED_DURING_PULL');
    journal.phase='candidate';writeJson(ctx.journalFile,journal);
    await dependencies();
    releaseDataLease(ctx);
    const record=await launch(ctx,newSha,journal.id);
    await health(record,newSha);
    cleanTracked();
    if(git('rev-parse','HEAD')!==newSha)throw new Error('CODE_CHANGED_DURING_UPDATE');
    journal.phase='promotion';writeJson(ctx.journalFile,journal);
    const result=await activate(ctx,record,newSha);
    journal.state='complete';journal.phase='done';writeJson(ctx.journalFile,journal);
    return result;
  } catch(error) {
    if(journal.phase==='promotion')throw new Error(`PROMOTION_UNCERTAIN: inspect ${ctx.journalFile}; run recover (never restore old data)`);
    try {const result=await rollback(ctx,journal,api);throw Object.assign(new Error(`ROLLED_BACK_HEALTHY: ${JSON.stringify(result)}`),{restored:true});}
    catch(recoveryError) {
      if(recoveryError.restored)throw recoveryError;
      throw new Error(`ROLLBACK_INCOMPLETE: stopped or maintenance; inspect ${ctx.journalFile}; run status then recover`);
    }
  }
}
async function main() {
  const action=process.argv[2],ctx=context();
  if(action==='status'){
    const journal=readJson(ctx.journalFile), record=await owned(ctx);
    return {state:record?(await health(record,record.gitSha)).gated?'gated':'healthy':'stopped',gitSha:record?.gitSha,journal:journal?.state,phase:journal?.phase,resume:journal?.state==='rolled-back'?'bash scripts/update-local.sh':journal?.state==='pending'?'node scripts/local-service.mjs recover':undefined};
  }
  if(action==='unlock') {
    // A dead controller PID does not prove its npm/git subprocesses exited.
    // Never steal a stale command lock from another operation automatically.
    throw new Error(`LOCK_RECOVERY_REQUIRES_INSPECTION: verify the operation and its subprocesses exited before manually retiring exact lock directories: ${ctx.locks.join(', ')}; then status and recover`);
  }
  const release=lock(ctx);
  let primaryFailure;
  try {
    if(action==='install')return await install(ctx);
    if(action==='start')return await install(ctx,false);
    if(action==='stop'){await stop(ctx);return {state:'stopped'};}
    if(action==='update')return await update(ctx);
    if(action==='recover'){
      const journal=readJson(ctx.journalFile);
      if(!journal||['complete','rolled-back'].includes(journal.state))return await install(ctx,false);
      if(!/^[0-9a-f]{40}$/.test(journal.oldSha)||!journal.upstream)throw new Error('JOURNAL_INVALID_MANUAL_RECOVERY_REQUIRED');
      if(journal.phase==='promotion'){
        if(git('rev-parse','HEAD')!==journal.newSha)throw new Error('PROMOTION_CODE_MISMATCH');
        const record=await owned(ctx);
        if(!record)throw new Error('PROMOTION_SERVICE_MISSING_MANUAL_RECOVERY_REQUIRED');
        const result=await activate(ctx,record,journal.newSha);journal.state='complete';journal.phase='done';writeJson(ctx.journalFile,journal);return result;
      }
      return await rollback(ctx,journal);
    }
    throw new Error('USAGE: install | start | stop | status | update | recover');
  } catch(error){primaryFailure=error;throw error;}
  finally {
    try{releaseDataLease(ctx);}catch{console.error('LEASE_CLEANUP_FAILED: inspect data ownership');}
    try{release();}catch{
      if(!primaryFailure)throw new Error('LOCK_CLEANUP_FAILED: retained lock requires inspection');
      console.error('LOCK_CLEANUP_FAILED: retained lock requires inspection');
    }
  }
}
main().then(result=>console.log(JSON.stringify(result))).catch(error=>{
  // Git/npm output may contain credential URLs. Emit only our safe error codes.
  console.error(/^[A-Z][A-Z_]+(?::|$)/.test(error.message)?error.message:'LOCAL_OPERATION_FAILED');process.exitCode=1;
});
