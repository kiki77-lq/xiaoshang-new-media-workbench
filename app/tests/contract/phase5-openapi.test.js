import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { phase5Server } from '../helpers/phase5-api.js';

test('PHASE5 OpenAPI describes routed ingestion defaults, bounded evidence, review and derived trends', async t => {
  const spec = parse(fs.readFileSync(new URL('../../server/openapi.yaml',import.meta.url),'utf8'));
  for (const [path,method] of [['/ingestion','post'],['/ingestion','get'],['/ingestion/mapping','get'],
    ['/analytics/overview','get'],['/contents/{id}/review','get']]) {
    assert.ok(spec.paths[path]?.[method]?.operationId, path);
  }
  const schemas = spec.components.schemas;
  const monthPattern = spec.paths['/analytics/overview'].get.parameters.find(p=>p.name==='month').schema.pattern;
  assert.equal(new RegExp(monthPattern).test('2026-09'),true);
  assert.equal(schemas.IngestionInput.additionalProperties,false);
  assert.equal(schemas.IngestionInput.properties.rows.maxItems,1000);
  assert.ok(schemas.IngestionInput.properties.defaults);
  assert.ok(spec.paths['/ingestion'].post.parameters.some(p=>p.$ref==='#/components/parameters/IdempotencyKey'));
  for (const field of ['evidenceLevel','calculationNote','evidence']) assert.ok(schemas.TrendPoint.required.includes(field));
  // Every local reference resolves, including PHASE3/4 retained definitions.
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (value.$ref?.startsWith('#/')) {
      let ref = spec;
      for (const key of value.$ref.slice(2).split('/')) ref = ref?.[key];
      assert.ok(ref,value.$ref);
    }
    Object.values(value).forEach(walk);
  };
  walk(spec);
  const s = await phase5Server(t);
  const imported = await s.ingest([s.row({views:7},{periodStart:'2026-09-02',periodEnd:'2026-09-02'})]);
  assert.equal(imported.status,201);
  for (const key of schemas.IngestionRun.required) assert.ok(Object.hasOwn(imported.data,key),key);
  const overview = (await s.overview()).data;
  for (const key of schemas.AnalyticsOverview.required) assert.ok(Object.hasOwn(overview,key),key);
  for (const key of schemas.TrendPoint.required) assert.ok(Object.hasOwn(overview.trends.views[0],key),key);
  const review = (await s.review()).data;
  for (const key of schemas.ContentReviewResult.required) assert.ok(Object.hasOwn(review,key),key);
});
