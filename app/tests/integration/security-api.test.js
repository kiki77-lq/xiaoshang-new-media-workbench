import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { startTestServer } from "../helpers/test-server.js";

function rawRequest(url, requestPath) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request({
      host: target.hostname,
      port: target.port,
      method: "GET",
      path: requestPath
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("encoded path traversal cannot read files outside app", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const response = await rawRequest(baseUrl, "/%2e%2e/%2e%2e/etc/passwd");

  assert.equal(response.status, 403);
  assert.equal(response.body.includes("root:"), false);
});

test("malformed JSON returns a stable validation error", async (t) => {
  const { baseUrl, token } = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/v1/workbuddy/token/rotate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: "{not-json"
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_JSON");
});
