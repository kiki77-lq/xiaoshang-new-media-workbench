import { randomUUID } from "node:crypto";

export function normalizeTagName(value) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

function cleanTags(tags) {
  const seen = new Set();
  return tags.map((name) => name.trim().replace(/\s+/g, " ")).filter((name) => {
    if (!name) return false;
    const normalized = normalizeTagName(name);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function ensureTag(db, name, now) {
  const normalized = normalizeTagName(name);
  const existing = db.prepare("SELECT id, name FROM tags WHERE normalized_name = ?").get(normalized);
  if (existing) return existing;
  const tag = { id: randomUUID(), name, normalizedName: normalized };
  db.prepare(`INSERT INTO tags(id, name, normalized_name, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, 1)`)
    .run(tag.id, tag.name, tag.normalizedName, now, now);
  return tag;
}

function replaceTags(db, joinTable, ownerColumn, ownerId, tags, now) {
  db.prepare(`DELETE FROM ${joinTable} WHERE ${ownerColumn} = ?`).run(ownerId);
  for (const name of cleanTags(tags)) {
    const tag = ensureTag(db, name, now);
    db.prepare(`INSERT INTO ${joinTable}(${ownerColumn}, tag_id) VALUES (?, ?)`)
      .run(ownerId, tag.id);
  }
}

export function replaceInspirationTags(db, inspirationId, tags, now) {
  replaceTags(db, "inspiration_tags", "inspiration_id", inspirationId, tags, now);
}

export function replaceContentTags(db, contentId, tags, now) {
  replaceTags(db, "content_tags", "content_id", contentId, tags, now);
}

export function listInspirationTags(db, inspirationId) {
  return db.prepare(`SELECT t.name FROM tags t JOIN inspiration_tags it ON it.tag_id = t.id WHERE it.inspiration_id = ? ORDER BY t.created_at, t.name`)
    .all(inspirationId).map(({ name }) => name);
}

export function listContentTags(db, contentId) {
  return db.prepare(`SELECT t.name FROM tags t JOIN content_tags ct ON ct.tag_id = t.id WHERE ct.content_id = ? ORDER BY t.created_at, t.name`)
    .all(contentId).map(({ name }) => name);
}
