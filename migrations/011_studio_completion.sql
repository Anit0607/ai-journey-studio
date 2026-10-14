ALTER TABLE ledger ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS checkpoint INTEGER;
CREATE OR REPLACE FUNCTION studio_ledger_attribution_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.checkpoint IS DISTINCT FROM OLD.checkpoint) THEN
  RAISE EXCEPTION 'Ledger attribution is immutable';
 END IF;
 IF (NEW.role IS NULL) <> (NEW.checkpoint IS NULL) OR
  (NEW.role IS NOT NULL AND (NEW.checkpoint NOT BETWEEN 0 AND 5 OR NEW.role IS DISTINCT FROM (ARRAY['Harvester','Story Miner','Strategist','Writer','Platform Adapter','Critic'])[NEW.checkpoint+1])) THEN
  RAISE EXCEPTION 'Invalid ledger attribution';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS studio_ledger_attribution ON ledger;
CREATE TRIGGER studio_ledger_attribution BEFORE INSERT OR UPDATE ON ledger FOR EACH ROW EXECUTE FUNCTION studio_ledger_attribution_guard();
CREATE TABLE IF NOT EXISTS owner_metrics (
 id UUID PRIMARY KEY, request_id UUID NOT NULL UNIQUE,
 period TEXT NOT NULL CHECK(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 platform TEXT NOT NULL CHECK(platform IN ('LinkedIn','X','Instagram')),
 post_reference TEXT NOT NULL, observed_at TIMESTAMPTZ NOT NULL, task_id UUID REFERENCES tasks(id),
 sequence INTEGER NOT NULL CHECK(sequence>0),
 metrics JSONB NOT NULL, source_reference TEXT NOT NULL,
 created TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(platform,post_reference,sequence)
);
CREATE TABLE IF NOT EXISTS owner_money (
 id UUID PRIMARY KEY, request_id UUID NOT NULL UNIQUE,
 period TEXT NOT NULL CHECK(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 currency TEXT NOT NULL CHECK(currency IN ('USD','INR')),
 kind TEXT NOT NULL CHECK(kind IN ('revenue','expense')),
 category TEXT NOT NULL CHECK(category IN ('revenue','other_expense','ai_invoice')),
 attribution TEXT NOT NULL DEFAULT 'ai_journey_content' CHECK(attribution='ai_journey_content'),
 amount_minor BIGINT NOT NULL CHECK(amount_minor>=0 AND amount_minor<=1000000000000),
 source_reference TEXT NOT NULL, created TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((kind='revenue' AND category='revenue') OR (kind='expense' AND category!='revenue'))
);
CREATE TABLE IF NOT EXISTS owner_money_voids (
 record_id UUID PRIMARY KEY REFERENCES owner_money(id), reason TEXT NOT NULL,
 created TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS owner_coverage (
 id UUID PRIMARY KEY, sequence BIGSERIAL UNIQUE NOT NULL, period TEXT NOT NULL, currency TEXT NOT NULL CHECK(currency IN ('USD','INR')),
 basis TEXT NOT NULL CHECK(basis IN ('actual_expenses','estimated_ai')),
 input_hash TEXT NOT NULL, source_reference TEXT NOT NULL,
 created TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION studio_owner_record_immutable() RETURNS trigger AS $$
BEGIN
 RAISE EXCEPTION 'Owner report history is immutable; add a new snapshot or void record';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS owner_metrics_immutable ON owner_metrics;
CREATE TRIGGER owner_metrics_immutable BEFORE UPDATE OR DELETE ON owner_metrics FOR EACH ROW EXECUTE FUNCTION studio_owner_record_immutable();
DROP TRIGGER IF EXISTS owner_money_immutable ON owner_money;
CREATE TRIGGER owner_money_immutable BEFORE UPDATE OR DELETE ON owner_money FOR EACH ROW EXECUTE FUNCTION studio_owner_record_immutable();
DROP TRIGGER IF EXISTS owner_voids_immutable ON owner_money_voids;
CREATE TRIGGER owner_voids_immutable BEFORE UPDATE OR DELETE ON owner_money_voids FOR EACH ROW EXECUTE FUNCTION studio_owner_record_immutable();
DROP TRIGGER IF EXISTS owner_coverage_immutable ON owner_coverage;
CREATE TRIGGER owner_coverage_immutable BEFORE UPDATE OR DELETE ON owner_coverage FOR EACH ROW EXECUTE FUNCTION studio_owner_record_immutable();
CREATE TABLE IF NOT EXISTS owner_report_guard (id INTEGER PRIMARY KEY CHECK(id=1));
INSERT INTO owner_report_guard(id) VALUES(1) ON CONFLICT DO NOTHING;
INSERT INTO schema_versions(version) VALUES(11) ON CONFLICT DO NOTHING;
