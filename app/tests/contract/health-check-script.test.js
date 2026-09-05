import assert from "node:assert/strict";
import test from "node:test";

import { checkHealth } from "../../../scripts/health-check.mjs";
import { startTestServer } from "../helpers/test-server.js";

test("health-check script validates a real running server", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const result = await checkHealth({ baseUrl });

  assert.equal(result.status, "ok");
  assert.equal(result.database, "ok");
  assert.equal(result.schemaVersion, 4);
});
