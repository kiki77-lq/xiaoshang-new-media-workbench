import { randomUUID } from "node:crypto";

import { inTransaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
import { appendAuditLog } from "../repositories/audit-repository.js";
import { getContent } from "../repositories/content-repository.js";
import { createFallbackTitle, getInspiration, insertInspiration, markInspirationConverted, updateInspirationRecord } from "../repositories/inspiration-repository.js";
import { replaceInspirationTags } from "../repositories/tag-repository.js";
import { createContentRecord } from "./content-service.js";
import { withIdempotency } from "./idempotency-service.js";
import { assertVersion } from "./optimistic-lock-service.js";
import { assertObject, booleanValue, enumValue, expectedVersion, optionalString, optionalUrl, requiredString, tagValues } from "./validation.js";

const SOURCE_TYPES = ["wechat", "workbuddy", "manual", "hotspot", "other"];
const STATUSES = ["inbox", "organized", "converted", "archived"];

function validateCreate(input) {
  assertObject(input, ["rawText", "summaryTitle", "brand", "vehicleModel", "sourceType", "sourcePlatform", "sourceUrl", "pinned", "tags"]);
  const rawText = requiredString(input.rawText, "rawText", 5000);
  const suppliedTitle = optionalString(input.summaryTitle, "summaryTitle", 240);
  return {
    rawText,
    summaryTitle: suppliedTitle || createFallbackTitle(rawText),
    brand: optionalString(input.brand, "brand", 120),
    vehicleModel: optionalString(input.vehicleModel, "vehicleModel", 120),
    sourceType: enumValue(input.sourceType, "sourceType", SOURCE_TYPES, "manual"),
    sourcePlatform: optionalString(input.sourcePlatform, "sourcePlatform", 120),
    sourceUrl: optionalUrl(input.sourceUrl, "sourceUrl"),
    pinned: booleanValue(input.pinned, "pinned"),
    status: suppliedTitle ? "organized" : "inbox",
    isFallbackTitle: !suppliedTitle,
    tags: tagValues(input.tags)
  };
}

function validateUpdate(input) {
  assertObject(input, ["summaryTitle", "brand", "vehicleModel", "sourcePlatform", "sourceUrl", "pinned", "status", "tags", "version", "rawText"]);
  if (Object.hasOwn(input, "rawText")) {
    throw new HttpError(400, "INSPIRATION_RAW_TEXT_IMMUTABLE", "老板原始表达创建后不可修改。", [{ field: "rawText" }]);
  }
  const output = {};
  if (Object.hasOwn(input, "summaryTitle")) output.summaryTitle = requiredString(input.summaryTitle, "summaryTitle", 240);
  if (Object.hasOwn(input, "brand")) output.brand = optionalString(input.brand, "brand", 120);
  if (Object.hasOwn(input, "vehicleModel")) output.vehicleModel = optionalString(input.vehicleModel, "vehicleModel", 120);
  if (Object.hasOwn(input, "sourcePlatform")) output.sourcePlatform = optionalString(input.sourcePlatform, "sourcePlatform", 120);
  if (Object.hasOwn(input, "sourceUrl")) output.sourceUrl = optionalUrl(input.sourceUrl, "sourceUrl");
  if (Object.hasOwn(input, "pinned")) output.pinned = booleanValue(input.pinned, "pinned");
  if (Object.hasOwn(input, "status")) output.status = enumValue(input.status, "status", STATUSES);
  if (Object.hasOwn(input, "tags")) output.tags = tagValues(input.tags);
  if (output.summaryTitle && !Object.hasOwn(output, "status")) output.status = "organized";
  return output;
}

export async function createInspiration(input, context) {
  const outcome = await withIdempotency({
    db: context.db,
    key: context.idempotencyKey,
    method: "POST",
    path: "/api/v1/inspirations",
    requestBody: input,
    execute: () => {
      const values = validateCreate(input);
      const now = context.now || new Date().toISOString();
      const record = { id: randomUUID(), ...values, createdAt: now, updatedAt: now };
      return inTransaction(context.db, () => {
        insertInspiration(context.db, record);
        replaceInspirationTags(context.db, record.id, values.tags, now);
        const created = getInspiration(context.db, record.id);
        appendAuditLog({
          db: context.db, actor: context.actor, action: "inspiration.create", entityType: "inspiration",
          entityId: record.id, requestId: context.requestId, after: created
        });
        return { status: 201, body: { inspiration: created } };
      });
    }
  });
  return { ...outcome.body.inspiration, idempotencyReplayed: outcome.replayed };
}

export async function updateInspiration(id, input, context) {
  const values = validateUpdate(input);
  const version = expectedVersion(context.expectedVersion ?? input.version);
  const now = context.now || new Date().toISOString();
  return inTransaction(context.db, () => {
    const current = getInspiration(context.db, id);
    if (!current) throw new HttpError(404, "INSPIRATION_NOT_FOUND", "Inspiration was not found.");
    assertVersion({ expectedVersion: version, actualVersion: current.version });
    const outcome = updateInspirationRecord(context.db, id, values, now, version);
    if (outcome.changes !== 1) throw new HttpError(409, "VERSION_CONFLICT", "The record changed before this update could be saved.");
    if (Object.hasOwn(values, "tags")) replaceInspirationTags(context.db, id, values.tags, now);
    const updated = getInspiration(context.db, id);
    appendAuditLog({
      db: context.db, actor: context.actor, action: "inspiration.update", entityType: "inspiration",
      entityId: id, requestId: context.requestId, before: current, after: updated
    });
    return updated;
  });
}

export async function convertInspiration(id, input, context) {
  assertObject(input, ["title", "contentType", "status", "brand", "vehicleModel", "summary", "notes", "tags", "version"]);
  const path = `/api/v1/inspirations/${id}/convert`;
  const outcome = await withIdempotency({
    db: context.db,
    key: context.idempotencyKey,
    method: "POST",
    path,
    requestBody: input,
    execute: () => {
      const inspiration = getInspiration(context.db, id);
      if (!inspiration) throw new HttpError(404, "INSPIRATION_NOT_FOUND", "Inspiration was not found.");
      if (inspiration.convertedContentId) {
        return { status: 200, body: { result: {
          content: getContent(context.db, inspiration.convertedContentId),
          inspiration,
          alreadyConverted: true
        } } };
      }
      const version = expectedVersion(context.expectedVersion ?? input.version);
      assertVersion({ expectedVersion: version, actualVersion: inspiration.version });
      const content = createContentRecord({
        title: input.title || inspiration.summaryTitle,
        contentType: input.contentType,
        status: input.status || "preparing",
        brand: input.brand ?? inspiration.brand,
        vehicleModel: input.vehicleModel ?? inspiration.vehicleModel,
        summary: input.summary ?? inspiration.rawText,
        notes: input.notes,
        tags: input.tags ?? inspiration.tags
      }, context);
      const now = context.now || new Date().toISOString();
      context.db.prepare(`INSERT INTO content_inspirations(content_id, inspiration_id, relation_type) VALUES (?, ?, 'source')`)
        .run(content.id, inspiration.id);
      markInspirationConverted(context.db, inspiration.id, content.id, now);
      const converted = getInspiration(context.db, inspiration.id);
      appendAuditLog({
        db: context.db, actor: context.actor, action: "inspiration.convert", entityType: "inspiration",
        entityId: inspiration.id, requestId: context.requestId, before: inspiration, after: converted
      });
      return { status: 201, body: { result: { content: getContent(context.db, content.id), inspiration: converted, alreadyConverted: false } } };
    }
  });
  return { ...outcome.body.result, idempotencyReplayed: outcome.replayed };
}
