import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MIGRATION_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations"
);

function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

function listMigrations(migrationDir) {
  return fs.readdirSync(migrationDir)
    .map((fileName) => {
      const match = /^(\d{3})_([a-z0-9_-]+)\.sql$/i.exec(fileName);
      if (!match) return null;
      const sql = fs.readFileSync(path.join(migrationDir, fileName), "utf8");
      return {
        version: Number(match[1]),
        name: match[2],
        sql,
        checksum: checksum(sql)
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.version - right.version);
}

function hasMigrationTable(db) {
  return db.prepare(`
    SELECT count(*) AS count
    FROM sqlite_master
    WHERE type = 'table' AND name = 'schema_migrations'
  `).get().count === 1;
}

function rollbackQuietly(db) {
  try {
    db.exec("ROLLBACK");
  } catch {
    // The transaction may already have been rolled back by SQLite.
  }
}

export function getSchemaVersion(db) {
  if (!hasMigrationTable(db)) return 0;
  return db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get().version;
}

export function inspectMigrations(db, { migrationDir = DEFAULT_MIGRATION_DIR } = {}) {
  const migrations = listMigrations(migrationDir);
  const fromVersion = getSchemaVersion(db);
  const applied = hasMigrationTable(db)
    ? new Map(db.prepare("SELECT version, checksum FROM schema_migrations").all()
      .map((row) => [row.version, row.checksum]))
    : new Map();

  for (const migration of migrations) {
    if (applied.has(migration.version) && applied.get(migration.version) !== migration.checksum) {
      throw new Error(`MIGRATION_CHECKSUM_DRIFT: version ${migration.version}`);
    }
  }

  return { fromVersion, pending: migrations.filter(migration => !applied.has(migration.version)) };
}

export function runMigrations(db, options = {}) {
  const { fromVersion, pending } = inspectMigrations(db, options);
  const appliedVersions = [];
  for (const migration of pending) {

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare(`
        INSERT INTO schema_migrations(version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(
        migration.version,
        migration.name,
        migration.checksum,
        new Date().toISOString()
      );
      db.exec("COMMIT");
      appliedVersions.push(migration.version);
    } catch (error) {
      rollbackQuietly(db);
      throw new Error(`Migration ${migration.version} failed: ${error.message}`, { cause: error });
    }
  }

  return {
    fromVersion,
    toVersion: getSchemaVersion(db),
    appliedVersions
  };
}
