import { randomUUID } from 'node:crypto';
import { HttpError } from '../http/errors.js';
import { assertObject,requiredString,optionalString,optionalUrl,enumValue,expectedVersion,tagValues } from './validation.js';
import { assertVersion } from './optimistic-lock-service.js';
import { withIdempotency } from './idempotency-service.js';
import { inTransaction } from '../db/transaction.js';
import { appendAuditLog } from '../repositories/audit-repository.js';
import { insertInspiration,getInspiration } from '../repositories/inspiration-repository.js';
import { replaceObservationTags,replaceInspirationTags } from '../repositories/tag-repository.js';
import { reportPeriod } from './report-service.js';
import { shanghaiDate,shiftDate } from '../../assets/js/shared/format.js';
import { timestamp } from './scheduling-rules.js';

const fields={kind:'kind',title:'title',summary:'ai_summary',competitorName:'competitor_name',brand:'brand',vehicleModel:'vehicle_model',sourceUrl:'source_url',sourcePlatform:'source_platform',sourceType:'source_type',discoveredAt:'discovered_at',heatScore:'heat_score',heatDelta:'heat_delta',worthReason:'worth_reason'};
function values(input,patch=false) {
  assertObject(input,[...Object.keys(fields),'tags',...(patch?['status','version']:[])]);
  const result={};
  for(const key of Object.keys(fields)) {
    if(patch&&!Object.hasOwn(input,key)) continue;
    const value=input[key];
    if(['kind','sourceType'].includes(key)) result[key]=enumValue(key==='sourceType'&&value===undefined?'manual':value,key,key==='kind'?['hotspot','competitor']:['manual','workbuddy']);
    else if(['title','sourcePlatform','worthReason'].includes(key)) result[key]=requiredString(value,key,key==='title'?200:5000);
    else if(key==='sourceUrl') result[key]=optionalUrl(requiredString(value,key,2048),key);
    else if(key==='discoveredAt') {
      const date=value===undefined?new Date().toISOString():value;
      result[key]=timestamp(date,key);
    } else if(['heatScore','heatDelta'].includes(key)) {
      if(value!==undefined&&value!==null&&(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER||(key==='heatScore'&&(value<0||value>100)))) throw new HttpError(400,'VALIDATION_ERROR','热度须为 0–100 人工评分，变化值须为有限数字。');
      result[key]=value??null;
    } else result[key]=optionalString(value,key,5000);
  }
  if(!patch||Object.hasOwn(input,'tags')) result.tags=tagValues(input.tags);
  if(patch&&Object.hasOwn(input,'status')) result.status=enumValue(input.status,'status',['pending','ignored']);
  return result;
}
export function getObservation(db,id) {
  const row=db.prepare('SELECT * FROM observations WHERE id=?').get(id);
  if(!row) throw new HttpError(404,'OBSERVATION_NOT_FOUND','观察不存在。');
  return {id:row.id,...Object.fromEntries(Object.entries(fields).map(([key,col])=>[key,row[col]])),status:row.status,convertedInspirationId:row.converted_inspiration_id,convertedAt:row.converted_at,createdAt:row.created_at,updatedAt:row.updated_at,version:row.version,
    tags:db.prepare('SELECT t.name FROM tags t JOIN observation_tags ot ON ot.tag_id=t.id WHERE ot.observation_id=? ORDER BY t.name').all(id).map(r=>r.name)};
}
export function listObservations(db,{kind,status,search}={},now=new Date().toISOString()) {
  const conditions=[],params=[];
  if(kind!==undefined){enumValue(kind,'kind',['hotspot','competitor']);conditions.push('kind=?');params.push(kind);}
  if(status!==undefined){enumValue(status,'status',['pending','converted','ignored']);conditions.push('status=?');params.push(status);}
  if(search){conditions.push('(title LIKE ? OR ai_summary LIKE ? OR competitor_name LIKE ? OR worth_reason LIKE ? OR brand LIKE ? OR vehicle_model LIKE ?)');params.push(...Array(6).fill(`%${search}%`));}
  const items=db.prepare(`SELECT id FROM observations ${conditions.length?'WHERE '+conditions.join(' AND '):''} ORDER BY discovered_at DESC,id`).all(...params).map(r=>getObservation(db,r.id));
  const today=shanghaiDate(now),from=new Date(`${today}T00:00:00+08:00`).toISOString(),to=new Date(`${shiftDate(today,1)}T00:00:00+08:00`).toISOString();
  const week=reportPeriod('week',today);
  return {items,stats:{todayHotspots:db.prepare("SELECT count(*) n FROM observations WHERE kind='hotspot' AND discovered_at>=? AND discovered_at<?").get(from,to).n,
    highHeat:db.prepare('SELECT count(*) n FROM observations WHERE heat_score>=70').get().n,
    pending:db.prepare("SELECT count(*) n FROM observations WHERE status='pending'").get().n,
    weekConverted:db.prepare('SELECT count(*) n FROM observations WHERE converted_at>=? AND converted_at<?').get(week.from,week.to).n}};
}
function audit(ctx,action,id,before,after){appendAuditLog({db:ctx.db,actor:ctx.actor,requestId:ctx.requestId,action,entityType:'observation',entityId:id,before,after});}
export function createObservation(input,ctx) {
  return withIdempotency({db:ctx.db,key:ctx.key,method:'POST',path:'/api/v1/observations',requestBody:input,execute:()=>{
    const v=values(input),id=randomUUID(),now=new Date().toISOString();
    ctx.db.prepare(`INSERT INTO observations(id,${Object.values(fields).join(',')},status,created_at,updated_at) VALUES (?,${Object.keys(fields).map(()=>'?').join(',')},'pending',?,?)`).run(id,...Object.keys(fields).map(k=>v[k]),now,now);
    replaceObservationTags(ctx.db,id,v.tags,now);
    const result=getObservation(ctx.db,id);audit(ctx,'observation.create',id,null,result);
    return {status:201,body:result};
  }});
}
export function updateObservation(id,input,ctx) {
  const v=values(input,true),version=expectedVersion(input.version);
  return inTransaction(ctx.db,()=>{
    const old=getObservation(ctx.db,id);assertVersion({expectedVersion:version,actualVersion:old.version});
    if(old.convertedInspirationId&&v.status) throw new HttpError(409,'OBSERVATION_ALREADY_CONVERTED','已收入灵感，不能移除转换历史。');
    const keys=Object.keys(v).filter(k=>k!=='tags'),now=new Date().toISOString();
    ctx.db.prepare(`UPDATE observations SET ${keys.map(k=>`${fields[k]??'status'}=?`).concat(['updated_at=?','version=version+1']).join(',')} WHERE id=? AND version=?`).run(...keys.map(k=>v[k]),now,id,version);
    if(v.tags)replaceObservationTags(ctx.db,id,v.tags,now);
    const result=getObservation(ctx.db,id);audit(ctx,'observation.update',id,old,result);return result;
  });
}
export function convertObservation(id,input,ctx) {
  assertObject(input,['version','summaryTitle']);
  return withIdempotency({db:ctx.db,key:ctx.key,method:'POST',path:`/api/v1/observations/${id}/convert`,requestBody:input,execute:()=>{
    const old=getObservation(ctx.db,id);
    if(old.convertedInspirationId)return {status:200,body:{observation:old,inspiration:getInspiration(ctx.db,old.convertedInspirationId),alreadyConverted:true}};
    if(old.status!=='pending')throw new HttpError(409,'OBSERVATION_NOT_PENDING','已忽略的观察须先恢复为待处理，才能收入灵感。');
    assertVersion({expectedVersion:expectedVersion(input.version),actualVersion:old.version});
    const inspirationId=randomUUID(),now=new Date().toISOString();
    insertInspiration(ctx.db,{id:inspirationId,rawText:[old.title,old.summary,old.worthReason,`来源：${old.sourcePlatform} ${old.sourceUrl}`].filter(Boolean).join('\n'),summaryTitle:input.summaryTitle===undefined?old.title:requiredString(input.summaryTitle,'summaryTitle',200),brand:old.brand,vehicleModel:old.vehicleModel,sourceType:old.kind==='hotspot'?'hotspot':'other',sourcePlatform:old.sourcePlatform,sourceUrl:old.sourceUrl,status:'inbox',createdAt:now,updatedAt:now});
    replaceInspirationTags(ctx.db,inspirationId,old.tags,now);
    ctx.db.prepare("UPDATE observations SET status='converted',converted_inspiration_id=?,converted_at=?,updated_at=?,version=version+1 WHERE id=?").run(inspirationId,now,now,id);
    const observation=getObservation(ctx.db,id);audit(ctx,'observation.convert',id,old,observation);
    return {status:201,body:{observation,inspiration:getInspiration(ctx.db,inspirationId),alreadyConverted:false}};
  }});
}
