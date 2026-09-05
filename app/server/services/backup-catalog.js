import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { HttpError } from '../http/errors.js';
import { inspectMigrations,runMigrations,getSchemaVersion } from '../db/migrate.js';
import { verifyBackup } from './backup-service.js';

const invalid=()=>new HttpError(400,'BACKUP_INVALID','备份文件或清单无效，不能恢复。');
const safeId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{1,180}$/.test(id);
function regular(file) {const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw invalid();return stat;}
function safeDirectory(directory){const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw invalid();}
export function ownedManifest(config,id) {
  if(!safeId(id))throw invalid();
  try {
    safeDirectory(config.backupsDir);
    const manifestPath=path.join(config.backupsDir,`${id}.sqlite.json`);regular(manifestPath);
    const stored=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    if(stored.sqliteFile!==`${id}.sqlite`||!/^[a-f0-9]{64}$/.test(stored.sha256)||!Number.isInteger(stored.schemaVersion)
      ||typeof stored.appVersion!=='string'||typeof stored.reason!=='string'||!Number.isFinite(Date.parse(stored.createdAt)))throw invalid();
    const sqlitePath=path.join(config.backupsDir,stored.sqliteFile);regular(sqlitePath);
    return {...stored,manifestPath,sqlitePath};
  }catch(error){if(error.code==='ENOENT')throw new HttpError(404,'BACKUP_NOT_FOUND','备份不存在。');throw invalid();}
}

// Compare with this executable's own migrations, not a version number supplied by a manifest.
// The checks apply to disposable staged copies only; historical backups are never migrated in place.
export function validateCompatible(db,{migrate=false}={}) {
  const canonical=new DatabaseSync(':memory:');
  try {
    runMigrations(canonical);
    const version=getSchemaVersion(db),current=getSchemaVersion(canonical);
    if(version<1||version>current)throw invalid();
    const versions=db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r=>r.version);
    if(versions.length!==version||versions.some((v,i)=>v!==i+1))throw invalid();
    inspectMigrations(db);
    if(migrate)runMigrations(db);
    // Exact known schema after additive staging rules out missing tables, altered constraints and triggers.
    if(migrate||version===current){
      const objects=canonical.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all();
      const normalize=sql=>sql.replace(/\s+/g,' ').trim();
      for(const object of objects){
        const actual=db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get(object.type,object.name);
        if(!actual?.sql||normalize(actual.sql)!==normalize(object.sql))throw invalid();
      }
    }
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw invalid();
    return getSchemaVersion(db);
  }finally{canonical.close();}
}
export async function backupMetadata(manifest) {
  const verification=await verifyBackup(manifest);
  let restorable=false;
  if(verification.ok){
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-verify-'));
    let db;
    try{
      const staged=path.join(directory,'verify.sqlite');copyVerified(manifest,staged);
      db=new DatabaseSync(staged);validateCompatible(db,{migrate:true});restorable=true;
    }catch{/* incompatible stays visible, but cannot be restored */}
    finally{db?.close();fs.rmSync(directory,{recursive:true,force:true});}
  }
  return {id:manifest.sqliteFile.slice(0,-7),createdAt:manifest.createdAt,appVersion:manifest.appVersion,schemaVersion:manifest.schemaVersion,sizeBytes:fs.statSync(manifest.sqlitePath).size,sha256:manifest.sha256,integrity:verification.integrity,verified:verification.ok,restorable,reason:manifest.reason};
}
export async function listBackups(config) {
  const items=[],warnings=[];
  if(!fs.existsSync(config.backupsDir))return {items,warnings};
  safeDirectory(config.backupsDir);
  for(const name of fs.readdirSync(config.backupsDir).filter(n=>n.endsWith('.sqlite.json'))){
    try{items.push(await backupMetadata(ownedManifest(config,name.slice(0,-12))));}
    catch{warnings.push('已忽略无效或不安全的备份清单。');}
  }
  return {items:items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),warnings};
}
export function copyVerified(manifest,destination) {
  regular(manifest.sqlitePath);
  fs.copyFileSync(manifest.sqlitePath,destination,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination,0o600);
  if(createHash('sha256').update(fs.readFileSync(destination)).digest('hex')!==manifest.sha256)throw invalid();
}
