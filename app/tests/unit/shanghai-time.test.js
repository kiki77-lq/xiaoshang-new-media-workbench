import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { normalizeTimestamp, shanghaiDateTime, shanghaiInputToUtc, shanghaiMonthBounds } from '../../assets/js/shared/format.js';

test('Shanghai datetime inputs round-trip 00:30, 23:30, month/year boundaries and milliseconds',()=>{
  for(const [input,utc] of [
    ['2026-09-12T00:30','2026-09-11T16:30:00.000Z'],
    ['2026-09-30T23:30','2026-09-30T15:30:00.000Z'],
    ['2026-10-01T00:30','2026-09-30T16:30:00.000Z'],
    ['2027-01-01T00:30','2026-12-31T16:30:00.000Z'],
    ['2026-12-31T23:30','2026-12-31T15:30:00.000Z'],
    ['2024-02-29T12:00:03.456','2024-02-29T04:00:03.456Z']
  ]) { assert.equal(shanghaiInputToUtc(input),utc);assert.equal(shanghaiDateTime(utc).slice(0,input.length),input); }
  for(const input of ['2026-02-29T00:30','2026-09-31T23:30','2026-01-01T24:00','bad']) assert.throws(()=>shanghaiInputToUtc(input));
  assert.equal(normalizeTimestamp('2026-10-01T00:30:00+08:00'),'2026-09-30T16:30:00.000Z');
  assert.deepEqual(shanghaiMonthBounds('2026-12-31T16:30:00Z'),['2026-12-31T16:00:00.000Z','2027-01-31T16:00:00.000Z']);
});

test('server and browser calendar calculations use Shanghai even under UTC and Los Angeles machine timezones',()=>{
  const format=new URL('../../assets/js/shared/format.js',import.meta.url).href;
  const calendar=new URL('../../assets/js/pages/calendar.js',import.meta.url).href;
  const source=`import {shanghaiMonthBounds} from ${JSON.stringify(format)}; import {renderCalendar} from ${JSON.stringify(calendar)}; const html=renderCalendar({now:new Date('2026-12-31T16:30:00Z')}); console.log(JSON.stringify([shanghaiMonthBounds('2026-12-31T16:30:00Z'),html.includes('2027年1月') && html.includes('data-calendar-year="2027"') && html.includes('data-calendar-month="0"')]));`;
  for(const TZ of ['UTC','America/Los_Angeles','Asia/Shanghai']) {
    const actual=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',source],{env:{...process.env,TZ},encoding:'utf8'}));
    assert.deepEqual(actual,[['2026-12-31T16:00:00.000Z','2027-01-31T16:00:00.000Z'],true]);
  }
});
