import { escapeHtml, emptyState } from './dom.js';
import { shanghaiDate } from './format.js';

export const METRICS = Object.freeze({
  views: ['播放 / 阅读', 'count'], likes: ['点赞', 'count'], comments: ['评论', 'count'],
  shares: ['分享', 'count'], saves: ['收藏', 'count'], followers_total: ['粉丝总量', 'count'],
  followers_gained: ['新增粉丝', 'count'], followers_lost: ['流失粉丝', 'count'], net_followers: ['净增粉丝', 'count'],
  completion_rate: ['完播率', 'ratio'], two_second_bounce_rate: ['2 秒跳出率', 'ratio'],
  five_second_retention_rate: ['5 秒留存率', 'ratio'], average_watch_seconds: ['平均观看时长', 'seconds']
});
export const PLATFORMS = [['douyin','抖音'],['wechat_channels','视频号'],['xiaohongshu','小红书'],['weibo','微博']];
export const currentMonth = (now = new Date()) => shanghaiDate(now).slice(0, 7);
export function formatMetric(value, unit = 'count') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  const formatted = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(unit === 'ratio' ? number * 100 : number);
  return `${formatted}${unit === 'ratio' ? '%' : unit === 'seconds' ? ' 秒' : ''}`;
}
export function evidenceBadge(level) {
  const labels = { observed: '原始数据', derived: '计算结果', inferred: '推断 · 非事实' };
  const safe = Object.hasOwn(labels, level) ? level : 'unknown';
  return `<span class="evidence-badge evidence-${safe}">${labels[safe] || '证据未标注'}</span>`;
}
export function qualityLabel(quality) {
  return { complete:'完整', partial:'部分数据', proxy_based:'代理数据 · 非单作品事实', empty:'尚无数据' }[quality] || quality || '尚无数据';
}
export function evidenceDetails(item) {
  return `${item.calculationNote ? `<p class="evidence-note">口径：${escapeHtml(item.calculationNote)}</p>` : ''}${item.evidence ? `<details class="metric-evidence"><summary>查看证据</summary><pre>${escapeHtml(typeof item.evidence === 'string' ? item.evidence : JSON.stringify(item.evidence, null, 2))}</pre></details>` : ''}`;
}
export function renderSeries(points = [], title = '数据趋势', { bars = false } = {}) {
  const valid = points.filter(p => p.value !== null && p.value !== undefined && Number.isFinite(Number(p.value)));
  if (!valid.length) return emptyState('暂无序列数据', `${escapeHtml(title)}需要导入对应序列，不根据总量猜测曲线。`, '⌁');
  const values = valid.map(p => Number(p.value));
  const max = Math.max(...values, 0), min = Math.min(...values, 0), range = max - min || 1;
  const positions = valid.map((point,i) => typeof point.position === 'number' && Number.isFinite(point.position)
    ? point.position : /^\d{4}-\d{2}-\d{2}$/.test(point.label || '') ? Date.parse(point.label) : i);
  const start = Math.min(...positions), span = Math.max(...positions) - start || 1;
  const x = i => 25 + (positions[i] - start) * 550 / span;
  const y = v => 170 - (v - min) / range * 145;
  const level = p => ['observed','derived','inferred'].includes(p.evidenceLevel) ? p.evidenceLevel : 'unknown';
  const factual = p => ['observed','derived'].includes(level(p));
  const shape = bars
    ? valid.map((p,i) => `<rect data-point-evidence="${level(p)}" x="${15+i*570/valid.length}" y="${Math.min(y(Number(p.value)),y(0))}" width="${Math.max(1, 500/valid.length)}" height="${Math.max(1,Math.abs(y(Number(p.value))-y(0)))}" rx="3"/>`).join('')
    : valid.map((p,i)=>`${i>0 && factual(p) && factual(valid[i-1]) ? `<line class="evidence-line ${level(p)==='derived' || level(valid[i-1])==='derived'?'derived-line':''}" x1="${x(i-1)}" y1="${y(Number(valid[i-1].value))}" x2="${x(i)}" y2="${y(Number(p.value))}"/>` : ''}<circle data-point-evidence="${level(p)}" cx="${x(i)}" cy="${y(Number(p.value))}" r="${level(p)==='inferred'?6:3}"/>`).join('');
  const counts = [...new Set(valid.map(level))].map(e=>({level:e,count:valid.filter(p=>level(p)===e).length}));
  const inferred = valid.filter(p=>level(p)==='inferred');
  const legend = counts.map(e=>`${evidenceBadge(e.level)} <span>${e.count} 点</span>`).join(' ');
  return `<div class="metric-chart"><div class="chart-evidence-legend">${legend}</div>
    ${inferred.length ? `<p class="chart-inference-warning">紫色空心标记为推断 · 非事实，不连接为实测曲线：${inferred.map(p=>`${escapeHtml(p.label ?? p.position)}（${formatMetric(p.value,p.unit)}）`).join('、')}</p>` : ''}
    <svg viewBox="0 0 600 200" role="img" aria-label="${escapeHtml(title)}，${valid.length} 个已导入数据点；${inferred.length} 个推断非事实点，紫色空心且不连线；计算值使用虚线"><path class="chart-grid" d="M15 25H590 M15 97H590 M15 170H590"/>${shape}</svg>
    <div class="chart-axis"><span>${escapeHtml(valid[0].label ?? valid[0].position ?? '')}</span><span>${escapeHtml(valid.at(-1).label ?? valid.at(-1).position ?? '')}</span></div>
    <details class="series-table"><summary>查看 ${valid.length} 个数据点与证据</summary><table><thead><tr><th>位置</th><th>数值</th><th>证据</th></tr></thead><tbody>${valid.map(p=>`<tr><td>${escapeHtml(p.label ?? p.position ?? '')}</td><td>${formatMetric(p.value,p.unit)}</td><td>${evidenceBadge(p.evidenceLevel)}${evidenceDetails(p)}</td></tr>`).join('')}</tbody></table></details></div>`;
}
