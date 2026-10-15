/** JPEGs stay in the authenticated database until separate public-media consent. */
export const MEDIA_SCHEMA=`
CREATE TABLE IF NOT EXISTS media_artifacts (
 id UUID PRIMARY KEY, task_id UUID NOT NULL REFERENCES tasks(id),
 source_id UUID NOT NULL REFERENCES sources(id), source_hash TEXT NOT NULL,
 source_clearance_id UUID NOT NULL REFERENCES events(id), review_token TEXT NOT NULL,
 caption TEXT NOT NULL, caption_hash TEXT NOT NULL, renderer_version TEXT NOT NULL,
 sha256 TEXT NOT NULL, mime_type TEXT NOT NULL CHECK(mime_type='image/jpeg'),
 width INTEGER NOT NULL CHECK(width=1080), height INTEGER NOT NULL CHECK(height=1350),
 bytes BYTEA NOT NULL CHECK(octet_length(bytes)>0 AND octet_length(bytes)<=8000000),
 created TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(task_id,review_token,source_clearance_id,renderer_version)
);
CREATE INDEX IF NOT EXISTS media_artifacts_hash ON media_artifacts(sha256,task_id,review_token);
CREATE TABLE IF NOT EXISTS media_public_approvals (
 id UUID PRIMARY KEY, artifact_id UUID NOT NULL REFERENCES media_artifacts(id),
 sha256 TEXT NOT NULL, public_origin TEXT NOT NULL, source_clearance_id UUID NOT NULL REFERENCES events(id),
 acknowledgement TEXT NOT NULL, created TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(artifact_id,sha256,public_origin,source_clearance_id)
);
CREATE OR REPLACE FUNCTION studio_media_immutable() RETURNS trigger AS $$
BEGIN
 RAISE EXCEPTION 'Media artifacts and public consent are immutable; render and review a new artifact';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS media_artifacts_immutable ON media_artifacts;
CREATE TRIGGER media_artifacts_immutable BEFORE UPDATE OR DELETE ON media_artifacts FOR EACH ROW EXECUTE FUNCTION studio_media_immutable();
DROP TRIGGER IF EXISTS media_public_approvals_immutable ON media_public_approvals;
CREATE TRIGGER media_public_approvals_immutable BEFORE UPDATE OR DELETE ON media_public_approvals FOR EACH ROW EXECUTE FUNCTION studio_media_immutable();
INSERT INTO schema_versions(version) VALUES(15) ON CONFLICT DO NOTHING;
`;
