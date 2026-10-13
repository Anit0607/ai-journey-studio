
ALTER TABLE sources ADD COLUMN IF NOT EXISTS clearance_id UUID REFERENCES events(id);
ALTER TABLE sources ADD COLUMN IF NOT EXISTS clearance_hash TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS clearance_provider TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS clearance_purpose TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS clearance_owner_acknowledged BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS clearance_acknowledgement TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS cleared_sources ON sources(cleared,created);
INSERT INTO schema_versions(version) VALUES(6) ON CONFLICT DO NOTHING;
