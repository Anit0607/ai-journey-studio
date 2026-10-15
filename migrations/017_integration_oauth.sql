
CREATE TABLE IF NOT EXISTS integration_oauth_guard (id INTEGER PRIMARY KEY CHECK(id=1));
INSERT INTO integration_oauth_guard(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS integration_oauth_flows (
 state_hash TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider IN ('x','linkedin','instagram_facebook')),
 owner_id TEXT NOT NULL CHECK(owner_id='studio-owner') REFERENCES studio_auth_user(id),
 session_id TEXT NOT NULL, binding_hash TEXT NOT NULL, verifier_ciphertext TEXT,
 config_hash TEXT NOT NULL, redirect_uri TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ, created TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_oauth_flow_expiry ON integration_oauth_flows(expires_at);
CREATE TABLE IF NOT EXISTS integration_oauth_connections (
 provider TEXT PRIMARY KEY CHECK(provider IN ('x','linkedin','instagram_facebook')),
 owner_id TEXT NOT NULL CHECK(owner_id='studio-owner') REFERENCES studio_auth_user(id),
 authorization_version UUID NOT NULL, config_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('connected','tested','selection_required','reauthorization_required','disconnected')),
 token_ciphertext TEXT, scopes JSONB NOT NULL DEFAULT '[]', expires_at TIMESTAMPTZ,
 remote_id TEXT, label TEXT, tested_at TIMESTAMPTZ,
 refresh_lease UUID, refresh_until TIMESTAMPTZ, last_error TEXT,
 created TIMESTAMPTZ NOT NULL DEFAULT now(), updated TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS integration_oauth_tests (
 id UUID PRIMARY KEY, provider TEXT NOT NULL CHECK(provider IN ('x','linkedin','instagram_facebook')),
 authorization_version UUID NOT NULL, month TEXT NOT NULL,
 reserved_microdollars BIGINT NOT NULL CHECK(reserved_microdollars>=0),
 state TEXT NOT NULL CHECK(state IN ('started','succeeded','failed','uncertain')), created TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO schema_versions(version) VALUES(17) ON CONFLICT DO NOTHING;
