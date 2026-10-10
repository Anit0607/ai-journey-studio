
CREATE TABLE IF NOT EXISTS calendar_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
 short_days JSONB NOT NULL DEFAULT '[1,3,5]', long_day INTEGER NOT NULL DEFAULT 0,
 review_hours INTEGER NOT NULL DEFAULT 48, start_date TEXT, post_time TEXT,
 generation_lead_hours INTEGER, updated TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO calendar_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS calendar_entries (
 id UUID PRIMARY KEY, planned_date TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('shortform','longform')),
 intended_post TIMESTAMPTZ NOT NULL, draft_due TIMESTAMPTZ NOT NULL, review_due TIMESTAMPTZ NOT NULL,
 generation_due TIMESTAMPTZ, source_id UUID REFERENCES sources(id), task_id UUID REFERENCES tasks(id),
 updated TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(planned_date,kind)
);
CREATE TABLE IF NOT EXISTS calendar_jobs (
 id UUID PRIMARY KEY, entry_id UUID UNIQUE NOT NULL REFERENCES calendar_entries(id),
 status TEXT NOT NULL CHECK(status='blocked'), created TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO schema_versions(version) VALUES(4) ON CONFLICT DO NOTHING;
