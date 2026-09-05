import { escapeHtml, emptyState } from '../shared/dom.js';
import { displayShanghai } from '../shared/format.js';
import { METRICS, evidenceBadge, evidenceDetails, formatMetric, qualityLabel, renderSeries } from '../shared/metrics.js';

export function renderContentReview(data, snapshotId) {
  if (!data) return emptyState('请选择一条作品', '从上方选择，或在内容库点击“作品复盘”。', '▤');
  const snapshots = data.snapshots || [];
  const snapshot = snapshots.find(s => s.id === snapshotId) || snapshots[0];
  const reviews = (data.reviews || []).filter(r => !snapshot || (r.periodStart === snapshot.periodStart && r.periodEnd === snapshot.periodEnd && (!r.platformCode || r.platformCode === snapshot.platformCode)));
  const seriesTitles = { traffic_lifecycle:'流量生命周期', retention:'留存曲线', engagement_timeline:'互动结构', traffic_source:'流量来源' };
  const findingTitles = { high_engagement_segment:'TOP 高互动段落', strength:'AI / 人工做得好的判断', issue:'AI / 人工问题诊断', recommendation:'下一条优化建议' };
  return `<section class="review-shell" data-content-review><div class="section-heading"><div><h2>${escapeHtml(data.content?.title || '单条作品复盘')}</h2><p>指标与判断独立展示；推断不是事实。</p></div><span class="status-badge status-muted">${escapeHtml(qualityLabel(data.dataQuality))}</span></div>
    ${snapshots.length ? `<label class="form-field snapshot-selector"><span>数据快照 / 周期</span><select data-review-snapshot>${snapshots.map(s=>`<option value="${escapeHtml(s.id)}"${s.id===snapshot.id?' selected':''}>${escapeHtml(s.platformName || s.platformCode)} · ${escapeHtml(s.periodStart)} — ${escapeHtml(s.periodEnd)} · ${escapeHtml(s.sourceName || s.sourceType)}</option>`).join('')}</select></label>` : emptyState('这条作品尚未导入指标','账号数据不会被当作单作品数据，请在导入时选择这条作品。','⌁')}
    ${snapshot ? `<div class="review-provenance"><span>周期（上海，含首尾日）：${escapeHtml(snapshot.periodStart)} 至 ${escapeHtml(snapshot.periodEnd)}</span><span>来源：${escapeHtml(snapshot.sourceName || snapshot.sourceType)}${snapshot.sourceReference ? ` · ${escapeHtml(snapshot.sourceReference)}` : ''}</span><span>更新：${snapshot.capturedAt ? escapeHtml(displayShanghai(snapshot.capturedAt)) : '—'}</span></div>
    <h3>核心指标</h3><div class="review-metrics">${Object.entries(METRICS).map(([key,[label,unit]])=>{const metric=snapshot.metrics?.[key];return `<article class="review-metric"><small>${label}</small><strong>${formatMetric(metric?.value,unit)}</strong>${metric ? evidenceBadge(metric.evidenceLevel)+evidenceDetails(metric) : '<span class="muted">未提供</span>'}</article>`;}).join('')}</div>
    <div class="review-charts">${Object.entries(seriesTitles).map(([key,title])=>`<article class="content-section"><h3>${title}</h3>${renderSeries((snapshot.series || []).filter(s=>s.seriesKey===key),title,{bars:['traffic_source','engagement_timeline'].includes(key)})}</article>`).join('')}</div>` : ''}
    <section class="content-section review-judgments"><div class="section-heading"><div><h2>复盘判断与建议</h2><p>以下是独立提交的判断，不是指标自动证明的结论。</p></div></div>
    ${reviews.length ? reviews.map(r=>`<article class="review-record"><div class="review-provenance"><span>${escapeHtml(r.generatedBy || 'human')} · ${escapeHtml(qualityLabel(r.dataQuality))}</span><span>${r.generatedAt ? escapeHtml(displayShanghai(r.generatedAt)) : ''}</span></div><p>${escapeHtml(r.summary)}</p><div class="review-grid">${Object.entries(findingTitles).map(([kind,title])=>`<section class="review-card"><h3>${title}</h3>${(r.findings || []).filter(f=>f.findingType===kind).map(f=>`<div class="review-finding">${evidenceBadge(f.evidenceLevel)}<h4>${escapeHtml(f.title)}</h4><p>${escapeHtml(f.body)}</p>${evidenceDetails(f)}</div>`).join('') || '<p>尚未提供此类判断</p>'}</section>`).join('')}</div></article>`).join('') : emptyState('暂无复盘判断','可以通过导入或 WorkBuddy 提交带证据的判断；本地不会调用外部 AI。','◇')}
    </section>${(data.warnings || []).length ? `<aside class="quality-warning">${data.warnings.map(w=>escapeHtml(w)).join('<br>')}</aside>` : ''}</section>`;
}
