import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startTestServer } from '../helpers/test-server.js';
import { createWorkbuddyClient,loadLocalToken } from '../../../workbuddy/client.mjs';
const cli=fileURLToPath(new URL('../../../workbuddy/client.mjs',import.meta.url));

test('WorkBuddy four intents run against actual API: record search versioned changes views and all four publications',async t=>{
  const s=await startTestServer(t),client=createWorkbuddyClient({baseUrl:s.baseUrl,token:s.token});
  const run=(intent,input={})=>client.execute(intent,{requestKey:randomUUID(),...input});
  const input={body:{rawText:'虚构 FUV 雨夜原话'},requestKey:randomUUID()};
  const inspiration=(await run('remember.inspiration',input)).data;
  assert.equal((await run('remember.inspiration',input)).data.id,inspiration.id);
  const changed=(await run('change.inspiration',{id:inspiration.id,body:{summaryTitle:'虚构雨夜',version:inspiration.version}})).data;
  assert.equal(changed.rawText,input.body.rawText);
  const converted=(await run('convert.inspiration',{id:inspiration.id,body:{version:changed.version,title:'虚构 FUV 内容'}})).data;
  const content=converted.content;assert.equal(content.publications.length,4);
  for(const p of content.publications)await run('remember.publication',{id:content.id,platformCode:p.platformCode,body:{version:p.version,status:'scheduled',scheduledAt:'2026-09-12T10:00:00+08:00'}});
  const event=(await run('remember.shoot',{body:{title:'虚构拍摄',contentId:content.id,startsAt:'2026-09-10T10:00:00+08:00'}})).data;
  await run('change.calendar',{id:event.id,body:{version:event.version,startsAt:'2026-09-11T10:00:00+08:00'}});
  assert.equal((await run('find.calendar',{query:{from:'2026-09-01T00:00:00+08:00',to:'2026-10-01T00:00:00+08:00'}})).data.items.length,5);
  const fresh=(await run('find.contents',{id:content.id})).data;
  await run('change.publication',{id:content.id,platformCode:'douyin',body:{version:fresh.publications[0].version,status:'published',publishedAt:'2026-09-12T10:00:00+08:00'}});
  await run('change.content',{id:content.id,body:{version:fresh.version,status:'producing'}});
  const metrics=(await run('remember.metrics',{body:{sourceName:'虚构WorkBuddy验收',periodStart:'2026-09-01',periodEnd:'2026-09-01',rows:[{contentId:content.id,platformCode:'douyin',views:123}]}})).data;
  assert.equal(metrics.rowsImported,1);assert.equal(metrics.rowsRejected,0);
  const observation=(await run('remember.observation',{body:{kind:'hotspot',title:'虚构热点',sourceUrl:'https://example.invalid',sourcePlatform:'douyin',worthReason:'虚构结构验证'}})).data;
  await run('convert.observation',{id:observation.id,body:{version:observation.version}});
  await run('remember.content',{body:{title:'虚构直接建内容'}});
  await run('remember.report',{body:{periodType:'week',anchorDate:'2026-09-05'}});
  const found=await run('find.all',{query:{search:'虚构'}});assert.equal(found.data.inspirations.length,2);assert.equal(found.data.contents.length,2);assert.equal(found.data.observations.length,1);assert.equal(found.data.reports.length,1);
  for(const [intent,input] of [['view.home',{}],['view.week',{query:{anchorDate:'2026-09-05'}}],['view.performance',{id:content.id}],['view.hotspots',{}],['view.health',{}]])assert.equal((await run(intent,input)).ok,true);
  await assert.rejects(run('change.inspiration',{id:inspiration.id,body:{summaryTitle:'旧版本',version:1}}),e=>e.status===409);
  assert.ok((await (await fetch(`${s.baseUrl}/api/v1/settings`)).json()).data.workbuddy.lastRequestAt);
});

test('WorkBuddy CLI reads private local credential without printing it; missing token and unsafe files fail closed',async t=>{
  const s=await startTestServer(t);
  const invoke=async(input,env={})=>{
    const child=spawn(process.execPath,[cli],{env:{...process.env,WORKBENCH_DATA_DIR:s.config.dataDir,WORKBENCH_URL:s.baseUrl,...env},stdio:['pipe','pipe','pipe']});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.stdin.end(JSON.stringify(input));const [code]=await once(child,'close');return {code,output};
  };
  const success=await invoke({intent:'remember.inspiration',body:{rawText:'虚构CLI灵感'},requestKey:randomUUID()});
  assert.equal(success.code,0);assert.equal(JSON.parse(success.output).data.rawText,'虚构CLI灵感');assert.ok(!success.output.includes(s.token));
  const fail=await invoke({intent:'view.home'},{WORKBENCH_TOKEN_FILE:path.join(s.config.dataDir,'missing.json')});assert.equal(fail.code,1);assert.ok(!fail.output.includes(s.token));
  const linked=path.join(s.config.dataDir,'link.json');fs.symlinkSync(s.config.secretsPath,linked);await assert.rejects(loadLocalToken(linked),/UNSAFE_TOKEN_FILE/);
  fs.chmodSync(s.config.secretsPath,0o644);await assert.rejects(loadLocalToken(s.config.secretsPath),/UNSAFE_TOKEN_FILE/);fs.chmodSync(s.config.secretsPath,0o600);
});
