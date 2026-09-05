import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { openDatabase } from "../../server/db/connection.js";
import { runMigrations } from "../../server/db/migrate.js";
import { appendAuditLog } from "../../server/repositories/audit-repository.js";
import { loadOrCreateSecrets, rotateToken } from "../../server/security/secrets.js";
import { withIdempotency } from "../../server/services/idempotency-service.js";
import { assertVersion } from "../../server/services/optimistic-lock-service.js";
import { createTempWorkbench } from "../helpers/temp-workbench.js";

test("local token is generated once with owner-only permissions and rotates safely", (t) => {
  const paths = createTempWorkbench(t);

  const first = loadOrCreateSecrets({ dataDir: paths.dataDir });
  const second = loadOrCreateSecrets({ dataDir: paths.dataDir });
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(second.token, first.token);
  assert.equal(fs.statSync(path.join(paths.dataDir, "secrets.json")).mode & 0o777, 0o600);

  const rotated = rotateToken({ dataDir: paths.dataDir });
  assert.notEqual(rotated.token, first.token);
  assert.equal(loadOrCreateSecrets({ dataDir: paths.dataDir }).token, rotated.token);
});

test("same idempotency key replays one database write and one audit row", async (t) => {
  const paths = createTempWorkbench(t);
  const db = openDatabase({ dbPath: paths.dbPath });
  t.after(() => db.close());
  runMigrations(db);

  let executions = 0;
  const execute = () => {
    executions += 1;
    db.prepare("INSERT INTO app_settings(key, value_json, updated_at) VALUES (?, ?, ?)")
      .run("foundation-probe", JSON.stringify({ enabled: true }), "2026-09-04T00:00:00.000Z");
    appendAuditLog({
      db,
      actor: "workbuddy",
      action: "foundation.probe",
      entityType: "app_setting",
      entityId: "foundation-probe",
      requestId: "request-1",
      after: { enabled: true }
    });
    return { status: 201, body: { data: { id: "foundation-probe" }, meta: {} } };
  };

  const input = {
    db,
    key: "idem-1",
    method: "POST",
    path: "/api/v1/foundation-probe",
    requestBody: { enabled: true },
    execute
  };
  const first = await withIdempotency(input);
  const second = await withIdempotency(input);

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.deepEqual(second.body, first.body);
  assert.equal(executions, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM app_settings").get().count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM audit_log").get().count, 1);
});

test("idempotency key cannot be reused for a different request", async (t) => {
  const paths = createTempWorkbench(t);
  const db = openDatabase({ dbPath: paths.dbPath });
  t.after(() => db.close());
  runMigrations(db);

  await withIdempotency({
    db,
    key: "idem-reused",
    method: "POST",
    path: "/api/v1/foundation-probe",
    requestBody: { value: 1 },
    execute: () => ({ status: 201, body: { data: { value: 1 }, meta: {} } })
  });

  await assert.rejects(
    withIdempotency({
      db,
      key: "idem-reused",
      method: "POST",
      path: "/api/v1/foundation-probe",
      requestBody: { value: 2 },
      execute: () => ({ status: 201, body: { data: { value: 2 }, meta: {} } })
    }),
    (error) => error.status === 409 && error.code === "IDEMPOTENCY_KEY_REUSED"
  );
});

test("expired idempotency keys can be safely reused", async (t) => {
  const paths = createTempWorkbench(t);
  const db = openDatabase({ dbPath: paths.dbPath });
  t.after(() => db.close());
  runMigrations(db);
  let executions = 0;
  const base = {
    db,
    key: "expired-key",
    method: "POST",
    path: "/api/v1/foundation-probe",
    execute: () => ({ status: 201, body: { data: { execution: ++executions }, meta: {} } })
  };
  await withIdempotency({ ...base, requestBody: { value: 1 } });
  db.prepare("UPDATE idempotency_keys SET expires_at = '2000-01-01T00:00:00.000Z' WHERE key = ?").run(base.key);
  const reused = await withIdempotency({ ...base, requestBody: { value: 2 } });

  assert.equal(reused.replayed, false);
  assert.equal(reused.body.data.execution, 2);
  assert.equal(db.prepare("SELECT count(*) AS count FROM idempotency_keys WHERE key = ?").get(base.key).count, 1);
});

test("optimistic lock rejects stale versions with VERSION_CONFLICT", () => {
  assert.doesNotThrow(() => assertVersion({ expectedVersion: 3, actualVersion: 3 }));
  assert.throws(
    () => assertVersion({ expectedVersion: 2, actualVersion: 3 }),
    (error) => error.status === 409 && error.code === "VERSION_CONFLICT"
  );
});

test("audit log redacts tokens and authorization values", (t) => {
  const paths = createTempWorkbench(t);
  const db = openDatabase({ dbPath: paths.dbPath });
  t.after(() => db.close());
  runMigrations(db);

  appendAuditLog({
    db,
    actor: "workbuddy",
    action: "security.check",
    entityType: "system",
    entityId: null,
    requestId: "request-security",
    before: { token: "top-secret-token" },
    after: {
      title: "safe value",
      nested: { authorization: "Bearer another-secret", password: "hidden" }
    }
  });

  const row = db.prepare("SELECT before_json, after_json FROM audit_log").get();
  const serialized = `${row.before_json}${row.after_json}`;
  assert.equal(serialized.includes("top-secret-token"), false);
  assert.equal(serialized.includes("another-secret"), false);
  assert.equal(serialized.includes("hidden"), false);
  assert.equal(serialized.includes("safe value"), true);
  assert.equal(serialized.includes("[REDACTED]"), true);
});
