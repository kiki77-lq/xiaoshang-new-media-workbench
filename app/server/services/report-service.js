import { randomUUID } from 'node:crypto';
import { HttpError } from '../http/errors.js';
import { dateOnly } from './metric-model.js';
import { assertObject, enumValue } from './validation.js';
import { getPeriodOverview } from './analytics-service.js';
import { shanghaiDate, shiftDate } from '../../assets/js/shared/format.js';
import { appendAuditLog } from '../repositories/audit-repository.js';
import { withIdempotency } from './idempotency-service.js';

export function reportPeriod(periodType, anchorDate = shanghaiDate(new Date().toISOString())) {
  enumValue(periodType,'periodType',['week','month']);
  dateOnly(anchorDate,'anchorDate');
  let periodStart, periodEnd;
  if (periodType === 'week') {
    periodStart = shiftDate(anchorDate,-((new Date(anchorDate).getUTCDay()+6)%7));
    periodEnd = shiftDate(periodStart,6);
  } else {
    periodStart = `${anchorDate.slice(0,7)}-01`;
    const next = new Date(periodStart); next.setUTCMonth(next.getUTCMonth()+1);
    periodEnd = shiftDate(next.toISOString().slice(0,10),-1);
  }
  return { periodStart,periodEnd,from:new Date(`${periodStart}T00:00:00+08:00`).toISOString(),to:new Date(`${shiftDate(periodEnd,1)}T00:00:00+08:00`).toISOString() };
}
const safeText = value => String(value).replace(/[<>&]/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])).replace(/[\r\n]+/g,' ');
export function previewReport(db,input) {
  assertObject(input,['periodType','anchorDate','generationMode']);
  enumValue(input.generationMode===undefined?'deterministic':input.generationMode,'generationMode',['deterministic']);
  const dates = reportPeriod(input.periodType,input.anchorDate);
  const overview = getPeriodOverview(db,dates);
  const count = table => db.prepare(`SELECT count(*) n FROM ${table} WHERE created_at>=? AND created_at<?`).get(dates.from,dates.to).n;
  const observations = db.prepare('SELECT id,title,kind,status FROM observations WHERE discovered_at>=? AND discovered_at<? ORDER BY discovered_at,id').all(dates.from,dates.to);
  const summary = { newInspirations:count('inspirations'),newContents:count('contents'),
    publishedContents:db.prepare('SELECT count(DISTINCT content_id) n FROM content_publications WHERE published_at>=? AND published_at<?').get(dates.from,dates.to).n,
    views:overview.kpis.views,topContents:overview.ranking.slice(0,10).map(({contentId,title,views})=>({contentId,title,views})),
    platforms:overview.platforms.map(({code,name,views,netFollowers})=>({code,name,views,netFollowers})),observations,
    insights:[`本周期新增 ${count('contents')} 条内容，记录 ${observations.length} 条观察。`, '本报告由确定性规则汇总，未调用 AI 模型。'],
    recommendations:[overview.warnings.length ? '下周期优先补齐平台指标与周期覆盖，再进行内容比较。' : '下周期结合高表现作品的实际复盘安排内容。'],dataGaps:overview.warnings };
  const generatedAt=new Date().toISOString();
  const updates = db.prepare(`SELECT MAX(value) value FROM (
    SELECT MAX(updated_at) value FROM inspirations UNION ALL SELECT MAX(updated_at) FROM contents
    UNION ALL SELECT MAX(updated_at) FROM content_publications UNION ALL SELECT MAX(updated_at) FROM observations
    UNION ALL SELECT MAX(completed_at) FROM ingestion_runs)`).get().value;
  const markdown=[`# ${input.periodType==='week'?'周报':'月报'} ${dates.periodStart} — ${dates.periodEnd}`,
    '生成方式：确定性规则汇总（非 AI）',`生成时间：${generatedAt}`,`数据更新时间：${updates??'暂无数据'}`,
    `## 周期摘要\n新增灵感：${summary.newInspirations}；新增内容：${summary.newContents}；已发布内容：${summary.publishedContents}；总播放 / 阅读：${summary.views??'未知'}`,
    '## TOP 内容',...summary.topContents.map(r=>`- ${safeText(r.title)}：${r.views}`),
    '## 四平台表现',...summary.platforms.map(r=>`- ${r.name}：播放 / 阅读 ${r.views??'未知'}；净增粉丝 ${r.netFollowers??'未知'}`),
    '## 热点与竞品',...observations.map(r=>`- ${safeText(r.title)}（${r.kind} / ${r.status}）`),
    '## 数据缺口',...summary.dataGaps.map(s=>`- ${s}`),'## 周期洞察',...summary.insights.map(s=>`- ${s}`),
    '## 下周期建议',...summary.recommendations.map(s=>`- ${s}`)].join('\n\n');
  return {periodType:input.periodType,periodStart:dates.periodStart,periodEnd:dates.periodEnd,generatedBy:'deterministic',generatedAt,dataUpdatedAt:updates,summary,markdown};
}
export function getReport(db,id) {
  const row=db.prepare('SELECT snapshot_json FROM report_snapshots WHERE id=?').get(id);
  if(!row) throw new HttpError(404,'REPORT_NOT_FOUND','报告不存在。');
  return JSON.parse(row.snapshot_json);
}
export function listReports(db,periodType) {
  if(periodType!==undefined) enumValue(periodType,'periodType',['week','month']);
  return db.prepare(`SELECT snapshot_json FROM report_snapshots ${periodType?'WHERE period_type=?':''} ORDER BY generated_at DESC,id`).all(...(periodType?[periodType]:[])).map(r=>JSON.parse(r.snapshot_json));
}
export function createReport(input,ctx) {
  return withIdempotency({db:ctx.db,key:ctx.key,method:'POST',path:'/api/v1/reports',requestBody:input,execute:()=>{
    const report={id:randomUUID(),...previewReport(ctx.db,input)};
    ctx.db.prepare('INSERT INTO report_snapshots VALUES (?,?,?,?,?,?,?)').run(report.id,report.periodType,report.periodStart,report.periodEnd,report.markdown,JSON.stringify(report),report.generatedAt);
    appendAuditLog({db:ctx.db,actor:ctx.actor,requestId:ctx.requestId,action:'report.create',entityType:'report',entityId:report.id,after:{id:report.id}});
    return {status:201,body:report};
  }});
}
