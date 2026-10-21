CREATE TABLE IF NOT EXISTS evidence_decisions (
 sequence BIGSERIAL UNIQUE, id UUID PRIMARY KEY, task_id UUID NOT NULL REFERENCES tasks(id),
 binding TEXT NOT NULL, finding_id TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('accept','withdraw')),
 policy_version TEXT NOT NULL, actor TEXT NOT NULL CHECK(actor='owner'), reason TEXT NOT NULL,
 evidence JSONB NOT NULL, context JSONB NOT NULL, created TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidence_task ON evidence_decisions(task_id,created,id);
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS evidence_version TEXT;
ALTER TABLE revision_approvals ADD COLUMN IF NOT EXISTS evidence_version TEXT;
CREATE TABLE IF NOT EXISTS evidence_approval_receipts (
 id UUID PRIMARY KEY, task_id UUID NOT NULL REFERENCES tasks(id), binding TEXT NOT NULL,
 evidence_version TEXT NOT NULL, review_token TEXT NOT NULL, created TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(task_id,binding,evidence_version,review_token)
);
CREATE OR REPLACE FUNCTION studio_evidence_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Evidence audit records are immutable'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS evidence_decision_immutable ON evidence_decisions;
CREATE TRIGGER evidence_decision_immutable BEFORE UPDATE OR DELETE ON evidence_decisions FOR EACH ROW EXECUTE FUNCTION studio_evidence_immutable();
DROP TRIGGER IF EXISTS evidence_receipt_immutable ON evidence_approval_receipts;
CREATE TRIGGER evidence_receipt_immutable BEFORE UPDATE OR DELETE ON evidence_approval_receipts FOR EACH ROW EXECUTE FUNCTION studio_evidence_immutable();
INSERT INTO schema_versions(version) VALUES(19) ON CONFLICT DO NOTHING;
