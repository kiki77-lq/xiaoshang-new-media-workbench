CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE platform_channels (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK(code IN ('douyin', 'wechat_channels', 'xiaohongshu', 'weibo')),
  display_name TEXT NOT NULL,
  handle TEXT,
  profile_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  last_metric_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  updated_at TEXT NOT NULL
);

CREATE TABLE contents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK(content_type IN ('organic', 'commercial')),
  status TEXT NOT NULL CHECK(status IN ('preparing', 'producing', 'ready', 'published')),
  brand TEXT,
  vehicle_model TEXT,
  summary TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);

CREATE TABLE inspirations (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  summary_title TEXT NOT NULL,
  brand TEXT,
  vehicle_model TEXT,
  source_type TEXT NOT NULL CHECK(source_type IN ('wechat', 'workbuddy', 'manual', 'hotspot', 'other')),
  source_platform TEXT,
  source_url TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1)),
  status TEXT NOT NULL CHECK(status IN ('inbox', 'organized', 'converted', 'archived')),
  converted_content_id TEXT REFERENCES contents(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);

CREATE TABLE content_inspirations (
  content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  inspiration_id TEXT NOT NULL REFERENCES inspirations(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'source',
  PRIMARY KEY(content_id, inspiration_id)
);

CREATE TABLE content_publications (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  platform_id TEXT NOT NULL REFERENCES platform_channels(id),
  status TEXT NOT NULL CHECK(status IN ('not_started', 'preparing', 'producing', 'ready', 'scheduled', 'published')),
  scheduled_at TEXT,
  published_at TEXT,
  platform_content_id TEXT,
  published_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  UNIQUE(content_id, platform_id)
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);

CREATE TABLE inspiration_tags (
  inspiration_id TEXT NOT NULL REFERENCES inspirations(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(inspiration_id, tag_id)
);

CREATE TABLE content_tags (
  content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(content_id, tag_id)
);

CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('hotspot', 'competitor')),
  title TEXT NOT NULL,
  ai_summary TEXT,
  competitor_name TEXT,
  brand TEXT,
  vehicle_model TEXT,
  source_url TEXT NOT NULL,
  source_platform TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  heat_score REAL,
  heat_delta REAL,
  worth_reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'converted', 'ignored')),
  converted_inspiration_id TEXT REFERENCES inspirations(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);

CREATE TABLE observation_tags (
  observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(observation_id, tag_id)
);

CREATE TABLE schedule_events (
  id TEXT PRIMARY KEY,
  content_id TEXT REFERENCES contents(id) ON DELETE CASCADE,
  publication_id TEXT REFERENCES content_publications(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('shoot', 'publish', 'pending_confirmation')),
  status TEXT NOT NULL CHECK(status IN ('planned', 'confirmed', 'completed', 'cancelled')),
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  CHECK(event_type <> 'publish' OR publication_id IS NOT NULL)
);

CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL CHECK(actor IN ('web', 'workbuddy', 'system')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  request_id TEXT NOT NULL,
  before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK(after_json IS NULL OR json_valid(after_json)),
  occurred_at TEXT NOT NULL
);

CREATE INDEX content_publications_content_idx ON content_publications(content_id);
CREATE INDEX inspirations_status_created_idx ON inspirations(status, created_at);
CREATE INDEX contents_status_updated_idx ON contents(status, updated_at);
CREATE INDEX observations_kind_status_idx ON observations(kind, status);
CREATE INDEX schedule_events_starts_idx ON schedule_events(starts_at);
CREATE INDEX idempotency_keys_expires_idx ON idempotency_keys(expires_at);
CREATE INDEX audit_log_entity_idx ON audit_log(entity_type, entity_id, occurred_at);

CREATE TRIGGER inspirations_raw_text_immutable
BEFORE UPDATE OF raw_text ON inspirations
FOR EACH ROW
WHEN NEW.raw_text <> OLD.raw_text
BEGIN
  SELECT RAISE(ABORT, 'INSPIRATION_RAW_TEXT_IMMUTABLE');
END;

INSERT INTO platform_channels(
  id, code, display_name, enabled, created_at, updated_at, version
) VALUES
  ('platform-douyin', 'douyin', '抖音', 1, '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z', 1),
  ('platform-wechat-channels', 'wechat_channels', '视频号', 1, '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z', 1),
  ('platform-xiaohongshu', 'xiaohongshu', '小红书', 1, '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z', 1),
  ('platform-weibo', 'weibo', '微博', 1, '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z', 1);
