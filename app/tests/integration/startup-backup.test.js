import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../server/db/connection.js';
import { runMigrations } from '../../server/db/migrate.js';
import { prepareWorkbench } from '../../server/index.js';
import { verifyBackup } from '../../server/services/backup-service.js';
import { createTempWorkbench } from '../helpers/temp-workbench.js';

for (const initialVersion of [0,1,2,3,4]) test(`startup schema v${initialVersion} verifies pre-migration backup only when pending`,async(t)=>{
  const p=createTempWorkbench(t);
  if(initialVersion) {
    const dir=path.join(p.projectRoot,'migrations'); fs.mkdirSync(dir);
    for (const name of ['001_core.sql','002_inspiration_title_origin.sql','003_metrics_reviews.sql','004_reports_settings.sql'].slice(0,initialVersion)) fs.copyFileSync(new URL(`../../server/db/migrations/${name}`,import.meta.url),path.join(dir,name));
    const db=openDatabase({dbPath:p.dbPath}); runMigrations(db,{migrationDir:dir}); db.close();
  }
  const options={projectRoot:p.projectRoot,env:{WORKBENCH_DATA_DIR:p.dataDir,WORKBENCH_GIT_SHA:'b'.repeat(40)}};
  const ready=await prepareWorkbench(options); ready.db.close();
  const dir=path.join(p.dataDir,'backups');
  const manifests=fs.readdirSync(dir).filter(n=>n.endsWith('.json'));
  assert.equal(manifests.length,initialVersion<4?1:0);
  if(initialVersion<4) {
    const manifestPath=path.join(dir,manifests[0]);
    const manifest={...JSON.parse(fs.readFileSync(manifestPath,'utf8')),manifestPath};
    assert.equal(manifest.reason,'pre-migration');
    assert.equal(manifest.schemaVersion,initialVersion);
    assert.equal((await verifyBackup(manifest)).ok,true);
    const backup=new DatabaseSync(path.join(dir,manifest.sqliteFile),{readOnly:true});
    assert.equal(backup.prepare("SELECT count(*) n FROM sqlite_master WHERE name='inspirations'").get().n,initialVersion?1:0);
    backup.close();
  }
  const repeat=await prepareWorkbench(options);repeat.db.close();
  assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.json')).length,manifests.length);
});

test('a failed pending migration leaves a verified backup of the previous schema and no partial table',async(t)=>{
  const p=createTempWorkbench(t);
  const dir=path.join(p.projectRoot,'migrations');fs.mkdirSync(dir);
  fs.copyFileSync(new URL('../../server/db/migrations/001_core.sql',import.meta.url),path.join(dir,'001_core.sql'));
  const db=openDatabase({dbPath:p.dbPath});runMigrations(db,{migrationDir:dir});db.close();
  fs.writeFileSync(path.join(dir,'002_broken.sql'),'CREATE TABLE half_done(id TEXT); THIS IS INVALID;');
  await assert.rejects(prepareWorkbench({projectRoot:p.projectRoot,migrationDir:dir,env:{WORKBENCH_DATA_DIR:p.dataDir,WORKBENCH_GIT_SHA:'b'.repeat(40)}}),/Migration 2 failed/);
  const backups=path.join(p.dataDir,'backups');const name=fs.readdirSync(backups).find(n=>n.endsWith('.json'));
  assert.ok(name);
  const manifestPath=path.join(backups,name);const manifest={...JSON.parse(fs.readFileSync(manifestPath,'utf8')),manifestPath};
  assert.equal(manifest.schemaVersion,1);assert.equal((await verifyBackup(manifest)).ok,true);
  const check=openDatabase({dbPath:p.dbPath});
  try {assert.equal(check.prepare("SELECT count(*) n FROM sqlite_master WHERE name='half_done'").get().n,0);assert.equal(check.prepare('SELECT max(version) n FROM schema_migrations').get().n,1);}finally{check.close();}
});
