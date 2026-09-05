import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../../server/db/connection.js";
import { runMigrations } from "../../server/db/migrate.js";
import { prepareWorkbench } from "../../server/index.js";
import { createTempWorkbench } from "../helpers/temp-workbench.js";

const EXPECTED_TABLES = [
  "app_settings",
  "audit_log",
  "content_inspirations",
  "content_publications",
  "content_tags",
  "contents",
  "idempotency_keys",
  "inspiration_tags",
  "inspirations",
  "observation_tags",
  "observations",
  "platform_channels",
  "schedule_events",
  "schema_migrations",
  "tags"
];

test("empty database migrates once through schema version 2", (t) => {
  const paths = createTempWorkbench(t);
  const db = openDatabase({ dbPath: paths.dbPath });
  t.after(() => db.close());

  const first = runMigrations(db);
  const actualTables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);

  assert.deepEqual(actualTables, EXPECTED_TABLES);
  assert.deepEqual(first, { fromVersion: 0, toVersion: 2, appliedVersions: [1, 2] });
  assert.deepEqual(
    db.prepare("SELECT code FROM platform_channels ORDER BY code").all().map((row) => row.code),
    ["douyin", "wechat_channels", "weibo", "xiaohongshu"]
  );

  assert.deepEqual(runMigrations(db), {
    fromVersion: 2,
    toVersion: 2,
    appliedVersions: []
  });
});

test("schema v1 upgrades additively to v2 and repeats safely", (t) => {
  const paths = createTempWorkbench(t);
  const v1Dir = path.join(paths.projectRoot, "v1-migrations");
  fs.mkdirSync(v1Dir);
  fs.copyFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/db/migrations/001_core.sql"),
    path.join(v1Dir, "001_core.sql")
  );
  const db = openDatabase({ dbPath: paths.dbPath });
  t.after(() => db.close());
  assert.equal(runMigrations(db, { migrationDir: v1Dir }).toVersion, 1);
  db.prepare(`INSERT INTO inspirations(id, raw_text, summary_title, source_type, pinned, status, created_at, updated_at, version)
    VALUES ('existing-v1', '旧原话', '旧标题', 'manual', 0, 'organized', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z', 1)`).run();

  assert.deepEqual(runMigrations(db), { fromVersion: 1, toVersion: 2, appliedVersions: [2] });
  assert.equal(db.prepare("SELECT summary_title_is_fallback FROM inspirations WHERE id = 'existing-v1'").get().summary_title_is_fallback, 0);
  assert.deepEqual(runMigrations(db), { fromVersion: 2, toVersion: 2, appliedVersions: [] });
});

test("database connection enables required safety pragmas", (t) => {
  const paths = createTempWorkbench(t);
  const db = openDatabase({ dbPath: paths.dbPath });
  t.after(() => db.close());

  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(db.prepare("PRAGMA busy_timeout").get().timeout, 5000);
  assert.equal(db.prepare("PRAGMA synchronous").get().synchronous, 2);
});

test("foreign keys and immutable inspiration raw text are enforced", (t) => {
  const paths = createTempWorkbench(t);
  const db = openDatabase({ dbPath: paths.dbPath });
  t.after(() => db.close());
  runMigrations(db);

  assert.throws(
    () => db.prepare(`
      INSERT INTO content_inspirations(content_id, inspiration_id, relation_type)
      VALUES ('missing-content', 'missing-inspiration', 'source')
    `).run(),
    /FOREIGN KEY constraint failed/
  );

  db.prepare(`
    INSERT INTO inspirations(
      id, raw_text, summary_title, source_type, pinned, status,
      created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, 0, 'inbox', ?, ?, 1)
  `).run("inspiration-1", "老板原话", "摘要", "manual", "2026-09-04T00:00:00.000Z", "2026-09-04T00:00:00.000Z");

  assert.throws(
    () => db.prepare("UPDATE inspirations SET raw_text = ? WHERE id = ?")
      .run("被修改", "inspiration-1"),
    /INSPIRATION_RAW_TEXT_IMMUTABLE/
  );
});

test("failed migration rolls back every statement", (t) => {
  const paths = createTempWorkbench(t);
  const migrationDir = path.join(paths.projectRoot, "migrations");
  fs.mkdirSync(migrationDir);
  fs.writeFileSync(path.join(migrationDir, "001_broken.sql"), `
    CREATE TABLE schema_migrations(
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE half_migrated(id TEXT PRIMARY KEY);
    THIS IS NOT SQL;
  `);
  const db = openDatabase({ dbPath: paths.dbPath });
  t.after(() => db.close());

  assert.throws(() => runMigrations(db, { migrationDir }), /migration 1 failed/i);
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'half_migrated'").get().count,
    0
  );
});

test("applied migration checksum drift is rejected", (t) => {
  const paths = createTempWorkbench(t);
  const migrationDir = path.join(paths.projectRoot, "migrations");
  fs.mkdirSync(migrationDir);
  const migrationPath = path.join(migrationDir, "001_test.sql");
  fs.writeFileSync(migrationPath, `
    CREATE TABLE schema_migrations(
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const db = openDatabase({ dbPath: paths.dbPath });
  t.after(() => db.close());
  runMigrations(db, { migrationDir });

  fs.appendFileSync(migrationPath, "\n-- changed after application\n");
  assert.throws(() => runMigrations(db, { migrationDir }), /MIGRATION_CHECKSUM_DRIFT/);
});

test("startup preparation stops before listening when migration fails", async (t) => {
  const paths = createTempWorkbench(t);
  const migrationDir = path.join(paths.projectRoot, "broken-startup-migrations");
  fs.mkdirSync(migrationDir);
  fs.writeFileSync(path.join(migrationDir, "001_broken.sql"), "THIS IS NOT SQL;");

  await assert.rejects(
    prepareWorkbench({
      projectRoot: paths.projectRoot,
      env: {
        WORKBENCH_DATA_DIR: paths.dataDir,
        WORKBENCH_GIT_SHA: "b".repeat(40)
      },
      migrationDir
    }),
    /Migration 1 failed/
  );
});
