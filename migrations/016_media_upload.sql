
CREATE TABLE IF NOT EXISTS media_upload_guard(id INTEGER PRIMARY KEY CHECK(id=1));
INSERT INTO media_upload_guard(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS media_uploads(
 sha256 TEXT NOT NULL,public_origin TEXT NOT NULL,media_id UUID NOT NULL REFERENCES media_artifacts(id),
 outbox_id UUID NOT NULL REFERENCES publishing_outbox(id),byte_length BIGINT NOT NULL CHECK(byte_length>0),
 status TEXT NOT NULL CHECK(status IN ('uncertain','uploaded')),url TEXT,created TIMESTAMPTZ NOT NULL DEFAULT now(),verified_at TIMESTAMPTZ,
 PRIMARY KEY(sha256,public_origin)
);
INSERT INTO schema_versions(version) VALUES(16) ON CONFLICT DO NOTHING;
