ALTER TABLE inspirations
ADD COLUMN summary_title_is_fallback INTEGER NOT NULL DEFAULT 0
CHECK(summary_title_is_fallback IN (0, 1));
