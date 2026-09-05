import { randomUUID } from 'node:crypto';
import { appendAuditLog } from '../repositories/audit-repository.js';
import { withIdempotency } from './idempotency-service.js';
import { assertObject, optionalString, requiredString } from './validation.js';
import { timestamp } from './scheduling-rules.js';
import { ROW_FIELDS, invalid, period, normalizeMetrics, normalizeSeries, normalizeReview } from './metric-model.js';
import { validateIngestion, parseIngestion } from './ingestion-parser.js';

function normalizeRow(input, request, db, now) {
  assertObject(input, ROW_FIELDS);
  const platformCode = requiredString(input.platformCode, 'platformCode', 80);
  const platform = db.prepare('SELECT id FROM platform_channels WHERE code=?').get(platformCode);
  if (!platform) invalid('Unknown platformCode.');
  const contentId = optionalString(input.contentId, 'contentId', 240);
  const publication = contentId ? db.prepare('SELECT id FROM content_publications WHERE content_id=? AND platform_id=?')
    .get(contentId, platform.id) : null;
  if (contentId && !publication) invalid('Unknown content or publication.');
  const dates = period(input.periodStart === undefined ? request.periodStart : input.periodStart,
    input.periodEnd === undefined ? request.periodEnd : input.periodEnd);
  const metrics = normalizeMetrics(input), series = normalizeSeries(input.series), review = normalizeReview(input.review);
  if (!contentId && (input.series !== undefined || input.review !== undefined)) invalid('series/review require a contentId.');
  if (!Object.keys(metrics).length && !series.length && !review) invalid('Row has no metrics, series or review.');
  return { ...dates, platformId: contentId ? null : platform.id, publicationId: publication?.id ?? null,
    reviewPlatformId: platform.id, contentId, metrics, series, review,
    capturedAt: input.capturedAt === undefined ? now : timestamp(input.capturedAt, 'capturedAt'),
    sourceReference: optionalString(input.sourceReference, 'sourceReference', 2048),
    notes: optionalString(input.notes, 'notes', 5000) };
}

function insertRow(db, runId, row, now) {
  const id = randomUUID();
  db.prepare(`INSERT INTO metric_snapshots(id,platform_id,publication_id,ingestion_run_id,period_start,period_end,
    captured_at,source_reference,notes) VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id, row.platformId, row.publicationId, runId, row.periodStart, row.periodEnd, row.capturedAt, row.sourceReference, row.notes);
  const metric = db.prepare(`INSERT INTO metric_values(id,snapshot_id,metric_key,value_number,unit,evidence_level,
    calculation_note,evidence_json) VALUES (?,?,?,?,?,?,?,?)`);
  for (const [key, v] of Object.entries(row.metrics)) metric.run(
    randomUUID(), id, key, v.value, v.unit, v.evidenceLevel, v.calculationNote, JSON.stringify(v.evidence));
  const point = db.prepare(`INSERT INTO metric_series_points(id,snapshot_id,series_key,position,label,value_number,
    unit,evidence_level,calculation_note,evidence_json) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const v of row.series) point.run(randomUUID(), id, v.seriesKey, v.position, v.label,
    v.value, v.unit, v.evidenceLevel, v.calculationNote, JSON.stringify(v.evidence));
  if (row.review) {
    const reviewId = randomUUID(), r = row.review;
    db.prepare(`INSERT INTO content_reviews(id,snapshot_id,content_id,platform_id,period_start,period_end,
      summary,data_quality,generated_by,generated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      reviewId, id, row.contentId, row.reviewPlatformId, row.periodStart, row.periodEnd, r.summary, r.dataQuality, r.generatedBy, now);
    const finding = db.prepare(`INSERT INTO review_findings(id,review_id,finding_type,title,body,evidence_level,
      calculation_note,evidence_json,sort_order) VALUES (?,?,?,?,?,?,?,?,?)`);
    r.findings.forEach((v, index) => finding.run(randomUUID(), reviewId, v.findingType, v.title, v.body,
      v.evidenceLevel, v.calculationNote, JSON.stringify(v.evidence), index));
  }
  db.prepare('UPDATE platform_channels SET last_metric_at=MAX(COALESCE(last_metric_at,?),?) WHERE id=?')
    .run(now, now, row.reviewPlatformId);
}

export function runResult(row) {
  return { id: row.id, sourceType: row.source_type, sourceName: row.source_name,
    periodStart: row.period_start, periodEnd: row.period_end, status: row.status,
    rowsTotal: row.rows_total, rowsImported: row.rows_imported, rowsRejected: row.rows_rejected,
    errors: JSON.parse(row.error_json), startedAt: row.started_at, completedAt: row.completed_at };
}
export function listIngestionRuns(db) {
  return { items: db.prepare('SELECT * FROM ingestion_runs ORDER BY started_at DESC, rowid DESC LIMIT 100').all().map(runResult) };
}
export async function createIngestion(input, context) {
  const request = validateIngestion(input);
  return withIdempotency({ db: context.db, key: context.idempotencyKey, method: 'POST',
    path: '/api/v1/ingestion', requestBody: input, execute: () => {
      const db = context.db, id = randomUUID(), now = new Date().toISOString();
      db.prepare(`INSERT INTO ingestion_runs(id,source_type,source_name,period_start,period_end,status,
        rows_total,rows_imported,rows_rejected,error_json,mapping_json,started_at) VALUES (?,?,?,?,?,'received',0,0,0,'[]',?,?)`)
        .run(id, request.sourceType, request.sourceName, request.periodStart, request.periodEnd, JSON.stringify(request.mapping), now);
      let records = [], parseFailed = false;
      const errors = [];
      try { records = parseIngestion(request); }
      catch (error) { parseFailed = true; errors.push({ row: 0, message: error.message.slice(0,500) }); }
      let imported = 0;
      for (const record of records) {
        db.exec('SAVEPOINT ingestion_row');
        try {
          if (record.error) invalid(record.error);
          insertRow(db, id, normalizeRow(record.row, request, db, now), now);
          db.exec('RELEASE SAVEPOINT ingestion_row');
          imported++;
        } catch (error) {
          db.exec('ROLLBACK TO SAVEPOINT ingestion_row');
          db.exec('RELEASE SAVEPOINT ingestion_row');
          errors.push({ row: record.line, message: error.message.slice(0,500) });
        }
      }
      const rejected = records.length - imported;
      const status = parseFailed || imported === 0 ? 'failed' : rejected ? 'partial_failure' : 'imported';
      const completedAt = new Date().toISOString();
      db.prepare('UPDATE ingestion_runs SET status=?,rows_total=?,rows_imported=?,rows_rejected=?,error_json=?,completed_at=? WHERE id=?')
        .run(status, records.length, imported, rejected, JSON.stringify(errors), completedAt, id);
      const result = runResult(db.prepare('SELECT * FROM ingestion_runs WHERE id=?').get(id));
      appendAuditLog({ db, actor: context.actor, requestId: context.requestId, action: 'ingestion.create',
        entityType: 'ingestion_run', entityId: id, after: result });
      return { status: 201, body: result };
    } });
}
