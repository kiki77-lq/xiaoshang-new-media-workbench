import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

test("service worker always sends API GET requests directly to the network", async () => {
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const source = fs.readFileSync(path.join(appDir, "sw.js"), "utf8");
  const listeners = new Map();
  let cacheReads = 0;
  let networkReads = 0;
  const networkResponse = { clone: () => networkResponse };
  const context = {
    URL,
    Promise,
    self: {
      addEventListener: (name, handler) => listeners.set(name, handler),
      skipWaiting: () => {},
      clients: { claim: () => {} }
    },
    caches: {
      match: async () => { cacheReads += 1; return null; },
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      keys: async () => [],
      delete: async () => true
    },
    fetch: async () => { networkReads += 1; return networkResponse; }
  };
  vm.runInNewContext(source, context, { filename: "sw.js" });

  let responsePromise;
  listeners.get("fetch")({
    request: { method: "GET", url: "http://127.0.0.1:5173/api/v1/health" },
    respondWith: (promise) => { responsePromise = promise; }
  });
  const response = await responsePromise;

  assert.equal(response, networkResponse);
  assert.equal(networkReads, 1);
  assert.equal(cacheReads, 0);
});

test("service worker precache never contains an API URL", () => {
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const source = fs.readFileSync(path.join(appDir, "sw.js"), "utf8");
  const assetsMatch = source.match(/const ASSETS = \[([\s\S]*?)\];/);

  assert.ok(assetsMatch, "static asset list must exist");
  assert.doesNotMatch(assetsMatch[1], /["']\/api\//);
  assert.match(source, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(source, /fetch\(e\.request\)/);
});

test("PHASE 4 service worker upgrades the shell cache and removes previous shells", async () => {
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const source = fs.readFileSync(path.join(appDir, "sw.js"), "utf8");
  const listeners = new Map();
  const deleted = [];
  const context = {
    URL,
    Promise,
    self: {
      addEventListener: (name, handler) => listeners.set(name, handler),
      skipWaiting: () => {},
      clients: { claim: async () => {} }
    },
    caches: {
      keys: async () => ["xiaoshang-shell-v2", "xiaoshang-shell-v3", "xiaoshang-shell-v4"],
      delete: async (key) => { deleted.push(key); return true; },
      open: async () => ({ addAll: async () => {} }),
      match: async () => null
    },
    fetch: async () => ({ clone() { return this; } })
  };
  vm.runInNewContext(source, context, { filename: "sw.js" });
  let activation;
  listeners.get("activate")({ waitUntil: (promise) => { activation = promise; } });
  await activation;

  assert.deepEqual(deleted, ["xiaoshang-shell-v2", "xiaoshang-shell-v3"]);
});
