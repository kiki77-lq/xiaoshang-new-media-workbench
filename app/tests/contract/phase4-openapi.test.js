import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

test('OpenAPI specifies Phase 4 operations, strict inputs, versioned deletes, reasons and bounded calendar reads',()=>{
  const spec=parse(fs.readFileSync(new URL('../../server/openapi.yaml',import.meta.url),'utf8'));
  for(const [p,methods] of Object.entries({'/contents/{id}/publications/{platformCode}':['patch'],'/calendar-events':['get','post'],'/calendar-events/{id}':['patch','delete']})) {
    assert.ok(spec.paths[p],p);
    for(const method of methods) {
      const op=spec.paths[p][method]; assert.ok(op.operationId);
      assert.ok(op.responses['200'] || op.responses['201']);
      if(method!=='get') { assert.ok(op.security);assert.ok(op.requestBody.required);assert.ok(op.responses['409']); }
    }
  }
  const get=spec.paths['/calendar-events'].get;
  for(const name of ['from','to']) assert.ok(get.parameters.some(p=>p.name===name && p.required));
  assert.ok(spec.paths['/calendar-events'].post.parameters.some(p=>p.$ref==='#/components/parameters/IdempotencyKey'));
  for(const name of ['UpdatePublicationInput','UpdateCalendarEventInput','DeleteCalendarEventInput']) {
    const schema=spec.components.schemas[name];assert.ok(schema.required.includes('version'));
    assert.equal(schema.additionalProperties,false);assert.ok(schema.properties.reason);
  }
  assert.deepEqual(spec.components.schemas.CalendarEventType.enum,['shoot','publish','pending_confirmation']);
  assert.ok(spec.components.schemas.CalendarEvent.properties.endsAt);
});
