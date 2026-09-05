import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestServer } from './test-server.js';

// All numbers and content here are fictional. Never use production reference values.
export async function phase5Server(t) {
  const server = await startTestServer(t);
  const call = async (path, { method = 'GET', body, key, authenticated = true } = {}) => {
    const response = await fetch(`${server.baseUrl}/api/v1${path}`, {
      method, headers: { ...(authenticated ? { Origin: server.baseUrl } : {}),
        'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, ...(await response.json()) };
  };
  const result = await call('/contents', { method: 'POST', key: randomUUID(),
    body: { title: '纯虚构 FUV 结构测试作品' } });
  assert.equal(result.status, 201);
  const input = (rows, overrides = {}) => ({
    sourceType: 'manual', sourceName: 'fictional-test', periodStart: '2026-09-01',
    periodEnd: '2026-09-30', rows, ...overrides
  });
  const ingest = (rows, overrides = {}, key = randomUUID()) =>
    call('/ingestion', { method: 'POST', key, body: input(rows, overrides) });
  const row = (metrics = { views: 123 }, extra = {}) => ({
    contentId: result.data.id, platformCode: 'douyin', ...metrics, ...extra
  });
  const review = async () => {
    const response = await call(`/contents/${result.data.id}/review`);
    assert.equal(response.status, 200);
    return response;
  };
  const overview = async () => {
    const response = await call('/analytics/overview?month=2026-09');
    assert.equal(response.status, 200);
    return response;
  };
  return { ...server, call, content: result.data, input, ingest, row, review, overview };
}
