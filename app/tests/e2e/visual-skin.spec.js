import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const routes = [['01-home','/','首页'],['02-observations','/observations','热点 / 竞品观察'],['03-inspirations','/inspirations','灵感备忘'],['04-contents','/contents','内容库'],['05-calendar','/calendar','发布日历'],['06-analytics','/analytics','数据看板'],['07-reports','/reports','周报 / 月报'],['08-settings','/settings','设置']];
const root = path.resolve('../artifacts/ui-skin-refactor');

test('danger confirmation remains readable after the hover transition', async ({page}) => {
  await page.goto('/settings');
  await page.evaluate(async () => {
    const {openModal} = await import('/assets/js/components/modal.js');
    openModal({title:'仅前端视觉状态检查',content:'<button class="btn btn-danger">确认恢复</button>'});
  });
  const button=page.getByRole('button',{name:'确认恢复',exact:true});
  await button.hover();
  // Wait for the actual CSS transition, rather than reading its first frame.
  await button.evaluate(async e=>{await new Promise(requestAnimationFrame);await Promise.all(e.getAnimations().map(a=>a.finished));});
  const ratio=await button.evaluate(e=>{
    const luminance=color=>color.match(/\d+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const s=getComputedStyle(e),a=luminance(s.color),b=luminance(s.backgroundColor);
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

for (const [device, viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]) {
  test(`${device} light skin keeps eight-page navigation, readable controls and shared icons`, async ({page, request}) => {
    await page.setViewportSize(viewport);
    const errors=[];
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('pageerror',e=>errors.push(e.message));
    fs.mkdirSync(path.join(root,device),{recursive:true});
    for (const [name,url,title] of routes) {
      await page.goto(url);
      await expect(page.getByRole('heading',{name:title,exact:true,level:1})).toBeVisible();
      await page.waitForLoadState('networkidle');
      // A forgotten dark surface or foreground token must fail on the rendered page.
      const visual=await page.evaluate(()=>{
        const rgb=s=>s.match(/\d+/g).slice(0,3).map(Number);
        const body=getComputedStyle(document.body);
        return {bg:rgb(body.backgroundColor),fg:rgb(body.color),scheme:getComputedStyle(document.documentElement).colorScheme,overflow:document.documentElement.scrollWidth>innerWidth,sidebar:getComputedStyle(document.querySelector('.sidebar')).width};
      });
      expect(visual.bg.every(v=>v>230)).toBeTruthy();
      expect(visual.fg.every(v=>v<50)).toBeTruthy();
      expect(visual.scheme).toBe('light');
      expect(visual.overflow).toBe(false);
      if(device==='desktop')expect(visual.sidebar).toBe('252px');
      await expect(page.locator('.sidebar nav a')).toHaveCount(8);
      await expect(page.locator('.nav-icon svg.lucide')).toHaveCount(8);
      await expect(page.locator('.sidebar [aria-current="page"]')).toHaveText(title);
      const missing=await page.locator('.stat-icon,.empty-icon,.setting-title > span,.content-symbol,.idea-icon').evaluateAll(nodes=>nodes.filter(n=>!n.querySelector('svg.lucide')).length);
      expect(missing).toBe(0);
      const broken=await page.locator('img').evaluateAll(nodes=>nodes.filter(n=>!n.complete||!n.naturalWidth).length);
      expect(broken).toBe(0);
      await page.screenshot({path:path.join(root,device,`${name}.png`)});
      await page.screenshot({path:path.join(root,device,`${name}-full.png`),fullPage:true});
    }
    await page.goto('/');
    await page.locator('[data-quick-inspiration]').click();
    const dialog=page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('button[aria-label="关闭"] svg.lucide')).toHaveCount(1);
    const box=await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({path:path.join(root,device,'09-modal.png')});
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    if(device==='mobile')await page.getByRole('button',{name:'打开导航'}).click();
    await page.getByRole('link',{name:'设置',exact:true}).click();
    await expect(page).toHaveURL(/\/settings$/);
    for(const endpoint of ['health','meta'])expect((await request.get(`/api/v1/${endpoint}`)).ok()).toBeTruthy();
    expect(errors).toEqual([]);
    fs.writeFileSync(path.join(root,device,'console-errors.json'),JSON.stringify(errors));
  });
}
