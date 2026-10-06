-- The public website's daily allowance per visitor (lib/server/site.ts): one row per paid
-- submission (a room, a piece, a paid retry) or upload, by visitor id and hashed network address.
CREATE TABLE submissions (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  client TEXT NOT NULL,
  kind TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX submissions_recent ON submissions(kind, created);
