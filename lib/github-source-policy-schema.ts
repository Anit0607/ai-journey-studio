/** Empty, additive opt-in state. No existing source, task, or approval is changed. */
export const GITHUB_SOURCE_POLICY_SCHEMA=`
CREATE TABLE IF NOT EXISTS public.github_source_policy_previews (
 id UUID PRIMARY KEY, owner_id TEXT NOT NULL, session_id TEXT NOT NULL,
 scope JSONB NOT NULL, scope_hash TEXT NOT NULL, runtime_binding TEXT NOT NULL,
 preview_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ, created TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.github_source_policies (
 id UUID PRIMARY KEY REFERENCES public.github_source_policy_previews(id),
 scope JSONB NOT NULL,
 scope_hash TEXT NOT NULL,
 runtime_binding TEXT NOT NULL,
 receipt_id UUID UNIQUE NOT NULL REFERENCES public.events(id),
 active BOOLEAN NOT NULL DEFAULT false,
 created TIMESTAMPTZ NOT NULL DEFAULT now(),
 revoked_at TIMESTAMPTZ,
 CHECK (NOT active OR revoked_at IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS github_source_policy_one_active ON public.github_source_policies(active) WHERE active;
CREATE TABLE IF NOT EXISTS public.github_source_grants (
 id UUID PRIMARY KEY REFERENCES public.events(id),
 policy_id UUID NOT NULL REFERENCES public.github_source_policies(id),
 policy_hash TEXT NOT NULL,
 provenance_id UUID NOT NULL REFERENCES public.source_provenance(id),
 provenance_hash TEXT NOT NULL,
 source_id UUID UNIQUE NOT NULL REFERENCES public.sources(id),
 source_hash TEXT NOT NULL,
 evidence_key TEXT UNIQUE NOT NULL,
 entry_id UUID UNIQUE NOT NULL REFERENCES public.calendar_entries(id),
 task_id UUID UNIQUE REFERENCES public.tasks(id),
 created TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.schema_versions(version) VALUES(21) ON CONFLICT DO NOTHING;
`;
