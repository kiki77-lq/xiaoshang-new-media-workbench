import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { startTestServer } from "../helpers/test-server.js";

const ROTATE_PATH = "/api/v1/workbuddy/token/rotate";

function writeOptions(token, extra = {}) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(extra.headers || {})
    },
    body: extra.body ?? "{}"
  };
}

test("write authentication rejects missing and incorrect bearer tokens", async (t) => {
  const { baseUrl } = await startTestServer(t);

  const noToken = await fetch(`${baseUrl}${ROTATE_PATH}`, writeOptions(null));
  const wrongToken = await fetch(`${baseUrl}${ROTATE_PATH}`, writeOptions("wrong-token"));

  assert.equal(noToken.status, 401);
  assert.equal((await noToken.json()).error.code, "UNAUTHORIZED");
  assert.equal(wrongToken.status, 401);
  assert.equal((await wrongToken.json()).error.code, "UNAUTHORIZED");
});

test("cross-origin browser writes are rejected before cookie authentication", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const response = await fetch(`${baseUrl}${ROTATE_PATH}`, writeOptions(null, {
    headers: { origin: "https://evil.example", cookie: "session=untrusted" }
  }));

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "ORIGIN_FORBIDDEN");
});

test("valid bearer token rotates securely without returning the new token", async (t) => {
  const { baseUrl, config, paths, token } = await startTestServer(t);
  const response = await fetch(`${baseUrl}${ROTATE_PATH}`, writeOptions(token));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.rotated, true);
  assert.equal(JSON.stringify(body).includes(token), false);
  assert.equal("token" in body.data, false);

  const stored = JSON.parse(fs.readFileSync(path.join(paths.dataDir, "secrets.json"), "utf8"));
  assert.notEqual(stored.token, token);
  assert.equal(config.authToken, stored.token);
});

test("same-origin browser write succeeds without exposing a bearer token", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const response = await fetch(`${baseUrl}${ROTATE_PATH}`, writeOptions(null, {
    headers: { origin: baseUrl }
  }));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.rotated, true);
});

test("JSON body limit is enforced", async (t) => {
  const { baseUrl, token } = await startTestServer(t, { bodyLimitBytes: 64 });
  const response = await fetch(`${baseUrl}${ROTATE_PATH}`, writeOptions(token, {
    body: JSON.stringify({ value: "x".repeat(128) })
  }));

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "PAYLOAD_TOO_LARGE");
});
