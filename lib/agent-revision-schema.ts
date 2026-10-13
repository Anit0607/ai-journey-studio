export const AGENT_REVISION_SCHEMA=`
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS revision_parent_task_id UUID REFERENCES tasks(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS revision_base_token TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS revision_note TEXT;
ALTER TABLE content_revisions ADD COLUMN IF NOT EXISTS agent_task_id UUID REFERENCES tasks(id);
CREATE UNIQUE INDEX IF NOT EXISTS content_revision_agent_task ON content_revisions(agent_task_id) WHERE agent_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pending_agent_revisions ON tasks(revision_parent_task_id,status) WHERE revision_parent_task_id IS NOT NULL;
INSERT INTO schema_versions(version) VALUES(8) ON CONFLICT DO NOTHING;
`;
