const SNAPSHOTS = `
  SELECT s.*, s.rowid AS sequence, p.code AS platform_code, p.display_name AS platform_name,
    cp.content_id, c.title, r.source_type, r.source_name, r.completed_at,
    ROW_NUMBER() OVER (
      PARTITION BY s.platform_id,s.publication_id,s.period_start,s.period_end
      ORDER BY s.captured_at DESC,s.rowid DESC
    ) AS latest
  FROM metric_snapshots s
  LEFT JOIN content_publications cp ON cp.id=s.publication_id
  JOIN platform_channels p ON p.id=COALESCE(s.platform_id,cp.platform_id)
  LEFT JOIN contents c ON c.id=cp.content_id
  JOIN ingestion_runs r ON r.id=s.ingestion_run_id
`;
export function latestSnapshots(db, { contentId, platformCode, periodStart, periodEnd } = {}) {
  const clauses = [], parameters = [];
  if (contentId) { clauses.push('cp.content_id=?'); parameters.push(contentId); }
  if (platformCode) { clauses.push('p.code=?'); parameters.push(platformCode); }
  if (periodStart) { clauses.push('s.period_end>=?'); parameters.push(periodStart); }
  if (periodEnd) { clauses.push('s.period_start<=?'); parameters.push(periodEnd); }
  return db.prepare(`SELECT * FROM (${SNAPSHOTS} ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''})
    WHERE latest=1 ORDER BY captured_at DESC,sequence DESC`).all(...parameters);
}
export function evidenceValue(row) {
  return { evidenceLevel: row.evidence_level, calculationNote: row.calculation_note,
    evidence: row.evidence_json ? JSON.parse(row.evidence_json) : null };
}
export function snapshotMetrics(db, id) {
  return Object.fromEntries(db.prepare('SELECT * FROM metric_values WHERE snapshot_id=? ORDER BY metric_key')
    .all(id).map(v => [v.metric_key, { value: v.value_number, unit: v.unit, ...evidenceValue(v) }]));
}
export function snapshotDetail(db, row) {
  return { id: row.id, platformCode: row.platform_code, platformName: row.platform_name,
    periodStart: row.period_start, periodEnd: row.period_end, sourceType: row.source_type, sourceName: row.source_name,
    sourceReference: row.source_reference, capturedAt: row.captured_at, notes: row.notes,
    metrics: snapshotMetrics(db, row.id),
    series: db.prepare('SELECT * FROM metric_series_points WHERE snapshot_id=? ORDER BY series_key,position')
      .all(row.id).map(v => ({ seriesKey: v.series_key, position: v.position, label: v.label,
        value: v.value_number, unit: v.unit, ...evidenceValue(v) })) };
}
export function snapshotReview(db, snapshotId) {
  const r = db.prepare(`SELECT r.*,p.code FROM content_reviews r JOIN platform_channels p ON p.id=r.platform_id
    WHERE r.snapshot_id=?`).get(snapshotId);
  if (!r) return null;
  return { id: r.id, snapshotId: r.snapshot_id, platformCode: r.code, summary: r.summary,
    dataQuality: r.data_quality, generatedBy: r.generated_by, generatedAt: r.generated_at,
    periodStart: r.period_start, periodEnd: r.period_end,
    findings: db.prepare('SELECT * FROM review_findings WHERE review_id=? ORDER BY sort_order').all(r.id)
      .map(f => ({ findingType: f.finding_type, title: f.title, body: f.body, ...evidenceValue(f) })) };
}
