import assert from "node:assert/strict";
import test from "node:test";

import { startTestServer } from "../helpers/test-server.js";

test("health and meta expose only non-sensitive runtime facts", async (t) => {
  const { baseUrl, token } = await startTestServer(t);

  const healthResponse = await fetch(`${baseUrl}/api/v1/health`);
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(health.data.status, "ok");
  assert.equal(health.data.database, "ok");
  assert.equal(health.data.schemaVersion, 3);
  assert.match(health.data.gitSha, /^[0-9a-f]{40}$/);
  assert.equal(typeof health.meta.requestId, "string");

  const metaResponse = await fetch(`${baseUrl}/api/v1/meta`);
  const meta = await metaResponse.json();
  assert.equal(metaResponse.status, 200);
  assert.deepEqual(meta.data, {
    appVersion: "0.1.0",
    schemaVersion: 3,
    gitSha: "a".repeat(40),
    upstreamSha: "d8f8e5b2d10c193d0ea0bf3581e41cc34490e55b"
  });
  assert.equal(JSON.stringify({ health, meta }).includes(token), false);
  assert.notEqual(healthResponse.headers.get("access-control-allow-origin"), "*");
});

test("unknown API paths use the standard error envelope", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/v1/does-not-exist`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.deepEqual(body.error, {
    code: "NOT_FOUND",
    message: "API route not found.",
    details: []
  });
  assert.equal(typeof body.requestId, "string");
});
