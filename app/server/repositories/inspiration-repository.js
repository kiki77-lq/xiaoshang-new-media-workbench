import { listInspirationTags } from "./tag-repository.js";

function fallbackTitle(rawText) {
  return rawText.length > 48 ? `${rawText.slice(0, 48)}…` : rawText;
}

function mapRow(db, row) {
  if (!row) return null;
  return {
    id: row.id,
    rawText: row.raw_text,
    summaryTitle: row.summary_title,
    isFallbackTitle: Boolean(row.summary_title_is_fallback),
    brand: row.brand,
    vehicleModel: row.vehicle_model,
    sourceType: row.source_type,
    sourcePlatform: row.source_platform,
    sourceUrl: row.source_url,
    pinned: Boolean(row.pinned),
    status: row.status,
    convertedContentId: row.converted_content_id,
    tags: listInspirationTags(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version
  };
}

export function createFallbackTitle(rawText) {
  return fallbackTitle(rawText);
}

export function insertInspiration(db, record) {
  db.prepare(`
    INSERT INTO inspirations(
      id, raw_text, summary_title, brand, vehicle_model, source_type,
      source_platform, source_url, pinned, status, converted_content_id,
      created_at, updated_at, version, summary_title_is_fallback
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?)
  `).run(
    record.id, record.rawText, record.summaryTitle, record.brand, record.vehicleModel,
    record.sourceType, record.sourcePlatform, record.sourceUrl, record.pinned ? 1 : 0,
    record.status, record.createdAt, record.updatedAt, record.isFallbackTitle ? 1 : 0
  );
}

export function getInspiration(db, id) {
  return mapRow(db, db.prepare("SELECT * FROM inspirations WHERE id = ?").get(id));
}

export function listInspirations(db, { search, status, pinned } = {}) {
  const conditions = [];
  const values = [];
  if (status) { conditions.push("i.status = ?"); values.push(status); }
  if (pinned !== undefined) { conditions.push("i.pinned = ?"); values.push(pinned ? 1 : 0); }
  if (search) {
    conditions.push(`(
      i.raw_text LIKE ? OR i.summary_title LIKE ? OR i.brand LIKE ? OR i.vehicle_model LIKE ?
      OR i.source_platform LIKE ? OR EXISTS (
        SELECT 1 FROM inspiration_tags it JOIN tags t ON t.id = it.tag_id
        WHERE it.inspiration_id = i.id AND t.name LIKE ?
      )
    )`);
    const like = `%${search}%`;
    values.push(like, like, like, like, like, like);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return db.prepare(`SELECT i.* FROM inspirations i ${where} ORDER BY i.pinned DESC, i.created_at DESC, i.id DESC`)
    .all(...values).map((row) => mapRow(db, row));
}

export function updateInspirationRecord(db, id, changes, now, expectedVersion) {
  const columns = [];
  const values = [];
  const mapping = {
    summaryTitle: "summary_title", brand: "brand", vehicleModel: "vehicle_model",
    sourcePlatform: "source_platform", sourceUrl: "source_url", pinned: "pinned", status: "status"
  };
  for (const [key, column] of Object.entries(mapping)) {
    if (!Object.hasOwn(changes, key)) continue;
    columns.push(`${column} = ?`);
    values.push(key === "pinned" ? (changes[key] ? 1 : 0) : changes[key]);
  }
  if (Object.hasOwn(changes, "summaryTitle")) columns.push("summary_title_is_fallback = 0");
  columns.push("updated_at = ?", "version = version + 1");
  values.push(now, id, expectedVersion);
  return db.prepare(`UPDATE inspirations SET ${columns.join(", ")} WHERE id = ? AND version = ?`).run(...values);
}

export function markInspirationConverted(db, id, contentId, now) {
  db.prepare(`UPDATE inspirations SET status = 'converted', converted_content_id = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
    .run(contentId, now, id);
}
