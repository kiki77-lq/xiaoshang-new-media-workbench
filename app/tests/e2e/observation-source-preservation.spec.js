import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { test as base, expect } from '@playwright/test';
import { startTestServer } from '../helpers/test-server.js';
import { createWorkbuddyClient } from '../../../workbuddy/client.mjs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const test = base.extend({ workbench: async ({}, use) => {
  const cleanup = [];
  const server = await startTestServer({ after: fn => cleanup.push(fn) }, { appDir });
  try { await use(server); } finally { for (const fn of cleanup.reverse()) await fn(); }
} });
test.use({ locale: 'zh-CN' });

const sources = [
  { name: 'douyin', value: 'douyin', label: '抖音', via: 'api' },
  { name: 'channels', value: 'wechat_channels', label: '视频号', via: 'workbuddy' },
  { name: 'xiaohongshu', value: 'xiaohongshu', label: '小红书', via: 'api' },
  { name: 'weibo', value: 'weibo', label: '微博', via: 'workbuddy' },
  { name: 'other', value: 'other', label: '其他来源', via: 'api' },
  { name: 'Chinese platform label', value: '小红书', label: '小红书', via: 'workbuddy' },
  { name: 'custom Chinese source', value: '汽车之家', label: '汽车之家', via: 'api' },
  {
    name: 'escaped custom source', via: 'workbuddy',
    value: `汽车之家 " ' & < > </option></select><img data-source-injected src=x onerror="window.__sourceInjected=true">`,
    label: `汽车之家 " ' & < > </option></select><img data-source-injected src=x onerror="window.__sourceInjected=true">`
  }
];

async function read(page, workbench, endpoint) {
  const response = await page.request.get(`${workbench.baseUrl}/api/v1${endpoint}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).data;
}

// Catches a title-only web edit replacing an API-valid source with the first
// dropdown option, including corruption of the converted immutable raw text.
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  for (const source of sources) {
    test(`${viewport.width}x${viewport.height}: ${source.via} ${source.name} survives title-only edit and conversion`, async ({ page, workbench }, testInfo) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const input = {
        kind: 'hotspot', title: '虚构来源保留回归', summary: '虚构来源摘要',
        sourceUrl: 'https://example.invalid/source-preservation',
        sourcePlatform: source.value, worthReason: '虚构测试关注原因'
      };
      let observation;
      if (source.via === 'workbuddy') {
        const client = createWorkbuddyClient({ baseUrl: workbench.baseUrl, token: workbench.token });
        observation = (await client.execute('remember.observation', { body: input, requestKey: randomUUID() })).data;
      } else {
        const response = await page.request.post(`${workbench.baseUrl}/api/v1/observations`, {
          headers: { Origin: workbench.baseUrl, 'Idempotency-Key': randomUUID() }, data: input
        });
        expect(response.status()).toBe(201);
        observation = (await response.json()).data;
      }
      expect(observation.sourcePlatform).toBe(source.value);
      await page.setViewportSize(viewport);
      await page.goto(`${workbench.baseUrl}/observations`);
      const card = page.locator(`[data-observation="${observation.id}"]`);
      await card.getByRole('button', { name: '编辑', exact: true }).click();
      const dialog = page.getByRole('dialog');
      const platform = dialog.getByRole('combobox', { name: '来源平台', exact: true });
      // Soft assertions let RED also show the persisted and converted corruption.
      expect.soft(await platform.inputValue()).toBe(source.value);
      expect.soft(await platform.locator('option:checked').textContent()).toBe(source.label);
      await expect(page.locator('[data-source-injected]')).toHaveCount(0);
      expect(await page.evaluate(() => window.__sourceInjected)).toBeUndefined();
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      const box = await dialog.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      if (source.name === 'escaped custom source') {
        await page.screenshot({ path: testInfo.outputPath('escaped-source-editor.png') });
      }
      await dialog.getByLabel('观察标题', { exact: true }).fill('虚构仅修改标题');
      await dialog.getByRole('button', { name: '保存观察', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(card.getByRole('heading')).toHaveText('虚构仅修改标题');
      const persisted = await read(page, workbench, `/observations/${observation.id}`);
      expect(persisted.title).toBe('虚构仅修改标题');
      expect.soft(persisted.sourcePlatform).toBe(source.value);
      expect(persisted.sourceType).toBe(source.via === 'workbuddy' ? 'workbuddy' : 'manual');
      expect(persisted.sourceUrl).toBe(input.sourceUrl);
      await page.reload();
      await card.getByRole('button', { name: '收入灵感', exact: true }).click();
      await page.getByRole('button', { name: '确认收入灵感', exact: true }).click();
      await expect(card).toContainText('已收入灵感');
      const converted = await read(page, workbench, `/observations/${observation.id}`);
      const inspiration = await read(page, workbench, `/inspirations/${converted.convertedInspirationId}`);
      expect.soft(converted.sourcePlatform).toBe(source.value);
      expect.soft(inspiration.sourcePlatform).toBe(source.value);
      expect(inspiration.sourceUrl).toBe(input.sourceUrl);
      expect.soft(inspiration.rawText).toBe(`虚构仅修改标题\n虚构来源摘要\n虚构测试关注原因\n来源：${source.value} https://example.invalid/source-preservation`);
      expect(errors).toEqual([]);
    });
  }
}
