ALTER TABLE interest ADD COLUMN emailed INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_interest_dedupe ON interest (lower(email), group_slug, created_at);
