import { HttpError } from '../http/errors.js';
import { assertObject,expectedVersion,requiredString,optionalString,optionalUrl,booleanValue } from './validation.js';
import { assertVersion } from './optimistic-lock-service.js';
import { inTransaction } from '../db/transaction.js';
import { appendAuditLog } from '../repositories/audit-repository.js';

export function getSettings(db,config) {
  const row=db.prepare("SELECT * FROM app_settings WHERE key='preferences'").get();
  const prefs=row?JSON.parse(row.value_json):{version:1,keywords:[]};
  const last=db.prepare("SELECT value_json FROM app_settings WHERE key='workbuddy_last_request'").get();
  return {workbuddy:{tokenConfigured:Boolean(config.authToken),lastRequestAt:last?JSON.parse(last.value_json):null},
    platforms:db.prepare('SELECT code,display_name name,handle,profile_url profileUrl,enabled,last_metric_at lastMetricAt,version FROM platform_channels ORDER BY rowid').all().map(p=>({...p,enabled:Boolean(p.enabled)})),keywords:prefs.keywords,version:prefs.version,updatedAt:row?.updated_at??null};
}
export function recordWorkbuddyRequest(db) {
  const now=new Date().toISOString();
  db.prepare("INSERT INTO app_settings(key,value_json,updated_at) VALUES ('workbuddy_last_request',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").run(JSON.stringify(now),now);
}
export function updateSettings(input,ctx,config) {
  assertObject(input,['version','keywords','platforms']);expectedVersion(input.version);
  if(input.keywords!==undefined&&(!Array.isArray(input.keywords)||input.keywords.length>100))throw new HttpError(400,'VALIDATION_ERROR','关键词最多 100 个。');
  const keywords=input.keywords?.map(k=>requiredString(k,'keyword',100));
  if(input.platforms!==undefined&&(!Array.isArray(input.platforms)||input.platforms.length>4))throw new HttpError(400,'VALIDATION_ERROR','平台配置无效。');
  return inTransaction(ctx.db,()=>{
    const old=getSettings(ctx.db,config);assertVersion({expectedVersion:input.version,actualVersion:old.version});
    const now=new Date().toISOString(),seen=new Set();
    for(const p of input.platforms??[]) {
      assertObject(p,['code','handle','profileUrl','enabled','version']);
      const current=old.platforms.find(v=>v.code===p.code);
      if(!current||seen.has(p.code))throw new HttpError(400,'VALIDATION_ERROR','平台不存在或重复。');
      seen.add(p.code);assertVersion({expectedVersion:expectedVersion(p.version),actualVersion:current.version});
      ctx.db.prepare('UPDATE platform_channels SET handle=?,profile_url=?,enabled=?,version=version+1,updated_at=? WHERE code=? AND version=?').run(
        Object.hasOwn(p,'handle')?optionalString(p.handle,'handle',200):current.handle,
        Object.hasOwn(p,'profileUrl')?optionalUrl(p.profileUrl,'profileUrl'):current.profileUrl,
        Object.hasOwn(p,'enabled')?Number(booleanValue(p.enabled,'enabled')):Number(current.enabled),now,p.code,p.version);
    }
    ctx.db.prepare("INSERT INTO app_settings(key,value_json,updated_at) VALUES ('preferences',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").run(JSON.stringify({version:old.version+1,keywords:keywords?[...new Set(keywords)]:old.keywords}),now);
    const result=getSettings(ctx.db,config);
    appendAuditLog({db:ctx.db,actor:ctx.actor,requestId:ctx.requestId,action:'settings.update',entityType:'settings',entityId:null,before:old,after:result});return result;
  });
}
