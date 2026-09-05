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
  return {
    monthContentCount,
    producingCount,
    todayPublishCount: db.prepare(`SELECT count(*) count FROM schedule_events e JOIN content_publications p ON p.id=e.publication_id WHERE e.event_type='publish' AND e.status IN ('planned','confirmed') AND p.status='scheduled' AND e.starts_at>=? AND e.starts_at<?`).get(dayStart,dayEnd).count,
    needsAttentionCount: db.prepare(`SELECT count(*) count FROM schedule_events WHERE event_type='pending_confirmation' AND status IN ('planned','confirmed')`).get().count,
    platforms: db.prepare("SELECT code, display_name AS displayName, enabled FROM platform_channels ORDER BY CASE code WHEN 'douyin' THEN 1 WHEN 'wechat_channels' THEN 2 WHEN 'xiaohongshu' THEN 3 WHEN 'weibo' THEN 4 END")
      .all().map((row) => ({ ...row, enabled: Boolean(row.enabled) })),
    recentContents: listContents(db, { limit: 5 }),
    hotspotSummary: db.prepare("SELECT id,title,kind,heat_score heatScore,worth_reason worthReason FROM observations WHERE status='pending' ORDER BY heat_score DESC,discovered_at DESC LIMIT 5").all()
  };
}
