import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.js';

test('dashboard HTTP returns separate pending Top 3 with correct ranking, lossless tags and unchanged KPIs', async t => {
  const {baseUrl,token,db} = await startTestServer(t);
  const call = async (url,body,method='POST') => {
    const response = await fetch(baseUrl+'/api/v1'+url,{method,headers:{
      'Content-Type':'application/json',Authorization:'Bearer '+token,
      'Idempotency-Key':crypto.randomUUID()
    },body:JSON.stringify(body)});
    assert.equal(response.ok,true);
    return (await response.json()).data;
  };
  const before=(await(await fetch(baseUrl+'/api/v1/dashboard')).json()).data;
  for(const kind of ['hotspot','competitor']) {
    for(let i=0;i<4;i++) await call('/observations',{
      kind,title:kind+'-'+i,sourceUrl:'https://example.invalid/'+kind+'/'+i,
      sourcePlatform:'douyin',worthReason:'虚构测试说明',summary:'虚构来源摘要',
      competitorName:kind==='competitor'?'虚构对照账号':undefined,
      discoveredAt:`2026-09-0${i+1}T01:00:00.000Z`,heatScore:[95,95,80,70][i],
      tags:i===1?['SUV,EV','引号"和反斜杠\\','中文标签']:[]
    });
    const input={kind,title:'EXCLUDED-'+kind,sourceUrl:'https://example.invalid/excluded',
      sourcePlatform:'other',worthReason:'虚构已处理记录',heatScore:100,discoveredAt:'2026-09-07T00:00:00Z'};
    const ignored=await call('/observations',input);
    await call('/observations/'+ignored.id,{status:'ignored',version:ignored.version},'PATCH');
    const converted=await call('/observations',{...input,title:'CONVERTED-'+kind});
    await call('/observations/'+converted.id+'/convert',{version:converted.version});
  }
  const countBefore=db.prepare('SELECT count(*) n FROM audit_log').get().n;
  const response=await fetch(baseUrl+'/api/v1/dashboard');
  assert.equal(response.status,200);
  const envelope=await response.json(),d=envelope.data;
  assert.ok(envelope.meta.requestId);
  assert.deepEqual(d.hotspotSummary.map(x=>x.title),['hotspot-1','hotspot-0','hotspot-2']);
  assert.deepEqual(d.competitorSummary.map(x=>x.title),['competitor-3','competitor-2','competitor-1']);
  assert.ok(d.hotspotSummary.every(x=>x.kind==='hotspot'));
  assert.ok(d.competitorSummary.every(x=>x.kind==='competitor'));
  assert.deepEqual(d.hotspotSummary[0].tags,['SUV,EV','中文标签','引号"和反斜杠\\']);
  assert.deepEqual(d.competitorSummary[2].tags,d.hotspotSummary[0].tags);
  assert.deepEqual(d.hotspotSummary[1].tags,[]);
  for(const key of ['monthContentCount','producingCount','todayPublishCount','needsAttentionCount','platforms','recentContents'])
    assert.deepEqual(d[key],before[key]);
  assert.equal(db.prepare('SELECT count(*) n FROM audit_log').get().n,countBefore);
});
