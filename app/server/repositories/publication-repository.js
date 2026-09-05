const SELECT = `SELECT cp.*, pc.code AS platform_code, pc.display_name AS platform_name, c.title AS content_title
  FROM content_publications cp JOIN platform_channels pc ON pc.id=cp.platform_id JOIN contents c ON c.id=cp.content_id`;

function map(row) {
  return row ? {
    id:row.id, contentId:row.content_id, contentTitle:row.content_title,
    platformCode:row.platform_code, platformName:row.platform_name, status:row.status,
    scheduledAt:row.scheduled_at, publishedAt:row.published_at, publishedUrl:row.published_url,
    platformContentId:row.platform_content_id, version:row.version, createdAt:row.created_at, updatedAt:row.updated_at
  } : null;
}
export function getPublication(db, contentId, platformCode) { return map(db.prepare(`${SELECT} WHERE cp.content_id=? AND pc.code=?`).get(contentId,platformCode)); }
export function getPublicationById(db,id) { return map(db.prepare(`${SELECT} WHERE cp.id=?`).get(id)); }
export function updatePublicationRecord(db,record,expectedVersion) {
  return db.prepare(`UPDATE content_publications SET status=?,scheduled_at=?,published_at=?,published_url=?,platform_content_id=?,updated_at=?,version=version+1 WHERE id=? AND version=?`)
    .run(record.status,record.scheduledAt,record.publishedAt,record.publishedUrl,record.platformContentId,record.updatedAt,record.id,expectedVersion);
}
