import assert from 'node:assert/strict';
import test from 'node:test';
import { phase4Server } from '../helpers/phase4-api.js';

test('publication updates keep one content, four independent publications and UTC calendar dates', async (t) => {
  const s = await phase4Server(t);
  for (const [code, day] of [['douyin',12], ['wechat_channels',13], ['xiaohongshu',15]]) {
    const result = await s.call(s.pubPath(code), { method:'PATCH', body:{ version:1, status:'scheduled', scheduledAt:`2026-09-${day}T00:30:00+08:00` } });
    assert.equal(result.status, 200);
    assert.equal(result.data.status, 'scheduled');
    assert.equal(result.data.version, 2);
  }
  const c = await s.current();
  assert.equal((await s.call('/contents')).data.total, 1);
  assert.equal(c.publications.length, 4);
  assert.equal(c.publications[3].status, 'not_started');
  assert.equal(c.publications[3].version, 1);
  const events = await s.events();
  assert.equal(events.length, 3);
  assert.equal(events[0].startsAt, '2026-09-11T16:30:00.000Z');
  for (const p of c.publications.slice(0,3)) assert.equal(events.find(e => e.publicationId === p.id).startsAt, p.scheduledAt);
});

test('publication backward transitions require reason and preserve it in before/after audit', async (t) => {
  const s = await phase4Server(t);
  assert.equal((await s.call(s.pubPath(), {method:'PATCH',body:{version:1,status:'producing'}})).status, 200);
  for (const reason of [undefined, '', '   ']) {
    const r = await s.call(s.pubPath(), {method:'PATCH',body:{version:2,status:'preparing',reason}});
    assert.equal(r.status, 400);
    assert.equal(r.error.code, 'REASON_REQUIRED');
  }
  const r = await s.call(s.pubPath(), {method:'PATCH',body:{version:2,status:'preparing',reason:'重新拍摄'}});
  assert.equal(r.status, 200);
  const audit = s.db.prepare("SELECT * FROM audit_log WHERE action = 'publication.update' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(JSON.parse(audit.before_json).status, 'producing');
  assert.equal(JSON.parse(audit.after_json).status, 'preparing');
  assert.equal(JSON.parse(audit.after_json).reason, '重新拍摄');
  assert.equal(audit.actor, 'web');
  assert.ok(audit.request_id);
});

test('publication validation rejects fifth platform, stale/missing version, impossible dates and unsafe URLs without writes', async (t) => {
  const s = await phase4Server(t);
  for (const body of [
    {status:'preparing'}, {version:0}, {version:1,status:'invented'}, {version:1,other:true},
    {version:1,status:'scheduled'}, {version:1,status:'published'},
    ...['2026-02-30T10:00:00Z','2026-09-12T24:00:00Z','2026-09-12T12:00','nonsense',123].map(scheduledAt => ({version:1,scheduledAt})),
    {version:1,publishedUrl:'javascript:alert(1)'}, {version:1,publishedAt:'2026-02-30T12:00:00Z'}
  ]) assert.equal((await s.call(s.pubPath(), {method:'PATCH',body})).status,400, JSON.stringify(body));
  assert.equal((await s.call(s.pubPath('tiktok'),{method:'PATCH',body:{version:1,status:'ready'}})).status,400);
  assert.equal((await s.call(s.pubPath(),{method:'PATCH',origin:'https://evil.invalid',body:{version:1,status:'ready'}})).status,403);
  assert.equal((await s.call('/contents/missing/publications/douyin',{method:'PATCH',body:{version:1,status:'ready'}})).status,404);
  const stale = await s.call(s.pubPath(),{method:'PATCH',body:{version:9,status:'ready'}});
  assert.equal(stale.error.code,'VERSION_CONFLICT');
  assert.equal((await s.current()).publications[0].version,1);
  assert.equal(s.db.prepare('SELECT count(*) n FROM audit_log').get().n,1);
});

test('publication rescheduling updates the same event, invalidates its version and rolls back on audit failure', async (t) => {
  const s = await phase4Server(t);
  await s.call(s.pubPath(),{method:'PATCH',body:{version:1,scheduledAt:'2026-09-12T04:00:00Z'}});
  const first = (await s.events())[0];
  assert.ok(first);
  s.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log WHEN NEW.entity_type = 'publication' BEGIN SELECT RAISE(ABORT,'test audit failure'); END;");
  assert.equal((await s.call(s.pubPath(),{method:'PATCH',body:{version:2,scheduledAt:'2026-09-13T04:00:00Z'}})).status,500);
  assert.deepEqual((await s.events())[0],first);
  assert.equal((await s.current()).publications[0].scheduledAt,first.startsAt);
  s.db.exec('DROP TRIGGER fail_audit');
  assert.equal((await s.call(s.pubPath(),{method:'PATCH',body:{version:2,scheduledAt:'2026-09-13T04:00:00Z'}})).status,200);
  const next = (await s.events())[0];
  assert.equal(next.id,first.id);
  assert.equal(next.version,first.version+1);
  assert.equal((await s.call(`/calendar-events/${first.id}`,{method:'PATCH',body:{version:first.version,title:'stale'}})).error.code,'VERSION_CONFLICT');
});

test('published history survives reasoned backward status changes and cannot be erased or rescheduled', async (t) => {
  const s = await phase4Server(t);
  await s.call(s.pubPath(),{method:'PATCH',body:{version:1,scheduledAt:'2026-09-12T04:00:00Z'}});
  const result = await s.call(s.pubPath(),{method:'PATCH',body:{version:2,status:'published',publishedAt:'2026-09-12T04:10:00Z',publishedUrl:'https://example.invalid/1',platformContentId:'123'}});
  assert.equal(result.status,200);
  const history = (await s.events())[0];
  assert.equal(history.status,'completed');
  assert.equal((await s.call(s.pubPath(),{method:'PATCH',body:{version:3,status:'ready'}})).error.code,'REASON_REQUIRED');
  assert.equal((await s.call(s.pubPath(),{method:'PATCH',body:{version:3,status:'ready',reason:'核实链接'}})).status,200);
  for (const body of [{scheduledAt:null},{scheduledAt:'2026-09-14T04:00:00Z'},{publishedAt:null}]) {
    assert.equal((await s.call(s.pubPath(),{method:'PATCH',body:{version:4,reason:'不应删除历史',...body}})).error.code,'PUBLISHED_HISTORY_PROTECTED');
  }
  for (const method of ['PATCH','DELETE']) {
    assert.equal((await s.call(`/calendar-events/${history.id}`,{method,body:{version:history.version,reason:'历史不可删除',...(method==='PATCH'?{startsAt:'2026-09-14T04:00:00Z'}:{})}})).error.code,'PUBLISHED_HISTORY_PROTECTED');
  }
  assert.deepEqual((await s.events())[0],history);
});

test('clearing schedule from content requires reason and removes the matching event with two audit entries',async(t)=>{
  const s=await phase4Server(t);
  await s.call(s.pubPath(),{method:'PATCH',body:{version:1,scheduledAt:'2026-09-12T04:00:00Z'}});
  const scheduled=(await s.current()).publications[0];
  assert.equal((await s.call(s.pubPath(),{method:'PATCH',body:{version:2,scheduledAt:null}})).error.code,'REASON_REQUIRED');
  assert.deepEqual((await s.current()).publications[0],scheduled);
  const before=s.db.prepare('SELECT count(*) n FROM audit_log').get().n;
  const cleared=await s.call(s.pubPath(),{method:'PATCH',body:{version:2,scheduledAt:null,reason:'取消排期'}});
  assert.equal(cleared.data.status,'ready');assert.equal(cleared.data.scheduledAt,null);
  assert.equal((await s.events()).length,0);
  assert.equal(s.db.prepare('SELECT count(*) n FROM audit_log').get().n,before+2);
  assert.equal(s.db.prepare("SELECT count(*) n FROM audit_log WHERE action='calendar.delete'").get().n,1);
});

test('content-side rescheduling cannot move past the event end and leave either record partially updated',async(t)=>{
  const s=await phase4Server(t);
  const result=await s.call('/calendar-events',{method:'POST',key:'interval',body:{eventType:'publish',title:'完整排期',publicationId:s.content.publications[0].id,startsAt:'2026-09-12T04:00:00Z',endsAt:'2026-09-12T05:00:00Z'}});
  assert.equal(result.status,201);
  assert.equal((await s.call(s.pubPath(),{method:'PATCH',body:{version:2,scheduledAt:'2026-09-13T04:00:00Z'}})).status,400);
  assert.equal((await s.current()).publications[0].scheduledAt,'2026-09-12T04:00:00.000Z');
  assert.deepEqual((await s.events())[0],result.data);
});
