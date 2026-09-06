import { emptyState, escapeHtml, pageHeader, statCard, icon } from '../shared/dom.js';
import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { showFormError } from '../shared/forms.js';
import { PLATFORMS } from '../shared/metrics.js';

const labels={pending:'待判断',converted:'已收入灵感',ignored:'已忽略'};
function observationCard(item) {
  return `<article class="observation-preview" data-observation="${escapeHtml(item.id)}"><span class="rank tone-warning">${item.heatScore ?? '—'}</span><div><h3>${escapeHtml(item.title)}</h3><div class="chips"><span class="status-badge ${item.status==='converted'?'badge-success':'status-muted'}">${labels[item.status] || '未知'}</span><span class="data-state">${item.sourceType==='workbuddy'?'WorkBuddy 提交':'手动记录'}</span></div><p>${escapeHtml(item.summary || '')}</p><p>值得关注：${escapeHtml(item.worthReason || '')}</p><small>人工热度（0–100）：${item.heatScore ?? '未填写'} · 来源 ${escapeHtml(item.sourcePlatform || '')}${item.competitorName?` · ${escapeHtml(item.competitorName)}`:''}</small><div class="tag-list">${(item.tags || []).map(t=>`<span># ${escapeHtml(t)}</span>`).join('')}</div><div class="inline-actions"><button class="btn btn-primary" data-convert-observation="${escapeHtml(item.id)}"${item.status!=='pending'?' disabled':''}>收入灵感</button><a class="btn btn-secondary" href="${escapeHtml(/^https?:\/\//i.test(item.sourceUrl || '')?item.sourceUrl:'#')}" target="_blank" rel="noopener noreferrer">查看来源</a><button class="btn btn-secondary" data-edit-observation="${escapeHtml(item.id)}">编辑</button>${item.status==='converted'?'<a class="btn btn-secondary" href="/inspirations" data-route>查看灵感</a>':`<button class="btn btn-secondary" data-observation-status="${escapeHtml(item.id)}">${item.status==='ignored'?'重新判断':'忽略'}</button>`}</div></div></article>`;
}
export function renderObservations({data,error,loading,filters={}}={}) {
  const items=data?.items || [], stats=data?.stats || {};
  return `<section class="page page-observations">${pageHeader('热点 / 竞品观察','手动记录来源，先判断，再收入灵感',`<button class="btn btn-primary" data-new-observation aria-label="＋ 新增观察">${icon('plus')}新增观察</button>`)}
    <div class="stats-grid stats-four">${statCard('今日新热点','danger','♨','按上海时间',stats.todayHotspots ?? '—')}${statCard('高热趋势','warning','↗','人工热度 ≥ 70',stats.highHeat ?? '—')}${statCard('待老板判断','pending','♙','待判断候选',stats.pending ?? '—')}${statCard('本周转入灵感','success','◉','按实际转入时间',stats.weekConverted ?? '—')}</div>
    <section class="content-section filter-panel"><label class="search-control"><span>${icon('search')}</span><input type="search" data-observation-search value="${escapeHtml(filters.search || '')}" placeholder="搜索观察标题、品牌…"></label><div class="chips">${[['all','全部'],...Object.entries(labels)].map(([value,label])=>`<button class="chip${(filters.status || 'all')===value?' active':''}" data-observation-filter="${value}">${label}</button>`).join('')}</div></section>
    ${error?`<div role="alert" class="quality-warning">${escapeHtml(error.message)} ${escapeHtml(error.requestId || '')}</div>`:''}${loading?'<p role="status">正在读取本地观察…</p>':''}
    <div class="observations-grid">${[['hotspot','热点雷达'],['competitor','竞品观察']].map(([kind,title])=>`<section class="content-section"><div class="section-heading"><div><h2>${title}</h2><p>候选来自人工或 WorkBuddy，不运行爬虫</p></div></div>${items.filter(i=>i.kind===kind).map(observationCard).join('') || emptyState('暂无观察记录','可新增带来源的候选，再决定是否收入灵感。','◎')}</section>`).join('')}</div></section>`;
}
function observationForm(item) {
  const field=(label,name,value='',required=false)=>`<label class="form-field"><span>${label}</span><input name="${name}" value="${escapeHtml(value ?? '')}"${required?' required':''}></label>`;
  const platforms=[...PLATFORMS,['other','其他来源']];
  if(item?.sourcePlatform && !platforms.some(([code])=>code===item.sourcePlatform)) {
    platforms.push([item.sourcePlatform,item.sourcePlatform]);
  }
  return `<form class="workbench-form" data-observation-form><label class="form-field"><span>观察类型</span><select name="kind"><option value="hotspot">热点</option><option value="competitor"${item?.kind==='competitor'?' selected':''}>竞品</option></select></label>${field('观察标题','title',item?.title,true)}${field('竞品名称','competitorName',item?.competitorName)}${field('来源链接','sourceUrl',item?.sourceUrl,true)}<label class="form-field"><span>来源平台</span><select name="sourcePlatform">${platforms.map(([code,label])=>`<option value="${escapeHtml(code)}"${item?.sourcePlatform===code?' selected':''}>${escapeHtml(label)}</option>`).join('')}</select></label><label class="form-field"><span>人工热度（0–100，可空）</span><input name="heatScore" type="number" min="0" max="100" step="any" value="${item?.heatScore ?? ''}"></label>${field('品牌','brand',item?.brand)}${field('车型','vehicleModel',item?.vehicleModel)}<label class="form-field form-field-wide"><span>来源摘要（非自动 AI）</span><textarea name="summary" rows="3">${escapeHtml(item?.summary || '')}</textarea></label><label class="form-field form-field-wide"><span>值得关注的原因</span><textarea name="worthReason" rows="2" required>${escapeHtml(item?.worthReason || '')}</textarea></label>${field('标签（逗号分隔）','tags',item?.tags?.join('，'))}<div role="alert" class="form-error form-field-wide" data-form-error tabindex="-1" hidden></div><footer class="form-actions"><button class="btn btn-secondary" type="button" data-modal-close>取消</button><button class="btn btn-primary" type="submit">保存观察</button></footer></form>`;
}
function editObservation(item,controls) {
  openModal({title:item?'编辑观察':'新增观察',content:observationForm(item)});
  const form=document.querySelector('[data-observation-form]'), key=crypto.randomUUID();
  form.addEventListener('submit',async e=>{e.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;
    const values=Object.fromEntries(new FormData(form));const body={...values,heatScore:values.heatScore===''?null:Number(values.heatScore),tags:values.tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean)};
    try {if(item)await controls.api.patch(`/observations/${item.id}`,body,{version:item.version});else await controls.api.post('/observations',{...body,sourceType:'manual'},{idempotencyKey:key});closeModal();showToast('观察已保存。','success');await controls.reload();}
    catch(error){submit.disabled=false;showFormError(form,error,async()=>editObservation((await controls.api.get(`/observations/${item.id}`)).data,controls));}
  });
}
export function attachObservations(root,controls) {
  const find=id=>controls.data?.items?.find(i=>i.id===id);
  root.querySelector('[data-new-observation]')?.addEventListener('click',()=>editObservation(null,controls));
  root.querySelectorAll('[data-edit-observation]').forEach(b=>b.addEventListener('click',()=>editObservation(find(b.dataset.editObservation),controls)));
  root.querySelectorAll('[data-observation-filter]').forEach(b=>b.addEventListener('click',()=>controls.setFilters({...controls.filters,status:b.dataset.observationFilter})));
  root.querySelector('[data-observation-search]')?.addEventListener('change',e=>controls.setFilters({...controls.filters,search:e.target.value}));
  root.querySelectorAll('[data-observation-status]').forEach(b=>b.addEventListener('click',async()=>{const item=find(b.dataset.observationStatus);b.disabled=true;try {await controls.api.patch(`/observations/${item.id}`,{status:item.status==='ignored'?'pending':'ignored'},{version:item.version});await controls.reload();}catch(error){b.disabled=false;showToast(`${error.message} ${error.requestId || ''}`,'danger');}}));
  root.querySelectorAll('[data-convert-observation]').forEach(b=>b.addEventListener('click',()=>{
    const item=find(b.dataset.convertObservation), key=crypto.randomUUID();
    openModal({title:'收入灵感',content:`<form class="workbench-form" data-observation-convert><p class="form-field-wide">将「${escapeHtml(item.title)}」连同来源和关注原因保存为灵感。重复提交不会产生重复灵感。</p><div role="alert" class="form-error form-field-wide" data-form-error tabindex="-1" hidden></div><footer class="form-actions"><button class="btn btn-secondary" type="button" data-modal-close>取消</button><button class="btn btn-primary" type="submit">确认收入灵感</button></footer></form>`});
    const form=document.querySelector('[data-observation-convert]');form.addEventListener('submit',async e=>{e.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;try {await controls.api.post(`/observations/${item.id}/convert`,{version:item.version},{idempotencyKey:key});closeModal();showToast('已收入灵感，原来源保留。','success');await controls.reload();}catch(error){submit.disabled=false;showFormError(form,error);}});
  }));
}
