import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from 'node:child_process';

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

test('secrets and SQLite sidecars are ignored at every depth without opening runtime data', () => {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const targets = ['secrets.json', 'nested/secrets.json', 'local.sqlite-wal', 'nested/local.sqlite-shm'];
  const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {cwd:projectRoot,input:targets.join('\n'),encoding:'utf8'});
  const ignored = result.stdout.trim().split('\n').filter(Boolean);
  assert.deepEqual(ignored, targets);
});
