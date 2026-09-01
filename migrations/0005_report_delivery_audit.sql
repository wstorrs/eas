ALTER TABLE reports ADD COLUMN delivery_attempted_at TEXT;
ALTER TABLE reports ADD COLUMN delivered_at TEXT;
ALTER TABLE reports ADD COLUMN delivery_error TEXT;

CREATE INDEX idx_reports_generated_at ON reports(generated_at);
CREATE INDEX idx_reports_delivery_status ON reports(delivery_status);
