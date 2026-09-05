import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { test as base, expect } from '@playwright/test';
import { startTestServer } from '../helpers/test-server.js';

const appDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const artifactRoot=path.resolve(appDir,'../artifacts/phase-5');
const test=base.extend({workbench:async({},use)=>{
  const cleanup=[];
  const server=await startTestServer({after:fn=>cleanup.push(fn)},{appDir});
  try {await use(server);} finally {for(const fn of cleanup.reverse())await fn();}
}});
test.use({timezoneId:'America/Los_Angeles',locale:'zh-CN'});

// Entirely fictional FUV-shaped fixture, not copied from the boss's report.
const title='智界 FUV 类型 · 纯虚构导入验收';
const series=[
  ...[21,34,13].map((value,position)=>({seriesKey:'traffic_lifecycle',position,label:`第 ${position+1} 小时`,value,unit:'count',evidenceLevel:'observed'})),
  ...[1,.65,.31].map((value,position)=>({seriesKey:'retention',position:position*5,label:`${position*5} 秒`,value,unit:'ratio',evidenceLevel:'observed'})),
  ...[3,8,2].map((value,position)=>({seriesKey:'engagement_timeline',position,label:`段落 ${position+1}`,value,unit:'count',evidenceLevel:'observed'})),
  ...[.6,.4].map((value,position)=>({seriesKey:'traffic_source',position,label:['推荐','搜索'][position],value,unit:'ratio',evidenceLevel:'observed'}))
];
const review={summary:'虚构验收：不要当作运营事实',dataQuality:'partial',generatedBy:'human',findings:[
  {findingType:'strength',title:'虚构指标摘要',body:'有已提供的留存序列',evidenceLevel:'observed',evidence:['retention']},
  {findingType:'issue',title:'开头可能需要更紧凑',body:'这是待验证假设',evidenceLevel:'inferred',calculationNote:'仅根据虚构留存序列提出假设',evidence:{seriesKey:'retention'}},
  {findingType:'recommendation',title:'下一条测试更短开场',body:'需要新样本验证',evidenceLevel:'inferred',calculationNote:'根据留存假设提出实验',evidence:['retention']},
  {findingType:'high_engagement_segment',title:'段落 2',body:'当前导入序列中的最大值',evidenceLevel:'derived',calculationNote:'max(3,8,2)=8',evidence:{seriesKey:'engagement_timeline',position:1}}
]};
const quote=value=>`"${String(value).replaceAll('"','""')}"`;
async function shot(page,name) {
  fs.mkdirSync(artifactRoot,{recursive:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const dialog=page.getByRole('dialog');
  if(await dialog.count()) {
    await dialog.getByRole('button',{name:'返回看板',exact:true}).scrollIntoViewIfNeeded();
    const box=await dialog.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(box.y+box.height).toBeLessThanOrEqual(page.viewportSize().height);
    expect(await dialog.evaluate(d=>d.scrollWidth<=d.clientWidth)).toBe(true);
    const actionBox=await dialog.getByRole('button',{name:'返回看板',exact:true}).boundingBox();
    expect(actionBox.y+actionBox.height).toBeLessThanOrEqual(page.viewportSize().height);
  }
  await page.screenshot({path:path.join(artifactRoot,`${name}.png`),fullPage:!(await dialog.count())});
}
async function importFile(page,{sourceType,contentId,name,buffer}) {
  await page.getByRole('button',{name:'＋ 导入数据',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'导入运营数据',exact:true});
  await dialog.getByLabel('输入方式').selectOption(sourceType);
  await dialog.getByLabel('数据对象').selectOption(contentId);
  await dialog.getByLabel('选择文件').setInputFiles({name,mimeType:sourceType==='csv'?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
  await dialog.getByRole('button',{name:'确认导入',exact:true}).click();
  await expect(dialog.locator('[data-ingestion-result]')).toBeVisible();
  return dialog;
}

for(const viewport of [{width:1440,height:900,name:'desktop'},{width:390,height:844,name:'mobile'}]) {
  test(`${viewport.name}: CSV and Excel to real overview and persisted evidence review`,async({page,workbench})=>{
    test.setTimeout(120_000);
    const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize(viewport);
    const created=await page.request.post(`${workbench.baseUrl}/api/v1/contents`,{headers:{Origin:workbench.baseUrl,'Idempotency-Key':'fictional-content'},data:{title}});
    expect(created.status()).toBe(201);const content=(await created.json()).data;
    await page.goto(`${workbench.baseUrl}/analytics`);
    await page.getByLabel('统计月份').fill('2026-09');
    await expect(page.locator('[data-review-content] option')).toHaveCount(2);
    const headers=['播放量','点赞数','评论数','完播率','备注','series','review'];
    const csv=[headers.join(','),[3210,64,12,'31%','虚构,带逗号\n及换行',JSON.stringify(series),JSON.stringify(review)].map(quote).join(','),[-1,2,1,'10%','无效行','',''].map(quote).join(',')].join('\r\n');
    const csvDialog=await importFile(page,{sourceType:'csv',contentId:content.id,name:'fictional-fuv.csv',buffer:Buffer.from(csv)});
    await expect(csvDialog.locator('[data-ingestion-result]')).toContainText('成功 1 行 · 失败 1 行');
    await shot(page,`${viewport.name}-csv-import`);
    await csvDialog.getByRole('button',{name:'返回看板',exact:true}).click();
    await expect(page.locator('[data-metric="analytics-views"] strong')).toHaveText('3,210');
    await shot(page,`${viewport.name}-overview`);
    await page.goto(`${workbench.baseUrl}/contents`);
    await page.getByRole('button',{name:`查看内容 ${title}`,exact:true}).click();
    await page.getByRole('link',{name:'作品复盘',exact:true}).click();
    await expect(page.locator('[data-content-review]')).toContainText(title);
    await expect(page.locator('[data-content-review] svg')).toHaveCount(4);
    await expect(page.locator('[data-content-review]')).toContainText('推断 · 非事实');
    await expect(page.locator('[data-content-review]')).toContainText('计算结果');
    await expect(page.locator('[data-content-review]')).toContainText('fictional-fuv.csv');
    await page.reload();await expect(page.locator('[data-content-review] svg')).toHaveCount(4);
    await shot(page,`${viewport.name}-review`);
    await page.getByRole('tab',{name:'数据总览',exact:true}).click();
    const workbook=XLSX.utils.book_new();const sheet=XLSX.utils.aoa_to_sheet([headers,[4321,83,17,.42,'虚构Excel',JSON.stringify(series),JSON.stringify(review)]]);sheet.D2.z='0.0%';XLSX.utils.book_append_sheet(workbook,sheet,'FUV-fixture');
    const excelDialog=await importFile(page,{sourceType:'excel',contentId:content.id,name:'fictional-fuv.xlsx',buffer:XLSX.write(workbook,{type:'buffer',bookType:'xlsx'})});
    await expect(excelDialog.locator('[data-ingestion-result]')).toContainText('成功 1 行 · 失败 0 行');
    await excelDialog.getByRole('button',{name:'返回看板',exact:true}).click();
    await page.getByRole('tab',{name:'数据总览',exact:true}).click();
    await expect(page.locator('[data-metric="analytics-views"] strong')).toHaveText('4,321');
    await page.reload();await page.getByRole('tab',{name:'数据总览',exact:true}).click();
    await expect(page.locator('[data-metric="analytics-views"] strong')).toHaveText('4,321');
    expect(workbench.db.prepare('SELECT count(*) n FROM metric_snapshots').get().n).toBe(2);
    expect(errors).toEqual([]);
  });
}

test('manual UI preserves zero, missing values and source account scope',async({page,workbench})=>{
  await page.goto(`${workbench.baseUrl}/analytics`);
  await expect(page.locator('[data-metric="analytics-views"] strong')).toHaveText('—');
  await page.getByRole('button',{name:'＋ 导入数据',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('播放 / 阅读',{exact:true}).fill('0');
  await dialog.getByLabel('新增粉丝',{exact:true}).fill('9');
  await dialog.getByRole('button',{name:'确认导入',exact:true}).click();
  await expect(dialog.locator('[data-ingestion-result]')).toContainText('成功 1 行');
  await dialog.getByRole('button',{name:'返回看板',exact:true}).click();
  await expect(page.locator('[data-metric="analytics-views"] strong')).toHaveText('0');
  const snap=workbench.db.prepare('SELECT platform_id,publication_id FROM metric_snapshots').get();
  expect(snap.platform_id).not.toBeNull();expect(snap.publication_id).toBeNull();
  expect(workbench.db.prepare("SELECT count(*) n FROM metric_values WHERE metric_key='likes'").get().n).toBe(0);
});

test.describe('deterministic HTTP failure injection',()=>{
// Playwright routing cannot intercept a request already owned by a service worker.
// The normal journeys above keep SW enabled; this fault-injection case blocks it.
test.use({serviceWorkers:'block'});
test('failed month switch hides stale KPI and mixed evidence stays visibly distinct on both viewports',async({page,workbench})=>{
  const created=await page.request.post(`${workbench.baseUrl}/api/v1/contents`,{headers:{Origin:workbench.baseUrl,'Idempotency-Key':'mixed-content'},data:{title:'虚构混合证据验收'}});
  const content=(await created.json()).data;
  const imported=await page.request.post(`${workbench.baseUrl}/api/v1/ingestion`,{headers:{Origin:workbench.baseUrl,'Idempotency-Key':'mixed-import'},data:{sourceType:'manual',sourceName:'fictional-mixed',periodStart:'2026-09-01',periodEnd:'2026-09-30',rows:[{contentId:content.id,platformCode:'douyin',views:9876,series:[
    {seriesKey:'traffic_lifecycle',position:0,label:'0小时',value:10,unit:'count',evidenceLevel:'observed'},
    {seriesKey:'traffic_lifecycle',position:1,label:'1小时',value:30,unit:'count',evidenceLevel:'inferred',calculationNote:'虚构假设',evidence:['fixture']},
    {seriesKey:'traffic_lifecycle',position:2,label:'2小时',value:7,unit:'count',evidenceLevel:'derived',calculationNote:'虚构计算',evidence:['fixture']}
  ]}]}});
  expect(imported.status()).toBe(201);
  for(const viewport of [{width:1440,height:900,name:'desktop'},{width:390,height:844,name:'mobile'}]) {
    await page.setViewportSize(viewport);await page.goto(`${workbench.baseUrl}/analytics`);
    await page.getByLabel('统计月份').fill('2026-09');
    await expect(page.locator('[data-metric="analytics-views"] strong')).toHaveText('9,876');
    // Deliberate transport failure is expected here, not a normal-path console error.
    await page.route('**/api/v1/analytics/overview?month=2026-10',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'UNAVAILABLE',message:'测试注入：本月暂不可用'},requestId:'month-failure-test'})}));
    await page.getByLabel('统计月份').fill('2026-10');
    await expect(page.getByRole('alert')).toContainText('month-failure-test');
    await expect(page.locator('[data-metric="analytics-views"] strong')).toHaveText('—');
    await expect(page.getByText(/已隐藏 2026-09 的旧数据/)).toBeVisible();
    await page.unroute('**/api/v1/analytics/overview?month=2026-10');
    await page.goto(`${workbench.baseUrl}/analytics?contentId=${content.id}`);
    const chart=page.locator('[data-content-review] .metric-chart');
    await expect(chart.locator('[data-point-evidence="inferred"]')).toHaveCount(1);
    await expect(chart.locator('.chart-inference-warning')).toContainText('1小时（30）');
    await expect(chart.locator('.chart-inference-warning')).toBeVisible();
    await expect(chart.locator('line,polyline')).toHaveCount(0);
    await expect(chart.locator('[data-point-evidence="inferred"]')).toHaveCSS('stroke','rgb(154, 107, 255)');
    await expect(chart.locator('[data-point-evidence="observed"]')).toHaveCSS('fill','rgb(36, 214, 154)');
    await expect(chart.locator('[data-point-evidence="derived"]')).toHaveCSS('fill','rgb(19, 200, 245)');
    await shot(page,`${viewport.name}-mixed-evidence`);
  }
});
});
