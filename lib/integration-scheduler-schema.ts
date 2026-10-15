export const INTEGRATION_SCHEDULER_SCHEMA=`
CREATE TABLE IF NOT EXISTS integration_ticks (
 id INTEGER PRIMARY KEY CHECK(id=1), lease_token UUID, lease_until TIMESTAMPTZ,
 last_started TIMESTAMPTZ, last_finished TIMESTAMPTZ, next_source_sync TIMESTAMPTZ,
 last_status TEXT NOT NULL DEFAULT 'never-run', last_result JSONB NOT NULL DEFAULT '{}'
);
INSERT INTO integration_ticks(id) VALUES(1) ON CONFLICT DO NOTHING;
INSERT INTO schema_versions(version) VALUES(14) ON CONFLICT DO NOTHING;
`;
