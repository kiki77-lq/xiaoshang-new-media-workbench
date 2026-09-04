import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertDataIsolation } from "../../server/security/data-isolation.js";

test("all production database secret backup import and log paths stay outside Git", () => {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const result = assertDataIsolation({ projectRoot });

  assert.deepEqual(result.tracked, []);
  assert.deepEqual(result.ignored, [
    "data/workbench.sqlite",
    "data/workbench.sqlite-wal",
    "data/workbench.sqlite-shm",
    "data/secrets.json",
    "data/backups/example.sqlite",
    "data/imports/example.csv",
    "data/logs/server.log",
    "app/data/workbench.sqlite"
  ]);
});
