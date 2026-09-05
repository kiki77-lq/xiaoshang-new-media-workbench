import { HttpError } from '../http/errors.js';
import { latestSnapshots, snapshotMetrics, snapshotDetail, snapshotReview } from '../repositories/metric-repository.js';
import { METRIC_KEYS, dateOnly, invalid } from './metric-model.js';
import { PLATFORM_CODES } from './scheduling-rules.js';

export function analyticsMonth(month) {
  const selected = month ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric',
    month: '2-digit' }).format(new Date()).slice(0,7);
  if (typeof selected !== 'string' || !/^\d{4}-\d{2}$/.test(selected)) invalid('month must be YYYY-MM.');
  const periodStart = dateOnly(`${selected}-01`, 'month');
  const next = new Date(`${periodStart}T00:00:00.000Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const nextStart = next.toISOString().slice(0,10);
  const periodEnd = new Date(next.getTime() - 86400000).toISOString().slice(0,10);
  return { periodStart, periodEnd, from: new Date(`${periodStart}T00:00:00+08:00`).toISOString(),
    to: new Date(`${nextStart}T00:00:00+08:00`).toISOString() };
}
const warning = (warnings, message) => warnings.add(message);
const overlaps = (a, b) => a.period_start <= b.period_end && b.period_start <= a.period_end;
const days = row => (Date.parse(row.period_end) - Date.parse(row.period_start)) / 86400000 + 1;

function selectDisjoint(rows, warnings) {
  const selected = [];
  // Prefer the widest measured period, then newest capture, then latest import row.
  // Partial overlaps cannot be subtracted without daily observations.
  for (const row of [...rows].sort((a,b) => days(b) - days(a)
    || b.captured_at.localeCompare(a.captured_at) || b.sequence - a.sequence)) {
    if (selected.some(other => overlaps(row, other))) {
      warning(warnings, '存在重叠或累计周期：优先保留覆盖较宽的实测周期，排除重复部分，不按天摊分。');
    } else selected.push(row);
  }
  return selected;
}
function groups(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const id = key(row);
    if (!result.has(id)) result.set(id, []);
    result.get(id).push(row);
  }
  return [...result.values()];
}
function factual(row, key, warnings) {
  const value = row.metrics[key];
  if (value?.evidenceLevel === 'inferred') {
    warning(warnings, '推断指标（inferred）已从总览汇总与排行中排除，不能作为观测事实。');
    return null;
  }
  if (value) return value.value;
  if (key === 'net_followers') {
    const gained = row.metrics.followers_gained, lost = row.metrics.followers_lost;
    if (gained?.evidenceLevel === 'inferred' || lost?.evidenceLevel === 'inferred') {
      warning(warnings, '涨粉或掉粉属于推断数据（inferred），未参与净增粉丝计算。');
      return null;
    }
    if (gained && lost) return gained.value - lost.value;
  }
  return null;
}
function sumMetric(rows, key, warnings) {
  const values = rows.map(row => factual(row, key, warnings));
  if (!values.length || values.every(v => v === null)) return null;
  if (values.some(v => v === null)) warning(warnings, '部分记录缺少指标，显示的合计仅包含已知数据，不代表完整总量。');
  const total = values.reduce((sum,v) => sum + (v ?? 0), 0);
  if (Math.abs(total) > Number.MAX_SAFE_INTEGER) {
    warning(warnings, '合计超出可精确表示的数值范围，暂不显示该合计。');
    return null;
  }
  return total;
}
function fullCoverage(rows, dates) {
  const sorted = [...rows].sort((a,b) => a.period_start.localeCompare(b.period_start));
  let cursor = dates.periodStart;
  for (const row of sorted) {
    if (row.period_start !== cursor) return false;
    cursor = new Date(Date.parse(row.period_end) + 86400000).toISOString().slice(0,10);
  }
  return cursor > dates.periodEnd;
}
export function getOverview(db, month) {
  return getPeriodOverview(db, analyticsMonth(month));
}
export function getPeriodOverview(db, dates) {
  const warnings = new Set();
  const observed = latestSnapshots(db, dates);
  const inMonth = observed.filter(row => {
    if (row.period_start < dates.periodStart || row.period_end > dates.periodEnd) {
      warning(warnings, '跨月或跨报告周期观测已排除：无法将累计值准确拆分到所选周期。');
      return false;
    }
    return true;
  }).map(row => ({ ...row, metrics: snapshotMetrics(db, row.id) }));
  const chosen = [];
  const platforms = db.prepare('SELECT code,display_name FROM platform_channels ORDER BY rowid').all().map(platform => {
    const rows = inMonth.filter(row => row.platform_code === platform.code);
    const accounts = rows.filter(row => row.platform_id);
    const publications = rows.filter(row => row.publication_id);
    let selected;
    if (accounts.length) {
      selected = selectDisjoint(accounts, warnings);
      if (publications.length) warning(warnings, '平台汇总优先使用账户数据，不再叠加该平台的单作品数据。');
    } else {
      selected = groups(publications, r => r.publication_id).flatMap(group => selectDisjoint(group, warnings));
      if (selected.length) warning(warnings, '缺少账户数据的平台仅汇总已导入的单作品指标，可能不是平台完整总量。');
    }
    chosen.push(...selected);
    const values = { views: sumMetric(selected, 'views', warnings), likes: sumMetric(selected, 'likes', warnings),
      comments: sumMetric(selected, 'comments', warnings), netFollowers: sumMetric(selected, 'net_followers', warnings) };
    const complete = accounts.length > 0 && fullCoverage(selected, dates)
      && ['views','likes','comments','net_followers'].every(key => selected.every(row => factual(row,key,warnings) !== null));
    if (!complete) warning(warnings, `${platform.display_name}：周期覆盖不完整或有指标缺失，未知值保留为空。`);
    return { code: platform.code, name: platform.display_name, ...values, dataQuality: complete ? 'complete' : 'partial' };
  });
  const publicationRows = groups(inMonth.filter(r => r.publication_id), r => r.publication_id)
    .flatMap(group => selectDisjoint(group, warnings));
  const ranking = groups(publicationRows, r => r.content_id).map(rows => {
    const views = sumMetric(rows, 'views', warnings);
    return { contentId: rows[0].content_id, title: rows[0].title, views,
      ...(new Set(rows.map(r => r.platform_code)).size === 1 ? { platformCode: rows[0].platform_code } : {}) };
  }).filter(r => r.views !== null).sort((a,b) => b.views - a.views || a.contentId.localeCompare(b.contentId));
  const trends = {};
  for (const [field,key] of [['views','views'],['likes','likes'],['comments','comments'],['netFollowers','net_followers']]) {
    trends[field] = groups(chosen.filter(r => r.period_start === r.period_end), r => r.period_start)
      .map(rows => ({ label: rows[0].period_start, value: sumMetric(rows, key, warnings),
        evidenceLevel: 'derived',
        calculationNote: '汇总该日已选中的实测或计算指标；缺失数据不补零，净增粉丝可由同一快照的新增减流失计算。',
        evidence: rows.filter(row => factual(row,key,warnings) !== null).map(row => ({
          snapshotId: row.id, metricKey: key,
          inputMetricKeys: key === 'net_followers' && !row.metrics.net_followers ? ['followers_gained','followers_lost'] : [key]
        })) }))
      .filter(point => point.value !== null).sort((a,b) => a.label.localeCompare(b.label));
  }
  if (chosen.some(r => r.period_start !== r.period_end)) {
    warning(warnings, '趋势只展示已选中的单日观测；累计或多日数据不会生成虚构的每日曲线。');
  }
  const best = ranking[0];
  return { periodStart: dates.periodStart, periodEnd: dates.periodEnd,
    kpis: { views: sumMetric(chosen,'views',warnings), netFollowers: sumMetric(chosen,'net_followers',warnings),
      contentCount: db.prepare('SELECT count(*) n FROM contents WHERE created_at>=? AND created_at<?').get(dates.from,dates.to).n,
      bestContent: best ? { id: best.contentId, title: best.title, views: best.views } : null },
    platforms, ranking, trends,
    updatedAt: observed.length ? observed.map(r => r.completed_at).sort().at(-1) : null,
    dataQuality: platforms.every(p => p.dataQuality === 'complete') && warnings.size === 0 ? 'complete' : 'partial',
    warnings: [...warnings],
    calculationNote: '周期按上海日期计算，包含首尾两天。同对象、同周期取采集时间最新的快照，同一采集时间按导入顺序选最新记录。' +
      '优先选择较宽且互不重叠的测量周期，跨月记录不摊分。平台总量优先取账户数据，否则显示已知单作品小计。' +
      '仅汇总原始与计算指标，推断数据不进入合计；缺失值保留为空。净增粉丝优先使用显式指标，或用同一快照的新增减流失。' +
      '作品排行按作品汇总各平台指标。趋势只使用单日实测周期；本月内容数按上海时区的内容创建时间（created_at）统计。' };
}

export function getContentReview(db, contentId, platformCode) {
  const content = db.prepare('SELECT id,title FROM contents WHERE id=?').get(contentId);
  if (!content) throw new HttpError(404, 'CONTENT_NOT_FOUND', 'Content was not found.');
  if (platformCode !== undefined && !PLATFORM_CODES.includes(platformCode)) invalid('platformCode is invalid.');
  const rows = latestSnapshots(db, { contentId, platformCode });
  const snapshots = rows.map(row => snapshotDetail(db,row));
  const reviews = rows.map(row => snapshotReview(db,row.id)).filter(Boolean);
  const inferredMetrics = snapshots.some(s => [...Object.values(s.metrics),...s.series].some(v => v.evidenceLevel === 'inferred'));
  const inferred = inferredMetrics || reviews.some(r => r.findings.some(f => f.evidenceLevel === 'inferred'));
  const proxy = inferredMetrics || reviews.some(r => r.dataQuality === 'proxy_based');
  const complete = snapshots.length > 0 && snapshots.every(s => METRIC_KEYS.every(key => Object.hasOwn(s.metrics,key))
    && ['traffic_lifecycle','retention','engagement_timeline','traffic_source'].every(key => s.series.some(p => p.seriesKey === key)));
  const warnings = [];
  if (!complete) warnings.push('部分指标或序列尚未导入，缺失项不补零，也不生成虚构曲线。');
  if (inferred) warnings.push('推断结论（inferred）属于待验证判断，请与原始数据分开理解。');
  return { content, snapshots, reviews, updatedAt: rows.length ? rows.map(r => r.completed_at).sort().at(-1) : null,
    dataQuality: proxy ? 'proxy_based' : complete && reviews.every(r => r.dataQuality === 'complete') ? 'complete' : 'partial', warnings };
}
