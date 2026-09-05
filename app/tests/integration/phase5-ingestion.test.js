import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { phase5Server } from '../helpers/phase5-api.js';

test('manual ingestion persists evidence, series and independent review findings; replay creates no duplicates', async t => {
  const s = await phase5Server(t);
  const rows = [s.row({}, { sourceReference: 'fictional://source', metrics: {
    views: '1.23万', likes: '1,234', completion_rate: '25%', followers_lost: 4,
    net_followers: { value: -2, evidenceLevel: 'derived', calculationNote: '2 minus 4',
      evidence: { followers_gained: 2, followers_lost: 4 } }
  }, series: [{ seriesKey: 'retention', position: 5, label: '5秒', value: '50%', unit: 'ratio',
    evidenceLevel: 'observed' }], review: { summary: '纯虚构复盘', dataQuality: 'partial',
    generatedBy: 'human', findings: [{ findingType: 'recommendation', title: '虚构建议',
      body: '仅用于测试', evidenceLevel: 'inferred', calculationNote: 'test hypothesis',
      evidence: ['retention'] }] } })];
  const first = await s.ingest(rows, {}, 'same-import');
  assert.equal(first.status, 201);
  assert.equal(first.data.status, 'imported');
  assert.equal(first.data.rowsImported, 1);
  assert.deepEqual((await s.ingest(rows, {}, 'same-import')).data, first.data);
  assert.equal((await s.ingest([s.row({ views: 5 })], {}, 'same-import')).status, 409);
  assert.equal(s.db.prepare('SELECT count(*) n FROM metric_snapshots').get().n, 1);
  const review = await s.review();
  assert.equal(review.status, 200);
  const snap = review.data.snapshots[0];
  assert.equal(snap.metrics.views.value, 12300);
  assert.equal(snap.metrics.likes.value, 1234);
  assert.equal(snap.metrics.completion_rate.value, 0.25);
  assert.equal(snap.metrics.net_followers.evidenceLevel, 'derived');
  assert.deepEqual(snap.metrics.net_followers.evidence, { followers_gained: 2, followers_lost: 4 });
  assert.equal(snap.series[0].value, 0.5);
  assert.equal(review.data.reviews[0].findings[0].evidenceLevel, 'inferred');
  assert.equal(review.data.reviews[0].findings[0].calculationNote, 'test hypothesis');
  assert.equal(snap.sourceReference, 'fictional://source');
  assert.deepEqual((await s.review()).data, review.data);
  assert.equal((await s.call('/ingestion')).data.items[0].id, first.data.id);
});

test('invalid rows cannot contaminate successful rows or leave review/metric residue', async t => {
  const s = await phase5Server(t);
  const bad = [
    s.row({ views: -1 }), s.row({ completion_rate: '101%' }), s.row({ views: '1,23' }),
    s.row({ likes: 1.2 }), s.row({ madeUpMetric: 4 }), s.row({ views: true }),
    s.row({}, { metrics: { views: { value: 5, evidenceLevel: 'derived' } } }),
    s.row({}, { series: [{ seriesKey: 'retention', position: 1, value: 0.5, unit: 'ratio',
      evidenceLevel: 'inferred', calculationNote: 'missing evidence' }], views: 4 }),
    s.row({ views: 6 }, { review: { summary: 'bad', dataQuality: 'partial', generatedBy: 'ai',
      findings: [{ findingType: 'issue', title: 'bad', body: 'bad', evidenceLevel: 'inferred' }] } }),
    s.row({ views: 5 }, { contentId: 'missing' }),
    s.row({ views: 5 }, { periodStart: '2026-02-30' }),
    s.row({ views: 5 }, { platformCode: 'unknown' })
  ];
  const result = await s.ingest([s.row({ views: 37 }), ...bad, s.row({ likes: 0 }, { platformCode: 'weibo' })]);
  assert.equal(result.status, 201);
  assert.equal(result.data.status, 'partial_failure');
  assert.equal(result.data.rowsTotal, 14);
  assert.equal(result.data.rowsImported, 2);
  assert.equal(result.data.rowsRejected, 12);
  assert.equal(result.data.errors.length, 12);
  assert.equal(s.db.prepare('SELECT count(*) n FROM metric_snapshots').get().n, 2);
  assert.equal(s.db.prepare('SELECT count(*) n FROM content_reviews').get().n, 0);
  assert.equal(s.db.prepare('SELECT count(*) n FROM metric_series_points').get().n, 0);
});

test('CSV handles Chinese headers, quoted commas/newlines, blank values, explicit mapping and structural failures', async t => {
  const s = await phase5Server(t);
  const csvText = '平台,内容ID,播放量,完播率,备注,来源引用,点赞数\r\n' +
    `douyin,${s.content.id},"1,234",12.5%,"虚构,备注\n第二行",fictional,\r\n` +
    `weibo,${s.content.id},wrong,25%,bad,fictional,5`;
  const result = await s.ingest(undefined, { sourceType: 'csv', csvText });
  assert.equal(result.status, 201);
  assert.equal(result.data.status, 'partial_failure');
  const snap = (await s.review()).data.snapshots[0];
  assert.equal(snap.metrics.views.value, 1234);
  assert.equal(snap.metrics.completion_rate.value, 0.125);
  assert.equal(snap.metrics.likes, undefined);
  const mapped = await s.ingest(undefined, { sourceType: 'csv', mapping: { custom: 'views' },
    csvText: 'platformCode,custom\ndouyin,2亿' });
  assert.equal(mapped.data.rowsImported, 1);
  const broken = await s.ingest(undefined, { sourceType: 'csv', csvText: '平台,播放量\ndouyin,"unterminated' });
  assert.equal(broken.data.status, 'failed');
  assert.ok(broken.data.errors.length);
  const duplicate = await s.ingest(undefined, { sourceType: 'csv', csvText: '平台,播放量,views\ndouyin,1,2' });
  assert.equal(duplicate.data.status, 'failed');
});

test('Excel imports first worksheet typed numeric and percentage cells and JSON series only', async t => {
  const s = await phase5Server(t);
  const sheet = XLSX.utils.aoa_to_sheet([
    ['平台', '内容ID', '播放量', '完播率', 'series'],
    ['douyin', s.content.id, 91, 0.375, JSON.stringify([{ seriesKey: 'traffic_source', position: 0,
      label: '虚构来源', value: 7, unit: 'count', evidenceLevel: 'observed' }])]
  ]);
  sheet.D2.z = '0.0%';
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'fixture');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['broken'], ['ignored']]), 'ignored');
  const result = await s.ingest(undefined, { sourceType: 'excel',
    fileBase64: XLSX.write(workbook, { type: 'base64', bookType: 'xlsx', compression: true }) });
  assert.equal(result.status, 201);
  assert.equal(result.data.rowsImported, 1);
  const snap = (await s.review()).data.snapshots[0];
  assert.equal(snap.metrics.views.value, 91);
  assert.equal(snap.metrics.completion_rate.value, 0.375);
  assert.equal(snap.series[0].label, '虚构来源');
  assert.equal((await s.ingest(undefined, { sourceType: 'excel', fileBase64: 'not-base64!' })).data.status, 'failed');
});

test('ingestion requires auth/idempotency, rejects ambiguous envelopes and reserves official_api', async t => {
  const s = await phase5Server(t);
  assert.equal((await s.call('/ingestion', { method: 'POST', body: s.input([s.row()]) })).status, 400);
  assert.equal((await s.call('/ingestion', { method: 'POST', body: s.input([s.row()]), key: 'no-auth',
    authenticated: false })).status, 401);
  for (const overrides of [{ sourceType: 'official_api' }, { extra: true }, { periodEnd: '2026-08-01' },
    { rows: [] }, { rows: Array.from({ length: 1001 }, () => s.row()) }, { csvText: 'extra' },
    { periodStart: '2026-02-30' }, { mapping: { x: 'wrong' } }]) {
    assert.equal((await s.ingest([s.row()], overrides)).status, 400, JSON.stringify(overrides).slice(0,100));
  }
  const mapping = await s.call('/ingestion/mapping');
  assert.equal(mapping.status, 200);
  assert.equal(mapping.data.mapping['播放量'], 'views');
  assert.equal(mapping.data.metrics.length, 13);
});

test('WorkBuddy bearer ingestion and storage write failure use per-row savepoints', async t => {
  const s = await phase5Server(t);
  assert.equal(s.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='metric_values'").get().n, 1);
  s.db.exec(`CREATE TRIGGER fictional_fail BEFORE INSERT ON metric_values
    WHEN NEW.value_number = 999999 BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END;`);
  const res = await fetch(`${s.baseUrl}/api/v1/ingestion`, { method: 'POST',
    headers: { Authorization: `Bearer ${s.token}`, 'Idempotency-Key': 'wb',
      'Content-Type': 'application/json' },
    body: JSON.stringify(s.input([s.row({ views: 999999 }), s.row({ views: 19 })], { sourceType: 'workbuddy' })) });
  assert.equal(res.status, 201);
  const { data } = await res.json();
  assert.equal(data.rowsImported, 1);
  assert.equal(data.rowsRejected, 1);
  assert.equal(s.db.prepare('SELECT count(*) n FROM metric_snapshots').get().n, 1);
  assert.equal(s.db.prepare("SELECT actor FROM audit_log WHERE action='ingestion.create'").get().actor, 'workbuddy');
});

test('CSV defaults supply content/platform once while explicit row values override defaults', async t => {
  const s = await phase5Server(t);
  const result = await s.ingest(undefined, { sourceType: 'csv',
    defaults: { platformCode: 'douyin', contentId: s.content.id },
    csvText: '播放量,平台\n41,\n59,weibo' });
  assert.equal(result.status, 201);
  assert.equal(result.data.rowsImported, 2);
  const snaps = (await s.review()).data.snapshots;
  assert.equal(snaps.length, 2);
  assert.equal(snaps.find(x => x.platformCode === 'douyin').metrics.views.value, 41);
  assert.equal(snaps.find(x => x.platformCode === 'weibo').metrics.views.value, 59);
});

test('explicit null evidence and periods, near-integer counts, and malformed short CSV rows are rejected', async t => {
  const s = await phase5Server(t);
  const result = await s.ingest([
    s.row({ views: '1.00000001' }),
    s.row({}, { metrics: { views: { value: 1, evidenceLevel: null } } }),
    s.row({ views: 1 }, { periodStart: null }),
    s.row({ views: 1 }, { periodEnd: null })
  ]);
  assert.equal(result.status, 201);
  assert.equal(result.data.rowsImported, 0);
  assert.equal(result.data.rowsRejected, 4);
  const short = await s.ingest(undefined, { sourceType: 'csv',
    defaults: { platformCode: 'douyin' }, csvText: '播放量,点赞数\n5\n7,2' });
  assert.equal(short.data.rowsImported, 1);
  assert.equal(short.data.rowsRejected, 1);
});

test('XLSX formula/error rows are rejected but valid rows and defaults survive; XLS works too', async t => {
  const s = await phase5Server(t);
  const sheet = XLSX.utils.aoa_to_sheet([['播放量','完播率'],[33,0.2],[1,0.2],[2,0.2]]);
  sheet.A3 = { t: 'n', v: 1, f: '1+0' };
  sheet.A4 = { t: 'e', v: 7 };
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,sheet,'fictional');
  const result = await s.ingest(undefined, { sourceType: 'excel',
    defaults: { platformCode: 'douyin', contentId: s.content.id },
    fileBase64: XLSX.write(wb,{ type: 'base64', bookType: 'xlsx' }) });
  assert.equal(result.status, 201);
  assert.equal(result.data.rowsImported, 1);
  assert.equal(result.data.rowsRejected, 2);
  assert.equal((await s.review()).data.snapshots[0].metrics.views.value, 33);
  const plain = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(plain,XLSX.utils.aoa_to_sheet([['platformCode','views'],['weibo',14]]),'fixture');
  assert.equal((await s.ingest(undefined,{sourceType:'excel',fileBase64:XLSX.write(plain,{type:'base64',bookType:'xls'})})).data.rowsImported,1);
});

test('Excel row/column/decompression limits fail before any snapshot persists', async t => {
  const s = await phase5Server(t);
  for (const range of ['A1:B1002','A1:BM2']) {
    const sheet = XLSX.utils.aoa_to_sheet([['platformCode','views'],['douyin',1]]);
    sheet['!ref'] = range;
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,sheet,'fixture');
    const result = await s.ingest(undefined,{sourceType:'excel',
      fileBase64:XLSX.write(wb,{type:'base64',bookType:'xlsx',compression:true})});
    assert.equal(result.data.status,'failed',range);
  }
  const sheet = XLSX.utils.aoa_to_sheet([['platformCode','views'],['douyin',1]]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,sheet,'fixture');
  const archive = XLSX.write(wb,{type:'buffer',bookType:'xlsx',compression:true});
  const directory = archive.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  archive.writeUInt32LE(20 * 1024 * 1024,directory + 24);
  const result = await s.ingest(undefined,{sourceType:'excel',fileBase64:archive.toString('base64')});
  assert.equal(result.data.status,'failed');
  assert.equal(s.db.prepare('SELECT count(*) n FROM metric_snapshots').get().n,0);
});

test('Excel local allocation hints must agree with bounded central directory before parser entry', async t => {
  const s = await phase5Server(t);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['platformCode','views'],['douyin',1]]),'fixture');
  const archive = XLSX.write(wb,{type:'buffer',bookType:'xlsx',compression:true});
  // Small mismatch proves early validation without allocating a real decompression bomb.
  archive.writeUInt32LE(archive.readUInt32LE(22)+1,22);
  const result = await s.ingest(undefined,{sourceType:'excel',fileBase64:archive.toString('base64')});
  assert.equal(result.data.status,'failed');
  assert.match(result.data.errors[0].message,/local.*size/i);
});

test('nested unknown properties and duplicate series positions reject entire rows', async t => {
  const s = await phase5Server(t);
  const p = {seriesKey:'traffic_lifecycle',position:0,label:'fictional',value:1,unit:'count'};
  for (const row of [
    s.row({views:5},{metrics:{likes:{value:2,unsupported:1}}}),
    s.row({views:5},{series:[p,p]}),
    s.row({views:5},{review:{summary:'fictional',dataQuality:'partial',generatedBy:'human',findings:[],unknown:1}}),
    s.row({}, {metrics:{views:{value:1,evidenceLevel:'inferred',calculationNote:'fictional',evidence:[{}]}}})
  ]) {
    const result = await s.ingest([row]);
    assert.equal(result.data.rowsImported,0);
    assert.equal(result.data.rowsRejected,1);
  }
  assert.equal(s.db.prepare('SELECT count(*) n FROM metric_snapshots').get().n,0);
});

test('explicit null source and required nested enums cannot silently become defaults', async t => {
  const s = await phase5Server(t);
  assert.equal((await s.ingest([s.row()],{sourceType:null})).status,400);
  for (const overrides of [{dataQuality:null},{generatedBy:null}]) {
    const result = await s.ingest([s.row({views:1},{review:{
      summary:'fictional',dataQuality:'partial',generatedBy:'human',findings:[],...overrides}})]);
    assert.equal(result.data.rowsImported,0);
  }
  for (const overrides of [{unit:null},{seriesKey:null},{evidenceLevel:null}]) {
    const result = await s.ingest([s.row({views:1},{series:[{
      seriesKey:'retention',position:0,label:'fictional',value:0.5,unit:'ratio',...overrides} ]})]);
    assert.equal(result.data.rowsImported,0);
  }
});

test('series reject mixed units and retention counts; coherent traffic-source ratios are retained', async t => {
  const s = await phase5Server(t);
  const point = {seriesKey:'traffic_source',position:0,label:'fictional',value:1,unit:'count'};
  for (const series of [
    [point,{...point,position:1,value:0.2,unit:'ratio'}],
    [{...point,seriesKey:'retention'}]
  ]) {
    const result = await s.ingest([s.row({views:3},{series})]);
    assert.equal(result.data.rowsRejected,1);
  }
  const result = await s.ingest([s.row({views:3},{series:[{...point,value:0.2,unit:'ratio'}]})]);
  assert.equal(result.data.rowsImported,1);
});
