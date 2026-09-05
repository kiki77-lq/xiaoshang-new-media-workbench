import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMetric, evidenceBadge, renderSeries, currentMonth } from '../../assets/js/shared/metrics.js';
import { renderAnalytics } from '../../assets/js/pages/analytics.js';
import { renderContentReview } from '../../assets/js/pages/content-review.js';

test('metric formatting distinguishes missing, zero, ratios, seconds and negative followers', () => {
  assert.equal(formatMetric(null), '—');
  assert.equal(formatMetric(undefined), '—');
  assert.equal(formatMetric(0), '0');
  assert.equal(formatMetric(.235, 'ratio'), '23.5%');
  assert.equal(formatMetric(11.5, 'seconds'), '11.5 秒');
  assert.equal(formatMetric(-12), '-12');
  assert.equal(currentMonth(new Date('2026-08-31T16:30:00Z')), '2026-09');
});
test('evidence badges label inference explicitly, unknown is not observed', () => {
  assert.match(evidenceBadge('inferred'), /推断.*非事实/);
  assert.match(evidenceBadge('derived'), /计算结果/);
  assert.match(evidenceBadge('observed'), /原始数据/);
  assert.doesNotMatch(evidenceBadge('unexpected'), /原始数据/);
});
test('series renderer draws only supplied finite points, includes accessible values and escapes labels', () => {
  assert.doesNotMatch(renderSeries([], '留存'), /<svg/);
  const html = renderSeries([{label:'<script>',value:.5,unit:'ratio',evidenceLevel:'observed'}], '留存');
  assert.match(html, /<svg/);
  assert.match(html, /50%/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(renderSeries([{value:NaN}], '空'), /<svg/);
});
test('series uses actual numeric time spacing rather than evenly spacing irregular seconds', () => {
  const html=renderSeries([{position:0,value:10},{position:1,value:8},{position:10,value:2}], '留存');
  assert.match(html, /cx="80"/);
  assert.match(html, /cx="575"/);
});
test('analytics shell retains two views and real data provenance, never substitutes a demo total', () => {
  const empty = renderAnalytics();
  assert.match(empty, /data-analytics-tab="review"/);
  assert.match(empty, /导入数据/);
  assert.match(empty, /本月/);
  const html = renderAnalytics({data:{periodStart:'2026-09-01',kpis:{views:321,contentCount:1,netFollowers:0},platforms:[],ranking:[],trends:{},warnings:['<unsafe>'],dataQuality:'partial'},filters:{month:'2026-09'}});
  assert.match(html, /321/);
  assert.match(html, /&lt;unsafe&gt;/);
});
test('failed month switch never labels a previous-period KPI as the newly selected month', () => {
  const data={periodStart:'2026-09-01',periodEnd:'2026-09-30',kpis:{views:987654,contentCount:7},platforms:[],ranking:[],trends:{}};
  const html=renderAnalytics({data,filters:{month:'2026-10'},error:{message:'连接失败'}});
  assert.doesNotMatch(html, /987,654/);
  assert.match(html,/2026-09.*已隐藏|已隐藏.*2026-09/);
});
test('mixed evidence chart never connects inferred values into a factual polyline and labels evidence outside collapsed tables', () => {
  const html=renderSeries([{position:0,value:10,evidenceLevel:'observed'},{position:1,value:30,evidenceLevel:'inferred',calculationNote:'假设',evidence:['sample']},{position:2,value:7,evidenceLevel:'derived',calculationNote:'计算',evidence:['sample']}], '生命周期');
  const visible=html.split('<details class="series-table">')[0];
  assert.match(visible,/推断.*非事实/);
  assert.match(visible,/data-point-evidence="inferred"/);
  assert.doesNotMatch(visible,/<polyline/);
  assert.doesNotMatch(visible,/<line /);
});
test('review separates observed metrics from inferred findings and does not fabricate absent curves', () => {
  const html = renderContentReview({content:{title:'测试智界 FUV（虚构）'},snapshots:[{id:'s1',platformName:'抖音',platformCode:'douyin',periodStart:'2026-09-01',periodEnd:'2026-09-30',sourceName:'虚构CSV',metrics:{views:{value:123,unit:'count',evidenceLevel:'observed'}},series:[]}],reviews:[{platformCode:'douyin',periodStart:'2026-09-01',periodEnd:'2026-09-30',summary:'<unsafe>',dataQuality:'partial',findings:[{findingType:'issue',title:'推测开头偏长',body:'仅为建议',evidenceLevel:'inferred',calculationNote:'样本有限',evidence:{metric:'views'}}]}]});
  assert.match(html, /原始数据/);
  assert.match(html, /推断.*非事实/);
  assert.match(html, /虚构CSV/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.match(html, /样本有限/);
  assert.doesNotMatch(html, /<svg/);
});
