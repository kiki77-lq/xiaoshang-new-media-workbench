import assert from 'node:assert/strict';
import test from 'node:test';
import { renderNavigation } from '../../assets/js/components/shell.js';
import { statCard, emptyState } from '../../assets/js/shared/dom.js';
import { renderHome } from '../../assets/js/pages/home.js';

test('navigation gives each destination an accessible decorative Lucide icon without changing labels', () => {
  const html = renderNavigation('calendar');
  assert.equal((html.match(/class="lucide"/g) || []).length, 8);
  assert.equal((html.match(/aria-hidden="true" focusable="false"/g) || []).length, 8);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  assert.match(html, /发布日历/);
});

test('KPI and empty-state icons render from the same safe icon vocabulary', () => {
  assert.match(statCard('制作中', 'pending', '▷', '当前筛选结果', 3), /class="lucide"/);
  assert.match(emptyState('暂无', '等待数据', '◇'), /class="lucide"/);
  assert.doesNotMatch(statCard('安全', 'accent', '<script>alert(1)</script>'), /<script>/);
});

test('platform marks are local brand assets, not first-character approximations', () => {
  const html = renderHome({ data: { platforms: [{code:'douyin', displayName:'抖音', enabled:true}], recentContents:[] } });
  assert.match(html, /<img[^>]+src="\/assets\/brands\/douyin\./);
  assert.match(html, /alt="抖音"/);
});

test('a named KPI uses text typography while ordinary numeric KPIs retain their numeric hierarchy', () => {
  const html = statCard('最佳内容','accent','star','已导入指标','很长的中文作品标题','','text');
  assert.match(html, /<strong class="stat-text-value">很长的中文作品标题<\/strong>/);
  assert.match(statCard('本月内容','accent','files','本月',12), /<strong>12<\/strong>/);
});
