import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { phase5Server } from '../helpers/phase5-api.js';

const candidate = { kind: 'hotspot', title: '虚构汽车观察', summary: '虚构来源摘要', sourceUrl: 'https://example.invalid/item', sourcePlatform: 'douyin', worthReason: '测试人工判断', heatScore: 75, tags: ['虚构'] };
test('observation validates explicit null and impossible dates, searches brand, and respects ignored state', async t=>{
  const s=await phase5Server(t);
  for(const delta of [{sourceType:null},{kind:null},{discoveredAt:'2026-02-30T00:00:00Z'},{discoveredAt:null}]){
    assert.equal((await s.call('/observations',{method:'POST',key:randomUUID(),body:{...candidate,...delta}})).status,400,JSON.stringify(delta));
  }
  const item=(await s.call('/observations',{method:'POST',key:randomUUID(),body:{...candidate,brand:'虚构独立品牌',vehicleModel:'测试车型'}})).data;
  assert.equal((await s.call('/observations?search=虚构独立品牌')).data.items.length,1);
  assert.equal((await s.call(`/observations/${item.id}`,{method:'PATCH',body:{version:1,status:'ignored'}})).status,200);
  assert.equal((await s.call(`/observations/${item.id}/convert`,{method:'POST',key:randomUUID(),body:{version:2}})).status,409);
  assert.equal(s.db.prepare('SELECT count(*) n FROM inspirations').get().n,0);
});
test('observations preserve source and atomically convert once across keys and protect conversion history', async t => {
  const s = await phase5Server(t);
  const key = randomUUID();
  const created = await s.call('/observations', { method: 'POST', key, body: candidate });
  assert.equal(created.status, 201);
  assert.equal((await s.call('/observations', { method:'POST', key, body:candidate })).data.id, created.data.id);
  const id = created.data.id;
  const converted = await s.call(`/observations/${id}/convert`, { method:'POST', key:randomUUID(), body:{version:1} });
  assert.equal(converted.status, 201);
  assert.match(converted.data.inspiration.rawText, /虚构来源摘要/);
  assert.equal(converted.data.inspiration.sourceUrl, candidate.sourceUrl);
  assert.deepEqual(converted.data.inspiration.tags, ['虚构']);
  const again = await s.call(`/observations/${id}/convert`, { method:'POST', key:randomUUID(), body:{version:1} });
  assert.equal(again.data.alreadyConverted, true);
  assert.equal(again.data.inspiration.id, converted.data.inspiration.id);
  assert.equal((await s.call(`/observations/${id}`, { method:'PATCH', body:{version:2,status:'pending'} })).status, 409);
  assert.equal((await s.call('/observations?kind=hotspot')).data.stats.weekConverted, 1);
  assert.equal(s.db.prepare('SELECT count(*) n FROM inspirations').get().n, 1);
  assert.equal((await s.call('/observations', {method:'POST',key:randomUUID(),body:{...candidate,heatScore:101}})).status,400);
});

test('settings whitelist and platform optimistic locks are atomic and bearer usage is genuine', async t => {
  const s = await phase5Server(t);
  const initial = await s.call('/settings');
  assert.equal(initial.status,200);
  assert.equal(initial.data.workbuddy.lastRequestAt,null);
  const changed = await s.call('/settings',{method:'PATCH',body:{version:1,keywords:['虚构关键词'],platforms:[{code:'douyin',version:1,handle:'fictional',enabled:false}]}});
  assert.equal(changed.status,200);
  assert.equal(changed.data.platforms[0].enabled,false);
  assert.equal((await s.call('/settings',{method:'PATCH',body:{version:2,keywords:['回滚'],platforms:[{code:'douyin',version:1,handle:'stale'}]}})).status,409);
  assert.deepEqual((await s.call('/settings')).data.keywords,['虚构关键词']);
  assert.equal((await s.call('/settings',{method:'PATCH',body:{version:2,password:'forbidden'}})).status,400);
  assert.equal((await fetch(`${s.baseUrl}/api/v1/settings`,{headers:{Authorization:'Bearer wrong'}})).status,401);
  const response = await fetch(`${s.baseUrl}/api/v1/settings`,{headers:{Authorization:`Bearer ${s.token}`}});
  const body = await response.json();
  assert.ok(body.data.workbuddy.lastRequestAt);
  assert.ok(!JSON.stringify(body).includes(s.token));
});

test('reports use true week and month boundaries, safe metrics and immutable persisted snapshots', async t => {
  const s = await phase5Server(t);
  await s.ingest([s.row({views:90})],{periodStart:'2026-08-31',periodEnd:'2026-09-06'});
  await s.ingest([s.row({views:900})],{periodStart:'2026-09-01',periodEnd:'2026-09-30'});
  s.db.prepare('UPDATE contents SET created_at=?').run('2026-08-30T16:00:00.000Z');
  s.db.prepare("UPDATE content_publications SET published_at='2026-09-06T15:59:59.000Z',status='published'").run();
  const preview = await s.call('/reports/preview?periodType=week&anchorDate=2026-09-05');
  assert.equal(preview.status,200);
  assert.equal(preview.data.periodStart,'2026-08-31');
  assert.equal(preview.data.periodEnd,'2026-09-06');
  assert.equal(preview.data.summary.views,90);
  assert.equal(preview.data.summary.newContents,1);
  assert.equal(preview.data.summary.publishedContents,1);
  assert.equal((await s.call('/reports/preview?periodType=month&anchorDate=2026-09-05')).data.summary.views,900);
  const key=randomUUID(), body={periodType:'week',anchorDate:'2026-09-05'};
  const saved=await s.call('/reports',{method:'POST',key,body});
  assert.equal(saved.status,201);
  assert.equal((await s.call('/reports',{method:'POST',key,body})).data.id,saved.data.id);
  assert.notEqual((await s.call('/reports',{method:'POST',key:randomUUID(),body})).data.id,saved.data.id);
  s.db.prepare('UPDATE contents SET title=?').run('后来的虚构标题');
  assert.deepEqual((await s.call(`/reports/${saved.data.id}`)).data,saved.data);
  assert.equal((await s.call(`/reports/${saved.data.id}/markdown`)).data.markdown,saved.data.markdown);
  assert.throws(()=>s.db.prepare('UPDATE report_snapshots SET markdown=?').run('changed'),/IMMUTABLE/);
  assert.throws(()=>s.db.exec('DELETE FROM report_snapshots'),/IMMUTABLE/);
  assert.equal((await s.call('/reports/preview?periodType=week&anchorDate=2026-02-30')).status,400);
  assert.equal((await s.call('/reports',{method:'POST',key:randomUUID(),body:{...body,generationMode:null}})).status,400);
});

test('observation conversion audit failure rolls back inspiration tags status and idempotency then retries cleanly',async t=>{
  const s=await phase5Server(t),item=(await s.call('/observations',{method:'POST',key:randomUUID(),body:{...candidate,kind:'competitor'}})).data;
  s.db.exec("CREATE TRIGGER fictional_conversion_failure BEFORE INSERT ON audit_log WHEN NEW.action='observation.convert' BEGIN SELECT RAISE(ABORT,'fictional'); END");
  const key=randomUUID(),url=`/observations/${item.id}/convert`,body={version:1};
  assert.equal((await s.call(url,{method:'POST',key,body})).status,500);
  assert.equal(s.db.prepare('SELECT count(*) n FROM inspirations').get().n,0);
  assert.equal(s.db.prepare('SELECT count(*) n FROM inspiration_tags').get().n,0);
  assert.equal((await s.call(`/observations/${item.id}`)).data.status,'pending');
  assert.equal(s.db.prepare('SELECT count(*) n FROM idempotency_keys WHERE key=?').get(key).n,0);
  s.db.exec('DROP TRIGGER fictional_conversion_failure');
  const result=await s.call(url,{method:'POST',key,body});assert.equal(result.status,201);assert.equal(result.data.inspiration.sourceType,'other');
});

test('report summaries aggregate only factual non-overlapping periods with account precedence and retain unknown',async t=>{
  const s=await phase5Server(t);
  await s.ingest([s.row({views:23})],{periodStart:'2026-09-01',periodEnd:'2026-09-01'});
  await s.ingest([{platformCode:'douyin',views:100}],{periodStart:'2026-09-01',periodEnd:'2026-09-01'});
  await s.ingest([{platformCode:'douyin',views:120}],{periodStart:'2026-09-01',periodEnd:'2026-09-01'});
  await s.ingest([{platformCode:'douyin',views:50}],{periodStart:'2026-09-02',periodEnd:'2026-09-02'});
  const r=await s.call('/reports/preview?periodType=week&anchorDate=2026-09-03');
  assert.equal(r.data.summary.views,170);
  assert.equal(r.data.summary.topContents[0].views,23);
  assert.equal(r.data.summary.platforms.find(p=>p.code==='weibo').views,null);
  assert.equal(r.data.summary.platforms[0].netFollowers,null);
  assert.ok(r.data.summary.dataGaps.length);
  assert.equal((await s.call('/reports')).data.items.length,0);
});
