import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, createApiClient } from "../../assets/js/api/client.js";

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("API client reads health and meta through the shared versioned base URL", async () => {
  const requested = [];
  const api = createApiClient({
    fetchImpl: async (url, options) => {
      requested.push([url, options.method]);
      if (url.endsWith("/health")) {
        return jsonResponse(200, { data: { status: "ok", database: "ok" }, meta: { requestId: "health-1" } });
      }
      return jsonResponse(200, { data: { appVersion: "0.1.0", schemaVersion: 1 }, meta: { requestId: "meta-1" } });
    }
  });

  assert.deepEqual(await api.get("/health"), {
    data: { status: "ok", database: "ok" },
    requestId: "health-1"
  });
  assert.deepEqual(await api.get("/meta"), {
    data: { appVersion: "0.1.0", schemaVersion: 1 },
    requestId: "meta-1"
  });
  assert.deepEqual(requested, [["/api/v1/health", "GET"], ["/api/v1/meta", "GET"]]);
});

test("API client serializes write options consistently", async () => {
  const calls = [];
  const api = createApiClient({
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return jsonResponse(200, { data: { ok: true }, meta: { requestId: "write-1" } });
    }
  });

  await api.post("/inspirations", { rawText: "老板原话" }, { idempotencyKey: "message-123" });
  await api.patch("/contents/content-1", { title: "新标题" }, { version: 3 });
  await api.delete("/contents/content-1");

  assert.equal(calls[0][1].headers["Content-Type"], "application/json");
  assert.equal(calls[0][1].headers["Idempotency-Key"], "message-123");
  assert.equal(calls[0][1].body, JSON.stringify({ rawText: "老板原话" }));
  assert.equal(calls[1][1].body, JSON.stringify({ title: "新标题", version: 3 }));
  assert.equal(calls[2][1].method, "DELETE");
});

test("API client converts a standard error envelope into ApiError with requestId", async () => {
  const api = createApiClient({
    fetchImpl: async () => jsonResponse(409, {
      error: { code: "VERSION_CONFLICT", message: "Version is stale.", details: [] },
      requestId: "request-409"
    })
  });

  await assert.rejects(
    () => api.patch("/contents/content-1", { title: "冲突" }, { version: 3 }),
    (error) => error instanceof ApiError
      && error.status === 409
      && error.code === "VERSION_CONFLICT"
      && error.requestId === "request-409"
  );
});
