import assert from 'node:assert/strict';
import test from 'node:test';
import { phase4Server } from '../helpers/phase4-api.js';
import { getDashboard } from '../../server/services/dashboard-service.js';

const draft = {eventType:'publish',title:'发布 XT5',startsAt:'2026-09-12T00:30:00+08:00'};
test('calendar publish POST is idempotent, uniquely scheduled and synchronizes PATCH and version-checked audited DELETE', async (t) => {
  const s = await phase4Server(t);
  const body = {...draft,publicationId:s.content.publications[0].id};
  const first = await s.call('/calendar-events',{method:'POST',key:'schedule',body});
  assert.equal(first.status,201);
  const event = first.data;
  assert.equal(event.contentId,s.content.id);
  assert.equal(event.platformCode,'douyin');
  assert.equal(event.startsAt,'2026-09-11T16:30:00.000Z');
  const replay = await s.call('/calendar-events',{method:'POST',key:'schedule',body});
  assert.deepEqual(replay.data,event);
  assert.equal(replay.meta.idempotencyReplayed,true);
  assert.equal((await s.call('/calendar-events',{method:'POST',key:'schedule',body:{...body,title:'different'}})).error.code,'IDEMPOTENCY_KEY_REUSED');
  assert.equal((await s.call('/calendar-events',{method:'POST',key:'duplicate',body})).error.code,'PUBLICATION_ALREADY_SCHEDULED');
  const changed = await s.call(`/calendar-events/${event.id}`,{method:'PATCH',body:{version:1,startsAt:'2026-12-31T23:30:00+08:00',endsAt:'2027-01-01T00:30:00+08:00'}});
  assert.equal(changed.status,200);
  const pub = (await s.current()).publications[0];
  assert.equal(pub.scheduledAt,'2026-12-31T15:30:00.000Z');
  assert.equal(pub.status,'scheduled');
  assert.equal(pub.version,3);
  assert.equal((await s.call(s.pubPath(),{method:'PATCH',body:{version:2,status:'published',publishedAt:'2026-12-31T15:35:00Z'}})).error.code,'VERSION_CONFLICT');
  assert.equal((await s.call(`/calendar-events/${event.id}`,{method:'DELETE',body:{version:1,reason:'改期'}})).error.code,'VERSION_CONFLICT');
  assert.equal((await s.call(`/calendar-events/${event.id}`,{method:'DELETE',body:{version:2}})).error.code,'REASON_REQUIRED');
  const removed = await s.call(`/calendar-events/${event.id}`,{method:'DELETE',body:{version:2,reason:'取消此次排期'}});
  assert.equal(removed.status,200);
  assert.equal(removed.data.deleted,true);
  assert.equal((await s.events()).length,0);
  assert.equal((await s.current()).publications[0].scheduledAt,null);
  assert.equal((await s.current()).publications[0].status,'ready');
  const audit=s.db.prepare("SELECT * FROM audit_log WHERE action='calendar.delete'").get();
  assert.equal(JSON.parse(audit.before_json).id,event.id);
  assert.equal(JSON.parse(audit.after_json).reason,'取消此次排期');
});

test('calendar rejects unsupported types, bad references, invalid intervals, unversioned writes and missing explicit bounds', async (t) => {
  const s=await phase4Server(t);
  assert.equal((await s.call('/calendar-events',{method:'POST',key:'missing',body:draft})).error.code,'PUBLICATION_REQUIRED');
  for (const body of [
    ...['todo','reminder','meeting','pending'].map(eventType=>({...draft,eventType})),
    {...draft,eventType:'shoot',publicationId:s.content.publications[0].id},
    {...draft,publicationId:'missing'},
    {...draft,publicationId:s.content.publications[0].id,contentId:'wrong'},
    {...draft,eventType:'shoot',contentId:'missing'},
    ...['garbage','2026-02-30T01:00:00Z','2026-09-11T16:00:00Z'].map(endsAt=>({...draft,eventType:'shoot',endsAt})),
    {...draft,eventType:'shoot',startsAt:'2026-09-12'},
    {...draft,eventType:'shoot',unknown:true},
    {...draft,publicationId:s.content.publications[0].id,status:'completed'}
  ]) {
    const r=await s.call('/calendar-events',{method:'POST',key:crypto.randomUUID(),body});
    assert.ok([400,404].includes(r.status),JSON.stringify({body,r}));
  }
  assert.equal((await s.call('/calendar-events',{method:'POST',body:{...draft,eventType:'shoot'}})).error.code,'IDEMPOTENCY_KEY_REQUIRED');
  for (const q of ['', '?from=2026-01-01T00:00:00Z','?from=bad&to=bad','?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z','?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z&eventType=todo']) assert.equal((await s.call(`/calendar-events${q}`)).status,400,q);
  assert.equal((await s.events()).length,0);
});

test('calendar CRUD handles shoot and pending, immutable links, half-open ranges and eventType filtering',async(t)=>{
  const s=await phase4Server(t);
  const create=async(eventType,startsAt)=>s.call('/calendar-events',{method:'POST',key:eventType,body:{eventType,title:eventType,startsAt}});
  const a=(await create('shoot','2026-09-30T23:30:00+08:00')).data;
  assert.ok(a);
  const b=(await create('pending_confirmation','2026-10-01T00:30:00+08:00')).data;
  let range=await s.call('/calendar-events?from=2026-09-30T16:00:00Z&to=2026-10-01T16:00:00Z');
  assert.deepEqual(range.data.items.map(e=>e.id),[b.id]);
  range=await s.call('/calendar-events?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z&eventType=shoot');
  assert.deepEqual(range.data.items.map(e=>e.id),[a.id]);
  assert.equal((await s.call(`/calendar-events/${a.id}`,{method:'PATCH',body:{version:1,eventType:'publish'}})).status,400);
  assert.equal((await s.call(`/calendar-events/${a.id}`,{method:'PATCH',body:{version:1,contentId:s.content.id}})).status,400);
  assert.equal((await s.call(`/calendar-events/${a.id}`,{method:'PATCH',body:{title:'unversioned'}})).error.code,'VERSION_REQUIRED');
  assert.equal((await s.call(`/calendar-events/${a.id}`,{method:'DELETE',body:{}})).error.code,'VERSION_REQUIRED');
  const r=await s.call(`/calendar-events/${a.id}`,{method:'PATCH',body:{version:1,title:'拍摄准备完毕',status:'confirmed',notes:'机位确认'}});
  assert.equal(r.data.version,2);
  assert.equal(r.data.notes,'机位确认');
  assert.equal((await s.call(`/calendar-events/${a.id}`,{method:'DELETE',body:{version:2}})).status,200);
  assert.equal((await s.call(`/calendar-events/${a.id}`,{method:'DELETE',body:{version:2}})).status,404);
});

test('calendar rollback restores event, publication, audit and idempotency on any write failure',async(t)=>{
  const s=await phase4Server(t);
  const body={...draft,publicationId:s.content.publications[0].id};
  s.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log WHEN NEW.entity_type = 'calendar_event' BEGIN SELECT RAISE(ABORT,'test audit failure'); END;");
  assert.equal((await s.call('/calendar-events',{method:'POST',key:'retry',body})).status,500);
  assert.equal((await s.events()).length,0);
  assert.equal((await s.current()).publications[0].version,1);
  assert.equal(s.db.prepare("SELECT count(*) n FROM idempotency_keys WHERE key='retry'").get().n,0);
  s.db.exec('DROP TRIGGER fail_audit');
  const e=(await s.call('/calendar-events',{method:'POST',key:'retry',body})).data;
  const before=await s.current();
  const auditCount=s.db.prepare('SELECT count(*) n FROM audit_log').get().n;
  s.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log WHEN NEW.entity_type = 'calendar_event' BEGIN SELECT RAISE(ABORT,'test audit failure'); END;");
  for (const [method,extra] of [['PATCH',{startsAt:'2026-09-14T04:00:00Z'}],['DELETE',{reason:'取消排期'}]]) {
    assert.equal((await s.call(`/calendar-events/${e.id}`,{method,body:{version:1,...extra}})).status,500);
    assert.deepEqual(await s.current(),before);
    assert.deepEqual((await s.events())[0],e);
    assert.equal(s.db.prepare('SELECT count(*) n FROM audit_log').get().n,auditCount);
  }
});

test('dashboard uses Shanghai boundaries and counts only active due publications and pending confirmations',async(t)=>{
  const s=await phase4Server(t);
  s.db.prepare('UPDATE contents SET created_at=?').run('2026-09-30T16:10:00.000Z');
  await s.call(s.pubPath(),{method:'PATCH',body:{version:1,scheduledAt:'2026-10-01T00:30:00+08:00'}});
  await s.call(s.pubPath('weibo'),{method:'PATCH',body:{version:1,scheduledAt:'2026-09-30T23:30:00+08:00'}});
  await s.call('/calendar-events',{method:'POST',key:'pending',body:{eventType:'pending_confirmation',title:'确认脚本',startsAt:'2026-10-02T10:00:00+08:00'}});
  const d=getDashboard({db:s.db,now:'2026-09-30T16:30:00Z'});
  assert.equal(d.monthContentCount,1);
  assert.equal(d.todayPublishCount,1);
  assert.equal(d.needsAttentionCount,1);
  assert.deepEqual(d.hotspotSummary,[]);
  await s.call(s.pubPath(),{method:'PATCH',body:{version:2,status:'published',publishedAt:'2026-10-01T00:31:00+08:00'}});
  assert.equal(getDashboard({db:s.db,now:'2026-09-30T16:30:00Z'}).todayPublishCount,0);
});

test('cancelling a schedule requires reason; removing its cancelled predecessor leaves the new schedule intact',async(t)=>{
  const s=await phase4Server(t);
  const body={...draft,publicationId:s.content.publications[0].id};
  const first=(await s.call('/calendar-events',{method:'POST',key:'first',body})).data;
  assert.equal((await s.call(`/calendar-events/${first.id}`,{method:'PATCH',body:{version:1,status:'cancelled'}})).error.code,'REASON_REQUIRED');
  const cancelled=await s.call(`/calendar-events/${first.id}`,{method:'PATCH',body:{version:1,status:'cancelled',reason:'拍摄延期'}});
  assert.equal(cancelled.data.status,'cancelled');
  assert.equal((await s.current()).publications[0].status,'ready');
  assert.equal((await s.current()).publications[0].scheduledAt,null);
  const second=await s.call('/calendar-events',{method:'POST',key:'second',body:{...body,startsAt:'2026-09-13T12:00:00Z'}});
  assert.equal(second.status,201);
  const active=(await s.current()).publications[0];
  assert.equal((await s.call(`/calendar-events/${first.id}`,{method:'DELETE',body:{version:2}})).status,200);
  assert.deepEqual((await s.current()).publications[0],active);
  assert.deepEqual((await s.events()).map(e=>e.id),[second.data.id]);
});

test('concurrent calendar creates cannot create two active dates for one publication',async(t)=>{
  const s=await phase4Server(t);
  const results=await Promise.all(['one','two'].map((key,index)=>s.call('/calendar-events',{method:'POST',key,body:{...draft,publicationId:s.content.publications[0].id,startsAt:`2026-09-${12+index}T00:30:00Z`}})));
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  const events=await s.events();assert.equal(events.length,1);
  assert.equal(events[0].startsAt,(await s.current()).publications[0].scheduledAt);
  const start=encodeURIComponent(events[0].startsAt);
  const inclusive=await s.call(`/calendar-events?from=${start}&to=2027-01-01T00:00:00Z`);
  const exclusive=await s.call(`/calendar-events?from=2026-01-01T00:00:00Z&to=${start}`);
  assert.equal(inclusive.data.total,1);assert.equal(exclusive.data.total,0);
});
