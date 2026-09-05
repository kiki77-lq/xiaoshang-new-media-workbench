import assert from 'node:assert/strict';
import { startTestServer } from './test-server.js';

export async function phase4Server(t) {
  const server = await startTestServer(t);
  const call = async (path, { method = 'GET', body, key, origin = server.baseUrl } = {}) => {
    const response = await fetch(`${server.baseUrl}/api/v1${path}`, {
      method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, ...(await response.json()) };
  };
  const created = await call('/contents', { method: 'POST', key: 'content', body: { title: 'Phase 4 XT5' } });
  assert.equal(created.status, 201);
  const content = created.data;
  const pubPath = (code = 'douyin') => `/contents/${content.id}/publications/${code}`;
  const current = async () => (await call(`/contents/${content.id}`)).data;
  const events = async () => {
    const result = await call('/calendar-events?from=2026-01-01T00:00:00Z&to=2027-02-01T00:00:00Z');
    assert.equal(result.status, 200);
    return result.data.items;
  };
  return { ...server, call, content, pubPath, current, events };
}
