CREATE TABLE IF NOT EXISTS engineering_notes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  modified_time TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS engineering_sync (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
