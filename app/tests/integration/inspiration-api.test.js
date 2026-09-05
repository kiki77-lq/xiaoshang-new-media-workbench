import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { startTestServer } from "../helpers/test-server.js";

async function call(baseUrl, path, { method = "GET", body, key, origin = true, token } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (key) headers["Idempotency-Key"] = key;
  if (origin) headers.Origin = baseUrl;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

async function callWithHost(baseUrl, path, host) {
  const target = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "GET",
      headers: { Host: host, Accept: "application/json" }
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, payload: JSON.parse(body) }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("Inspirations API creates, persists, lists, searches, filters, reads and updates", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const createdResult = await call(baseUrl, "/api/v1/inspirations", {
    method: "POST",
    key: "api-inspiration-create",
    body: {
      rawText: "XT5那个可以从老美豪华车历史开始讲",
      summaryTitle: "凯迪拉克 XT5：美式豪华历史",
      brand: "凯迪拉克",
      vehicleModel: "XT5",
      sourceType: "manual",
      sourcePlatform: "线下沟通",
      tags: ["凯迪拉克", " 豪华车 "]
    }
  });
  assert.equal(createdResult.response.status, 201);
  const created = createdResult.payload.data;
  assert.equal(created.rawText, "XT5那个可以从老美豪华车历史开始讲");
  assert.equal(created.version, 1);

  const retry = await call(baseUrl, "/api/v1/inspirations", {
    method: "POST",
    key: "api-inspiration-create",
    body: {
      rawText: "XT5那个可以从老美豪华车历史开始讲",
      summaryTitle: "凯迪拉克 XT5：美式豪华历史",
      brand: "凯迪拉克",
      vehicleModel: "XT5",
      sourceType: "manual",
      sourcePlatform: "线下沟通",
      tags: ["凯迪拉克", " 豪华车 "]
    }
  });
  assert.equal(retry.response.status, 201);
  assert.equal(retry.payload.data.id, created.id);
  assert.equal(retry.payload.meta.idempotencyReplayed, true);

  const all = await call(baseUrl, "/api/v1/inspirations");
  assert.equal(all.payload.data.items.length, 1);
  const searched = await call(baseUrl, "/api/v1/inspirations?search=XT5");
  assert.equal(searched.payload.data.items.length, 1);
  const pinnedEmpty = await call(baseUrl, "/api/v1/inspirations?pinned=true");
  assert.equal(pinnedEmpty.payload.data.items.length, 0);
  const organized = await call(baseUrl, "/api/v1/inspirations?status=organized");
  assert.equal(organized.payload.data.items.length, 1);

  const read = await call(baseUrl, `/api/v1/inspirations/${created.id}`);
  assert.equal(read.response.status, 200);
  assert.deepEqual(read.payload.data.tags, ["凯迪拉克", "豪华车"]);

  const updated = await call(baseUrl, `/api/v1/inspirations/${created.id}`, {
    method: "PATCH",
    body: { pinned: true, summaryTitle: "人工更新标题", version: 1 }
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.payload.data.pinned, true);
  assert.equal(updated.payload.data.version, 2);
  const pinned = await call(baseUrl, "/api/v1/inspirations?pinned=true");
  assert.equal(pinned.payload.data.items.length, 1);
});

test("Inspirations API rejects unauthorized writes, rawText changes, stale versions and missing records", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const unauthorized = await call(baseUrl, "/api/v1/inspirations", {
    method: "POST",
    origin: false,
    key: "unauthorized-create",
    body: { rawText: "不应创建" }
  });
  assert.equal(unauthorized.response.status, 401);

  const invalid = await call(baseUrl, "/api/v1/inspirations", {
    method: "POST",
    key: "invalid-create",
    body: { rawText: "   " }
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.payload.error.code, "VALIDATION_ERROR");

  const created = (await call(baseUrl, "/api/v1/inspirations", {
    method: "POST",
    key: "immutable-create",
    body: { rawText: "老板原话" }
  })).payload.data;
  const immutable = await call(baseUrl, `/api/v1/inspirations/${created.id}`, {
    method: "PATCH",
    body: { rawText: "试图覆盖", version: 1 }
  });
  assert.equal(immutable.response.status, 400);
  assert.equal(immutable.payload.error.code, "INSPIRATION_RAW_TEXT_IMMUTABLE");

  await call(baseUrl, `/api/v1/inspirations/${created.id}`, {
    method: "PATCH",
    body: { summaryTitle: "第一次更新", version: 1 }
  });
  const stale = await call(baseUrl, `/api/v1/inspirations/${created.id}`, {
    method: "PATCH",
    body: { pinned: true, version: 1 }
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.error.code, "VERSION_CONFLICT");

  const missing = await call(baseUrl, "/api/v1/inspirations/missing");
  assert.equal(missing.response.status, 404);
  assert.equal(missing.payload.error.code, "INSPIRATION_NOT_FOUND");
});

test("business data rejects hostile Host headers and malformed write objects", async (t) => {
  const { baseUrl } = await startTestServer(t);
  const hostileHost = await callWithHost(baseUrl, "/api/v1/inspirations", "attacker.example");
  assert.equal(hostileHost.status, 403);
  assert.equal(hostileHost.payload.error.code, "HOST_FORBIDDEN");

  const nullBody = await call(baseUrl, "/api/v1/inspirations", {
    method: "POST", key: "null-inspiration", body: null
  });
  assert.equal(nullBody.response.status, 400);
  assert.equal(nullBody.payload.error.code, "VALIDATION_ERROR");

  const unknownField = await call(baseUrl, "/api/v1/inspirations", {
    method: "POST", key: "unknown-inspiration", body: { rawText: "原话", invented: true }
  });
  assert.equal(unknownField.response.status, 400);
  assert.equal(unknownField.payload.error.code, "VALIDATION_ERROR");
});

test("Inspiration conversion API is transactionally idempotent and business guarded", async (t) => {
  const { baseUrl, db } = await startTestServer(t);
  const inspiration = (await call(baseUrl, "/api/v1/inspirations", {
    method: "POST", key: "conversion-source", body: {
      rawText: "XT5那个可以从老美豪华车历史开始讲",
      summaryTitle: "凯迪拉克 XT5：美式豪华历史",
      brand: "凯迪拉克", vehicleModel: "XT5", tags: ["凯迪拉克"]
    }
  })).payload.data;
  const body = { title: "凯迪拉克 XT5", contentType: "commercial", version: inspiration.version };
  const first = await call(baseUrl, `/api/v1/inspirations/${inspiration.id}/convert`, {
    method: "POST", key: "conversion-once", body
  });
  const retry = await call(baseUrl, `/api/v1/inspirations/${inspiration.id}/convert`, {
    method: "POST", key: "conversion-once", body
  });
  const guarded = await call(baseUrl, `/api/v1/inspirations/${inspiration.id}/convert`, {
    method: "POST", key: "conversion-new-key", body: { ...body, version: 2 }
  });

  assert.equal(first.response.status, 201);
  assert.equal(retry.payload.data.content.id, first.payload.data.content.id);
  assert.equal(retry.payload.meta.idempotencyReplayed, true);
  assert.equal(guarded.response.status, 200);
  assert.equal(guarded.payload.data.alreadyConverted, true);
  assert.equal(guarded.payload.data.content.id, first.payload.data.content.id);
  assert.equal(db.prepare("SELECT count(*) AS count FROM contents").get().count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM content_publications").get().count, 4);
});
