import assert from "node:assert/strict";
import test from "node:test";

import { startTestServer } from "../helpers/test-server.js";

async function request(baseUrl, path, { method = "GET", body, key } = {}) {
  const headers = { Accept: "application/json", Origin: baseUrl };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (key) headers["Idempotency-Key"] = key;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { response, payload: await response.json() };
}

test("Contents API creates, lists without publication duplication, filters, reads and updates", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const createdResult = await request(baseUrl, "/api/v1/contents", {
    method: "POST",
    key: "content-api-create",
    body: {
      title: "凯迪拉克 XT5",
      contentType: "commercial",
      status: "preparing",
      brand: "凯迪拉克",
      vehicleModel: "XT5",
      tags: ["商单"]
    }
  });
  assert.equal(createdResult.response.status, 201);
  const created = createdResult.payload.data;
  assert.equal(created.publications.length, 4);
  assert.deepEqual(created.publications.map(({ platformCode, status }) => [platformCode, status]), [
    ["douyin", "not_started"],
    ["wechat_channels", "not_started"],
    ["xiaohongshu", "not_started"],
    ["weibo", "not_started"]
  ]);

  const list = await request(baseUrl, "/api/v1/contents?contentType=commercial&status=preparing&search=XT5");
  assert.equal(list.payload.data.items.length, 1);
  assert.equal(list.payload.data.items[0].id, created.id);
  const read = await request(baseUrl, `/api/v1/contents/${created.id}`);
  assert.equal(read.payload.data.id, created.id);

  const updated = await request(baseUrl, `/api/v1/contents/${created.id}`, {
    method: "PATCH",
    body: { title: "凯迪拉克 XT5 拍摄中", status: "producing", version: 1 }
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.payload.data.status, "producing");
  assert.equal(updated.payload.data.version, 2);
  const stale = await request(baseUrl, `/api/v1/contents/${created.id}`, {
    method: "PATCH",
    body: { status: "ready", version: 1 }
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.error.code, "VERSION_CONFLICT");
});

test("Dashboard API returns real SQLite aggregates and explicit empty unsupported sections", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const empty = await request(baseUrl, "/api/v1/dashboard");
  assert.equal(empty.payload.data.monthContentCount, 0);
  assert.equal(empty.payload.data.producingCount, 0);
  assert.deepEqual(empty.payload.data.recentContents, []);
  assert.deepEqual(empty.payload.data.hotspotSummary, []);

  await request(baseUrl, "/api/v1/contents", {
    method: "POST", key: "dashboard-api-content", body: {
      title: "首页实时内容", contentType: "organic", status: "producing"
    }
  });
  const dashboard = await request(baseUrl, "/api/v1/dashboard");
  assert.equal(dashboard.payload.data.monthContentCount, 1);
  assert.equal(dashboard.payload.data.producingCount, 1);
  assert.equal(dashboard.payload.data.recentContents.length, 1);
  assert.equal(dashboard.payload.data.recentContents[0].publications.length, 4);
});

test("Contents API rejects unknown write properties instead of drifting from OpenAPI", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const result = await request(baseUrl, "/api/v1/contents", {
    method: "POST", key: "unknown-content-property", body: { title: "内容", contentType: "organic", invented: true }
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.payload.error.code, "VALIDATION_ERROR");
});
