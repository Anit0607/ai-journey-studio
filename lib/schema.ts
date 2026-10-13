import {COMPLETION_SCHEMA} from "./completion-schema";
import {HOSTED_BATCH_SCHEMA} from "./hosted-schema";
import {CALENDAR_DISPATCH_SCHEMA} from "./calendar-dispatch-schema";
import {AGENT_REVISION_SCHEMA} from "./agent-revision-schema";
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
export const CALENDAR_SCHEMA=`
CREATE TABLE IF NOT EXISTS calendar_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
 short_days JSONB NOT NULL DEFAULT '[1,3,5]', long_day INTEGER NOT NULL DEFAULT 0,
 review_hours INTEGER NOT NULL DEFAULT 48, start_date TEXT, post_time TEXT,
 generation_lead_hours INTEGER, updated TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO calendar_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS calendar_entries (
 id UUID PRIMARY KEY, planned_date TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('shortform','longform')),
 intended_post TIMESTAMPTZ NOT NULL, draft_due TIMESTAMPTZ NOT NULL, review_due TIMESTAMPTZ NOT NULL,
 generation_due TIMESTAMPTZ, source_id UUID REFERENCES sources(id), task_id UUID REFERENCES tasks(id),
 updated TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(planned_date,kind)
);
CREATE TABLE IF NOT EXISTS calendar_jobs (
 id UUID PRIMARY KEY, entry_id UUID UNIQUE NOT NULL REFERENCES calendar_entries(id),
 status TEXT NOT NULL CHECK(status='blocked'), created TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO schema_versions(version) VALUES(4) ON CONFLICT DO NOTHING;
`;
export const PLATFORM_TIMING_SCHEMA=`
ALTER TABLE calendar_settings ADD COLUMN IF NOT EXISTS timing_mode TEXT NOT NULL DEFAULT 'shared' CHECK(timing_mode IN ('shared','per_platform'));
ALTER TABLE calendar_settings ADD COLUMN IF NOT EXISTS platform_times JSONB NOT NULL DEFAULT '{}';
ALTER TABLE calendar_settings ADD COLUMN IF NOT EXISTS timing_basis TEXT;
ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS platform_schedule JSONB NOT NULL DEFAULT '{}';
INSERT INTO schema_versions(version) VALUES(5) ON CONFLICT DO NOTHING;
`;
export const SOURCE_CLEARANCE_SCHEMA=`
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
`;
import {PASSWORD_SCHEMA} from "./password-schema";
export const SCHEMA=BASE_SCHEMA+PREFLIGHT_SCHEMA+REVISION_SCHEMA+CALENDAR_SCHEMA+PLATFORM_TIMING_SCHEMA+SOURCE_CLEARANCE_SCHEMA+CALENDAR_DISPATCH_SCHEMA+AGENT_REVISION_SCHEMA+HOSTED_BATCH_SCHEMA+PASSWORD_SCHEMA+COMPLETION_SCHEMA;
