const SELECT = `SELECT e.*,pc.code AS platform_code,pc.display_name AS platform_name FROM schedule_events e
  LEFT JOIN content_publications cp ON cp.id=e.publication_id LEFT JOIN platform_channels pc ON pc.id=cp.platform_id`;
function map(row) {
  return row ? {id:row.id,contentId:row.content_id,publicationId:row.publication_id,eventType:row.event_type,
    status:row.status,title:row.title,startsAt:row.starts_at,endsAt:row.ends_at,notes:row.notes,
    createdAt:row.created_at,updatedAt:row.updated_at,version:row.version,
    platformCode:row.platform_code,platformName:row.platform_name} : null;
}
export function getCalendarEvent(db,id) { return map(db.prepare(`${SELECT} WHERE e.id=?`).get(id)); }
export function publicationEvents(db,id) { return db.prepare(`${SELECT} WHERE e.publication_id=? AND e.event_type='publish' AND e.status<>'cancelled' ORDER BY e.starts_at,e.id`).all(id).map(map); }
export function queryCalendarEvents(db,{from,to,eventType}) {
  return db.prepare(`${SELECT} WHERE e.starts_at>=? AND e.starts_at<? ${eventType?'AND e.event_type=?':''} ORDER BY e.starts_at,e.id`)
    .all(...[from,to,...(eventType?[eventType]:[])]).map(map);
}
export function insertCalendarEvent(db,e) {
  db.prepare(`INSERT INTO schedule_events(id,content_id,publication_id,event_type,status,title,starts_at,ends_at,notes,created_at,updated_at,version)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`).run(e.id,e.contentId,e.publicationId,e.eventType,e.status,e.title,e.startsAt,e.endsAt,e.notes,e.createdAt,e.updatedAt);
}
export function updateCalendarRecord(db,e,version) {
  return db.prepare('UPDATE schedule_events SET title=?,status=?,starts_at=?,ends_at=?,notes=?,updated_at=?,version=version+1 WHERE id=? AND version=?')
    .run(e.title,e.status,e.startsAt,e.endsAt,e.notes,e.updatedAt,e.id,version);
}
export function deleteCalendarRecord(db,id,version) { return db.prepare('DELETE FROM schedule_events WHERE id=? AND version=?').run(id,version); }
