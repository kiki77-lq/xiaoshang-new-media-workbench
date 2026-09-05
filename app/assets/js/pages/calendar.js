import { closeModal, openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { emptyState, escapeHtml, pageHeader, statCard } from '../shared/dom.js';
import { formatMonth, shanghaiDate, shanghaiDateTime, shanghaiInputToUtc, shiftDate, displayShanghai } from '../shared/format.js';
import { showFormError } from '../shared/forms.js';

export const CALENDAR_COLORS = Object.freeze({publish:'#ff4d5f',shoot:'#2f8cff',pending_confirmation:'#9a6bff'});
const TYPES = {shoot:'拍摄 / 项目安排',publish:'发布',pending_confirmation:'待确认'};
const STATUSES = {planned:'已计划',confirmed:'已确认',completed:'已完成',cancelled:'已取消'};

export function buildMonthGrid(year,monthIndex) {
  const first=new Date(Date.UTC(year,monthIndex,1));
  const offset=(first.getUTCDay()+6)%7;
  return Array.from({length:42},(_,index)=>{
    const date=new Date(Date.UTC(year,monthIndex,1-offset+index));
    return {isoDate:date.toISOString().slice(0,10),day:date.getUTCDate(),inCurrentMonth:date.getUTCMonth()===monthIndex};
  });
}

export function calendarRange(date) {
  const [year,month]=shanghaiDate(date).split('-').map(Number);
  const days=buildMonthGrid(year,month-1);
  return {from:shanghaiInputToUtc(`${days[0].isoDate}T00:00`),to:shanghaiInputToUtc(`${shiftDate(days.at(-1).isoDate,1)}T00:00`)};
}

export function eventPresentation(type) {
  // Keep the old presentation alias; input validation accepts only pending_confirmation.
  return {publish:{label:'发布',tone:'danger'},shoot:{label:'拍摄 / 项目安排',tone:'info'},pending_confirmation:{label:'待确认',tone:'pending'},pending:{label:'待确认',tone:'pending'}}[type];
}

function eventChip(event) {
  return `<span class="calendar-event is-${escapeHtml(event.status)}" data-event-type="${escapeHtml(event.eventType)}" style="--event-color:${CALENDAR_COLORS[event.eventType]};border-left-color:${CALENDAR_COLORS[event.eventType]}" title="${escapeHtml(`${event.title} · ${displayShanghai(event.startsAt)} · ${STATUSES[event.status]}`)}">${event.eventType==='publish'?`<b class="calendar-platform">${escapeHtml(event.platformName)}</b>`:''}<span>${escapeHtml(event.title)}</span></span>`;
}

function eventList(events) {
  return events.length ? `<div class="day-events">${events.map(e=>`<article class="day-event" style="border-left-color:${CALENDAR_COLORS[e.eventType]}"><small>${TYPES[e.eventType]} · ${STATUSES[e.status]}</small><h3>${escapeHtml(e.title)}</h3>${e.eventType==='publish'?`<span class="status-badge">${escapeHtml(e.platformName)}</span>`:''}<p>${displayShanghai(e.startsAt)}${e.endsAt?` → ${displayShanghai(e.endsAt)}`:''}</p>${e.notes?`<p>${escapeHtml(e.notes)}</p>`:''}<button class="btn btn-secondary" type="button" data-edit-event="${escapeHtml(e.id)}" aria-label="编辑安排 ${escapeHtml(e.title)}">${e.eventType==='publish' && e.status==='completed'?'查看发布历史':'查看 / 编辑'}</button></article>`).join('')}</div>` : emptyState('当天没有安排','可以新增拍摄、发布或待确认安排。','▦');
}

export function renderCalendar({now=new Date(),calendarDate=now,data,loading=false,error=null,filters={}}={}) {
  const [year,month]=shanghaiDate(calendarDate).split('-').map(Number);
  const monthValue=`${year}-${String(month).padStart(2,'0')}`;
  const days=buildMonthGrid(year,month-1);
  const today=shanghaiDate(now);
  const events=data?.items || [];
  const inMonth=events.filter(e=>shanghaiDate(e.startsAt).startsWith(monthValue));
  const active=inMonth.filter(e=>!['completed','cancelled'].includes(e.status));
  const count=type=>!loading && !error?String(active.filter(e=>e.eventType===type).length):'—';
  return `<section class="page page-calendar" data-calendar-year="${year}" data-calendar-month="${month-1}">
    ${pageHeader('发布日历','拍摄、发布与待确认 · 所有时间均为上海时间','<button class="btn btn-primary" type="button" data-new-event>＋ 新增安排</button>')}
    <div class="stats-grid stats-four">${statCard('本月待发布','danger','➤','尚未完成的发布排期',count('publish'))}${statCard('本月拍摄','info','▦','尚未完成的拍摄安排',count('shoot'))}${statCard('本月待确认','pending','?','等待确认的安排',count('pending_confirmation'))}${statCard('本月已发布','accent','✓','保留已发布历史',loading||error?'—':String(inMonth.filter(e=>e.eventType==='publish'&&e.status==='completed').length))}</div>
    <div class="calendar-filters" aria-label="安排类型筛选">${[['all','全部安排'],...Object.entries(TYPES)].map(([code,label])=>`<button type="button" class="chip${(filters.eventType||'all')===code?' is-active':''}" data-event-filter="${code}" aria-pressed="${(filters.eventType||'all')===code}">${label}</button>`).join('')}</div>
    ${loading?'<p data-calendar-loading role="status">正在读取安排…</p>':''}${error?`<p role="alert">安排读取失败：${escapeHtml(error.message)} <button type="button" class="btn btn-secondary" data-calendar-retry>重试</button></p>`:''}
    <div class="calendar-layout"><section class="content-section calendar-panel" aria-label="发布月历"><div class="calendar-toolbar"><div><button class="icon-button" data-calendar-action="prev" aria-label="上个月">‹</button><strong>${formatMonth(calendarDate)}</strong><button class="icon-button" data-calendar-action="next" aria-label="下个月">›</button></div><button class="btn btn-secondary" data-calendar-action="today">今天</button><label class="calendar-month-picker"><span>显示月份</span><input type="month" data-month-picker value="${monthValue}"></label></div>
    <div class="calendar-weekdays">${['周一','周二','周三','周四','周五','周六','周日'].map(day=>`<span>${day}</span>`).join('')}</div>
    <div class="calendar-grid">${days.map(day=>{
      const entries=events.filter(e=>shanghaiDate(e.startsAt)===day.isoDate);
      return `<button type="button" class="calendar-day${day.inCurrentMonth?'':' is-outside'}${day.isoDate===today?' is-today':''}" data-calendar-day="${day.isoDate}" aria-label="${day.isoDate}，${entries.length}项安排"><span class="day-number">${day.day}</span>${entries.slice(0,3).map(eventChip).join('')}${entries.length>3?`<small>另 ${entries.length-3} 项</small>`:''}</button>`;
    }).join('')}</div><div class="calendar-legend">${Object.entries(TYPES).map(([type,label])=>`<span><i style="background:${CALENDAR_COLORS[type]}"></i>${label}</span>`).join('')}</div></section>
    <aside class="content-section day-panel"><div class="section-heading"><div><h2>本月安排</h2><p>点击日期查看全部安排 · 共 ${inMonth.length} 项</p></div></div>${eventList(inMonth.slice(0,5))}</aside></div>
  </section>`;
}

const field=(label,name,value='',type='text',required=false)=>`<label class="form-field${type==='text'?' form-field-wide':''}"><span>${label}</span><input type="${type}" name="${name}" value="${escapeHtml(value || '')}"${required?' required':''}${type==='datetime-local'?' step="0.001"':''}></label>`;
const options=(values,selected)=>Object.entries(values).map(([code,label])=>`<option value="${escapeHtml(code)}"${selected===code?' selected':''}>${escapeHtml(label)}</option>`).join('');

function openEventEditor(event,controls,date=shanghaiDate()) {
  const editing=Boolean(event);
  const publications=(controls.data?.contents || []).flatMap(c=>c.publications.map(p=>({...p,contentTitle:c.title})));
  const linked=publications.find(p=>p.id===event?.publicationId);
  const history=event?.eventType==='publish' && (event.status==='completed' || linked?.publishedAt || linked?.status==='published');
  if(history) { openModal({title:'发布历史',content:`<p>已发布历史已锁定。可在内容库查看或更正状态，历史日期会保留。</p>${eventList([event]).replace(/<button[\s\S]*?<\/button>/,'')}`}); return; }
  const available=publications.filter(p=>!p.publishedAt && p.status!=='published' && !p.scheduledAt);
  const statuses=event?.eventType==='publish'?{planned:'已计划',confirmed:'已确认',cancelled:'已取消'}:STATUSES;
  openModal({title:editing?'编辑安排':'新增安排',content:`<form class="workbench-form" data-calendar-form>
    ${editing?`<p class="form-field-wide">${TYPES[event.eventType]}${linked?` · ${escapeHtml(linked.platformName)}`:''} · 上海时间</p>`:`<label class="form-field form-field-wide"><span>安排类型</span><select name="eventType">${options(TYPES,'shoot')}</select></label>`}
    ${field('安排标题','title',event?.title,'text',true)}
    ${!editing?`<label class="form-field form-field-wide" data-publication-field hidden><span>关联平台发布</span><select name="publicationId"><option value="">选择内容与平台</option>${available.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.contentTitle)} · ${escapeHtml(p.platformName)}</option>`).join('')}</select><small>仅显示尚未排期、尚未发布的平台</small></label>`:''}
    ${field('开始时间（上海）','startsAt',event?shanghaiDateTime(event.startsAt):`${date}T10:00`,'datetime-local',true)}
    ${field('结束时间（上海）','endsAt',event?.endsAt?shanghaiDateTime(event.endsAt):'','datetime-local')}
    ${editing?`<label class="form-field form-field-wide"><span>安排状态</span><select name="status">${options(statuses,event.status)}</select></label>`:''}
    <label class="form-field form-field-wide"><span>备注</span><textarea name="notes" rows="2" maxlength="5000">${escapeHtml(event?.notes || '')}</textarea></label>
    ${editing?'<label class="form-field form-field-wide"><span>变更原因</span><textarea name="reason" rows="2" maxlength="1000" placeholder="取消发布排期时必填"></textarea></label>':''}
    <div class="form-error form-field-wide" role="alert" tabindex="-1" data-form-error hidden></div>
    <footer class="form-actions">${editing?'<button class="btn btn-secondary" type="button" data-delete-event>删除安排</button>':''}<button class="btn btn-secondary" type="button" data-modal-close>取消</button><button class="btn btn-primary" type="submit">保存安排</button></footer></form>`});
  const form=document.querySelector('[data-calendar-form]');
  const fields=form.elements;
  if(!editing) fields.eventType.addEventListener('change',()=>{
    const publish=fields.eventType.value==='publish';
    form.querySelector('[data-publication-field]').hidden=!publish;
    fields.publicationId.required=publish;
  });
  else fields.status.addEventListener('change',()=>{ fields.reason.required=event.eventType==='publish' && fields.status.value==='cancelled' && event.status!=='cancelled'; });
  const reloadLatest=async()=>{
    const fresh=await controls.reload();
    const match=fresh?.items.find(e=>e.id===event.id);
    if(!match) { closeModal();showToast('该安排已移出当前日期范围或被删除，请重新选择日期。','warning');return; }
    openEventEditor(match,{...controls,data:fresh});
  };
  const key=crypto.randomUUID();
  form.addEventListener('submit',async e=>{
    e.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;
    try {
      const body={title:fields.title.value,startsAt:shanghaiInputToUtc(fields.startsAt.value),endsAt:shanghaiInputToUtc(fields.endsAt.value),notes:fields.notes.value};
      if(body.endsAt && body.endsAt<body.startsAt) throw new Error('结束时间不能早于开始时间。');
      if(editing) { body.status=fields.status.value;body.reason=fields.reason.value;await controls.api.patch(`/calendar-events/${event.id}`,body,{version:event.version}); }
      else { body.eventType=fields.eventType.value;if(body.eventType==='publish') body.publicationId=fields.publicationId.value;await controls.api.post('/calendar-events',body,{idempotencyKey:key}); }
      closeModal();showToast('安排已保存。','success');await controls.reload();
    } catch(error) {submit.disabled=false;showFormError(form,error,editing?reloadLatest:undefined);}
  });
  form.querySelector('[data-delete-event]')?.addEventListener('click',()=>openDeleteEvent(event,controls));
}

function openDeleteEvent(event,controls) {
  openModal({title:'删除安排',content:`<form class="workbench-form" data-delete-form><p class="form-field-wide">删除“${escapeHtml(event.title)}”？${event.eventType==='publish'?'对应平台的发布时间将清除，已排期状态恢复待发布。':''}</p><label class="form-field form-field-wide"><span>删除原因</span><textarea name="reason" rows="2"${event.eventType==='publish'?' required':''}></textarea></label><div class="form-error form-field-wide" role="alert" tabindex="-1" data-form-error hidden></div><footer class="form-actions"><button class="btn btn-secondary" type="button" data-modal-close>取消</button><button class="btn btn-primary" type="submit">确认删除</button></footer></form>`});
  const form=document.querySelector('[data-delete-form]');
  form.addEventListener('submit',async e=>{
    e.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;
    try {await controls.api.delete(`/calendar-events/${event.id}`,{version:event.version,body:{reason:form.elements.reason.value}});closeModal();showToast('安排已删除，关联排期已同步。','success');await controls.reload();}
    catch(error) {submit.disabled=false;showFormError(form,error,async()=>{await controls.reload();closeModal();});}
  });
}

export function attachCalendar(root,controls={}) {
  const {now=new Date(),onMonthChange,data}=controls;
  root.querySelector('[data-new-event]')?.addEventListener('click',()=>openEventEditor(null,controls));
  root.querySelector('[data-calendar-retry]')?.addEventListener('click',()=>controls.reload());
  root.querySelector('[data-month-picker]')?.addEventListener('change',e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)) onMonthChange(new Date(shanghaiInputToUtc(`${e.target.value}-01T00:00`)));});
  root.querySelectorAll('[data-event-filter]').forEach(button=>button.addEventListener('click',()=>controls.setFilters({eventType:button.dataset.eventFilter})));
  root.querySelectorAll('[data-calendar-action]').forEach(button=>button.addEventListener('click',()=>{
    if(button.dataset.calendarAction==='today') return onMonthChange(now);
    const page=root.querySelector('.page-calendar');
    const date=new Date(Date.UTC(Number(page.dataset.calendarYear),Number(page.dataset.calendarMonth)+(button.dataset.calendarAction==='prev'?-1:1),1,4));
    onMonthChange(date);
  }));
  const bindEdit=container=>container.querySelectorAll('[data-edit-event]').forEach(button=>button.addEventListener('click',()=>openEventEditor(data.items.find(e=>e.id===button.dataset.editEvent),controls)));
  bindEdit(root);
  root.querySelectorAll('[data-calendar-day]').forEach(button=>button.addEventListener('click',()=>{
    const date=button.dataset.calendarDay;
    const events=(data?.items || []).filter(e=>shanghaiDate(e.startsAt)===date);
    openModal({title:`${date} 安排`,content:`${eventList(events)}<footer class="form-actions"><button class="btn btn-primary" type="button" data-new-on-day>新增当天安排</button></footer>`});
    const modal=document.querySelector('#modal-root');bindEdit(modal);
    modal.querySelector('[data-new-on-day]').addEventListener('click',()=>openEventEditor(null,controls,date));
  }));
}
