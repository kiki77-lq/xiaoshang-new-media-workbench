import { normalizeTimestamp } from '../../assets/js/shared/format.js';
import { HttpError } from '../http/errors.js';
import { appendAuditLog } from '../repositories/audit-repository.js';
import { optionalString } from './validation.js';

export const PUBLICATION_STATUSES = ['not_started','preparing','producing','ready','scheduled','published'];
export const PLATFORM_CODES = ['douyin','wechat_channels','xiaohongshu','weibo'];
export const EVENT_TYPES = ['shoot','publish','pending_confirmation'];
export const EVENT_STATUSES = ['planned','confirmed','completed','cancelled'];
export function timestamp(value,field,{nullable=false}={}) {
  if(nullable && value===null) return null;
  try { return normalizeTimestamp(value); }
  catch { throw new HttpError(400,'VALIDATION_ERROR',`${field} 必须是有效且带时区的 ISO8601 时间。`,[{field}]); }
}
export function requireReason(reason) {
  const value=optionalString(reason,'reason',1000);
  if(!value) throw new HttpError(400,'REASON_REQUIRED','状态回退或取消排期时，请填写原因。',[{field:'reason'}]);
  return value;
}
export function checkTransition(before,after,reason) {
  if(PUBLICATION_STATUSES.indexOf(after)<PUBLICATION_STATUSES.indexOf(before)) requireReason(reason);
}
export function protectHistory(pub) {
  if(pub.status==='published' || pub.publishedAt) throw new HttpError(409,'PUBLISHED_HISTORY_PROTECTED','已发布历史不可删除、取消或改期。');
}
export function checkInterval(startsAt,endsAt) {
  if(endsAt && endsAt<startsAt) throw new HttpError(400,'VALIDATION_ERROR','结束时间不能早于开始时间。',[{field:'endsAt'}]);
}
export function checkWrite(result) {
  if(result.changes!==1) throw new HttpError(409,'VERSION_CONFLICT','记录已更新，请刷新后重试。');
}
export function auditChange(context,action,entityType,before,after,reason) {
  appendAuditLog({db:context.db,actor:context.actor,requestId:context.requestId,action,entityType,
    entityId:after?.id || before?.id,before,after:after?{...after,...(reason?{reason}:{})}:null});
}
