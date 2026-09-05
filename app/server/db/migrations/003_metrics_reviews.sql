CREATE TABLE ingestion_runs (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK(source_type IN ('manual','csv','excel','workbuddy','official_api')),
  source_name TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL CHECK(period_end >= period_start),
  status TEXT NOT NULL CHECK(status IN ('received','validated','imported','partial_failure','failed')),
  rows_total INTEGER NOT NULL CHECK(rows_total >= 0),
  rows_imported INTEGER NOT NULL CHECK(rows_imported >= 0),
  rows_rejected INTEGER NOT NULL CHECK(rows_rejected >= 0),
  error_json TEXT NOT NULL CHECK(json_valid(error_json)),
  mapping_json TEXT CHECK(mapping_json IS NULL OR json_valid(mapping_json)),
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE metric_snapshots (
  id TEXT PRIMARY KEY,
  platform_id TEXT REFERENCES platform_channels(id),
  publication_id TEXT REFERENCES content_publications(id),
  ingestion_run_id TEXT NOT NULL REFERENCES ingestion_runs(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL CHECK(period_end >= period_start),
  captured_at TEXT NOT NULL,
  source_reference TEXT,
  notes TEXT,
  CHECK((platform_id IS NULL) <> (publication_id IS NULL))
);

CREATE TABLE metric_values (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES metric_snapshots(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL CHECK(metric_key IN ('views','likes','comments','shares','saves','followers_total',
    'followers_gained','followers_lost','net_followers','completion_rate','two_second_bounce_rate',
    'five_second_retention_rate','average_watch_seconds')),
  value_number REAL NOT NULL,
  unit TEXT NOT NULL CHECK(unit IN ('count','ratio','seconds')),
  evidence_level TEXT NOT NULL CHECK(evidence_level IN ('observed','derived','inferred')),
  calculation_note TEXT,
  evidence_json TEXT CHECK(evidence_json IS NULL OR json_valid(evidence_json)),
  UNIQUE(snapshot_id, metric_key),
  CHECK(evidence_level = 'observed' OR (
    calculation_note IS NOT NULL AND length(trim(calculation_note)) > 0
    AND evidence_json IS NOT NULL AND evidence_json NOT IN ('null','[]','{}','""'))),
  CHECK(value_number >= 0 OR metric_key = 'net_followers'),
  CHECK(unit <> 'ratio' OR value_number BETWEEN 0 AND 1),
  CHECK(unit <> 'count' OR value_number = CAST(value_number AS INTEGER))
);

CREATE TABLE metric_series_points (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES metric_snapshots(id) ON DELETE CASCADE,
  series_key TEXT NOT NULL CHECK(series_key IN ('traffic_lifecycle','retention','engagement_timeline','traffic_source')),
  position REAL NOT NULL CHECK(position >= 0),
  label TEXT NOT NULL,
  value_number REAL NOT NULL CHECK(value_number >= 0),
  unit TEXT NOT NULL CHECK(unit IN ('count','ratio','seconds')),
  evidence_level TEXT NOT NULL CHECK(evidence_level IN ('observed','derived','inferred')),
  calculation_note TEXT,
  evidence_json TEXT CHECK(evidence_json IS NULL OR json_valid(evidence_json)),
  UNIQUE(snapshot_id, series_key, position),
  CHECK(unit <> 'ratio' OR value_number BETWEEN 0 AND 1),
  CHECK(unit <> 'count' OR value_number = CAST(value_number AS INTEGER)),
  CHECK(evidence_level = 'observed' OR (
    calculation_note IS NOT NULL AND length(trim(calculation_note)) > 0
    AND evidence_json IS NOT NULL AND evidence_json NOT IN ('null','[]','{}','""')))
);

CREATE TABLE content_reviews (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL UNIQUE REFERENCES metric_snapshots(id) ON DELETE CASCADE,
  content_id TEXT NOT NULL REFERENCES contents(id),
  platform_id TEXT NOT NULL REFERENCES platform_channels(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL CHECK(period_end >= period_start),
  summary TEXT NOT NULL,
  data_quality TEXT NOT NULL CHECK(data_quality IN ('complete','partial','proxy_based')),
  generated_by TEXT NOT NULL CHECK(generated_by IN ('human','workbuddy','ai')),
  generated_at TEXT NOT NULL
);

CREATE TABLE review_findings (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES content_reviews(id) ON DELETE CASCADE,
  finding_type TEXT NOT NULL CHECK(finding_type IN ('strength','issue','recommendation','high_engagement_segment')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  evidence_level TEXT NOT NULL CHECK(evidence_level IN ('observed','derived','inferred')),
  calculation_note TEXT,
  evidence_json TEXT CHECK(evidence_json IS NULL OR json_valid(evidence_json)),
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  UNIQUE(review_id, sort_order),
  CHECK(evidence_level = 'observed' OR (
    calculation_note IS NOT NULL AND length(trim(calculation_note)) > 0
    AND evidence_json IS NOT NULL AND evidence_json NOT IN ('null','[]','{}','""')))
);

CREATE INDEX metric_snapshots_platform_period_idx ON metric_snapshots(platform_id, period_start, period_end, captured_at);
CREATE INDEX metric_snapshots_publication_period_idx ON metric_snapshots(publication_id, period_start, period_end, captured_at);
CREATE INDEX metric_snapshots_run_idx ON metric_snapshots(ingestion_run_id);
CREATE INDEX ingestion_runs_started_idx ON ingestion_runs(started_at);
CREATE INDEX content_reviews_content_idx ON content_reviews(content_id, period_start, period_end);
