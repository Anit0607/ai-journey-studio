CREATE TABLE IF NOT EXISTS hosted_batches (
 day TEXT PRIMARY KEY CHECK(day ~ '^\d{4}-\d{2}-\d{2}$'),
 lease_token UUID NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('running','idle','blocked','deadline','max_steps','failed','interrupted')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 12),
 steps INTEGER NOT NULL DEFAULT 0 CHECK(steps BETWEEN 0 AND attempts),
 reason TEXT,
 started_at TIMESTAMPTZ NOT NULL,
 heartbeat TIMESTAMPTZ NOT NULL,
 finished_at TIMESTAMPTZ,
 CHECK((status='running' AND finished_at IS NULL) OR (status!='running' AND finished_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS hosted_batch_lease (
 id INTEGER PRIMARY KEY CHECK(id=1),
 lease_token UUID,
 batch_day TEXT REFERENCES hosted_batches(day),
 lease_until TIMESTAMPTZ,
 CHECK((lease_token IS NULL AND batch_day IS NULL AND lease_until IS NULL) OR (lease_token IS NOT NULL AND batch_day IS NOT NULL AND lease_until IS NOT NULL))
);
INSERT INTO hosted_batch_lease(id) VALUES(1) ON CONFLICT DO NOTHING;
INSERT INTO schema_versions(version) VALUES(9) ON CONFLICT DO NOTHING;
