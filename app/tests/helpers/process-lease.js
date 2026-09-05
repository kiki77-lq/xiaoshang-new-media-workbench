import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { unusedPort } from './local-delivery.js';

export async function until(check) {
  const deadline=Date.now()+15000;
  while(!check()) {if(Date.now()>deadline)throw new Error('fixture wait timeout');await new Promise(resolve=>setTimeout(resolve,20));}
}
export async function launchDirect(f,{data=f.data,port,prepare=false,operationId,env={}}={}) {
  port ||= await unusedPort();
  const args=prepare?['--input-type=module','-e',`import {prepareWorkbench} from ${JSON.stringify(pathToFileURL(path.join(f.repo,'app/server/index.js')).href)};
    const ready=await prepareWorkbench({operationId:${JSON.stringify(operationId)}});process.send({ready:true});
    process.on('message',()=>{ready.db.close();process.exit(0);});`]:['app/server/index.js'];
  const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',...args],{
    cwd:f.repo,env:{...process.env,...f.env,WORKBENCH_DATA_DIR:data,WORKBENCH_PORT:String(port),...env},stdio:['ignore','pipe','pipe','ipc']
  });
  let output='',ready=false,done=false,code;
  child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('listening on'))ready=true;});
  child.stderr.on('data',chunk=>output+=chunk);
  child.on('message',message=>{if(message.ready)ready=true;});
  const exited=new Promise(resolve=>child.once('exit',value=>{done=true;code=value;resolve();}));
  child.on('error',()=>{done=true;});
  const stop=async(signal='SIGTERM')=>{if(!done){child.kill(signal);await exited;}};
  try{await until(()=>ready||done);}catch(error){await stop('SIGKILL');throw error;}
  return {ready,get output(){return output;},get code(){return code;},child,port,data,stop,closePrepared:async()=>{child.send({close:true});await exited;}};
}
export async function rejectedDirect(f,options={},pattern=/DATA_IN_USE|PENDING_UPDATE/) {
  const result=await launchDirect(f,options);
  try {
    const assert=await import('node:assert/strict');
    assert.equal(result.ready,false,'another process must not prepare or listen on this data directory');
    assert.notEqual(result.code,0,result.output);assert.match(result.output,pattern);
  } finally {await result.stop();}
}
export const post=async(f,route,body={})=>{
  const {token}=JSON.parse(f.read('secrets.json'));
  const response=await fetch(`http://127.0.0.1:${f.port}/api/v1${route}`,{
    method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify(body)
  });
  if(!response.ok)throw new Error(`fixture API failed ${response.status}`);
  return (await response.json()).data;
};
export function backupGate(f) {
  const file=path.join(f.seed,'app/server/services/backup-service.js');
  const source=fs.readFileSync(file,'utf8').replace('await backup(db, sqlitePath);',`if(reason==='pre-update' && process.env.LEASE_BACKUP_GATE) {
    fs.writeFileSync(process.env.LEASE_BACKUP_GATE+'.entered','entered');
    while(!fs.existsSync(process.env.LEASE_BACKUP_GATE))await new Promise(resolve=>setTimeout(resolve,20));
  }
  await backup(db, sqlitePath);`);
  return source;
}
