ALTER TABLE observations ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual','workbuddy'));
ALTER TABLE observations ADD COLUMN converted_at TEXT;
CREATE TABLE report_snapshots (
 id TEXT PRIMARY KEY,
 period_type TEXT NOT NULL CHECK(period_type IN ('week','month')),
 period_start TEXT NOT NULL,
 period_end TEXT NOT NULL,
 markdown TEXT NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 generated_at TEXT NOT NULL
);
CREATE TRIGGER report_snapshots_update_immutable BEFORE UPDATE ON report_snapshots
BEGIN SELECT RAISE(ABORT, 'REPORT_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER report_snapshots_delete_immutable BEFORE DELETE ON report_snapshots
BEGIN SELECT RAISE(ABORT, 'REPORT_SNAPSHOT_IMMUTABLE'); END;
