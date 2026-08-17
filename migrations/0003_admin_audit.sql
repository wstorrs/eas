CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  occurred_at TEXT NOT NULL,
  details_json TEXT
);

CREATE INDEX idx_admin_audit_occurred_at ON admin_audit(occurred_at);
CREATE INDEX idx_admin_audit_admin_email ON admin_audit(admin_email, occurred_at);
