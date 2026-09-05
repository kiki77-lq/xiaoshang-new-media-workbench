import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { phase5Server } from '../helpers/phase5-api.js';
import { randomUUID } from 'node:crypto';

test('PHASE6 OpenAPI covers live reports observations settings recovery and strict public shapes',async t=>{
  const spec=parse(fs.readFileSync(new URL('../../server/openapi.yaml',import.meta.url),'utf8'));
  for(const [route,methods] of Object.entries({'/reports':['get','post'],'/reports/preview':['get'],'/reports/{id}':['get'],'/reports/{id}/markdown':['get'],'/observations':['get','post'],'/observations/{id}':['get','patch'],'/observations/{id}/convert':['post'],'/settings':['get','patch'],'/backups':['get','post'],'/backups/{id}/verify':['post'],'/backups/{id}/restore':['post']}))for(const method of methods)assert.ok(spec.paths[route]?.[method]?.operationId,`${method} ${route}`);
  const schemas=spec.components.schemas;
  for(const name of ['ReportInput','ObservationInput','ObservationPatch','SettingsInput','RestoreInput'])assert.equal(schemas[name].additionalProperties,false,name);
  assert.equal(schemas.RestoreInput.properties.confirmText.const,'恢复');
  assert.ok(spec.paths['/backups/{id}/restore'].post.parameters.some(p=>p.$ref==='#/components/parameters/IdempotencyKey'));
  const s=await phase5Server(t);
  for(const [route,name] of [['/settings','Settings'],['/reports/preview?periodType=week&anchorDate=2026-09-05','Report']]){
    const result=await s.call(route);assert.equal(result.status,200);
    for(const key of schemas[name].required)assert.ok(Object.hasOwn(result.data,key),key);
  }
  const backup=await s.call('/backups',{method:'POST',key:randomUUID(),body:{}});
  for(const key of schemas.Backup.required)assert.ok(Object.hasOwn(backup.data,key),key);
});
