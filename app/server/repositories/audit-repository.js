import { randomUUID } from "node:crypto";

const SENSITIVE_KEY = /token|authorization|cookie|password|secret/i;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(nested)
    ]));
  }
  return value;
}

function serialize(value) {
  return value === undefined || value === null ? null : JSON.stringify(redact(value));
}

export function appendAuditLog({
  db,
  actor,
  action,
  entityType,
  entityId = null,
  requestId,
  before = null,
  after = null,
  occurredAt = new Date().toISOString()
}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO audit_log(
      id, actor, action, entity_type, entity_id, request_id,
      before_json, after_json, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    actor,
    action,
    entityType,
    entityId,
    requestId,
    serialize(before),
    serialize(after),
    occurredAt
  );
  return id;
}
