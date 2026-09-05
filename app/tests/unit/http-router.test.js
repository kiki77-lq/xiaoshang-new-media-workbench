import assert from "node:assert/strict";
import test from "node:test";

import { createRouter } from "../../server/http/router.js";

test("HTTP router extracts named path parameters without matching extra segments", async () => {
  const router = createRouter();
  let received;
  router.add("GET", "/api/v1/inspirations/:id", async (_req, _res, context) => {
    received = context.params;
  });

  assert.equal(await router.dispatch({ method: "GET" }, {}, {
    pathname: "/api/v1/inspirations/inspiration-1",
    requestId: "request-1"
  }), true);
  assert.deepEqual(received, { id: "inspiration-1" });
  assert.equal(await router.dispatch({ method: "GET" }, {}, {
    pathname: "/api/v1/inspirations/inspiration-1/extra",
    requestId: "request-2"
  }), false);
});
