import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test,expect } from '@playwright/test';
import { localDelivery,git } from '../helpers/local-delivery.js';
import { startTestServer } from '../helpers/test-server.js';
import { createWorkbuddyClient,loadLocalToken } from '../../../workbuddy/client.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const artifactRoot=path.join(root,'artifacts/v1-final');
test.use({locale:'zh-CN',timezoneId:'America/Los_Angeles'});
const title='虚构 FUV · V1 全流程验收';
const rawText='虚构 FUV 雨夜拍摄，保留原始灵感，不代表真实老板业务。';
const dates={from:'2026-09-01T00:00:00+08:00',to:'2026-10-01T00:00:00+08:00'};
const request=(client,intent,input={})=>client.execute(intent,{requestKey:crypto.randomUUID(),...input});
async function api(baseUrl,token,endpoint,body,method='POST'){
  const response=await fetch(`${baseUrl}/api/v1${endpoint}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:body===undefined?undefined:JSON.stringify(body)});
  const envelope=await response.json();expect(response.ok,JSON.stringify(envelope)).toBe(true);return envelope.data;
}
const metrics=contentId=>({sourceName:'虚构 V1 验收数据',periodStart:'2026-09-01',periodEnd:'2026-09-01',rows:[{contentId,platformCode:'douyin',views:1234,likes:37,comments:9,net_followers:5,series:[
  ...[100,230,140].map((value,position)=>({seriesKey:'traffic_lifecycle',position,label:`${position+1}小时`,value,unit:'count'})),
  ...[1,.7,.4].map((value,position)=>({seriesKey:'retention',position:position*5,label:`${position*5}秒`,value,unit:'ratio'})),
  ...[3,9,2].map((value,position)=>({seriesKey:'engagement_timeline',position,label:`段落${position+1}`,value,unit:'count'})),
  ...[.7,.3].map((value,position)=>({seriesKey:'traffic_source',position,label:['推荐','搜索'][position],value,unit:'ratio'}))
],review:{summary:'纯虚构验收复盘，非真实运营结论',dataQuality:'partial',generatedBy:'human',findings:[
  {findingType:'strength',title:'虚构实测结构',body:'已录入三段流量数据',evidenceLevel:'observed',evidence:['traffic_lifecycle']},
  {findingType:'issue',title:'开场留存待验证',body:'此处是推断而非事实',evidenceLevel:'inferred',calculationNote:'由虚构留存曲线提出假设',evidence:['retention']},
  {findingType:'recommendation',title:'下一条做开场实验',body:'需要新数据验证',evidenceLevel:'inferred',calculationNote:'由留存假设提出实验',evidence:['retention']},
  {findingType:'high_engagement_segment',title:'虚构段落2',body:'已知互动序列最高',evidenceLevel:'derived',calculationNote:'max(3,9,2)=9',evidence:['engagement_timeline']}
]}}]});
const observation={kind:'hotspot',title:'虚构 FUV 热点候选',summary:'虚构人工来源摘要',sourceUrl:'https://example.invalid/v1',sourcePlatform:'douyin',worthReason:'验证热点到灵感链路',heatScore:76};

async function invokeBossClient(f,input){
  const child=spawn(process.execPath,['workbuddy/client.mjs'],{cwd:f.repo,env:{...process.env,...f.env,WORKBENCH_URL:`http://127.0.0.1:${f.port}`},stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.end(JSON.stringify({...input,requestKey:crypto.randomUUID()}));
  const [code]=await once(child,'close');expect(code,stderr).toBe(0);return JSON.parse(stdout);
}

test('V1 complete 27-step fresh installation business WorkBuddy update migration and restore journey',async({page})=>{
  test.setTimeout(300_000);
  const cleanup=[],f=await localDelivery({after:fn=>cleanup.push(fn)});let token,client,inspiration,content,event,backup,reportId,nextSha;
  const baseUrl=`http://127.0.0.1:${f.port}`,errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(e.message));
  try{
    await test.step('01 install',async()=>{const r=await f.script('install');expect(r.code,r.output).toBe(0);token=await loadLocalToken(path.join(f.data,'secrets.json'));client=createWorkbuddyClient({baseUrl,token});});
    await test.step('02 health',async()=>expect((await request(client,'view.health')).data.database).toBe('ok'));
    await test.step('03 inspiration',async()=>{inspiration=(await request(client,'remember.inspiration',{body:{rawText}})).data;});
    await test.step('04 convert content',async()=>{content=(await request(client,'convert.inspiration',{id:inspiration.id,body:{version:inspiration.version,title}})).data.content;});
    await test.step('05 four publications',async()=>expect(content.publications.map(p=>p.platformCode)).toEqual(['douyin','wechat_channels','xiaohongshu','weibo']));
    await test.step('06 filming',async()=>{event=(await request(client,'remember.shoot',{body:{title:'虚构 FUV 拍摄',contentId:content.id,startsAt:'2026-09-07T10:00:00+08:00'}})).data;});
    await test.step('07 distinct publication times',async()=>{for(const [i,p] of content.publications.entries())await request(client,'remember.publication',{id:content.id,platformCode:p.platformCode,body:{version:p.version,status:'scheduled',scheduledAt:`2026-09-${10+i}T18:00:00+08:00`}});});
    await test.step('08 calendar sync',async()=>expect((await request(client,'find.calendar',{query:dates})).data.items).toHaveLength(5));
    await test.step('09 change publication time',async()=>{const c=(await request(client,'find.contents',{id:content.id})).data;await request(client,'change.publication',{id:content.id,platformCode:'douyin',body:{version:c.publications[0].version,scheduledAt:'2026-09-15T19:00:00+08:00'}});});
    await test.step('10 browser refresh persistence',async()=>{await page.goto(`${baseUrl}/calendar`);await page.getByLabel('显示月份').fill('2026-09');await page.reload();await expect(page.locator('[data-calendar-day="2026-09-15"]')).toContainText('抖音');});
    await test.step('11 import metrics',async()=>{const r=(await request(client,'remember.metrics',{body:metrics(content.id)})).data;expect(r.rowsImported).toBe(1);expect(r.rowsRejected).toBe(0);});
    await test.step('12 overview',async()=>{await page.goto(`${baseUrl}/analytics`);await page.getByLabel('统计月份').fill('2026-09');await expect(page.locator('[data-metric="analytics-views"] strong')).toHaveText('1,234');});
    await test.step('13 content review',async()=>{await page.goto(`${baseUrl}/analytics?contentId=${content.id}`);await expect(page.locator('[data-content-review] svg')).toHaveCount(4);});
    await test.step('14 weekly snapshot',async()=>{reportId=(await request(client,'remember.report',{body:{periodType:'week',anchorDate:'2026-09-05'}})).data.id;});
    await test.step('15 hotspot',async()=>{event=(await request(client,'remember.observation',{body:observation})).data;});
    await test.step('16 hotspot conversion',async()=>expect((await request(client,'convert.observation',{id:event.id,body:{version:event.version}})).data.inspiration.rawText).toContain(observation.title));
    await test.step('17 WorkBuddy remember CLI',async()=>{inspiration=(await invokeBossClient(f,{intent:'remember.inspiration',body:{rawText:'虚构 WorkBuddy 记找改看'}})).data;});
    await test.step('18 WorkBuddy find CLI',async()=>expect((await invokeBossClient(f,{intent:'find.all',query:{search:'虚构'}})).data.inspirations).toHaveLength(3));
    await test.step('19 WorkBuddy change CLI',async()=>expect((await invokeBossClient(f,{intent:'change.inspiration',id:inspiration.id,body:{summaryTitle:'虚构整理标题',version:inspiration.version}})).data.rawText).toBe('虚构 WorkBuddy 记找改看'));
    await test.step('20 WorkBuddy view CLI',async()=>expect((await invokeBossClient(f,{intent:'view.home'})).ok).toBe(true));
    await test.step('21 backup',async()=>{backup=await api(baseUrl,token,'/backups',{});expect(backup.verified).toBe(true);});
    await page.goto('about:blank');
    await test.step('22 simulated update',async()=>{nextSha=f.release({'app/server/db/migrations/005_fixture_upgrade.sql':'CREATE TABLE fixture_upgrade (id INTEGER PRIMARY KEY);\n'});const r=await f.script('update');expect(r.code,r.output).toBe(0);});
    await test.step('23 migration',async()=>expect((await f.health()).schemaVersion).toBe(5));
    await test.step('24 health SHA',async()=>expect((await f.health()).gitSha).toBe(nextSha));
    await test.step('25 data preserved',async()=>{expect((await request(client,'find.inspirations')).data.items).toHaveLength(3);expect((await request(client,'find.reports',{id:reportId})).data.id).toBe(reportId);expect(await loadLocalToken(path.join(f.data,'secrets.json'))).toBe(token);});
    await request(client,'remember.inspiration',{body:{rawText:'虚构恢复前暂存'}});
    await test.step('26 verify and explicitly restore backup',async()=>{const v=await api(baseUrl,token,`/backups/${backup.id}/verify`,{});const result=await api(baseUrl,token,`/backups/${backup.id}/restore`,{confirmationToken:v.confirmationToken,confirmText:'恢复'});expect(result.health.database).toBe('ok');});
    await test.step('27 restored data correct',async()=>{expect((await request(client,'find.inspirations')).data.items).toHaveLength(3);expect((await request(client,'find.contents',{id:content.id})).data.publications[0].scheduledAt).toBe('2026-09-15T11:00:00.000Z');expect((await request(client,'find.reports',{id:reportId})).data.id).toBe(reportId);expect((await f.health()).schemaVersion).toBe(5);});
    expect(errors).toEqual([]);
  }finally{await page.goto('about:blank');for(const fn of cleanup.reverse())await fn();}
});

test('V1 nine real views desktop and mobile screenshots with no console error',async({page})=>{
  test.setTimeout(120_000);const cleanup=[];
  const s=await startTestServer({after:fn=>cleanup.push(fn)},{appDir:path.join(root,'app'),gitSha:git(root,'rev-parse','HEAD')});
  const client=createWorkbuddyClient({baseUrl:s.baseUrl,token:s.token}),errors=[];
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(e.message));
  try{
    const inspiration=(await request(client,'remember.inspiration',{body:{rawText,summaryTitle:'虚构 FUV 雨夜灵感',pinned:true,tags:['虚构验收']}})).data;
    const c=(await request(client,'convert.inspiration',{id:inspiration.id,body:{version:inspiration.version,title}})).data.content;
    await request(client,'change.content',{id:c.id,body:{version:c.version,status:'producing'}});
    for(const [i,p] of c.publications.entries())await request(client,'remember.publication',{id:c.id,platformCode:p.platformCode,body:{version:p.version,status:'scheduled',scheduledAt:`2026-09-${10+i}T18:00:00+08:00`}});
    await request(client,'remember.shoot',{body:{title:'虚构拍摄安排',contentId:c.id,startsAt:'2026-09-08T10:00:00+08:00'}});
    await api(s.baseUrl,s.token,'/calendar-events',{title:'虚构待确认',eventType:'pending_confirmation',startsAt:'2026-09-09T10:00:00+08:00'});
    await request(client,'remember.metrics',{body:metrics(c.id)});
    await request(client,'remember.observation',{body:observation});
    await request(client,'remember.report',{body:{periodType:'week',anchorDate:'2026-09-05'}});
    await api(s.baseUrl,s.token,'/backups',{});
    const views=[['home','/'],['inspirations','/inspirations'],['contents','/contents'],['calendar','/calendar'],['analytics','/analytics'],['review',`/analytics?contentId=${c.id}`],['reports','/reports'],['observations','/observations'],['settings','/settings']];
    for(const viewport of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]){
      await page.setViewportSize(viewport);
      for(const [name,url] of views){
        await page.goto(`${s.baseUrl}${url}`);await expect(page.locator('main')).toHaveAttribute('data-page',name==='review'?'analytics':name);
        if(viewport.name==='mobile'){const quick=await page.locator('[data-quick-inspiration]').boundingBox();expect(quick.height).toBe(42);expect(quick.width).toBe(42);}
        if(name==='calendar'){await page.getByLabel('显示月份').fill('2026-09');await expect(page.locator('.calendar-grid [data-event-type="publish"]')).toHaveCount(4);}
        if(name==='analytics'){await page.getByLabel('统计月份').fill('2026-09');await expect(page.locator('[data-metric="analytics-views"] strong')).toHaveText('1,234');}
        if(name==='review')await expect(page.locator('[data-content-review] svg')).toHaveCount(4);
        if(name==='settings')await expect(page.locator('[data-backup]')).toHaveCount(1);
        if(name==='reports')await expect(page.locator('[data-report-snapshot]')).toHaveCount(1);
        await expect(page.locator('main [role="status"]')).toHaveCount(0);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        fs.mkdirSync(path.join(artifactRoot,viewport.name),{recursive:true});
        await page.screenshot({path:path.join(artifactRoot,viewport.name,`${name}.png`),fullPage:true});
      }
    }
    await expect.poll(()=>page.evaluate(async()=>Boolean(await navigator.serviceWorker.getRegistration()))).toBe(true);
    expect(errors).toEqual([]);
  }finally{await page.goto('about:blank');for(const fn of cleanup.reverse())await fn();}
});
