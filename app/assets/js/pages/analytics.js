import { emptyState, escapeHtml, pageHeader, statCard } from '../shared/dom.js';
import { displayShanghai } from '../shared/format.js';
import { currentMonth, formatMetric, qualityLabel, renderSeries } from '../shared/metrics.js';
import { renderContentReview } from './content-review.js';
import { openImportMetrics } from './ingestion.js';

export function renderAnalytics({data: loadedData, error, loading, filters = {}} = {}) {
  const month = filters.month || currentMonth();
  const mismatched = loadedData && loadedData.periodStart?.slice(0,7) !== month;
  const data = mismatched ? null : loadedData;
  const kpi = data?.kpis || {};
  const choices = loadedData?.contents || [];
  return `<section class="page page-analytics">${pageHeader('数据看板','四平台表现与单条作品复盘','<button class="btn btn-primary" data-import-metrics>＋ 导入数据</button>')}
    <div class="analytics-toolbar"><div class="view-switch" role="tablist"><button class="chip active" role="tab" aria-selected="true" data-analytics-tab="overview">数据总览</button><button class="chip" role="tab" aria-selected="false" data-analytics-tab="review">单条作品复盘</button></div><label class="month-selector">统计月份 <input type="month" aria-label="统计月份" data-analytics-month value="${escapeHtml(month)}"></label></div>
    ${error ? `<div role="alert" class="quality-warning">读取失败：${escapeHtml(error.message)} ${escapeHtml(error.requestId || '')}</div>` : ''}${loading ? '<p role="status">正在读取本地指标…</p>' : ''}${mismatched ? `<p class="quality-warning" role="status">已隐藏 ${escapeHtml(loadedData.periodStart?.slice(0,7) || '未知周期')} 的旧数据，等待 ${escapeHtml(month)} 的数据；不会沿用上个月数字。</p>` : ''}
    <div data-analytics-panel="overview" role="tabpanel"><div class="stats-grid stats-four">${statCard('本月总播放 / 阅读','accent','▷','只统计已导入的覆盖周期',formatMetric(kpi.views),'analytics-views')}${statCard('本月内容数','pending','▤','按内容创建日期',kpi.contentCount ?? '—')}${statCard('本月最佳内容','warning','☆',kpi.bestContent ? `${formatMetric(kpi.bestContent.views)} 播放 / 阅读` : '等待作品指标',kpi.bestContent?.title || '—')}${statCard('本月涨粉','success','♙','净增粉丝 · 缺失不补零',formatMetric(kpi.netFollowers))}</div>
    <div class="analytics-grid"><section class="content-section trend-panel"><div class="section-heading"><div><h2>数据趋势</h2><p>${escapeHtml(qualityLabel(data?.dataQuality))}</p></div><span class="data-state">更新时间 ${data?.updatedAt ? escapeHtml(displayShanghai(data.updatedAt)) : '—'}</span></div><div class="chips trend-tabs">${[['views','播放'],['likes','点赞'],['comments','评论'],['netFollowers','涨粉']].map(([key,label],i)=>`<button class="chip${!i?' active':''}" data-trend="${key}">${label}</button>`).join('')}</div>${[['views','播放'],['likes','点赞'],['comments','评论'],['netFollowers','涨粉']].map(([key,label],i)=>`<div data-trend-panel="${key}"${i?' hidden':''}>${renderSeries(data?.trends?.[key] || [],label)}</div>`).join('')}</section>
    <section class="content-section ranking-panel"><div class="section-heading"><h2>内容排行</h2></div>${data?.ranking?.length ? `<ol class="content-ranking">${data.ranking.map(r=>`<li><a href="/analytics?contentId=${encodeURIComponent(r.contentId)}" data-route>${escapeHtml(r.title)}</a><strong>${formatMetric(r.views)}</strong></li>`).join('')}</ol>` : emptyState('暂无排行','只对有作品级指标的内容排行，账号总量不充当作品成绩。','☷')}</section></div>
    <section class="content-section"><div class="section-heading"><div><h2>四平台表现</h2><p>账号与作品口径不混加，缺失数值显示 —</p></div></div><div class="platform-grid">${(data?.platforms || []).map(p=>`<article class="platform-card"><div><span class="platform-logo">${escapeHtml(p.name?.[0] || '')}</span><strong>${escapeHtml(p.name)}</strong></div><span class="status-badge status-muted">${escapeHtml(qualityLabel(p.dataQuality))}</span><p>播放 / 阅读</p><b>${formatMetric(p.views)}</b><small>点赞 ${formatMetric(p.likes)} · 评论 ${formatMetric(p.comments)} · 净增 ${formatMetric(p.netFollowers)}</small></article>`).join('')}</div></section>
    <aside class="quality-warning"><strong>统计口径与数据缺口</strong><p>${escapeHtml(data?.calculationNote || '尚未导入数据。相同对象与周期只取最新快照；不会对未知周期补点或猜测。')}</p>${(data?.warnings || []).map(w=>`<p>${escapeHtml(w)}</p>`).join('')}</aside></div>
    <div data-analytics-panel="review" role="tabpanel" hidden><section class="content-section"><label class="form-field"><span>选择复盘作品</span><select data-review-content><option value="">请选择作品</option>${choices.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`).join('')}</select></label></section><div data-review-outlet>${renderContentReview()}</div></div>
  </section>`;
}

export function attachAnalytics(root, controls = {}) {
  const activate = (name) => {
    root.querySelectorAll('[data-analytics-tab]').forEach(tab=>{const active=tab.dataset.analyticsTab===name;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});
    root.querySelectorAll('[data-analytics-panel]').forEach(panel=>{panel.hidden=panel.dataset.analyticsPanel!==name;});
  };
  root.querySelectorAll('[data-analytics-tab]').forEach(button=>button.addEventListener('click',()=>activate(button.dataset.analyticsTab)));
  root.querySelectorAll('[data-trend]').forEach(button=>button.addEventListener('click',()=>{
    root.querySelectorAll('[data-trend]').forEach(b=>b.classList.toggle('active',b===button));
    root.querySelectorAll('[data-trend-panel]').forEach(p=>{p.hidden=p.dataset.trendPanel!==button.dataset.trend;});
  }));
  root.querySelector('[data-analytics-month]')?.addEventListener('change',e=>{if(e.target.value) controls.setMonth?.(e.target.value);});
  root.querySelector('[data-import-metrics]')?.addEventListener('click',()=>openImportMetrics(controls));
  const selector=root.querySelector('[data-review-content]'), outlet=root.querySelector('[data-review-outlet]');
  let sequence=0;
  const loadReview = async(id) => {
    const request=++sequence;
    if(!id) { outlet.innerHTML=renderContentReview(); return; }
    outlet.innerHTML='<p role="status">正在读取作品复盘…</p>';
    try {
      const result=await controls.api.get(`/contents/${encodeURIComponent(id)}/review`);
      if(request!==sequence || !outlet.isConnected) return;
      const render=(snapshotId)=>{outlet.innerHTML=renderContentReview(result.data,snapshotId);outlet.querySelector('[data-review-snapshot]')?.addEventListener('change',e=>render(e.target.value));};
      render();
    } catch(error) { if(request===sequence && outlet.isConnected) outlet.innerHTML=`<div role="alert" class="quality-warning">${escapeHtml(error.message)} ${escapeHtml(error.requestId || '')}</div>`; }
  };
  selector?.addEventListener('change',()=>{
    const url=new URL(window.location.href); if(selector.value)url.searchParams.set('contentId',selector.value);else url.searchParams.delete('contentId');
    window.history.replaceState({},'',url);loadReview(selector.value);
  });
  const selected = typeof window==='undefined' ? null : new URLSearchParams(window.location.search).get('contentId');
  if(selected && controls.api) { selector.value=selected;activate('review');loadReview(selected); }
}
