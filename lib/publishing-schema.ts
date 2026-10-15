/** Durable, fail-closed publication intents. No account credentials are stored here. */
export const PUBLISHING_SCHEMA=`
CREATE TABLE IF NOT EXISTS publishing_budget_guard (id INTEGER PRIMARY KEY CHECK(id=1));
INSERT INTO publishing_budget_guard(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS publishing_outbox (
 id UUID PRIMARY KEY, request_id UUID UNIQUE NOT NULL,
 task_id UUID NOT NULL REFERENCES tasks(id), source_id UUID NOT NULL REFERENCES sources(id), source_hash TEXT NOT NULL, source_clearance_token TEXT NOT NULL,
 review_token TEXT NOT NULL, artifact_hash TEXT NOT NULL, variant_hash TEXT NOT NULL,
 platform TEXT NOT NULL CHECK(platform IN ('LinkedIn','X','Instagram')),
 account_id TEXT NOT NULL, account_version TEXT NOT NULL, remote_id TEXT NOT NULL,
 payload JSONB NOT NULL, scheduled_at TIMESTAMPTZ NOT NULL, version TEXT UNIQUE NOT NULL,
 status TEXT NOT NULL DEFAULT 'staged' CHECK(status IN ('staged','approved','claimed','published','failed','uncertain','cancelled','invalidated','missed')),
 reason TEXT, claim_token UUID, claimed_at TIMESTAMPTZ, published_at TIMESTAMPTZ,
 provider_id TEXT, receipt JSONB, budget_month TEXT, reserved_microdollars BIGINT NOT NULL DEFAULT 0 CHECK(reserved_microdollars>=0),
 created TIMESTAMPTZ NOT NULL DEFAULT now(), updated TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE publishing_outbox ADD COLUMN IF NOT EXISTS source_clearance_token TEXT NOT NULL DEFAULT 'unverified';
CREATE INDEX IF NOT EXISTS publishing_due ON publishing_outbox(status,scheduled_at);
CREATE TABLE IF NOT EXISTS publishing_approvals (
 id UUID PRIMARY KEY, outbox_id UUID NOT NULL REFERENCES publishing_outbox(id), version TEXT NOT NULL,
 acknowledgement TEXT NOT NULL, created TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(outbox_id,version)
);
CREATE TABLE IF NOT EXISTS publishing_requests (
 request_id UUID PRIMARY KEY, outbox_id UUID NOT NULL REFERENCES publishing_outbox(id), version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publishing_attempts (
 id UUID PRIMARY KEY, outbox_id UUID NOT NULL REFERENCES publishing_outbox(id), claim_token UUID NOT NULL,
 stage TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('started','received','uncertain','rejected')),
 http_status INTEGER, provider_id TEXT, created TIMESTAMPTZ NOT NULL DEFAULT now(), updated TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(outbox_id,stage)
);
CREATE OR REPLACE FUNCTION studio_publishing_approval_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Publication approvals are immutable'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS publishing_approval_immutable ON publishing_approvals;
CREATE TRIGGER publishing_approval_immutable BEFORE UPDATE OR DELETE ON publishing_approvals FOR EACH ROW EXECUTE FUNCTION studio_publishing_approval_immutable();
INSERT INTO schema_versions(version) VALUES(13) ON CONFLICT DO NOTHING;
`;
