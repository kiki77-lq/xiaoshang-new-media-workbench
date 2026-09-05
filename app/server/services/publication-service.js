import { randomUUID } from 'node:crypto';
import { inTransaction } from '../db/transaction.js';
import { HttpError } from '../http/errors.js';
import { getPublication, getPublicationById, updatePublicationRecord } from '../repositories/publication-repository.js';
import { publicationEvents, insertCalendarEvent, getCalendarEvent, updateCalendarRecord, deleteCalendarRecord } from '../repositories/calendar-repository.js';
import { assertVersion } from './optimistic-lock-service.js';
import { assertObject, enumValue, expectedVersion as validateVersion, optionalString, optionalUrl } from './validation.js';
import { PLATFORM_CODES, PUBLICATION_STATUSES, timestamp, checkTransition, checkInterval, checkWrite, protectHistory, auditChange } from './scheduling-rules.js';

export function updatePublication(contentId, platformCode, input, expectedVersion, context) {
  assertObject(input,['version','status','scheduledAt','publishedAt','publishedUrl','platformContentId','reason']);
  enumValue(platformCode,'platformCode',PLATFORM_CODES);
  const version=validateVersion(expectedVersion);
  const values={};
  if(Object.hasOwn(input,'status')) values.status=enumValue(input.status,'status',PUBLICATION_STATUSES);
  for(const field of ['scheduledAt','publishedAt']) if(Object.hasOwn(input,field)) values[field]=timestamp(input[field],field,{nullable:true});
  if(Object.hasOwn(input,'publishedUrl')) values.publishedUrl=optionalUrl(input.publishedUrl,'publishedUrl');
  if(Object.hasOwn(input,'platformContentId')) values.platformContentId=optionalString(input.platformContentId,'platformContentId',240);
  const reason=optionalString(input.reason,'reason',1000);
  return inTransaction(context.db,()=>{
    const current=getPublication(context.db,contentId,platformCode);
    if(!current) throw new HttpError(404,'PUBLICATION_NOT_FOUND','平台发布记录不存在。');
    assertVersion({expectedVersion:version,actualVersion:current.version});
    const next={...current,...values,updatedAt:context.now || new Date().toISOString()};
    const hasHistory=Boolean(current.publishedAt || current.status==='published');
    if(hasHistory && ((Object.hasOwn(values,'scheduledAt') && values.scheduledAt!==current.scheduledAt) || (Object.hasOwn(values,'publishedAt') && values.publishedAt!==current.publishedAt))) protectHistory(current);
    if(!hasHistory) {
      if(Object.hasOwn(values,'scheduledAt') && values.scheduledAt && !Object.hasOwn(values,'status')) next.status='scheduled';
      if(Object.hasOwn(values,'scheduledAt') && !values.scheduledAt && next.status==='scheduled' && !Object.hasOwn(values,'status')) next.status='ready';
      if(Object.hasOwn(values,'status') && PUBLICATION_STATUSES.indexOf(next.status)<4) {
        if(values.scheduledAt) throw new HttpError(400,'VALIDATION_ERROR','有发布排期时，状态必须为已排期或已发布。');
        next.scheduledAt=null;
      }
    }
    checkTransition(current.status,next.status,reason);
    if(next.status==='scheduled' && !next.scheduledAt) throw new HttpError(400,'VALIDATION_ERROR','已排期状态必须有发布时间。');
    if(next.status==='published' && !next.publishedAt) throw new HttpError(400,'VALIDATION_ERROR','已发布状态必须有实际发布时间。');
    if(!hasHistory && next.publishedAt && next.status!=='published') throw new HttpError(400,'VALIDATION_ERROR','实际发布时间只用于已发布记录。');
    const events=publicationEvents(context.db,current.id);
    if(events.length>1) throw new HttpError(409,'PUBLICATION_ALREADY_SCHEDULED','该平台存在多个排期，请核验数据。');
    const event=events[0];
    if(!hasHistory) {
      if(!next.scheduledAt && event) {
        checkWrite(deleteCalendarRecord(context.db,event.id,event.version));
        auditChange(context,'calendar.delete','calendar_event',event,{id:event.id,deleted:true},reason);
      } else if(next.scheduledAt) {
        const desiredStatus=next.status==='published'?'completed':event?.status || 'planned';
        if(event && (event.startsAt!==next.scheduledAt || event.status!==desiredStatus)) {
          const updated={...event,startsAt:next.scheduledAt,status:desiredStatus,updatedAt:next.updatedAt};
          checkInterval(updated.startsAt,updated.endsAt);
          checkWrite(updateCalendarRecord(context.db,updated,event.version));
          auditChange(context,'calendar.update','calendar_event',event,getCalendarEvent(context.db,event.id),reason);
        } else if(!event) {
          const created={id:randomUUID(),contentId,publicationId:current.id,eventType:'publish',status:desiredStatus,
            title:`${current.contentTitle} · ${current.platformName}发布`,startsAt:next.scheduledAt,endsAt:null,notes:null,createdAt:next.updatedAt,updatedAt:next.updatedAt};
          insertCalendarEvent(context.db,created);
          auditChange(context,'calendar.create','calendar_event',null,getCalendarEvent(context.db,created.id),reason);
        }
      }
    }
    checkWrite(updatePublicationRecord(context.db,next,version));
    const result=getPublicationById(context.db,current.id);
    auditChange(context,'publication.update','publication',current,result,reason);
    return result;
  });
}
