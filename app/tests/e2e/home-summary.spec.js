import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { test as base, expect } from '@playwright/test';
import { startTestServer } from '../helpers/test-server.js';

const appDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const evidence=path.resolve(appDir,'../artifacts/home-handoff-review');
const test=base.extend({workbench:async({},use)=>{
  const cleanup=[],server=await startTestServer({after:fn=>cleanup.push(fn)},{appDir});
  try{await use(server);}finally{for(const fn of cleanup.reverse())await fn();}
}});
test.use({locale:'zh-CN',timezoneId:'Asia/Shanghai'});

for(const [device,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]) {
  test(device+' home shows separate live Top 3 and preserves shell and matrix',async({page,workbench})=>{
    const errors=[];
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize(viewport);
    fs.mkdirSync(evidence,{recursive:true});
    await page.goto(workbench.baseUrl);
    const lists=page.locator('.home-summary-rail .home-radar-list');
    await expect(lists.nth(0)).toContainText('暂无值得关注的拍摄机会');
    await expect(lists.nth(1)).toContainText('暂无值得关注的竞品变化');
    await page.screenshot({path:path.join(evidence,device+'-empty.png'),fullPage:true});
    const sidebar=await page.locator('.sidebar').innerHTML();
    const stats=await page.locator('.page-home > .stats-grid').innerHTML();
    const matrix=await page.locator('.platform-section').innerHTML();
    for(const kind of ['hotspot','competitor']) for(let i=0;i<4;i++) {
      const res=await page.request.post(workbench.baseUrl+'/api/v1/observations',{
        headers:{Authorization:'Bearer '+workbench.token,'Idempotency-Key':crypto.randomUUID()},
        data:{kind,title:(kind==='hotspot'?'虚构拍摄机会':'虚构竞品变化')+' '+i+' · 经典车型夜间拍摄与内容方向观察',
          sourcePlatform:'douyin',sourceUrl:'https://example.invalid/'+kind+'/'+i,
          competitorName:kind==='competitor'?'虚构对照账号':undefined,
          worthReason:'仅用于浏览器验收：验证来源说明与两行摘要，不代表真实业务结论。',summary:'虚构观察摘要：连续作品的拍摄方式出现变化。',
          heatScore:90-i,discoveredAt:`2026-09-0${i+1}T01:00:00Z`,
          tags:['SUV,EV','长标签'+ 'W'.repeat(50),'视觉验证']}
      });expect(res.ok()).toBe(true);
    }
    await page.reload();
    await expect(lists.nth(0).locator('article')).toHaveCount(3);
    await expect(lists.nth(1).locator('article')).toHaveCount(3);
    await expect(lists.nth(0)).not.toContainText('虚构竞品变化');
    await expect(lists.nth(1)).not.toContainText('虚构拍摄机会');
    await expect(lists.nth(0).locator('article').first()).toContainText('虚构拍摄机会 0');
    await expect(lists.nth(1).locator('article').first()).toContainText('虚构竞品变化 3');
    await expect(lists.nth(0).locator('article').first()).toContainText('SUV,EV');
    expect(await page.locator('.sidebar').innerHTML()).toBe(sidebar);
    expect(await page.locator('.page-home > .stats-grid').innerHTML()).toBe(stats);
    expect(await page.locator('.platform-section').innerHTML()).toBe(matrix);
    await page.screenshot({path:path.join(evidence,device+'-home.png')});
    await page.screenshot({path:path.join(evidence,device+'-home-full.png'),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const overflowing=await lists.locator('article').evaluateAll(nodes=>nodes.filter(n=>n.scrollWidth>n.clientWidth+1).length);
    expect(overflowing).toBe(0);
    await page.getByRole('link',{name:'查看竞品 →',exact:true}).click();
    await expect(page.getByRole('heading',{level:1,name:'热点 / 竞品观察',exact:true})).toBeVisible();
    expect(errors).toEqual([]);
    fs.writeFileSync(path.join(evidence,device+'-console.json'),JSON.stringify(errors));
  });
}

test('an existing v0.1.1 service worker upgrades cached home assets',async({page,workbench})=>{
  const stage=fs.mkdtempSync(path.join(os.tmpdir(),'home-cache-upgrade-'));
  const cleanup=[];
  let server;
  try {
    fs.cpSync(path.join(appDir,'assets'),path.join(stage,'assets'),{recursive:true});
    for(const name of ['index.html','manifest.webmanifest','sw.js'])fs.copyFileSync(path.join(appDir,name),path.join(stage,name));
    const changed=['sw.js','assets/js/pages/home.js','assets/css/pages/home.css'];
    for(const file of changed)fs.writeFileSync(path.join(stage,file),execFileSync('git',['show','7ce331936ab0a93820fba4d03530349bb1daea9a:app/'+file],{cwd:appDir}));
    server=await startTestServer({after:fn=>cleanup.push(fn)},{appDir:stage});
    await page.goto(server.baseUrl);
    await expect(page.getByRole('heading',{name:'热点雷达摘要',exact:true})).toBeVisible();
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.reload();
    for(const file of changed)fs.copyFileSync(path.join(appDir,file),path.join(stage,file));
    await page.evaluate(async()=>{const r=await navigator.serviceWorker.ready;await r.update();});
    await expect.poll(()=>page.evaluate(()=>caches.keys()),{timeout:5000}).not.toContain('xiaoshang-shell-v9');
    await page.reload();
    await expect(page.getByRole('heading',{name:'拍摄机会雷达',exact:true})).toBeVisible();
    await expect(page.locator('.home-summary-rail').getByRole('heading',{name:'竞品观察',exact:true})).toBeVisible();
    expect(await page.evaluate(async()=>(await Promise.all((await caches.keys()).map(async k=>(await(await caches.open(k)).keys()).filter(r=>new URL(r.url).pathname.startsWith('/api/')).length))).reduce((a,b)=>a+b,0))).toBe(0);
  }finally{
    for(const fn of cleanup.reverse())await fn();
    fs.rmSync(stage,{recursive:true,force:true});
  }
});
