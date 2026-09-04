import assert from "node:assert/strict";
import test from "node:test";

import { startTestServer } from "../helpers/test-server.js";

test("success and error responses keep the public envelope contract", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const success = await (await fetch(`${baseUrl}/api/v1/meta`)).json();
  const failureResponse = await fetch(`${baseUrl}/api/v1/missing`);
  const failure = await failureResponse.json();

  assert.deepEqual(Object.keys(success).sort(), ["data", "meta"]);
  assert.equal(typeof success.meta.requestId, "string");
  assert.deepEqual(Object.keys(failure).sort(), ["error", "requestId"]);
  assert.deepEqual(Object.keys(failure.error).sort(), ["code", "details", "message"]);
});
