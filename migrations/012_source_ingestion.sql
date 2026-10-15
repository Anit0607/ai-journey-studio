
CREATE TABLE IF NOT EXISTS source_sync_state (
 provider TEXT NOT NULL CHECK(provider IN ('github','youtube')),
 scope TEXT NOT NULL, cursor JSONB NOT NULL DEFAULT '{}',
 last_attempted_at TIMESTAMPTZ, last_synced_at TIMESTAMPTZ, last_error TEXT,
 lease_token UUID, lease_until TIMESTAMPTZ,
 PRIMARY KEY(provider,scope)
);
CREATE TABLE IF NOT EXISTS source_provenance (
 id UUID PRIMARY KEY, source_id UUID NOT NULL REFERENCES sources(id),
 provider TEXT NOT NULL CHECK(provider IN ('github','youtube','chatgpt','claude','gemini','codex','spark')),
 scope TEXT NOT NULL, external_id TEXT NOT NULL, content_hash TEXT NOT NULL,
 source_url TEXT, metadata JSONB NOT NULL DEFAULT '{}', imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(provider,scope,external_id,content_hash)
);
CREATE INDEX IF NOT EXISTS source_provenance_source ON source_provenance(source_id);
INSERT INTO schema_versions(version) VALUES(12) ON CONFLICT DO NOTHING;
