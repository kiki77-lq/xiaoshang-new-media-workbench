import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import { startTestServer } from '../helpers/test-server.js';

const appDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const artifactRoot=path.resolve(appDir,'../artifacts/phase-4');
const test=base.extend({workbench:async({},use)=>{
  const cleanup=[];
  const server=await startTestServer({after:fn=>cleanup.push(fn)},{appDir});
  try { await use(server); } finally { for(const fn of cleanup.reverse()) await fn(); }
}});
test.use({timezoneId:'America/Los_Angeles',locale:'zh-CN'});

function errorsOn(page) {
  const errors=[];
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  page.on('pageerror',e=>errors.push(e.message));
  return errors;
}
async function screenshot(page,name) {
  fs.mkdirSync(artifactRoot,{recursive:true});
  await expect(page.locator('.toast')).toHaveCount(0);
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) {
    const submit = dialog.locator('button[type="submit"]');
    if (await submit.count()) {
      await submit.scrollIntoViewIfNeeded();
      expect(await submit.evaluate(e=>{const r=e.getBoundingClientRect();const d=e.closest('[role="dialog"]').getBoundingClientRect();return r.top>=d.top && r.bottom<=d.bottom && r.bottom<=innerHeight;})).toBe(true);
    }
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(box.y+box.height).toBeLessThanOrEqual(page.viewportSize().height);
  } else await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:path.join(artifactRoot,`${name}.png`),fullPage:!(await page.getByRole('dialog').count())});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}
async function contents(page,server) {
  return (await (await page.request.get(`${server.baseUrl}/api/v1/contents`)).json()).data.items;
}
async function selectMonth(page) {
  await page.getByLabel('显示月份').fill('2026-09');
  await expect(page.getByText('2026年9月',{exact:true})).toBeVisible();
  await expect(page.locator('[data-calendar-loading]')).toHaveCount(0);
}
async function openPublication(page,platform) {
  await page.getByRole('button',{name:'查看内容 Phase 4 浏览器 XT5',exact:true}).click();
  await page.getByRole('button',{name:`编辑${platform}发布`,exact:true}).click();
  return page.getByRole('dialog',{name:`编辑${platform}发布`,exact:true});
}

for(const viewport of [{width:1440,height:900,name:'desktop'},{width:390,height:844,name:'mobile'}]) {
  test(`${viewport.name}: real publication calendar workflow, Shanghai time, persisted edits and console zero`,async({page,workbench})=>{
    test.setTimeout(90_000);
    const errors=errorsOn(page);
    await page.setViewportSize(viewport);
    await page.goto(`${workbench.baseUrl}/contents`);
    await page.getByRole('button',{name:'＋ 新增内容',exact:true}).click();
    await page.getByLabel('内容标题').fill('Phase 4 浏览器 XT5');
    await page.getByRole('button',{name:'创建内容',exact:true}).click();
    await expect(page.locator('[data-content-row]')).toHaveCount(1);
    for(const [platform,date] of [['抖音','2026-09-12T00:30'],['视频号','2026-09-13T23:30'],['小红书','2026-09-15T12:00']]) {
      const dialog=await openPublication(page,platform);
      await dialog.getByLabel('发布状态').selectOption('scheduled');
      await dialog.getByLabel('计划发布时间（上海）').fill(date);
      await dialog.getByRole('button',{name:'保存发布',exact:true}).click();
      await expect(dialog).toHaveCount(0);
    }
    const [content]=await contents(page,workbench);
    expect(content.publications).toHaveLength(4);
    expect(content.publications[0].scheduledAt).toBe('2026-09-11T16:30:00.000Z');
    expect(content.publications[1].scheduledAt).toBe('2026-09-13T15:30:00.000Z');
    expect(content.publications[3].status).toBe('not_started');
    await screenshot(page,`${viewport.name}-contents`);

    await page.goto(`${workbench.baseUrl}/calendar`);
    await selectMonth(page);
    const newEvent=page.getByRole('button',{name:'＋ 新增安排',exact:true});
    for(const [type,title,date] of [['shoot','拍摄 XT5','2026-09-09T10:00'],['pending_confirmation','确认脚本','2026-09-10T10:00']]) {
      await newEvent.click();
      const dialog=page.getByRole('dialog',{name:'新增安排',exact:true});
      await dialog.getByLabel('安排类型').selectOption(type);
      await dialog.getByLabel('安排标题').fill(title);
      await dialog.getByLabel('开始时间（上海）').fill(date);
      await dialog.getByRole('button',{name:'保存安排',exact:true}).click();
      await expect(dialog).toHaveCount(0);
    }
    await expect(page.locator('.calendar-grid [data-event-type="publish"]')).toHaveCount(3);
    await expect(page.locator('[data-calendar-day="2026-09-12"]')).toContainText('抖音');
    for(const [type,color] of [['publish','rgb(201, 65, 65)'],['shoot','rgb(37, 99, 235)'],['pending_confirmation','rgb(117, 89, 168)']]) {
      await expect(page.locator(`.calendar-grid [data-event-type="${type}"]`).first()).toHaveCSS('border-left-color',color);
    }
    await screenshot(page,`${viewport.name}-calendar`);
    await page.locator('[data-calendar-day="2026-09-12"]').click();
    await page.getByRole('dialog').getByRole('button',{name:/编辑安排 .*抖音发布/}).click();
    const edit=page.getByRole('dialog',{name:'编辑安排',exact:true});
    await edit.getByLabel('开始时间（上海）').fill('2026-09-30T23:30');
    await edit.getByLabel('结束时间（上海）').fill('2026-10-01T00:30');
    await screenshot(page,`${viewport.name}-event-edit`);
    await edit.getByRole('button',{name:'保存安排',exact:true}).click();
    await expect(edit).toHaveCount(0);
    await expect(page.locator('[data-calendar-day="2026-09-30"]')).toContainText('抖音');
    const updated=(await contents(page,workbench))[0].publications[0];
    expect(updated.scheduledAt).toBe('2026-09-30T15:30:00.000Z');
    await page.reload(); await selectMonth(page);
    await expect(page.locator('[data-calendar-day="2026-09-30"]')).toContainText('抖音');

    await page.locator('[data-calendar-day="2026-09-30"]').click();
    await page.getByRole('dialog').getByRole('button',{name:/编辑安排 .*抖音发布/}).click();
    await page.getByRole('button',{name:'删除安排',exact:true}).click();
    const remove=page.getByRole('dialog',{name:'删除安排',exact:true});
    await remove.getByLabel('删除原因').fill('延期重新安排');
    await remove.getByRole('button',{name:'确认删除',exact:true}).click();
    await expect(remove).toHaveCount(0);
    await expect(page.locator('.calendar-grid [data-event-type="publish"]')).toHaveCount(2);
    expect((await contents(page,workbench))[0].publications[0].status).toBe('ready');
    expect((await contents(page,workbench))[0].publications[0].scheduledAt).toBeNull();

    // Create a publish event through the calendar UI as well.
    await newEvent.click();
    const create=page.getByRole('dialog',{name:'新增安排',exact:true});
    await create.getByLabel('安排类型').selectOption('publish');
    await create.getByLabel('关联平台发布').selectOption(content.publications[0].id);
    await create.getByLabel('安排标题').fill('抖音今日发布');
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    await create.getByLabel('开始时间（上海）').fill(`${today}T23:30`);
    await create.getByRole('button',{name:'保存安排',exact:true}).click();
    await expect(create).toHaveCount(0);
    await page.goto(`${workbench.baseUrl}/`);
    await expect(page.locator('[data-metric="month-content-count"] strong')).toHaveText('1');
    await expect(page.locator('[data-metric="today-publish-count"] strong')).toHaveText('1');
    await expect(page.locator('[data-metric="needs-attention-count"] strong')).toHaveText('1');
    await screenshot(page,`${viewport.name}-home`);

    await page.goto(`${workbench.baseUrl}/contents`);
    const publication=await openPublication(page,'抖音');
    await publication.getByLabel('发布状态').selectOption('published');
    await publication.getByLabel('实际发布时间（上海）').fill(`${today}T23:35`);
    await publication.getByLabel('作品链接').fill('https://example.invalid/douyin/phase4');
    await publication.getByRole('button',{name:'保存发布',exact:true}).click();
    await expect(publication).toHaveCount(0);
    const history=await openPublication(page,'抖音');
    await expect(history.getByLabel('计划发布时间（上海）')).toBeDisabled();
    await expect(history.getByLabel('实际发布时间（上海）')).toBeDisabled();
    await history.getByLabel('发布状态').selectOption('ready');
    await expect(history.getByLabel('变更原因')).toHaveAttribute('required','');
    await history.getByLabel('变更原因').fill('核实作品链接');
    await screenshot(page,`${viewport.name}-publication-edit`);
    await history.getByRole('button',{name:'保存发布',exact:true}).click();
    await expect(history).toHaveCount(0);
    expect((await contents(page,workbench))).toHaveLength(1);
    expect((await contents(page,workbench))[0].publications[0].publishedAt).not.toBeNull();
    await expect(page.getByText(/Todo|Reminder|Meeting/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('calendar and publication dialogs trap keyboard focus, restore focus and recover a stale version visibly',async({page,workbench})=>{
  await page.goto(`${workbench.baseUrl}/calendar`);
  const opener=page.getByRole('button',{name:'＋ 新增安排',exact:true});
  await opener.click();
  const dialog=page.getByRole('dialog',{name:'新增安排',exact:true});
  await expect(dialog).toBeVisible();
  await expect(page.locator('.workspace')).toHaveJSProperty('inert',true);
  expect(await dialog.evaluate(e=>e.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button',{name:'保存安排',exact:true}).focus();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(e=>e.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.locator('.workspace')).toHaveJSProperty('inert',false);

  await opener.click();
  await page.getByLabel('安排标题').fill('并发拍摄');
  await page.getByLabel('开始时间（上海）').fill('2026-09-09T10:00');
  await page.getByRole('button',{name:'保存安排',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await selectMonth(page);
  await page.locator('[data-calendar-day="2026-09-09"]').click();
  await page.getByRole('dialog').getByRole('button',{name:'编辑安排 并发拍摄',exact:true}).click();
  const edit=page.getByRole('dialog',{name:'编辑安排',exact:true});
  const events=(await (await page.request.get(`${workbench.baseUrl}/api/v1/calendar-events?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z`)).json()).data.items;
  const changed=await page.request.patch(`${workbench.baseUrl}/api/v1/calendar-events/${events[0].id}`,{headers:{Origin:workbench.baseUrl},data:{version:events[0].version,title:'他人已更新'}});
  expect(changed.status()).toBe(200);
  await edit.getByRole('button',{name:'保存安排',exact:true}).click();
  await expect(edit.getByRole('alert')).toContainText('已更新');
  await edit.getByRole('button',{name:'重新加载最新记录',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'编辑安排',exact:true}).getByLabel('安排标题')).toHaveValue('他人已更新');
});

test('date-time inputs fit their form columns without horizontal dialog scrolling at both viewports',async({page,workbench})=>{
  const result=await page.request.post(`${workbench.baseUrl}/api/v1/contents`,{headers:{Origin:workbench.baseUrl,'Idempotency-Key':'fit'},data:{title:'Phase 4 浏览器 XT5'}});
  expect(result.status()).toBe(201);
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    await page.goto(`${workbench.baseUrl}/contents`);
    const dialog=await openPublication(page,'抖音');
    const dimensions=await dialog.evaluate(d=>({scroll:d.scrollWidth,client:d.clientWidth,fields:[...d.querySelectorAll('input')].map(input=>({right:input.getBoundingClientRect().right,parentRight:input.parentElement.getBoundingClientRect().right}))}));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
    for(const field of dimensions.fields) expect(field.right).toBeLessThanOrEqual(field.parentRight+1);
    await page.keyboard.press('Escape');
  }
});
