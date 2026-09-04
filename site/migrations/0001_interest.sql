CREATE TABLE IF NOT EXISTS interest (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  group_slug TEXT NOT NULL,
  group_title TEXT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  travelers INTEGER,
  room TEXT,
  comments TEXT,
  ip_hash TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_interest_group_slug ON interest (group_slug);
