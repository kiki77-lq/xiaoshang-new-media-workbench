import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { openDatabase } from "../../server/db/connection.js";
import { runMigrations } from "../../server/db/migrate.js";
import {
  createBackup,
  restoreBackup,
  verifyBackup
} from "../../server/services/backup-service.js";
import { createTempWorkbench } from "../helpers/temp-workbench.js";

function insertProbe(db, value) {
  db.prepare(`
    INSERT INTO app_settings(key, value_json, updated_at)
    VALUES ('backup-probe', ?, '2026-09-04T00:00:00.000Z')
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
  `).run(JSON.stringify({ value }));
}

function readProbe(db) {
  return JSON.parse(
    db.prepare("SELECT value_json FROM app_settings WHERE key = 'backup-probe'").get().value_json
  ).value;
}

test("consistent backup includes SHA-256 manifest and passes integrity check", async (t) => {
  const paths = createTempWorkbench(t);
  const db = openDatabase({ dbPath: paths.dbPath });
  t.after(() => db.close());
  runMigrations(db);
  insertProbe(db, "original");

  const manifest = await createBackup({
    db,
    dataDir: paths.dataDir,
    reason: "pre-update",
    appVersion: "0.1.0"
  });

  assert.equal(manifest.reason, "pre-update");
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
  assert.equal(fs.existsSync(manifest.sqlitePath), true);
  assert.equal(fs.existsSync(manifest.manifestPath), true);
  assert.deepEqual(await verifyBackup(manifest), {
    ok: true,
    hashMatches: true,
    integrity: "ok",
    schemaVersion: 1
  });
});

test("corrupted backup fails verification", async (t) => {
  const paths = createTempWorkbench(t);
  const db = openDatabase({ dbPath: paths.dbPath });
  t.after(() => db.close());
  runMigrations(db);
  const manifest = await createBackup({
    db,
    dataDir: paths.dataDir,
    reason: "manual",
    appVersion: "0.1.0"
  });
  const corruptPath = path.join(paths.dataDir, "backups", "corrupt.sqlite");
  fs.copyFileSync(manifest.sqlitePath, corruptPath);
  fs.appendFileSync(corruptPath, "corruption");

  const result = await verifyBackup({ ...manifest, sqlitePath: corruptPath });
  assert.equal(result.ok, false);
  assert.equal(result.hashMatches, false);
});

test("backup then modify then restore returns original fixture data", async (t) => {
  const paths = createTempWorkbench(t);
  const db = openDatabase({ dbPath: paths.dbPath });
  runMigrations(db);
  insertProbe(db, "original");
  const manifest = await createBackup({
    db,
    dataDir: paths.dataDir,
    reason: "manual",
    appVersion: "0.1.0"
  });
  insertProbe(db, "modified");

  const restored = await restoreBackup({
    db,
    dbPath: paths.dbPath,
    dataDir: paths.dataDir,
    manifest,
    appVersion: "0.1.0"
  });
  t.after(() => restored.db.close());

  assert.equal(restored.ok, true);
  assert.equal(restored.preRestoreManifest.reason, "pre-restore");
  assert.equal(readProbe(restored.db), "original");
});

test("post-replacement validation failure restores the pre-restore database", async (t) => {
  const paths = createTempWorkbench(t);
  const db = openDatabase({ dbPath: paths.dbPath });
  runMigrations(db);
  insertProbe(db, "backup-original");
  const manifest = await createBackup({
    db,
    dataDir: paths.dataDir,
    reason: "manual",
    appVersion: "0.1.0"
  });
  insertProbe(db, "state-before-failed-restore");

  await assert.rejects(
    restoreBackup({
      db,
      dbPath: paths.dbPath,
      dataDir: paths.dataDir,
      manifest,
      appVersion: "0.1.0",
      validateRestored: () => { throw new Error("SIMULATED_POST_RESTORE_FAILURE"); }
    }),
    /RESTORE_FAILED_ROLLED_BACK/
  );

  const reopened = openDatabase({ dbPath: paths.dbPath });
  t.after(() => reopened.close());
  assert.equal(readProbe(reopened), "state-before-failed-restore");
});
