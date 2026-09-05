import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const prepared = new WeakMap();

function safePath(target, directory = false) {
  const stat=fs.lstatSync(target,{throwIfNoEntry:false});
  if(stat && (stat.isSymbolicLink() || (directory?!stat.isDirectory():!stat.isFile()) ||
    stat.uid!==process.getuid() || (!directory && stat.nlink!==1)))throw new Error('UNSAFE_DATA_LEASE');
}
function guard(dataDir,operationId) {
  const journalFile=path.join(dataDir,'local-runtime/update.json');
  safePath(journalFile);
  let journal;
  try{journal=fs.existsSync(journalFile)?JSON.parse(fs.readFileSync(journalFile,'utf8')):null;}
  catch{throw new Error('PENDING_UPDATE');}
  const pending=journal && !['complete','rolled-back'].includes(journal.state);
  if(pending && (!operationId || operationId!==journal.id))throw new Error('PENDING_UPDATE');
  if(operationId && (!pending || operationId!==journal.id))throw new Error('LEASE_OPERATION_INVALID');
  if(!operationId && fs.existsSync(path.join(dataDir,'local-runtime/installed.json')) &&
    !fs.existsSync(path.join(dataDir,'workbench.sqlite')))throw new Error('PREVIOUS_DATABASE_MISSING');
}

export function acquireDataLease({dataDir,operationId}={}) {
  safePath(dataDir,true);
  fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
  dataDir=fs.realpathSync(dataDir);
  const run=path.join(dataDir,'local-runtime');safePath(run,true);
  fs.mkdirSync(run,{recursive:true,mode:0o700});
  guard(dataDir,operationId);
  const file=path.join(run,'process-lease.sqlite');
  safePath(file);safePath(`${file}-journal`);safePath(`${file}-wal`);safePath(`${file}-shm`);
  let db;
  try {
    // A separate SQLite connection holds a kernel-managed file lock throughout
    // ownership. Never unlink this file: doing so could create a second inode.
    db=new DatabaseSync(file);fs.chmodSync(file,0o600);
    db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');
  } catch {
    try{db?.close();}catch{/* preserve the ownership failure */}
    throw new Error('DATA_IN_USE');
  }
  const lease={dataDir,release(){if(db){const held=db;db=null;held.close();}}};
  try{guard(dataDir,operationId);}catch(error){lease.release();throw error;}
  return lease;
}

export function bindPreparedLease(db,lease) {
  const state={lease,serverOwned:false};prepared.set(db,state);
  const close=db.close.bind(db);
  db.close=()=>{try{return close();}finally{if(!state.serverOwned)lease.release();}};
}
export function retainServerLease(db) {
  const state=prepared.get(db);
  if(state){state.serverOwned=true;return state.lease;}
}
