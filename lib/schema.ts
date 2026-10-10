export const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
 id UUID PRIMARY KEY, text TEXT NOT NULL, category TEXT NOT NULL,
 reported_date TEXT NOT NULL, cleared BOOLEAN NOT NULL DEFAULT FALSE,
 hash TEXT NOT NULL UNIQUE, created TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tasks (
 id UUID PRIMARY KEY, source_id UUID NOT NULL REFERENCES sources(id),
 source_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','blocked','review','approved','cancelled')),
 checkpoint INTEGER NOT NULL DEFAULT 0 CHECK(checkpoint BETWEEN 0 AND 6),
 lease_token UUID, lease_until TIMESTAMPTZ,
 updated TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(source_id,source_hash)
);
CREATE TABLE IF NOT EXISTS outputs (
 id UUID PRIMARY KEY, task_id UUID NOT NULL REFERENCES tasks(id), role TEXT NOT NULL,
 text TEXT NOT NULL, hash TEXT NOT NULL, created TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(task_id,role)
);
CREATE TABLE IF NOT EXISTS events (
 id UUID PRIMARY KEY, task_id UUID REFERENCES tasks(id),
 kind TEXT NOT NULL, detail TEXT NOT NULL, created TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS budget_months (month TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS ledger (
 id UUID PRIMARY KEY, task_id UUID NOT NULL REFERENCES tasks(id), month TEXT NOT NULL REFERENCES budget_months(month),
 provider TEXT NOT NULL, model TEXT NOT NULL, pricing JSONB NOT NULL,
 reserved BIGINT NOT NULL CHECK(reserved>0), estimated BIGINT,
 input_tokens BIGINT, output_tokens BIGINT,
 status TEXT NOT NULL CHECK(status IN ('reserved','settled','unknown')),
 created TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS approvals (
 task_id UUID PRIMARY KEY REFERENCES tasks(id), version TEXT NOT NULL,
 created TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS runtime (
 name TEXT PRIMARY KEY, heartbeat TIMESTAMPTZ NOT NULL, enabled BOOLEAN NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY, applied TIMESTAMPTZ NOT NULL DEFAULT now());
INSERT INTO schema_versions(version) VALUES(1) ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS queued_tasks ON tasks(status,updated);
CREATE INDEX IF NOT EXISTS monthly_ledger ON ledger(month);
`;
export const PREFLIGHT_SCHEMA = `
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS block_reason TEXT;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS requested_service_tier TEXT;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS returned_service_tier TEXT;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS returned_model TEXT;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS provider_request_id TEXT;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS pricing_anomaly BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS completion_status TEXT;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS finish_reason TEXT;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS partial_output TEXT;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS partial_hash TEXT;
INSERT INTO schema_versions(version) VALUES(2) ON CONFLICT DO NOTHING;
`;
export const REVISION_SCHEMA=`
CREATE TABLE IF NOT EXISTS content_revisions (
 id UUID PRIMARY KEY, task_id UUID NOT NULL REFERENCES tasks(id),
 parent_id UUID REFERENCES content_revisions(id), base_token TEXT NOT NULL,
 sequence INTEGER NOT NULL, UNIQUE(task_id,sequence),
 version TEXT NOT NULL, bundle JSONB NOT NULL, request_note TEXT NOT NULL,
 created TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS revision_approvals (
 revision_id UUID PRIMARY KEY REFERENCES content_revisions(id), version TEXT NOT NULL,
 created TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO schema_versions(version) VALUES(3) ON CONFLICT DO NOTHING;
`;
export const SCHEMA=BASE_SCHEMA+PREFLIGHT_SCHEMA+REVISION_SCHEMA;
