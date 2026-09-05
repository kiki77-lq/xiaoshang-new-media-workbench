import { randomUUID } from 'node:crypto';
import { inTransaction } from '../db/transaction.js';
import { HttpError } from '../http/errors.js';
import { getCalendarEvent, publicationEvents, queryCalendarEvents, insertCalendarEvent, updateCalendarRecord, deleteCalendarRecord } from '../repositories/calendar-repository.js';
import { getPublicationById, updatePublicationRecord } from '../repositories/publication-repository.js';
import { assertVersion } from './optimistic-lock-service.js';
import { withIdempotency } from './idempotency-service.js';
import { assertObject, requiredString, optionalString, enumValue, expectedVersion } from './validation.js';
import { EVENT_TYPES, EVENT_STATUSES, timestamp, checkTransition, checkInterval, checkWrite, protectHistory, auditChange } from './scheduling-rules.js';

function validate(input,partial=false) {
  assertObject(input,partial?['title','startsAt','endsAt','notes','status','version','reason']:['title','startsAt','endsAt','notes','status','eventType','contentId','publicationId']);
  const values={};
  if(!partial || Object.hasOwn(input,'title')) values.title=requiredString(input.title,'title',240);
  if(!partial || Object.hasOwn(input,'startsAt')) values.startsAt=timestamp(input.startsAt,'startsAt');
  if(Object.hasOwn(input,'endsAt')) values.endsAt=timestamp(input.endsAt,'endsAt',{nullable:true});
  if(Object.hasOwn(input,'notes')) values.notes=optionalString(input.notes,'notes',5000);
  if(!partial || Object.hasOwn(input,'status')) values.status=enumValue(input.status,'status',EVENT_STATUSES,'planned');
  if(!partial) {
    values.eventType=enumValue(input.eventType,'eventType',EVENT_TYPES);
    values.contentId=optionalString(input.contentId,'contentId',100);
    values.publicationId=optionalString(input.publicationId,'publicationId',100);
  }
  return values;
}

// Call only inside the same transaction as the event write.
function synchronizePublication(event,context,reason,{deleting=false}={}) {
  if(event.eventType!=='publish') return;
  const pub=getPublicationById(context.db,event.publicationId);
  if(!pub) throw new HttpError(404,'PUBLICATION_NOT_FOUND','平台发布记录不存在。');
  protectHistory(pub);
  if(event.status==='completed') throw new HttpError(400,'VALIDATION_ERROR','请从内容库记录实际发布时间后完成发布。');
  const cancelling=deleting || event.status==='cancelled';
  const next={...pub,updatedAt:context.now || new Date().toISOString()};
  if(cancelling) {
    const other=publicationEvents(context.db,pub.id).filter(e=>e.id!==event.id);
    if(other.length) return; // Deleting an old cancelled event must not clear a newer schedule.
    next.scheduledAt=null;
    if(pub.status==='scheduled') next.status='ready';
  } else {
    if(publicationEvents(context.db,pub.id).some(e=>e.id!==event.id)) throw new HttpError(409,'PUBLICATION_ALREADY_SCHEDULED','该平台已有发布排期，请编辑现有排期。');
    next.status='scheduled';next.scheduledAt=event.startsAt;
  }
  checkTransition(pub.status,next.status,reason);
  checkWrite(updatePublicationRecord(context.db,next,pub.version));
  auditChange(context,'publication.update','publication',pub,getPublicationById(context.db,pub.id),reason);
}

export function listCalendarEvents({from,to,eventType},context) {
  const bounds={from:timestamp(from,'from'),to:timestamp(to,'to')};
  if(bounds.from>=bounds.to) throw new HttpError(400,'VALIDATION_ERROR','to 必须晚于 from。');
  if(eventType!==undefined) bounds.eventType=enumValue(eventType,'eventType',EVENT_TYPES);
  const items=queryCalendarEvents(context.db,bounds);
  return {items,total:items.length};
}

export async function createCalendarEvent(input,context) {
  const outcome=await withIdempotency({db:context.db,key:context.idempotencyKey,method:'POST',path:'/api/v1/calendar-events',requestBody:input,execute:()=>{
    const values=validate(input);
    if(values.eventType==='publish') {
      if(!values.publicationId) throw new HttpError(400,'PUBLICATION_REQUIRED','发布事件必须关联一个平台发布记录。');
      const pub=getPublicationById(context.db,values.publicationId);
      if(!pub) throw new HttpError(404,'PUBLICATION_NOT_FOUND','平台发布记录不存在。');
      if(values.contentId && values.contentId!==pub.contentId) throw new HttpError(400,'VALIDATION_ERROR','内容和平台发布记录不匹配。');
      values.contentId=pub.contentId;
      if(values.status==='cancelled') throw new HttpError(400,'VALIDATION_ERROR','新建发布排期不可已取消。');
    } else if(values.publicationId) throw new HttpError(400,'VALIDATION_ERROR','只有发布事件可关联平台。');
    if(values.contentId && !context.db.prepare('SELECT id FROM contents WHERE id=?').get(values.contentId)) throw new HttpError(404,'CONTENT_NOT_FOUND','内容不存在。');
    const now=context.now || new Date().toISOString();
    const event={id:randomUUID(),endsAt:null,notes:null,...values,createdAt:now,updatedAt:now};
    checkInterval(event.startsAt,event.endsAt);
    synchronizePublication(event,context);
    insertCalendarEvent(context.db,event);
    const result=getCalendarEvent(context.db,event.id);
    auditChange(context,'calendar.create','calendar_event',null,result);
    return {status:201,body:result};
  }});
  return {event:outcome.body,idempotencyReplayed:outcome.replayed};
}

export function updateCalendarEvent(id,input,context) {
  const values=validate(input,true);
  const version=expectedVersion(input.version);
  const reason=optionalString(input.reason,'reason',1000);
  return inTransaction(context.db,()=>{
    const current=getCalendarEvent(context.db,id);
    if(!current) throw new HttpError(404,'CALENDAR_EVENT_NOT_FOUND','日历事件不存在。');
    assertVersion({expectedVersion:version,actualVersion:current.version});
    const next={...current,...values,updatedAt:context.now || new Date().toISOString()};
    checkInterval(next.startsAt,next.endsAt);
    synchronizePublication(next,context,reason);
    checkWrite(updateCalendarRecord(context.db,next,version));
    const result=getCalendarEvent(context.db,id);
    auditChange(context,'calendar.update','calendar_event',current,result,reason);
    return result;
  });
}

export function deleteCalendarEvent(id,input,context) {
  assertObject(input,['version','reason']);
  const version=expectedVersion(input.version);
  const reason=optionalString(input.reason,'reason',1000);
  return inTransaction(context.db,()=>{
    const current=getCalendarEvent(context.db,id);
    if(!current) throw new HttpError(404,'CALENDAR_EVENT_NOT_FOUND','日历事件不存在。');
    assertVersion({expectedVersion:version,actualVersion:current.version});
    synchronizePublication(current,context,reason,{deleting:true});
    checkWrite(deleteCalendarRecord(context.db,id,version));
    const result={id,deleted:true};
    auditChange(context,'calendar.delete','calendar_event',current,result,reason);
    return result;
  });
}
