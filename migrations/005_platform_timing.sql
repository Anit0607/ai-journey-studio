
ALTER TABLE calendar_settings ADD COLUMN IF NOT EXISTS timing_mode TEXT NOT NULL DEFAULT 'shared' CHECK(timing_mode IN ('shared','per_platform'));
ALTER TABLE calendar_settings ADD COLUMN IF NOT EXISTS platform_times JSONB NOT NULL DEFAULT '{}';
ALTER TABLE calendar_settings ADD COLUMN IF NOT EXISTS timing_basis TEXT;
ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS platform_schedule JSONB NOT NULL DEFAULT '{}';
INSERT INTO schema_versions(version) VALUES(5) ON CONFLICT DO NOTHING;
