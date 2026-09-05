import test from 'node:test';
import assert from 'node:assert/strict';
import { renderInspirations } from '../../assets/js/pages/inspirations.js';
test('inspiration provenance shows actual WorkBuddy source and Shanghai time regardless of computer timezone',()=>{
  const previous=process.env.TZ;process.env.TZ='America/Los_Angeles';
  try{
    const html=renderInspirations({data:{items:[{id:'i',rawText:'虚构',summaryTitle:'虚构',status:'inbox',sourceType:'workbuddy',createdAt:'2026-09-05T13:57:00Z',tags:[],version:1}]}});
    assert.match(html,/2026-09-05 21:57 上海/);assert.match(html,/WorkBuddy/);assert.doesNotMatch(html,/手动记录/);
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
