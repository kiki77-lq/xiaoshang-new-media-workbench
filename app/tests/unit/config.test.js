import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../../server/config.js";

test("default database lives in project root data directory", () => {
  const projectRoot = path.resolve("/tmp/xiaoshang-workbench");
  const config = loadConfig({ projectRoot, env: {}, nodeVersion: "24.13.0" });

  assert.equal(config.dataDir, path.join(projectRoot, "data"));
  assert.equal(config.dbPath, path.join(projectRoot, "data", "workbench.sqlite"));
  assert.equal(config.secretsPath, path.join(projectRoot, "data", "secrets.json"));
  assert.equal(config.backupsDir, path.join(projectRoot, "data", "backups"));
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.bodyLimitBytes, 2 * 1024 * 1024);
});

test("database path cannot resolve inside app directory", () => {
  const projectRoot = path.resolve("/tmp/xiaoshang-workbench");

  assert.throws(
    () => loadConfig({
      projectRoot,
      env: { WORKBENCH_DATA_DIR: path.join(projectRoot, "app", "data") },
      nodeVersion: "24.13.0"
    }),
    /DATA_DIR_INSIDE_APP/
  );
});

test("runtime rejects unsupported Node major versions", () => {
  assert.throws(
    () => loadConfig({
      projectRoot: path.resolve("/tmp/xiaoshang-workbench"),
      env: {},
      nodeVersion: "22.14.0"
    }),
    /UNSUPPORTED_NODE_VERSION/
  );
});
