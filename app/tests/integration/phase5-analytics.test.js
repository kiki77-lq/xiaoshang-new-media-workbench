import assert from 'node:assert/strict';
import test from 'node:test';
import { phase5Server } from '../helpers/phase5-api.js';

test('empty analytics exposes missing values and counts contents using Shanghai month boundaries', async t => {
  const s = await phase5Server(t);
  s.db.prepare('UPDATE contents SET created_at=? WHERE id=?').run('2026-08-31T16:00:00.000Z', s.content.id);
  let res = await s.overview();
  assert.equal(res.status, 200);
  assert.equal(res.data.kpis.contentCount, 1);
  assert.equal(res.data.kpis.views, null);
  assert.equal(res.data.kpis.netFollowers, null);
  assert.equal(res.data.kpis.bestContent, null);
  assert.equal(res.data.platforms.length, 4);
  assert.deepEqual(res.data.trends.views, []);
  assert.equal(res.data.updatedAt, null);
  s.db.prepare('UPDATE contents SET created_at=? WHERE id=?').run('2026-09-30T16:00:00.000Z', s.content.id);
  assert.equal((await s.overview()).data.kpis.contentCount, 0);
  assert.equal((await s.call('/analytics/overview?month=2026-13')).status, 400);
  assert.equal((await s.call('/contents/missing/review')).status, 404);
  assert.equal((await s.call(`/contents/${s.content.id}/review?platformCode=oops`)).status, 400);
});

test('latest exact-period entity snapshots supersede older values and reviews; account totals never add to publication totals', async t => {
  const s = await phase5Server(t);
  await s.ingest([s.row({ views: 100, likes: 10 }, { capturedAt: '2026-09-02T00:00:00Z' })]);
  await s.ingest([s.row({ views: 150, likes: 15 }, { capturedAt: '2026-09-03T00:00:00Z' })]);
  // A later import of an older observation must not win.
  await s.ingest([s.row({ views: 80 }, { capturedAt: '2026-09-01T00:00:00Z' })]);
  await s.ingest([{ platformCode: 'douyin', views: 400, net_followers: 7 }]);
  const res = (await s.overview()).data;
  assert.equal(res.kpis.views, 400);
  assert.equal(res.kpis.bestContent.views, 150);
  assert.equal(res.ranking.length, 1);
  assert.equal(res.platforms.find(p => p.code === 'douyin').views, 400);
  assert.equal(res.kpis.netFollowers, 7);
  assert.equal((await s.review()).data.snapshots.length, 1);
  assert.equal((await s.review()).data.snapshots[0].metrics.views.value, 150);
  assert.equal(res.trends.views.length, 0, 'month aggregate must not invent daily points');
});

test('overlapping/cross-month observations are excluded safely; disjoint daily values form genuine trends', async t => {
  const s = await phase5Server(t);
  await s.ingest([s.row({ views: 11 }, { periodStart: '2026-09-01', periodEnd: '2026-09-01' }),
    s.row({ views: 17 }, { periodStart: '2026-09-02', periodEnd: '2026-09-02' })]);
  let res = (await s.overview()).data;
  assert.equal(res.kpis.views, 28);
  assert.deepEqual(res.trends.views.map(({label,value}) => ({label,value})),
    [{ label: '2026-09-01', value: 11 }, { label: '2026-09-02', value: 17 }]);
  assert.equal(res.trends.views[0].evidenceLevel, 'derived');
  assert.ok(res.trends.views[0].calculationNote);
  assert.equal(res.trends.views[0].evidence.length, 1);
  assert.equal(res.trends.views[0].evidence[0].metricKey, 'views');
  assert.ok(res.trends.views[0].evidence[0].snapshotId);
  await s.ingest([s.row({ views: 50 }, { periodStart: '2026-09-01', periodEnd: '2026-09-10' }),
    s.row({ views: 80 }, { periodStart: '2026-08-20', periodEnd: '2026-09-15' })]);
  res = (await s.overview()).data;
  assert.equal(res.kpis.views, 50);
  assert.ok(res.warnings.length);
  assert.notEqual(res.dataQuality, 'complete');
  assert.deepEqual(res.trends.views, [], 'cumulative ranges cannot become dated daily deltas');
});

test('inferred values stay in review but are excluded from factual aggregates, absent observations are not zero', async t => {
  const s = await phase5Server(t);
  await s.ingest([s.row({}, { metrics: { views: { value: 900, evidenceLevel: 'inferred',
    calculationNote: 'fictional model', evidence: ['fictional prior'] }, likes: 0 } })]);
  const res = (await s.overview()).data;
  assert.equal(res.kpis.views, null);
  assert.equal(res.kpis.bestContent, null);
  assert.equal(res.platforms[0].likes, 0);
  assert.equal(res.platforms[0].comments, null);
  assert.ok(res.warnings.some(w => /inferred/i.test(w)));
  assert.equal((await s.review()).data.snapshots[0].metrics.views.evidenceLevel, 'inferred');
});

test('review results never pair a replacement snapshot with a superseded finding', async t => {
  const s = await phase5Server(t);
  await s.ingest([s.row({views:10},{capturedAt:'2026-09-03T00:00:00Z',review:{summary:'old',
    dataQuality:'partial',generatedBy:'human',findings:[]}})]);
  await s.ingest([s.row({views:20},{capturedAt:'2026-09-04T00:00:00Z'})]);
  const result = await s.review();
  assert.equal(result.data.snapshots.length,1);
  assert.equal(result.data.reviews.length,0);
  assert.equal(result.data.snapshots[0].metrics.views.value,20);
});

test('net followers derive only from paired same-snapshot factual inputs; disjoint publications remain separate', async t => {
  const s = await phase5Server(t);
  await s.ingest([s.row({views:12,followers_gained:6,followers_lost:8}),
    s.row({views:9,followers_gained:15},{platformCode:'weibo'})]);
  const result = (await s.overview()).data;
  assert.equal(result.kpis.views,21);
  assert.equal(result.kpis.netFollowers,-2);
  assert.equal(result.platforms.find(p=>p.code==='weibo').netFollowers,null);
  assert.equal(result.kpis.bestContent.views,21);
  assert.ok(result.warnings.length);
});

test('inferred recommendations do not downgrade observed metric quality to proxy; explicit proxy quality remains visible', async t => {
  const s = await phase5Server(t);
  const review = {summary:'fictional',dataQuality:'partial',generatedBy:'ai',findings:[
    {findingType:'recommendation',title:'fictional',body:'hypothesis',evidenceLevel:'inferred',
      calculationNote:'fictional reasoning',evidence:['views']} ]};
  await s.ingest([s.row({views:15},{review})]);
  let result = (await s.review()).data;
  assert.equal(result.dataQuality,'partial');
  assert.ok(result.warnings.some(w=>w.includes('inferred')));
  assert.equal(result.reviews[0].findings[0].evidenceLevel,'inferred');
  await s.ingest([s.row({views:16},{review:{...review,dataQuality:'proxy_based',findings:[]}})]);
  result = (await s.review()).data;
  assert.equal(result.dataQuality,'proxy_based');
});
