import { emptyState, escapeHtml, pageHeader, statCard } from '../shared/dom.js';
import { displayShanghai, shanghaiDate } from '../shared/format.js';
import { formatMetric } from '../shared/metrics.js';
import { downloadText } from '../shared/download.js';
import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { showFormError } from '../shared/forms.js';

const list = values => values?.length ? `<ul class="report-list">${values.map(value=>`<li>${escapeHtml(value)}</li>`).join('')}</ul>` : '<p>本周期暂无记录。</p>';
function card(title,content) {return `<article class="report-card"><h2>${title}</h2>${content}</article>`;}
export function renderReportSnapshot(report) {
  if(!report)return emptyState('尚未生成报告','选择周期后预览并保存；保存后就是独立历史快照，不随未来数据改变。','▤');
  const s=report.summary || {};
  return `<section data-report-snapshot="${escapeHtml(report.id || '')}"><div class="report-provenance"><strong>${escapeHtml(report.periodStart)} 至 ${escapeHtml(report.periodEnd)}</strong><span class="status-badge status-muted">本地规则汇总 · 非 AI</span><span>生成：${report.generatedAt?escapeHtml(displayShanghai(report.generatedAt)):'预览'}</span><span>数据更新：${report.dataUpdatedAt?escapeHtml(displayShanghai(report.dataUpdatedAt)):'尚无指标'}</span></div>
    <div class="stats-grid stats-four">${statCard('新增灵感','accent','◉','报告生成时的快照',s.newInspirations ?? '—')}${statCard('新增内容','pending','▤','报告生成时的快照',s.newContents ?? '—')}${statCard('已发布','success','➤','按实际发布日 · 内容去重',s.publishedContents ?? '—')}${statCard('总播放 / 阅读','warning','▷','已知口径小计 · 缺失不补零',formatMetric(s.views))}</div>
    <div class="report-grid">${card('周期摘要',list([`新增 ${s.newInspirations ?? '—'} 条灵感，${s.newContents ?? '—'} 条内容，${s.publishedContents ?? '—'} 条内容完成发布。`]))}${card('TOP 内容',s.topContents?.length?`<ol class="report-list">${s.topContents.map(c=>`<li>${escapeHtml(c.title)} <strong>${formatMetric(c.views)}</strong></li>`).join('')}</ol>`:'<p>尚无作品级指标，不以账号数据代替。</p>')}${card('四平台表现',list((s.platforms || []).map(p=>`${p.name}：播放 / 阅读 ${formatMetric(p.views)}，净增粉丝 ${formatMetric(p.netFollowers)}`)))}${card('周期洞察 · 本地规则',list(s.insights))}${card('热点 / 灵感沉淀',list((s.observations || []).map(o=>`${o.kind==='competitor'?'竞品':'热点'} · ${o.title} · ${o.status==='converted'?'已收入灵感':o.status==='ignored'?'已忽略':'待判断'}`)))}${card('下一周期建议',list(s.recommendations))}</div>
    <aside class="quality-warning"><h3>数据缺口</h3>${list(s.dataGaps)}</aside><details class="report-markdown"><summary>查看已保存 Markdown 原文</summary><pre>${escapeHtml(report.markdown || '')}</pre></details></section>`;
}
export function renderReports({data,error,loading,filters={}}={}) {
  const items=data?.items || [], report=items.find(r=>r.id===filters.reportId) || items[0];
  const periodType=filters.periodType || 'week';
  return `<section class="page page-reports">${pageHeader('周报 / 月报','生成一次，保存一份不可变的历史快照',`<button class="btn btn-secondary" data-copy-report${report?'':' disabled'}>复制 Markdown</button><button class="btn btn-secondary" data-download-report${report?'':' disabled'}>下载 Markdown</button><button class="btn btn-primary" data-preview-report>预览新报告</button>`)}
    <section class="content-section report-controls"><div class="chips">${[['week','本周'],['month','本月']].map(([value,label])=>`<button class="chip${periodType===value?' active':''}" data-report-period="${value}">${label}</button>`).join('')}</div><label class="form-field"><span>周期定位日期（上海）</span><input type="date" data-report-anchor value="${escapeHtml(filters.anchorDate || shanghaiDate())}"></label><label class="form-field"><span>历史快照</span><select data-report-history><option value="">${items.length?'选择已保存报告':'尚无历史报告'}</option>${items.map(r=>`<option value="${escapeHtml(r.id)}"${r.id===report?.id?' selected':''}>${escapeHtml(r.periodStart)} — ${escapeHtml(r.periodEnd)} · ${r.generatedAt?escapeHtml(displayShanghai(r.generatedAt)):''}</option>`).join('')}</select></label></section>
    ${error?`<div role="alert" class="quality-warning">${escapeHtml(error.message)} ${escapeHtml(error.requestId || '')}</div>`:''}${loading?'<p role="status">正在读取历史报告…</p>':''}<div data-report-body>${renderReportSnapshot(report)}</div></section>`;
}
export function attachReports(root,controls) {
  let report=controls.data?.items?.find(r=>r.id===controls.filters.reportId) || controls.data?.items?.[0];
  root.querySelectorAll('[data-report-period]').forEach(b=>b.addEventListener('click',()=>controls.setFilters({...controls.filters,periodType:b.dataset.reportPeriod,reportId:null})));
  root.querySelector('[data-report-anchor]')?.addEventListener('change',e=>{controls.filters.anchorDate=e.target.value;});
  root.querySelector('[data-report-history]')?.addEventListener('change',e=>{
    report=controls.data.items.find(r=>r.id===e.target.value);controls.filters.reportId=report?.id;
    root.querySelector('[data-report-body]').innerHTML=renderReportSnapshot(report);
    root.querySelectorAll('[data-copy-report],[data-download-report]').forEach(b=>{b.disabled=!report;});
  });
  const exportReport=async(download)=>{
    if(!report)return;
    try {const {data}=await controls.api.get(`/reports/${encodeURIComponent(report.id)}/markdown`);if(download)downloadText(data.markdown,data.fileName);else {await navigator.clipboard.writeText(data.markdown);showToast('已复制保存的 Markdown 快照。','success');}}
    catch(error){showToast(`${error.message} ${error.requestId || ''}`,'danger');}
  };
  root.querySelector('[data-copy-report]')?.addEventListener('click',()=>exportReport(false));
  root.querySelector('[data-download-report]')?.addEventListener('click',()=>exportReport(true));
  root.querySelector('[data-preview-report]')?.addEventListener('click',async()=>{
    const input={periodType:controls.filters.periodType,anchorDate:root.querySelector('[data-report-anchor]').value,generationMode:'deterministic'};
    if(!input.anchorDate){showToast('请先选择周期定位日期。','danger');return;}
    try {
      const {data}=await controls.api.get(`/reports/preview?${new URLSearchParams({periodType:input.periodType,anchorDate:input.anchorDate})}`);
      openModal({title:'报告预览',content:`<form class="workbench-form" data-report-save><div class="form-field-wide">${renderReportSnapshot(data)}<p>保存时将以最新本地数据生成独立快照，不修改任何旧报告。此汇总来自本地规则，不是 AI 分析。</p></div><div role="alert" class="form-error form-field-wide" data-form-error tabindex="-1" hidden></div><footer class="form-actions"><button type="button" class="btn btn-secondary" data-modal-close>取消</button><button type="submit" class="btn btn-primary">保存报告快照</button></footer></form>`});
      const form=document.querySelector('[data-report-save]'), key=crypto.randomUUID();
      form.addEventListener('submit',async event=>{event.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;try {const saved=await controls.api.post('/reports',input,{idempotencyKey:key});controls.filters.reportId=saved.data.id;closeModal();showToast('报告快照已保存。','success');await controls.reload();}catch(error){submit.disabled=false;showFormError(form,error);}});
    } catch(error){showToast(`${error.message} ${error.requestId || ''}`,'danger');}
  });
}
