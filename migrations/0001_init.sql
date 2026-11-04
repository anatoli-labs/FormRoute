CREATE TABLE IF NOT EXISTS forms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email_template TEXT,
  redirect_url TEXT,
  success_message TEXT DEFAULT 'Thank you for your submission!',
  database_config TEXT NOT NULL DEFAULT '{"type":"d1"}',
  spam_protection TEXT DEFAULT '{"disabled":true}',
  email_config TEXT,
  api_key TEXT,
  allowed_domains TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  data TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  submitted_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_submissions_form_id ON submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_submissions_submitted_at ON submissions(submitted_at);
