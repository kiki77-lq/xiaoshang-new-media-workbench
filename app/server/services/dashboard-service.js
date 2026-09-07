import { listContents } from "../repositories/content-repository.js";
import { shanghaiMonthBounds, shanghaiDate, shanghaiInputToUtc, shiftDate } from '../../assets/js/shared/format.js';

export function getDashboard({ db, now = new Date().toISOString() }) {
  const [monthStart, monthEnd] = shanghaiMonthBounds(now);
  const today=shanghaiDate(now);
  const dayStart=shanghaiInputToUtc(`${today}T00:00`);
  const dayEnd=shanghaiInputToUtc(`${shiftDate(today,1)}T00:00`);
  const monthContentCount = db.prepare(`SELECT count(*) AS count FROM contents WHERE created_at >= ? AND created_at < ?`)
    .get(monthStart, monthEnd).count;
  const producingCount = db.prepare(`SELECT count(*) AS count FROM contents WHERE status = 'producing'`).get().count;
  const summarySelect = `SELECT o.id,o.title,o.kind,o.heat_score heatScore,o.worth_reason worthReason,o.ai_summary summary,
      o.competitor_name competitorName,o.source_platform sourcePlatform,o.source_url sourceUrl,o.discovered_at discoveredAt,
      (SELECT json_group_array(t.name) FROM (SELECT tt.name FROM tags tt JOIN observation_tags ott ON ott.tag_id = tt.id WHERE ott.observation_id = o.id ORDER BY tt.name) t) tags
    FROM observations o WHERE o.status='pending'`;
  const withTagArray = (rows) => rows.map((row) => ({ ...row, tags: JSON.parse(row.tags) }));
  return {
    monthContentCount,
    producingCount,
    todayPublishCount: db.prepare(`SELECT count(*) count FROM schedule_events e JOIN content_publications p ON p.id=e.publication_id WHERE e.event_type='publish' AND e.status IN ('planned','confirmed') AND p.status='scheduled' AND e.starts_at>=? AND e.starts_at<?`).get(dayStart,dayEnd).count,
    needsAttentionCount: db.prepare(`SELECT count(*) count FROM schedule_events WHERE event_type='pending_confirmation' AND status IN ('planned','confirmed')`).get().count,
    platforms: db.prepare("SELECT code, display_name AS displayName, enabled FROM platform_channels ORDER BY CASE code WHEN 'douyin' THEN 1 WHEN 'wechat_channels' THEN 2 WHEN 'xiaohongshu' THEN 3 WHEN 'weibo' THEN 4 END")
      .all().map((row) => ({ ...row, enabled: Boolean(row.enabled) })),
    recentContents: listContents(db, { limit: 5 }),
    hotspotSummary: withTagArray(db.prepare(`${summarySelect} AND o.kind='hotspot' ORDER BY o.heat_score DESC, o.discovered_at DESC LIMIT 3`).all()),
    competitorSummary: withTagArray(db.prepare(`${summarySelect} AND o.kind='competitor' ORDER BY o.discovered_at DESC LIMIT 3`).all())
  };
}
