-- One index serves the submissions list, the count and the delete: a form's rows, newest first.
CREATE INDEX IF NOT EXISTS idx_submissions_form_submitted ON submissions(form_id, submitted_at DESC);
DROP INDEX IF EXISTS idx_submissions_form_id;
DROP INDEX IF EXISTS idx_submissions_submitted_at;
