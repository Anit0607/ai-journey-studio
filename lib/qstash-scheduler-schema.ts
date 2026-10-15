/** Signed delivery replay guard. Keep claims indefinitely; a crash never authorizes replay. */
export const QSTASH_SCHEDULER_SCHEMA=`
CREATE TABLE IF NOT EXISTS qstash_deliveries (
 destination TEXT NOT NULL,
 signed_jti TEXT NOT NULL,
 claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 completed_at TIMESTAMPTZ,
 outcome TEXT NOT NULL DEFAULT 'claimed' CHECK(outcome IN ('claimed','completed','failed')),
 PRIMARY KEY(destination,signed_jti)
);
INSERT INTO schema_versions(version) VALUES(18) ON CONFLICT DO NOTHING;
`;
