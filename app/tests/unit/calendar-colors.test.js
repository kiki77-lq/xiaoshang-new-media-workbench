import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCalendar } from '../../assets/js/pages/calendar.js';

test('calendar renders persisted event types with exact colors and publish-only platform badges on Shanghai dates',()=>{
  const html=renderCalendar({now:new Date('2026-09-30T16:30:00Z'),data:{items:[
    {id:'p',eventType:'publish',title:'发布 XT5',status:'planned',startsAt:'2026-09-30T16:30:00.000Z',platformName:'抖音'},
    {id:'s',eventType:'shoot',title:'拍摄 XT5',status:'planned',startsAt:'2026-10-01T15:30:00.000Z'},
    {id:'c',eventType:'pending_confirmation',title:'确认脚本',status:'planned',startsAt:'2026-10-02T02:00:00.000Z'}
  ]}});
  assert.match(html,/2026年10月/);
  assert.match(html,/发布 XT5/);
  for(const color of ['#ff4d5f','#2f8cff','#9a6bff']) assert.ok(html.includes(color),color);
  assert.match(html,/data-calendar-day="2026-10-01"[^>]*>[\s\S]*?发布 XT5/);
  assert.doesNotMatch(html,/Todo|Reminder|Meeting|后续阶段|基础 Modal/);
});
