-- Sign-ups (GitHub identity + questionnaire) and the operator audit trail.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id INTEGER NOT NULL UNIQUE,
  login TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  github_name TEXT NOT NULL DEFAULT '',
  github_email TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waitlisted' CHECK (status IN ('waitlisted', 'invited', 'active', 'rejected')),
  answers TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX users_status_id ON users (status, id);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_login TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  user_login TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT
);
