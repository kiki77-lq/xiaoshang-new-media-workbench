// Managed workers expose a private, nonce-authenticated loopback control port.
// PIDs are informational; stop never sends a signal based on a stored PID.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function writeJson(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  const dir = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
export const readJson = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : null;
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try { process.kill(pid,0); return true; } catch(error) { return error.code !== 'ESRCH'; }
}
export async function freePort(port) {
  const probe = net.createServer();
  await new Promise((resolve,reject)=>{
    probe.once('error',()=>reject(new Error('PORT_IN_USE')));
    probe.listen(port,'127.0.0.1',resolve);
  });
  await new Promise(resolve=>probe.close(resolve));
}
export async function control(record, action, timeoutMs = 35000) {
  if (!record || !Number.isInteger(record.controlPort) || typeof record.nonce !== 'string') throw new Error('OWNERSHIP_UNPROVEN');
  try {
    const response = await fetch(`http://127.0.0.1:${record.controlPort}/${action}`, {
      method:'POST', headers:{authorization:`Bearer ${record.nonce}`}, signal:AbortSignal.timeout(timeoutMs)
    });
    const body = await response.json();
    if(body.nonce !== record.nonce || body.pid !== record.pid || body.projectRoot !== record.projectRoot) throw new Error('OWNERSHIP_UNPROVEN');
    if(!response.ok) throw new Error(body.error === 'REQUEST_DRAIN_TIMEOUT' ? body.error : 'CONTROL_FAILED');
    return body;
  } catch(error) {
    if(['REQUEST_DRAIN_TIMEOUT','CONTROL_FAILED'].includes(error.message)) throw error;
    throw new Error('OWNERSHIP_UNPROVEN');
  }
}
export async function owned(ctx) {
  const record = readJson(ctx.serviceFile);
  if(!record) return null;
  if(record.projectRoot !== ctx.root) throw new Error('OWNERSHIP_UNPROVEN');
  try { await control(record,'status',2000); return record; }
  catch(error) {
    if(alive(record.pid)) throw error;
    // A dead process record can be retired, but never an ambiguous live PID.
    fs.unlinkSync(ctx.serviceFile); return null;
  }
}
export async function stop(ctx) {
  const record = await owned(ctx);
  if(!record) { await freePort(ctx.port); return; }
  await control(record,'stop');
  const deadline=Date.now()+5000;
  while(fs.existsSync(ctx.serviceFile)) {
    if(Date.now()>deadline) throw new Error('STOP_NOT_CONFIRMED');
    await new Promise(resolve=>setTimeout(resolve,25));
  }
}
export async function health(record, sha) {
  const identity = await control(record,'status',2000);
  const response = await fetch(`http://127.0.0.1:${record.port}/api/v1/health`,{signal:AbortSignal.timeout(3000)});
  const data = (await response.json()).data;
  if(!response.ok || data?.status !== 'ok' || data.database !== 'ok' || data.gitSha !== sha || data.schemaVersion !== identity.schemaVersion) throw new Error('HEALTH_FAILED');
  return {...data, gated:identity.gated};
}
export async function launch(ctx, sha, operationId) {
  if(await owned(ctx)) throw new Error('ALREADY_RUNNING');
  await freePort(ctx.port);
  const nonce=randomUUID();
  const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',path.join(ctx.root,'scripts/local-runtime.mjs'),'worker'],{
    cwd:ctx.root, detached:true, stdio:['ignore','ignore','ignore','ipc'],
    env:{...process.env, WORKBENCH_HOST:'127.0.0.1',WORKBENCH_PORT:String(ctx.port),WORKBENCH_DATA_DIR:ctx.data,WORKBENCH_GIT_SHA:sha}
  });
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('STARTUP_TIMEOUT')),30000);
      child.once('error',()=>{clearTimeout(timer);reject(new Error('STARTUP_FAILED'));});
      child.once('exit',()=>{clearTimeout(timer);reject(new Error('STARTUP_FAILED'));});
      child.on('message',message=>{
        if(message.ready || message.error) {clearTimeout(timer);message.ready?resolve():reject(new Error('STARTUP_FAILED'));}
      });
      child.send({root:ctx.root,data:ctx.data,port:ctx.port,serviceFile:ctx.serviceFile,nonce,sha,operationId});
    });
    const record=readJson(ctx.serviceFile);
    await health(record,sha);
    // The worker remains gated until the caller durably records promotion.
    child.disconnect(); child.unref();
    return record;
  } catch(error) {
    // This ChildProcess was spawned by this invocation; no PID file is trusted.
    if(child.exitCode===null && child.signalCode===null) {
      const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
    }
    if(readJson(ctx.serviceFile)?.nonce===nonce) fs.unlinkSync(ctx.serviceFile);
    throw error;
  }
}

async function worker() {
  const ctx=await new Promise(resolve=>process.once('message',resolve));
  const log=event=>{try{fs.appendFileSync(path.join(ctx.data,'local-runtime/events.log'),`${new Date().toISOString()} ${event}\n`,{mode:0o600});}catch{/* diagnostic failures never replace lifecycle failures */}};
  let server, prepared, state='starting', record, stopping=false;
  const controller=http.createServer(async(req,res)=>{
    if(req.method!=='POST' || req.headers.authorization!==`Bearer ${ctx.nonce}`) {res.writeHead(403);res.end();return;}
    const reply=(status,extra={})=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({nonce:ctx.nonce,pid:process.pid,projectRoot:ctx.root,gated:state!=='active',schemaVersion:record?.schemaVersion,...extra}));};
    if(req.url==='/status') return reply(200);
    if(req.url==='/activate' && server && !stopping) {server.activate();state='active';log('active');return reply(200);}
    if(req.url==='/stop' && server && !stopping) {
      stopping=true;
      try {
        await server.drain();
        state='stopped';log('stopped');reply(200);
        if(readJson(ctx.serviceFile)?.nonce===ctx.nonce) fs.unlinkSync(ctx.serviceFile);
        controller.close(()=>process.exit(0));
      } catch(error) {stopping=false;state='maintenance';reply(503,{error:error.message==='REQUEST_DRAIN_TIMEOUT'?error.message:'STOP_FAILED'});}
      return;
    }
    reply(503,{error:'NOT_READY'});
  });
  controller.requestTimeout=5000;
  await new Promise(resolve=>controller.listen(0,'127.0.0.1',resolve));
  record={pid:process.pid,nonce:ctx.nonce,projectRoot:ctx.root,port:ctx.port,controlPort:controller.address().port,gitSha:ctx.sha};
  writeJson(ctx.serviceFile,record);
  try {
    const api=await import(pathToFileURL(path.join(ctx.root,'app/server/index.js')));
    prepared=await api.prepareWorkbench({projectRoot:ctx.root,operationId:ctx.operationId});
    server=api.createWorkbenchServer({...prepared,gated:true});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(ctx.port,'127.0.0.1',resolve);});
    record.schemaVersion=server.database.prepare('SELECT max(version) v FROM schema_migrations').get().v;
    const expectedSchema=Math.max(...fs.readdirSync(path.join(ctx.root,'app/server/db/migrations'))
      .filter(name=>/^\d{3}_[a-z0-9_-]+\.sql$/i.test(name)).map(name=>Number(name.slice(0,3))));
    if(record.schemaVersion!==expectedSchema)throw new Error('SCHEMA_HEALTH_MISMATCH');
    writeJson(ctx.serviceFile,record);state='gated';log('ready');process.send?.({ready:true});
  } catch {
    // Never echo migration SQL, dependency stderr or configuration secrets.
    log('startup-failed');
    process.send?.({error:'STARTUP_FAILED'});process.exitCode=1;
    if(server?.database?.isOpen) server.database.close();
    prepared?.lease.release();
    if(readJson(ctx.serviceFile)?.nonce===ctx.nonce) fs.unlinkSync(ctx.serviceFile);
    controller.close();
  }
}
if(process.argv[2]==='worker') worker().catch(()=>process.exit(1));
