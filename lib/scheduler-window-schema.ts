/** Nullable legacy binding is intentional: fixed mode requires a fresh owner-approved intent. */
export const SCHEDULER_WINDOW_SCHEMA=`
ALTER TABLE publishing_outbox ADD COLUMN IF NOT EXISTS scheduler_policy_hash TEXT
 CHECK(scheduler_policy_hash IS NULL OR scheduler_policy_hash ~ '^[0-9a-f]{64}$');
INSERT INTO schema_versions(version) VALUES(22) ON CONFLICT DO NOTHING;
`;
