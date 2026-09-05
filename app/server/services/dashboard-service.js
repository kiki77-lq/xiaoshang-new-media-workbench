import { listContents } from "../repositories/content-repository.js";

function monthBounds(now) {
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return [start.toISOString(), end.toISOString()];
}

export function getDashboard({ db, now = new Date().toISOString() }) {
  const [monthStart, monthEnd] = monthBounds(now);
  const monthContentCount = db.prepare(`SELECT count(*) AS count FROM contents WHERE created_at >= ? AND created_at < ?`)
    .get(monthStart, monthEnd).count;
  const producingCount = db.prepare(`SELECT count(*) AS count FROM contents WHERE status = 'producing'`).get().count;
  return {
    monthContentCount,
    producingCount,
    todayPublishCount: 0,
    needsAttentionCount: 0,
    platforms: db.prepare("SELECT code, display_name AS displayName, enabled FROM platform_channels ORDER BY CASE code WHEN 'douyin' THEN 1 WHEN 'wechat_channels' THEN 2 WHEN 'xiaohongshu' THEN 3 WHEN 'weibo' THEN 4 END")
      .all().map((row) => ({ ...row, enabled: Boolean(row.enabled) })),
    recentContents: listContents(db, { limit: 5 }),
    hotspotSummary: []
  };
}
