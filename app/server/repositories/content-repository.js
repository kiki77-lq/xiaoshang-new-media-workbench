import { listContentTags } from "./tag-repository.js";

const PLATFORM_ORDER = ["douyin", "wechat_channels", "xiaohongshu", "weibo"];

function publicationsFor(db, contentId) {
  const rows = db.prepare(`
    SELECT cp.*, pc.code AS platform_code, pc.display_name AS platform_name
    FROM content_publications cp
    JOIN platform_channels pc ON pc.id = cp.platform_id
    WHERE cp.content_id = ?
    ORDER BY CASE pc.code
      WHEN 'douyin' THEN 1 WHEN 'wechat_channels' THEN 2
      WHEN 'xiaohongshu' THEN 3 WHEN 'weibo' THEN 4 ELSE 9 END
  `).all(contentId);
  return rows.map((row) => ({
    id: row.id,
    platformCode: row.platform_code,
    platformName: row.platform_name,
    status: row.status,
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    platformContentId: row.platform_content_id,
    publishedUrl: row.published_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version
  }));
}

function mapRow(db, row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    contentType: row.content_type,
    status: row.status,
    brand: row.brand,
    vehicleModel: row.vehicle_model,
    summary: row.summary,
    notes: row.notes,
    tags: listContentTags(db, row.id),
    publications: publicationsFor(db, row.id),
    sourceInspirationIds: db.prepare("SELECT inspiration_id FROM content_inspirations WHERE content_id = ? ORDER BY inspiration_id")
      .all(row.id).map(({ inspiration_id }) => inspiration_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version
  };
}

export function insertContent(db, record) {
  db.prepare(`
    INSERT INTO contents(
      id, title, content_type, status, brand, vehicle_model, summary, notes,
      created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    record.id, record.title, record.contentType, record.status, record.brand,
    record.vehicleModel, record.summary, record.notes, record.createdAt, record.updatedAt
  );
}

export function insertDefaultPublications(db, contentId, now, idFactory) {
  const platforms = db.prepare(`SELECT id, code FROM platform_channels WHERE code IN ('douyin', 'wechat_channels', 'xiaohongshu', 'weibo') ORDER BY CASE code
    WHEN 'douyin' THEN 1 WHEN 'wechat_channels' THEN 2 WHEN 'xiaohongshu' THEN 3 WHEN 'weibo' THEN 4 ELSE 9 END`).all();
  if (platforms.length !== 4 || !PLATFORM_ORDER.every((code, index) => platforms[index]?.code === code)) {
    const error = new Error("PLATFORM_CHANNELS_INCOMPLETE");
    error.code = "PLATFORM_CHANNELS_INCOMPLETE";
    throw error;
  }
  const insert = db.prepare(`
    INSERT INTO content_publications(
      id, content_id, platform_id, status, created_at, updated_at, version
    ) VALUES (?, ?, ?, 'not_started', ?, ?, 1)
  `);
  for (const platform of platforms) insert.run(idFactory(), contentId, platform.id, now, now);
}

export function getContent(db, id) {
  return mapRow(db, db.prepare("SELECT * FROM contents WHERE id = ?").get(id));
}

export function listContents(db, { search, contentType, status, limit } = {}) {
  const conditions = [];
  const values = [];
  if (contentType) { conditions.push("c.content_type = ?"); values.push(contentType); }
  if (status) { conditions.push("c.status = ?"); values.push(status); }
  if (search) {
    conditions.push(`(c.title LIKE ? OR c.brand LIKE ? OR c.vehicle_model LIKE ? OR c.summary LIKE ? OR EXISTS (
      SELECT 1 FROM content_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.content_id = c.id AND t.name LIKE ?
    ))`);
    const like = `%${search}%`;
    values.push(like, like, like, like, like);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitSql = Number.isSafeInteger(limit) && limit > 0 ? `LIMIT ${limit}` : "";
  return db.prepare(`SELECT c.* FROM contents c ${where} ORDER BY c.created_at DESC, c.id DESC ${limitSql}`)
    .all(...values).map((row) => mapRow(db, row));
}

export function updateContentRecord(db, id, changes, now, expectedVersion) {
  const columns = [];
  const values = [];
  const mapping = {
    title: "title", contentType: "content_type", status: "status", brand: "brand",
    vehicleModel: "vehicle_model", summary: "summary", notes: "notes"
  };
  for (const [key, column] of Object.entries(mapping)) {
    if (!Object.hasOwn(changes, key)) continue;
    columns.push(`${column} = ?`);
    values.push(changes[key]);
  }
  columns.push("updated_at = ?", "version = version + 1");
  values.push(now, id, expectedVersion);
  return db.prepare(`UPDATE contents SET ${columns.join(", ")} WHERE id = ? AND version = ?`).run(...values);
}
