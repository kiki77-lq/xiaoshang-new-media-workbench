import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHome } from '../../assets/js/pages/home.js';

test('home summaries distinguish failed reads from empty successful results and hide stale items', () => {
  const html = renderHome({error:{message:'HTTP failure <unsafe>',requestId:'home-request-1'},data:{
    hotspotSummary:[{title:'STALE-HOTSPOT'}],competitorSummary:[{title:'STALE-COMPETITOR'}]
  }});
  const rail = html.slice(html.indexOf('<aside'));
  assert.doesNotMatch(rail, /STALE-|暂无值得关注/);
  assert.equal((rail.match(/读取失败/g) || []).length, 2);
  assert.match(rail, /home-request-1/);
  assert.doesNotMatch(html, /<unsafe>/);
});

test('home summaries keep their loading states independent of stored results', () => {
  const html = renderHome({loading:true,data:{
    hotspotSummary:[{title:'STALE-HOTSPOT'}],competitorSummary:[{title:'STALE-COMPETITOR'}]
  }});
  assert.match(html, /正在读取机会/);
  assert.match(html, /正在读取竞品讯号/);
  assert.doesNotMatch(html, /STALE-|暂无值得关注/);
});
