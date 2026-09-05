import { createHash } from "node:crypto";

import { HttpError } from "../http/errors.js";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function requestHash(body) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(body ?? null)))
    .digest("hex");
}

function replay(row, method, path, hash) {
  if (row.method !== method || row.path !== path || row.request_hash !== hash) {
    throw new HttpError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "This Idempotency-Key was already used for a different request."
    );
  }
  return {
    status: row.response_status,
    body: JSON.parse(row.response_json),
    replayed: true
  };
}

function isActive(row, now = Date.now()) {
  const expiresAt = Date.parse(row.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export async function withIdempotency({
  db,
  key,
  method,
  path,
  requestBody,
  execute,
  ttlHours = 24
}) {
  if (typeof key !== "string" || key.length < 1 || key.length > 200) {
    throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key is required.");
  }

  const hash = requestHash(requestBody);
  const select = db.prepare("SELECT * FROM idempotency_keys WHERE key = ?");
  const existing = select.get(key);
  if (existing && isActive(existing)) return replay(existing, method, path, hash);

  db.exec("BEGIN IMMEDIATE");
  try {
    const raced = select.get(key);
    if (raced && isActive(raced)) {
      db.exec("COMMIT");
      return replay(raced, method, path, hash);
    }
    if (raced) db.prepare("DELETE FROM idempotency_keys WHERE key = ?").run(key);

    const outcome = execute();
    if (outcome && typeof outcome.then === "function") {
      throw new Error("IDEMPOTENCY_EXECUTE_MUST_BE_SYNCHRONOUS");
    }
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ttlHours * 60 * 60 * 1000);
    db.prepare(`
      INSERT INTO idempotency_keys(
        key, method, path, request_hash, response_status, response_json,
        created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      key,
      method,
      path,
      hash,
      outcome.status,
      JSON.stringify(outcome.body),
      createdAt.toISOString(),
      expiresAt.toISOString()
    );
    db.exec("COMMIT");
    return { ...outcome, replayed: false };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // SQLite may already have rolled back the transaction.
    }
    throw error;
  }
}
