import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import { startTestServer } from '../helpers/test-server.js';

const appDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const artifactRoot=path.resolve(appDir,'../artifacts/phase-6');
const test=base.extend({workbench:async({},use)=>{
  const cleanup=[];const server=await startTestServer({after:fn=>cleanup.push(fn)},{appDir});
  try {await use(server);}finally{for(const fn of cleanup.reverse())await fn();}
}});
test.use({locale:'zh-CN',timezoneId:'America/Los_Angeles'});
async function shot(page,name) {
  fs.mkdirSync(artifactRoot,{recursive:true});
  await expect(page.locator('.toast')).toHaveCount(0);
  const dialog=page.getByRole('dialog');
  if(await dialog.count()) {
    await dialog.locator('[type="submit"]').scrollIntoViewIfNeeded();
    const box=await dialog.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width);expect(box.y+box.height).toBeLessThanOrEqual(page.viewportSize().height);
    expect(await dialog.evaluate(d=>d.scrollWidth<=d.clientWidth)).toBe(true);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:path.join(artifactRoot,`${name}.png`),fullPage:!(await dialog.count())});
}
async function call(page,server,endpoint,body,method='post') {
  const response=await page.request[method](`${server.baseUrl}/api/v1${endpoint}`,{headers:{Origin:server.baseUrl,'Idempotency-Key':crypto.randomUUID()},data:body});
  expect(response.ok()).toBe(true);return (await response.json()).data;
}
async function keyword(page,text) {
  await page.getByRole('button',{name:'编辑关键词',exact:true}).click();
  await page.getByLabel('关键词（每行一个）').fill(text);
  await page.getByRole('button',{name:'保存关键词',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function saveReport(page) {
  await page.getByRole('button',{name:'预览新报告',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'报告预览',exact:true});
  await expect(dialog).toContainText('本地规则汇总 · 非 AI');
  await dialog.getByRole('button',{name:'保存报告快照',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-report-snapshot]')).toHaveAttribute('data-report-snapshot',/.+/);
  return page.locator('[data-report-snapshot]').getAttribute('data-report-snapshot');
}

for(const viewport of [{width:1440,height:900,name:'desktop'},{width:390,height:844,name:'mobile'}]) {
  test(`${viewport.name}: observations to immutable week/month reports and confirmed live recovery`,async({page,context,workbench})=>{
    test.setTimeout(150_000);
    const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize(viewport);
    await page.goto(`${workbench.baseUrl}/observations`);
    await page.getByRole('button',{name:'＋ 新增观察',exact:true}).click();
    await page.getByLabel('观察标题',{exact:true}).fill('虚构 FUV 热点观察');
    await page.getByLabel('来源链接',{exact:true}).fill('https://example.invalid/fictional-fuv');
    await page.getByLabel('人工热度（0–100，可空）').fill('78');
    await page.getByLabel('来源摘要（非自动 AI）').fill('虚构来源摘要，不能当成真实运营结论');
    await page.getByLabel('值得关注的原因').fill('虚构测试：值得做选题验证');
    await page.getByRole('button',{name:'保存观察',exact:true}).click();
    await expect(page.locator('[data-observation]')).toHaveCount(1);
    await page.getByRole('button',{name:'收入灵感',exact:true}).click();
    await page.getByRole('button',{name:'确认收入灵感',exact:true}).click();
    await expect(page.locator('[data-observation]')).toContainText('已收入灵感');
    await expect(page.getByRole('button',{name:'收入灵感',exact:true})).toBeDisabled();
    await page.reload();await expect(page.locator('[data-observation]')).toContainText('已收入灵感');
    const inspirationList=(await (await page.request.get(`${workbench.baseUrl}/api/v1/inspirations`)).json()).data.items;
    expect(inspirationList).toHaveLength(1);expect(inspirationList[0].rawText).toContain('虚构 FUV');
    await page.getByRole('button',{name:'＋ 新增观察',exact:true}).click();
    await page.getByLabel('观察类型').selectOption('competitor');await page.getByLabel('观察标题',{exact:true}).fill('虚构竞品观察');
    await page.getByLabel('竞品名称',{exact:true}).fill('虚构对照账号');await page.getByLabel('来源链接',{exact:true}).fill('https://example.invalid/competitor');await page.getByLabel('值得关注的原因').fill('学习虚构内容结构');
    await page.getByRole('button',{name:'保存观察',exact:true}).click();await expect(page.locator('[data-observation]')).toHaveCount(2);
    await page.getByRole('button',{name:'忽略',exact:true}).click();await expect(page.locator('[data-observation]')).toContainText(['已忽略']);
    await page.getByRole('button',{name:'重新判断',exact:true}).click();
    await expect(page.getByRole('button',{name:'忽略',exact:true})).toBeVisible();
    await shot(page,`${viewport.name}-observations`);

    const content=await call(page,workbench,'/contents',{title:'虚构周期报告内容'});
    const pub=content.publications.find(p=>p.platformCode==='douyin');
    await call(page,workbench,`/contents/${content.id}/publications/douyin`,{version:pub.version,status:'published',publishedAt:'2026-09-05T10:00:00+08:00'},'patch');
    await call(page,workbench,'/ingestion',{sourceType:'manual',sourceName:'fictional-report-metrics',periodStart:'2026-09-01',periodEnd:'2026-09-01',rows:[{platformCode:'douyin',contentId:content.id,views:222,likes:7,comments:3,net_followers:2}]});
    await page.goto(`${workbench.baseUrl}/reports`);await page.getByLabel('周期定位日期（上海）').fill('2026-09-05');
    const weekId=await saveReport(page);await expect(page.locator('[data-report-snapshot]')).toContainText('222');
    const saved=(await (await page.request.get(`${workbench.baseUrl}/api/v1/reports/${weekId}/markdown`)).json()).data;
    const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'下载 Markdown',exact:true}).click();const download=await downloadPromise;
    expect(fs.readFileSync(await download.path(),'utf8')).toBe(saved.markdown);
    await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:workbench.baseUrl});
    await page.getByRole('button',{name:'复制 Markdown',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe(saved.markdown);
    await call(page,workbench,'/contents',{title:'虚构报告之后新增的内容'});
    await page.reload();await expect(page.locator('[data-report-snapshot]')).toHaveAttribute('data-report-snapshot',weekId);
    expect((await (await page.request.get(`${workbench.baseUrl}/api/v1/reports/${weekId}/markdown`)).json()).data.markdown).toBe(saved.markdown);
    await shot(page,`${viewport.name}-weekly-report`);
    await page.getByRole('button',{name:'本月',exact:true}).click();
    await expect(page.locator('[data-report-snapshot]')).toHaveCount(0);
    const monthId=await saveReport(page);expect(monthId).not.toBe(weekId);
    await shot(page,`${viewport.name}-monthly-report`);

    await page.goto(`${workbench.baseUrl}/settings`);await expect(page.getByRole('button',{name:'编辑关键词',exact:true})).toBeEnabled();
    await keyword(page,'虚构保留关键词\n虚构 FUV');
    await page.locator('[data-edit-platform="douyin"]').click();await page.getByLabel('账号展示名称').fill('虚构测试账号');await page.getByLabel('账号主页链接').fill('https://example.invalid/profile');await page.getByRole('button',{name:'保存平台配置',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button',{name:'立即备份',exact:true}).click();await expect(page.locator('[data-backup]')).toHaveCount(1);
    const backupId=await page.locator('[data-backup]').getAttribute('data-backup');
    await keyword(page,'恢复前的虚构变更');await expect(page.locator('.keyword-list')).toContainText('恢复前的虚构变更');
    await page.locator(`[data-verify-backup="${backupId}"]`).click();
    const dialog=page.getByRole('dialog',{name:'确认恢复备份',exact:true});await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button',{name:'确认恢复',exact:true})).toBeDisabled();
    await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.keyword-list')).toContainText('恢复前的虚构变更');
    await page.locator(`[data-verify-backup="${backupId}"]`).click();
    await dialog.getByRole('checkbox').check();await dialog.getByLabel('输入“恢复”以确认').fill('恢复');
    await shot(page,`${viewport.name}-restore-confirmation`);
    await dialog.getByRole('button',{name:'确认恢复',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect(page.locator('.keyword-list')).toContainText('虚构保留关键词');await expect(page.locator('.keyword-list')).not.toContainText('恢复前的虚构变更');
    await expect(page.getByText('本地服务正常',{exact:true})).toBeVisible();
    await call(page,workbench,'/inspirations',{rawText:'恢复之后仍能写入的虚构验证'});
    const bearerResponse=await page.request.get(`${workbench.baseUrl}/api/v1/settings`,{headers:{Authorization:`Bearer ${workbench.token}`}});expect(bearerResponse.ok()).toBe(true);
    expect((await bearerResponse.json()).data.workbuddy.lastRequestAt).not.toBeNull();
    await page.getByRole('button',{name:'刷新状态',exact:true}).click();
    await expect(page.locator('[data-backup]')).toHaveCount(2);
    await shot(page,`${viewport.name}-settings-restored`);
    expect(errors).toEqual([]);
  });
}
