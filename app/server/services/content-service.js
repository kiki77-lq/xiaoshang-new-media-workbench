import { randomUUID } from "node:crypto";

import { inTransaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
import { appendAuditLog } from "../repositories/audit-repository.js";
import { getContent, insertContent, insertDefaultPublications, updateContentRecord } from "../repositories/content-repository.js";
import { replaceContentTags } from "../repositories/tag-repository.js";
import { withIdempotency } from "./idempotency-service.js";
import { assertVersion } from "./optimistic-lock-service.js";
import { assertObject, enumValue, expectedVersion, optionalString, requiredString, tagValues } from "./validation.js";

const CONTENT_TYPES = ["organic", "commercial"];
const CONTENT_STATUSES = ["preparing", "producing", "ready", "published"];

function validateContent(input, { partial = false } = {}) {
  assertObject(input, partial
    ? ["title", "contentType", "status", "brand", "vehicleModel", "summary", "notes", "tags", "version"]
    : ["title", "contentType", "status", "brand", "vehicleModel", "summary", "notes", "tags"]);
  const output = {};
  if (!partial || Object.hasOwn(input, "title")) output.title = requiredString(input.title, "title", 240);
  if (!partial || Object.hasOwn(input, "contentType")) output.contentType = enumValue(input.contentType, "contentType", CONTENT_TYPES, "organic");
  if (!partial || Object.hasOwn(input, "status")) output.status = enumValue(input.status, "status", CONTENT_STATUSES, "preparing");
  for (const [key, max] of [["brand", 120], ["vehicleModel", 120], ["summary", 5000], ["notes", 5000]]) {
    if (!partial || Object.hasOwn(input, key)) output[key] = optionalString(input[key], key, max);
  }
  if (!partial || Object.hasOwn(input, "tags")) output.tags = tagValues(input.tags);
  return output;
}

export function createContentRecord(input, context) {
  const values = validateContent(input);
  const now = context.now || new Date().toISOString();
  const record = { id: randomUUID(), ...values, createdAt: now, updatedAt: now };
  return inTransaction(context.db, () => {
    insertContent(context.db, record);
    insertDefaultPublications(context.db, record.id, now, randomUUID);
    replaceContentTags(context.db, record.id, values.tags, now);
    const created = getContent(context.db, record.id);
    appendAuditLog({
      db: context.db, actor: context.actor, action: "content.create", entityType: "content",
      entityId: record.id, requestId: context.requestId, after: created
    });
    return created;
  });
}

export async function createContent(input, context) {
  const outcome = await withIdempotency({
    db: context.db,
    key: context.idempotencyKey,
    method: "POST",
    path: "/api/v1/contents",
    requestBody: input,
    execute: () => ({ status: 201, body: { content: createContentRecord(input, context) } })
  });
  return { ...outcome.body.content, idempotencyReplayed: outcome.replayed };
}

export async function updateContent(id, input, context) {
  const values = validateContent(input, { partial: true });
  const version = expectedVersion(context.expectedVersion ?? input.version);
  const now = context.now || new Date().toISOString();
  return inTransaction(context.db, () => {
    const current = getContent(context.db, id);
    if (!current) throw new HttpError(404, "CONTENT_NOT_FOUND", "Content was not found.");
    assertVersion({ expectedVersion: version, actualVersion: current.version });
    const outcome = updateContentRecord(context.db, id, values, now, version);
    if (outcome.changes !== 1) throw new HttpError(409, "VERSION_CONFLICT", "The record changed before this update could be saved.");
    if (Object.hasOwn(values, "tags")) replaceContentTags(context.db, id, values.tags, now);
    const updated = getContent(context.db, id);
    appendAuditLog({
      db: context.db, actor: context.actor, action: "content.update", entityType: "content",
      entityId: id, requestId: context.requestId, before: current, after: updated
    });
    return updated;
  });
}
