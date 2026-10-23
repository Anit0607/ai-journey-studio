
ALTER TABLE publishing_outbox ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'scheduled' CHECK(delivery_mode IN ('scheduled','manual'));
INSERT INTO schema_versions(version) VALUES(20) ON CONFLICT DO NOTHING;
