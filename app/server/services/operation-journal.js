import fs from 'node:fs';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { HttpError } from '../http/errors.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
// Async backup operations cannot hold SQLite transactions or store receipts in the DB being replaced.
export function createOperationJournal(dataDir) {
  const running=new Map(),dir=path.join(dataDir,'operations');
  function write(file,value){const tmp=`${file}.${randomUUID()}.tmp`;fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}
  return async function operation({key,route,body,execute}){
    if(typeof key!=='string'||key.length<1||key.length>200)throw new HttpError(400,'IDEMPOTENCY_KEY_REQUIRED','需要有效的 Idempotency-Key。');
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    if(fs.lstatSync(dir).isSymbolicLink())throw new HttpError(500,'OPERATION_JOURNAL_UNSAFE','操作日志目录无效。');
    const fingerprint=hash(JSON.stringify({route,body:canonical(body)})),file=path.join(dir,`${hash(key)}.json`);
    const active=running.get(key);
    if(active){if(active.fingerprint!==fingerprint)throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED','请求键已用于不同请求。');return {...await active.promise,replayed:true};}
    if(fs.existsSync(file)){
      if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())throw new HttpError(500,'OPERATION_JOURNAL_UNSAFE','操作日志无效。');
      const receipt=JSON.parse(fs.readFileSync(file,'utf8'));
      if(receipt.fingerprint!==fingerprint)throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED','请求键已用于不同请求。');
      if(receipt.state!=='complete')throw new HttpError(409,'OPERATION_UNCERTAIN','前次操作未完成，请核对当前状态后重新校验备份。');
      return {...receipt.result,replayed:true};
    }
    write(file,{fingerprint,state:'pending'});
    let committed=false;
    // Restore calls this while its rollback scope is still open. A disk error when
    // persisting the receipt must roll back the database too, not merely return 500.
    const commit=result=>{write(file,{fingerprint,state:'complete',result});committed=true;};
    const promise=Promise.resolve().then(()=>execute(commit)).then(result=>{if(!committed)commit(result);return {...result,replayed:false};});
    running.set(key,{fingerprint,promise});
    try{return await promise;}finally{running.delete(key);}
  };
}
