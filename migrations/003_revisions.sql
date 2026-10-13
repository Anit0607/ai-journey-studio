
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
