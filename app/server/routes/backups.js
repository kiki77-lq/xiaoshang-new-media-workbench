import { randomUUID } from 'node:crypto';
import { HttpError } from '../http/errors.js';
import { authenticateRequest } from '../http/auth.js';
import { readJson } from '../http/body.js';
import { sendData } from '../http/response.js';
import { assertObject } from '../services/validation.js';
import { createBackup,verifyBackup,restoreBackup } from '../services/backup-service.js';
import { ownedManifest,backupMetadata,listBackups,validateCompatible } from '../services/backup-catalog.js';
import { getSchemaVersion } from '../db/migrate.js';
import { appendAuditLog } from '../repositories/audit-repository.js';

export function registerBackupRoutes(router,{config,lifecycle}) {
  router.add('GET','/api/v1/backups',async(_req,res,ctx)=>sendData(res,200,await listBackups(config),{requestId:ctx.requestId}));
  const write=(route,fn)=>router.add('POST',`/api/v1${route}`,async(req,res,ctx)=>{
    const principal=authenticateRequest(req,config),body=await readJson(req,config.bodyLimitBytes);
    const result=await fn(body,{...ctx,actor:principal.actor,key:req.headers['idempotency-key']});
    sendData(res,result.status,result.body,{requestId:ctx.requestId,idempotencyReplayed:result.replayed??false});
  });
  const audit=(ctx,action,id,after)=>appendAuditLog({db:lifecycle.db,actor:ctx.actor,action,entityType:'backup',entityId:id,requestId:ctx.requestId,after});
  write('/backups',async(body,ctx)=>{
    assertObject(body,[]);
    return lifecycle.operation({key:ctx.key,route:'/backups',body,execute:async()=>{
      const manifest=await createBackup({db:lifecycle.db,dataDir:config.dataDir,reason:'manual',appVersion:config.appVersion});
      const metadata=await backupMetadata(manifest);audit(ctx,'backup.create',metadata.id,{id:metadata.id});
      return {status:201,body:metadata};
    }});
  });
  write('/backups/:id/verify',async(body,ctx)=>{
    assertObject(body,[]);
    const manifest=ownedManifest(config,ctx.params.id),metadata=await backupMetadata(manifest),verification=await verifyBackup(manifest);
    if(!verification.ok||!metadata.restorable)throw new HttpError(400,'BACKUP_INVALID','备份校验失败或数据库版本不兼容。');
    const now=Date.now();
    for(const [token,ticket] of lifecycle.tickets)if(ticket.expires<=now)lifecycle.tickets.delete(token);
    const confirmationToken=randomUUID(),expires=now+5*60*1000;
    lifecycle.tickets.set(confirmationToken,{id:metadata.id,sha256:metadata.sha256,expires});
    audit(ctx,'backup.verify',metadata.id,{sha256:metadata.sha256});
    return {status:200,body:{backup:metadata,verification,confirmationToken,expiresAt:new Date(expires).toISOString()}};
  });
  write('/backups/:id/restore',async(body,ctx)=>{
    assertObject(body,['confirmationToken','confirmText']);
    if(typeof body.confirmationToken!=='string'||body.confirmText!=='恢复')throw new HttpError(400,'RESTORE_CONFIRMATION_REQUIRED','请先校验备份，并输入“恢复”进行二次确认。');
    // From here restore only touches backup files until it holds maintenance. Duplicate
    // journal waiters must not hold the drain open while waiting for that very restore.
    lifecycle.releaseRequest(ctx.requestId);
    return lifecycle.operation({key:ctx.key,route:`/backups/${ctx.params.id}/restore`,body,execute:async commit=>{
      const ticket=lifecycle.tickets.get(body.confirmationToken);
      if(!ticket||ticket.expires<=Date.now()||ticket.id!==ctx.params.id)throw new HttpError(409,'RESTORE_CONFIRMATION_INVALID','确认已失效或已使用，请重新校验。');
      lifecycle.tickets.delete(body.confirmationToken);
      const manifest=ownedManifest(config,ctx.params.id);
      if(ticket.sha256!==manifest.sha256||!(await verifyBackup(manifest)).ok)throw new HttpError(400,'BACKUP_INVALID','备份已变化，请重新校验。');
      return lifecycle.maintenance(ctx.requestId,async()=>{
        // Gate new calls and drain accepted async bodies/ingestion/backups BEFORE the protective snapshot.
        // This makes the pre-restore backup include the final completed write, not an earlier state.
        try {
          let preRestoreBackup,health;
          await restoreBackup({db:lifecycle.db,dbPath:config.dbPath,dataDir:config.dataDir,manifest,appVersion:config.appVersion,
            onDatabase:next=>lifecycle.rebind(next),validateRestored:async(next,pre)=>{
              validateCompatible(next);
              preRestoreBackup=await backupMetadata(pre);
              if(!preRestoreBackup.verified||!preRestoreBackup.restorable)throw new Error('PRE_RESTORE_BACKUP_INVALID');
              health={status:'ok',database:'ok',schemaVersion:getSchemaVersion(next)};
              audit(ctx,'backup.restore',ctx.params.id,{backupId:ctx.params.id,preRestoreBackupId:preRestoreBackup.id});
              commit({status:200,body:{restored:true,backupId:ctx.params.id,preRestoreBackup,health}});
            }});
          return {status:200,body:{restored:true,backupId:ctx.params.id,preRestoreBackup,health}};
        } catch(error) {
          if(error.rollbackFailed)lifecycle.failClosed();
          throw new HttpError(500,'RESTORE_FAILED','恢复失败，已尝试回滚保护原有数据。');
        }
      });
    }});
  });
}
