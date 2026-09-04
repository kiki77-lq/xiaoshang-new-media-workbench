import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import { openDatabase } from "../db/connection.js";
import { getSchemaVersion } from "../db/migrate.js";

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function inspectSqlite(sqlitePath) {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
    const hasMigrations = db.prepare(`
      SELECT count(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'schema_migrations'
    `).get().count === 1;
    const schemaVersion = hasMigrations
      ? db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version
      : 0;
    return { integrity, schemaVersion };
  } finally {
    db.close();
  }
}

function normalizeReason(reason) {
  if (typeof reason !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(reason)) {
    throw new Error("INVALID_BACKUP_REASON");
  }
  return reason;
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

function manifestWithPaths(stored, backupsDir, manifestPath) {
  return {
    ...stored,
    sqlitePath: path.join(backupsDir, stored.sqliteFile),
    manifestPath
  };
}

export async function createBackup({ db, dataDir, reason, appVersion }) {
  const safeReason = normalizeReason(reason);
  const backupsDir = path.join(dataDir, "backups");
  fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(backupsDir, 0o700);

  db.exec("PRAGMA wal_checkpoint(FULL)");
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, "-");
  const baseName = `${stamp}-${safeReason}-${randomUUID()}`;
  const sqliteFile = `${baseName}.sqlite`;
  const sqlitePath = path.join(backupsDir, sqliteFile);
  const manifestPath = `${sqlitePath}.json`;

  await backup(db, sqlitePath);
  fs.chmodSync(sqlitePath, 0o600);
  const inspected = inspectSqlite(sqlitePath);
  if (inspected.integrity !== "ok") throw new Error("BACKUP_INTEGRITY_FAILED");

  const stored = {
    reason: safeReason,
    appVersion,
    schemaVersion: getSchemaVersion(db),
    sha256: sha256(sqlitePath),
    createdAt,
    sqliteFile
  };
  writeJsonAtomic(manifestPath, stored);
  return manifestWithPaths(stored, backupsDir, manifestPath);
}

export async function verifyBackup(input) {
  let manifest = input;
  if (input.manifestPath && (!input.sha256 || !input.sqliteFile)) {
    manifest = {
      ...JSON.parse(fs.readFileSync(input.manifestPath, "utf8")),
      manifestPath: input.manifestPath,
      sqlitePath: input.sqlitePath
    };
  }
  const sqlitePath = manifest.sqlitePath || path.join(
    path.dirname(manifest.manifestPath),
    manifest.sqliteFile
  );

  if (!fs.existsSync(sqlitePath)) {
    return { ok: false, hashMatches: false, integrity: "missing", schemaVersion: null };
  }
  const hashMatches = sha256(sqlitePath) === manifest.sha256;
  if (!hashMatches) {
    return { ok: false, hashMatches: false, integrity: "not_checked", schemaVersion: null };
  }

  try {
    const inspected = inspectSqlite(sqlitePath);
    return {
      ok: inspected.integrity === "ok" && inspected.schemaVersion === manifest.schemaVersion,
      hashMatches: true,
      integrity: inspected.integrity,
      schemaVersion: inspected.schemaVersion
    };
  } catch {
    return { ok: false, hashMatches: true, integrity: "error", schemaVersion: null };
  }
}

function moveIfExists(source, destination) {
  if (fs.existsSync(source)) fs.renameSync(source, destination);
}

function moveDatabaseFamily(sourceBase, destinationBase) {
  moveIfExists(sourceBase, destinationBase);
  moveIfExists(`${sourceBase}-wal`, `${destinationBase}-wal`);
  moveIfExists(`${sourceBase}-shm`, `${destinationBase}-shm`);
}

export async function restoreBackup({
  db,
  dbPath,
  dataDir,
  manifest,
  appVersion,
  validateRestored = () => {}
}) {
  const verification = await verifyBackup(manifest);
  if (!verification.ok) throw new Error("BACKUP_VERIFICATION_FAILED");

  const preRestoreManifest = await createBackup({
    db,
    dataDir,
    reason: "pre-restore",
    appVersion
  });
  const suffix = randomUUID();
  const stagingPath = `${dbPath}.restore-${suffix}.tmp`;
  const rollbackPath = path.join(dataDir, "backups", `${suffix}-restore-rollback.sqlite`);
  const failedPath = path.join(dataDir, "backups", `${suffix}-failed-restored.sqlite`);

  fs.copyFileSync(manifest.sqlitePath, stagingPath);
  fs.chmodSync(stagingPath, 0o600);
  if (inspectSqlite(stagingPath).integrity !== "ok") {
    throw new Error("STAGED_RESTORE_INTEGRITY_FAILED");
  }

  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  let originalMoved = false;
  let restoredDb;
  try {
    moveDatabaseFamily(dbPath, rollbackPath);
    originalMoved = true;
    fs.renameSync(stagingPath, dbPath);
    restoredDb = openDatabase({ dbPath });
    if (restoredDb.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") {
      throw new Error("RESTORED_DATABASE_INTEGRITY_FAILED");
    }
    validateRestored(restoredDb);
    return {
      ok: true,
      db: restoredDb,
      preRestoreManifest,
      rollbackPath
    };
  } catch (error) {
    if (restoredDb) {
      restoredDb.close();
      restoredDb = null;
    }
    if (originalMoved) {
      moveDatabaseFamily(dbPath, failedPath);
      moveDatabaseFamily(rollbackPath, dbPath);
      const rollbackDb = openDatabase({ dbPath });
      try {
        if (rollbackDb.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") {
          throw new Error("ROLLBACK_DATABASE_INTEGRITY_FAILED");
        }
      } finally {
        rollbackDb.close();
      }
    }
    throw new Error(`RESTORE_FAILED_ROLLED_BACK: ${error.message}`, { cause: error });
  }
}
