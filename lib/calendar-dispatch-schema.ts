export const CALENDAR_DISPATCH_SCHEMA=`
ALTER TABLE calendar_settings ADD COLUMN IF NOT EXISTS generation_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS origin_key TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS content_brief JSONB NOT NULL DEFAULT '{}';
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_source_id_source_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_source_version_origin ON tasks(source_id,source_hash,origin_key);
ALTER TABLE calendar_jobs DROP CONSTRAINT IF EXISTS calendar_jobs_status_check;
ALTER TABLE calendar_jobs ADD CONSTRAINT calendar_jobs_status_check CHECK(status IN ('blocked','dispatched','linked'));
ALTER TABLE calendar_jobs ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id);
ALTER TABLE calendar_jobs ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES sources(id);
ALTER TABLE calendar_jobs ADD COLUMN IF NOT EXISTS source_hash TEXT;
ALTER TABLE calendar_jobs ADD COLUMN IF NOT EXISTS block_reason TEXT;
ALTER TABLE calendar_jobs ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ;
ALTER TABLE calendar_jobs ADD COLUMN IF NOT EXISTS updated TIMESTAMPTZ NOT NULL DEFAULT now();
INSERT INTO schema_versions(version) VALUES(7) ON CONFLICT DO NOTHING;
`;
