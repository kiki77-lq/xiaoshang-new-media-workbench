import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { prepareWorkbench, createWorkbenchServer } from '../../server/index.js';
import { createTempWorkbench } from '../helpers/temp-workbench.js';
import { unusedPort } from '../helpers/local-delivery.js';
import { localDelivery, git, command } from '../helpers/local-delivery.js';
import { control } from '../../../scripts/local-runtime.mjs';

const success = result => assert.equal(result.code, 0, result.output);
const failure = (result, pattern) => {assert.notEqual(result.code,0,result.output);assert.match(result.output,pattern);};
const count = data => {const db = new DatabaseSync(path.join(data,'workbench.sqlite'),{readOnly:true});try{return db.prepare('SELECT count(*) AS n FROM inspirations').get().n;}finally{db.close();}};

test('candidate gate denies every business request until activation and shutdown drains accepted bodies', async t=>{
  const temp=createTempWorkbench(t), port=await unusedPort();
  const {config,db}=await prepareWorkbench({projectRoot:temp.projectRoot,env:{WORKBENCH_DATA_DIR:temp.dataDir,WORKBENCH_PORT:String(port),WORKBENCH_GIT_SHA:'fixture-sha'}});
  const server=createWorkbenchServer({config,db,gated:true});
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${url}/api/v1/health`)).status,200);
  assert.equal((await fetch(`${url}/api/v1/inspirations`,{headers:{authorization:`Bearer ${config.authToken}`}})).status,503);
  server.activate();
  const body=JSON.stringify({rawText:'accepted before shutdown'});
  let request;
  const accepted=new Promise((resolve,reject)=>{
    request=http.request(`${url}/api/v1/inspirations`,{method:'POST',headers:{authorization:`Bearer ${config.authToken}`,'idempotency-key':'drain-test','content-type':'application/json','content-length':Buffer.byteLength(body)}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});
    request.on('error',reject);request.write(body.slice(0,5));
  });
  await new Promise(resolve=>setTimeout(resolve,50));
  const draining=server.drain(2000);
  assert.equal((await fetch(`${url}/api/v1/inspirations`)).status,503);
  request.end(body.slice(5));
  assert.equal(await accepted,201);await draining;
  assert.equal(count(temp.dataDir),1);
});

test('local install repeats without replacing data, token or owned process and reports actual running SHA', async t=>{
  const f = await localDelivery(t);
  success(await f.script('install'));
  const first = await f.health(), token = f.read('secrets.json'), state = f.read('local-runtime/service.json');
  assert.equal(first.gitSha,git(f.repo,'rev-parse','HEAD'));
  assert.equal(first.schemaVersion,4);
  await f.remember();
  const repeated = await f.script('install'); success(repeated);
  assert.equal(f.read('secrets.json'),token); assert.equal(f.read('local-runtime/service.json'),state); assert.equal(count(f.data),1);
  assert.ok(!repeated.output.includes(JSON.parse(token).token));
  f.release(); git(f.repo,'pull','--ff-only');
  failure(await f.script('install'),/RUNNING_CODE_MISMATCH/);
  assert.equal((await f.health()).gitSha,first.gitSha);
});

test('unknown port owner and stale PID are never killed or adopted', async t=>{
  const f = await localDelivery(t);
  const server = net.createServer(socket=>socket.end());
  await new Promise(resolve=>server.listen(f.port,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  failure(await f.script('install'),/PORT_IN_USE/);
  assert.equal(server.listening,true);
  fs.mkdirSync(path.join(f.data,'local-runtime'),{recursive:true});
  fs.writeFileSync(path.join(f.data,'local-runtime/service.json'),JSON.stringify({pid:process.pid,nonce:'not-owned',port:f.port,projectRoot:f.repo}));
  failure(await f.cli('stop'),/OWNERSHIP_UNPROVEN/);
  assert.equal(server.listening,true);
  fs.unlinkSync(path.join(f.data,'local-runtime/service.json'));
});

test('real clone fast-forward update preserves data token user files and verifies new health', async t=>{
  const f = await localDelivery(t); success(await f.script('install')); await f.remember();
  const token=f.read('secrets.json'); fs.writeFileSync(path.join(f.repo,'my-notes.txt'),'user owned');
  const next = f.release(); success(await f.script('update'));
  assert.equal((await f.health()).gitSha,next); assert.equal(count(f.data),1); assert.equal(f.read('secrets.json'),token);
  assert.equal(fs.readFileSync(path.join(f.repo,'my-notes.txt'),'utf8'),'user owned');
  assert.equal(git(f.repo,'ls-files','data'),'');
  success(await f.script('update'));
  assert.equal(count(f.data),1);
});

test('dirty tracked files, colliding untracked files and divergence refuse update before stopping service', async t=>{
  const f = await localDelivery(t); success(await f.script('install')); const before=await f.health();
  fs.appendFileSync(path.join(f.repo,'app/package.json'),'\n');
  failure(await f.script('update'),/DIRTY_TRACKED/);
  assert.equal((await f.health()).gitSha,before.gitSha);
  fs.writeFileSync(path.join(f.repo,'app/package.json'),fs.readFileSync(path.join(f.seed,'app/package.json')));
  fs.writeFileSync(path.join(f.repo,'release-marker.txt'),'user collision'); f.release();
  failure(await f.script('update'),/UNTRACKED_COLLISION/);
  assert.equal(fs.readFileSync(path.join(f.repo,'release-marker.txt'),'utf8'),'user collision');
  fs.unlinkSync(path.join(f.repo,'release-marker.txt'));
  git(f.repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','local divergent commit');
  failure(await f.script('update'),/NOT_FAST_FORWARD/);
  assert.equal((await f.health()).gitSha,before.gitSha);
});

test('partially committed migration failure restores old code and database with explicit healthy rollback and resumable update', async t=>{
  const f = await localDelivery(t); success(await f.script('install')); await f.remember();
  const before=await f.health(), token=f.read('secrets.json');
  f.release({'app/server/db/migrations/005_partial.sql':'CREATE TABLE partial_update (id TEXT);', 'app/server/db/migrations/006_broken.sql':'THIS IS DELIBERATELY INVALID SQL;'});
  const result = await f.script('update'); failure(result,/ROLLED_BACK_HEALTHY/);
  assert.equal(git(f.repo,'rev-parse','HEAD'),before.gitSha);
  assert.equal((await f.health()).gitSha,before.gitSha); assert.equal((await f.health()).schemaVersion,4);
  assert.equal(count(f.data),1); assert.equal(f.read('secrets.json'),token);
  const db=new DatabaseSync(path.join(f.data,'workbench.sqlite'),{readOnly:true});
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='partial_update'").get().n,0);db.close();
  assert.match((await f.cli('status')).output,/rolled-back/);
  const fixed=f.release({'app/server/db/migrations/006_broken.sql':'CREATE TABLE repaired_update (id TEXT);'});
  success(await f.script('update')); assert.equal((await f.health()).gitSha,fixed); assert.equal(count(f.data),1);
});

test('pending journal and missing previous database fail closed without new initialization', async t=>{
  const f=await localDelivery(t); success(await f.script('install')); success(await f.cli('stop'));
  fs.renameSync(path.join(f.data,'workbench.sqlite'),path.join(f.data,'saved.sqlite'));
  fs.writeFileSync(path.join(f.data,'local-runtime/update.json'),JSON.stringify({state:'pending',oldSha:git(f.repo,'rev-parse','HEAD')}));
  failure(await f.cli('start'),/PENDING_UPDATE/); failure(await f.script('install'),/PENDING_UPDATE/);
  assert.equal(fs.existsSync(path.join(f.data,'workbench.sqlite')),false);
});

test('unsafe symlink and tracked data targets are refused without modifying their contents', async t=>{
  const f=await localDelivery(t);fs.mkdirSync(f.data);
  const target=path.join(f.root,'private.json');fs.writeFileSync(target,'do not touch');
  fs.symlinkSync(target,path.join(f.data,'secrets.json'));
  failure(await f.script('install'),/UNSAFE_DATA/);assert.equal(fs.readFileSync(target,'utf8'),'do not touch');
  fs.unlinkSync(path.join(f.data,'secrets.json'));
  failure(await f.script('install',{WORKBENCH_DATA_DIR:path.join(f.repo,'app')}),/UNSAFE_DATA/);
  fs.writeFileSync(path.join(f.data,'tracked.txt'),'preserve');git(f.repo,'add','-f','data/tracked.txt');
  failure(await f.script('install'),/TRACKED_DATA/);
});

test('concurrent installers serialize with an exclusive process lock', async t=>{
  const f=await localDelivery(t);
  const results=await Promise.all([f.script('install'),f.script('install')]);
  assert.equal(results.filter(r=>r.code===0).length,1,JSON.stringify(results));
  failure(results.find(r=>r.code!==0),/OPERATION_LOCKED/);
  assert.equal((await f.health()).schemaVersion,4);
});

test('fetch failure leaves healthy old process and database intact', async t=>{
  const f=await localDelivery(t);success(await f.script('install'));await f.remember();
  const before=f.read('local-runtime/service.json');
  fs.renameSync(f.remote,`${f.remote}.offline`);
  failure(await f.script('update'),/FETCH_FAILED/);
  assert.equal(f.read('local-runtime/service.json'),before);assert.equal(count(f.data),1);assert.equal((await f.health()).status,'ok');
});

test('installation binds the checkout to one data directory and refuses changed origin', async t=>{
  const f=await localDelivery(t);success(await f.script('install'));const before=await f.health();
  failure(await f.script('install',{WORKBENCH_DATA_DIR:path.join(f.root,'other-data')}),/INSTALLATION_DATA_MISMATCH/);
  git(f.repo,'remote','set-url','origin',path.join(f.root,'unknown.git'));
  failure(await f.script('update'),/ORIGIN_CHANGED/);
  assert.equal((await f.health()).gitSha,before.gitSha);
});

test('real candidate health failure blocks writes and restores DB token and non-DB operation receipts', async t=>{
  const f=await localDelivery(t);success(await f.script('install'));await f.remember();
  const before=await f.health(),token=f.read('secrets.json');
  fs.mkdirSync(path.join(f.data,'operations'),{recursive:true});fs.writeFileSync(path.join(f.data,'operations','keep.json'),'retained receipt');
  const source=fs.readFileSync(path.join(f.seed,'app/server/index.js'),'utf8');
  // The candidate really starts but returns a failing public health response.
  f.release({'app/server/index.js':source.replace('database: checkDatabase(db),','database: "error",')});
  failure(await f.script('update'),/ROLLED_BACK_HEALTHY/);
  assert.equal((await f.health()).gitSha,before.gitSha);assert.equal(count(f.data),1);
  assert.equal(f.read('secrets.json'),token);assert.equal(f.read('operations/keep.json'),'retained receipt');
});

test('concurrent updates have one owner and keep one healthy process', async t=>{
  const f=await localDelivery(t);success(await f.script('install'));await f.remember();const next=f.release();
  const results=await Promise.all([f.script('update'),f.script('update')]);
  assert.equal(results.filter(r=>r.code===0).length,1,JSON.stringify(results));
  failure(results.find(r=>r.code!==0),/OPERATION_LOCKED/);
  assert.equal((await f.health()).gitSha,next);assert.equal(count(f.data),1);
});

test('dead stored PID can restart but missing initialized DB remains fail closed', async t=>{
  const f=await localDelivery(t);success(await f.script('install'));await f.remember();
  const state=JSON.parse(f.read('local-runtime/service.json'));success(await f.cli('stop'));
  fs.writeFileSync(path.join(f.data,'local-runtime/service.json'),JSON.stringify(state));
  success(await f.cli('start'));assert.equal(count(f.data),1);
  success(await f.cli('stop'));fs.renameSync(path.join(f.data,'workbench.sqlite'),path.join(f.data,'saved.sqlite'));
  failure(await f.cli('start'),/PREVIOUS_DATABASE_MISSING/);assert.equal(fs.existsSync(path.join(f.data,'workbench.sqlite')),false);
});

test('candidate cannot introduce tracked runtime data or replace an ignored user file', async t=>{
  const f=await localDelivery(t);success(await f.script('install'));const before=await f.health();
  fs.writeFileSync(path.join(f.repo,'personal.local'),'user setting');
  fs.writeFileSync(path.join(f.seed,'personal.local'),'upstream collision');git(f.seed,'add','-f','personal.local');
  f.release();failure(await f.script('update'),/UNTRACKED_COLLISION/);
  assert.equal(fs.readFileSync(path.join(f.repo,'personal.local'),'utf8'),'user setting');
  fs.mkdirSync(path.join(f.seed,'data'));fs.writeFileSync(path.join(f.seed,'data','bad.txt'),'not runtime');
  git(f.seed,'add','-f','data/bad.txt');f.release({'release-marker.txt':'bad data commit'});
  failure(await f.script('update'),/TRACKED_DATA_IN_CANDIDATE/);assert.equal((await f.health()).gitSha,before.gitSha);
});

test('explicit crash-gap recovery restores missing DB using old release primitives even if candidate backup module cannot load', async t=>{
  const f=await localDelivery(t);success(await f.script('install'));await f.remember();const before=await f.health();
  f.release({'app/server/services/backup-service.js':'throw new Error("candidate backup module is broken");'});
  failure(await f.script('update'),/ROLLED_BACK_HEALTHY/);success(await f.cli('stop'));
  const journal=JSON.parse(f.read('local-runtime/update.json'));
  git(f.repo,'switch','main');
  fs.renameSync(path.join(f.data,'workbench.sqlite'),path.join(f.data,'crash-gap-original.sqlite'));
  fs.writeFileSync(path.join(f.data,'local-runtime/update.json'),JSON.stringify({...journal,state:'pending',phase:'restoring'}));
  failure(await f.cli('start'),/PENDING_UPDATE/);
  success(await f.cli('recover'));assert.equal((await f.health()).gitSha,before.gitSha);assert.equal(count(f.data),1);
});

test('updater rejects deletion of an immutable prior migration before stopping the old service', async t=>{
  const f=await localDelivery(t);success(await f.script('install'));const before=f.read('local-runtime/service.json');
  fs.unlinkSync(path.join(f.seed,'app/server/db/migrations/001_core.sql'));f.release();
  failure(await f.script('update'),/MIGRATIONS_IMMUTABLE/);
  assert.equal(f.read('local-runtime/service.json'),before);assert.equal((await f.health()).schemaVersion,4);
});

test('recovery with no protected backup never initializes a missing previous database', async t=>{
  const f=await localDelivery(t);success(await f.script('install'));success(await f.cli('stop'));
  const sha=git(f.repo,'rev-parse','HEAD');
  fs.renameSync(path.join(f.data,'workbench.sqlite'),path.join(f.data,'saved.sqlite'));
  fs.writeFileSync(path.join(f.data,'local-runtime/update.json'),JSON.stringify({id:'fixture-gap',state:'pending',phase:'backup',oldSha:sha,newSha:sha,upstream:{ref:'refs/remotes/origin/main'}}));
  const result=await f.cli('recover');failure(result,/PREVIOUS_DATABASE_MISSING/);
  assert.equal(fs.existsSync(path.join(f.data,'workbench.sqlite')),false);
});

test('candidate schema must match release migrations before any promotion', async t=>{
  const f=await localDelivery(t);success(await f.script('install'));await f.remember();const before=await f.health();
  const source=fs.readFileSync(path.join(f.seed,'app/server/index.js'),'utf8');
  f.release({'app/server/index.js':source.replace('runMigrations(db, options);','void options;'), 'app/server/db/migrations/005_expected.sql':'CREATE TABLE expected (id TEXT);'});
  failure(await f.script('update'),/ROLLED_BACK_HEALTHY/);
  assert.equal((await f.health()).gitSha,before.gitSha);assert.equal(count(f.data),1);
});

test('failed first-install activation stops the newly launched gated worker', async t=>{
  const f=await localDelivery(t),file=path.join(f.repo,'scripts/local-runtime.mjs');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace("if(req.url==='/activate' && server && !stopping)","if(false && req.url==='/activate' && server && !stopping)"));
  failure(await f.script('install'),/CONTROL_FAILED/);
  const status=await f.cli('status');success(status);assert.match(status.output,/"state":"stopped"/);
  assert.equal(fs.existsSync(path.join(f.data,'local-runtime/service.json')),false);
});

test('lock cleanup failure never masks the primary startup failure', async t=>{
  const f=await localDelivery(t),file=path.join(f.repo,'app/server/index.js');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('const config = loadConfig({ projectRoot, env });',`const lockOwner = path.join(projectRoot, '.git', 'workbench-operation.lock', 'owner.json');
  fs.unlinkSync(lockOwner); fs.mkdirSync(lockOwner); throw new Error('injected startup failure');
  const config = loadConfig({ projectRoot, env });`));
  const result=await f.script('install');failure(result,/STARTUP_FAILED/);assert.match(result.output,/LOCK_CLEANUP_FAILED/);
  assert.equal(fs.existsSync(path.join(f.data,'local-runtime/service.json')),false);
});

test('a dead command owner does not authorize blind lock deletion while orphan subprocesses may still run', async t=>{
  const f=await localDelivery(t);success(await f.script('install'));
  const {pid}=JSON.parse(f.read('local-runtime/service.json'));success(await f.cli('stop'));
  const dir=path.join(f.repo,'.git','workbench-operation.lock');fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir,'owner.json'),JSON.stringify({pid,nonce:'fixture-dead-owner'}));
  failure(await f.cli('unlock'),/LOCK_RECOVERY_REQUIRES_INSPECTION/);
  assert.equal(fs.existsSync(path.join(dir,'owner.json')),true);
  failure(await f.script('install'),/OPERATION_LOCKED/);
});

test('managed runtime records safe lifecycle events without logging the bearer token', async t=>{
  const f=await localDelivery(t);success(await f.script('install'));const token=JSON.parse(f.read('secrets.json')).token;
  assert.equal(fs.existsSync(path.join(f.data,'local-runtime/events.log')),true);
  const log=f.read('local-runtime/events.log');assert.match(log,/ready/);assert.ok(!log.includes(token));
});

test('candidate ignore rules cannot delete runtime protection before pull', async t=>{
  const f=await localDelivery(t);success(await f.script('install'));await f.remember();
  const sha=git(f.repo,'rev-parse','HEAD'),state=f.read('local-runtime/service.json'),token=f.read('secrets.json');
  const rules=fs.readFileSync(path.join(f.repo,'.gitignore'),'utf8');
  f.release({'.gitignore':'node_modules/\n'});
  try {
    failure(await f.script('update'),/CANDIDATE_DATA_NOT_IGNORED/);
    assert.equal(git(f.repo,'rev-parse','HEAD'),sha);
    assert.equal(fs.readFileSync(path.join(f.repo,'.gitignore'),'utf8'),rules);
    assert.equal(f.read('local-runtime/service.json'),state);assert.equal(f.read('secrets.json'),token);
    assert.equal((await f.health()).gitSha,sha);assert.equal(count(f.data),1);
    assert.equal(fs.existsSync(path.join(f.data,'local-runtime/update.json')),false);
  } finally {
    // A RED candidate can break the CLI's own preflight. Clean up only this
    // fixture's authenticated worker without repairing its ignore rules.
    if(fs.existsSync(path.join(f.data,'local-runtime/service.json')))await control(JSON.parse(f.read('local-runtime/service.json')),'stop');
  }
});

test('candidate ignore rules must protect every runtime target even when service.json stays ignored', async t=>{
  const f=await localDelivery(t);success(await f.script('install'));await f.remember();
  const sha=git(f.repo,'rev-parse','HEAD'),state=f.read('local-runtime/service.json'),token=f.read('secrets.json');
  const rules=fs.readFileSync(path.join(f.repo,'.gitignore'),'utf8');
  try {
    for(const target of ['secrets.json','workbench.sqlite','workbench.sqlite-wal','workbench.sqlite-shm',
      'backups/retained.json','operations/receipt.json','local-runtime/update.json','imports/source.csv','logs/server.log','future-runtime-file']) {
      f.release({'.gitignore':`node_modules/\n/data/**\n!/data/\n!/data/backups/\n!/data/operations/\n!/data/local-runtime/\n!/data/imports/\n!/data/logs/\n!/data/${target}\n/data/local-runtime/service.json\n`});
      const result=await f.script('update');failure(result,/CANDIDATE_DATA_NOT_IGNORED/);
      assert.equal(git(f.repo,'rev-parse','HEAD'),sha,target);
      assert.equal(fs.readFileSync(path.join(f.repo,'.gitignore'),'utf8'),rules,target);
      assert.equal(f.read('local-runtime/service.json'),state,target);assert.equal(f.read('secrets.json'),token,target);
      assert.equal((await f.health()).gitSha,sha,target);assert.equal(count(f.data),1,target);
      assert.equal(fs.existsSync(path.join(f.data,'local-runtime/update.json')),false,target);
    }
  } finally {
    if(fs.existsSync(path.join(f.data,'local-runtime/service.json')))await control(JSON.parse(f.read('local-runtime/service.json')),'stop');
  }
});
