import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReports } from '../../assets/js/pages/reports.js';
import { renderObservations } from '../../assets/js/pages/observations.js';
import { renderSettings } from '../../assets/js/pages/settings.js';
import { renderBackups } from '../../assets/js/pages/backup-ui.js';

test('reports show immutable snapshot period and deterministic generation without fake AI claims',()=>{
  const html=renderReports({data:{items:[{id:'r1',periodType:'week',periodStart:'2026-08-31',periodEnd:'2026-09-06',generatedBy:'deterministic',generatedAt:'2026-09-05T00:00:00Z',summary:{newInspirations:2,newContents:1,publishedContents:0,views:null,topContents:[],platforms:[],insights:['<unsafe>'],recommendations:[],dataGaps:['未导入'],observations:[]},markdown:'# 虚构报告'}]},filters:{periodType:'week',anchorDate:'2026-09-05'}});
  assert.match(html,/2026-08-31/);assert.match(html,/本地规则/);assert.match(html,/&lt;unsafe&gt;/);assert.match(html,/data-copy-report/);assert.doesNotMatch(html,/AI 周期结论/);
});
test('observations render API source, status, conversion guard and escaped content without a seeded fake card',()=>{
  const html=renderObservations({data:{items:[{id:'o1',kind:'hotspot',title:'<标题>',summary:'原始摘要',status:'converted',sourceType:'manual',sourcePlatform:'douyin',sourceUrl:'https://example.invalid',worthReason:'值得记录',heatScore:72,tags:[],version:2,convertedInspirationId:'i1'}],stats:{todayHotspots:1,highHeat:1,pending:0,weekConverted:1}}});
  assert.match(html,/&lt;标题&gt;/);assert.match(html,/已收入灵感/);assert.match(html,/人工热度/);assert.doesNotMatch(html,/热点条目将显示在这里/);
});
test('settings uses actual keywords and token configured does not claim WorkBuddy is online or expose a token',()=>{
  const html=renderSettings({data:{version:1,keywords:['<test>'],workbuddy:{tokenConfigured:true,lastRequestAt:null,token:'must-not-render'},platforms:[],backups:[{id:'b1',createdAt:'2026-09-05T00:00:00Z',appVersion:'0.1.0',schemaVersion:4,sizeBytes:123,sha256:'ab'.repeat(32),integrity:'ok',verified:true,restorable:true}]},health:{status:'ok',database:'ok'}});
  assert.match(html,/&lt;test&gt;/);assert.match(html,/尚无已认证请求/);assert.match(html,/data-verify-backup="b1"/);assert.doesNotMatch(html,/must-not-render|WorkBuddy 已连接|沃尔沃/);
});
test('settings surfaces unsafe backup warnings instead of silently presenting a complete clean inventory',()=>{
  const html=renderSettings({data:{platforms:[],keywords:[],backups:[],workbuddy:{},backupWarnings:['已忽略 <不安全清单>']}});
  assert.match(html,/已忽略 &lt;不安全清单&gt;/);
});
test('incompatible backups are explicitly labelled and cannot offer restore action',()=>{
  const html=renderBackups([{id:'future',createdAt:'2026-09-05T00:00:00Z',verified:true,restorable:false,sizeBytes:1}]);
  assert.match(html,/版本不兼容/);
  assert.match(html,/data-verify-backup="future" disabled/);
});
