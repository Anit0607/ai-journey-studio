/** Only the reviewer actor domain expands. Existing decisions and immutable triggers stay intact. */
export const ASSISTANT_WORDING_SCHEMA=`
DO $$
DECLARE actor_number SMALLINT; actor_check TEXT; immutable_count INTEGER;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.schema_versions WHERE version=22) THEN
  RAISE EXCEPTION 'Assistant wording migration requires schema 22';
 END IF;
 LOCK TABLE public.evidence_decisions, public.evidence_approval_receipts IN ACCESS EXCLUSIVE MODE;
 SELECT attnum INTO actor_number FROM pg_catalog.pg_attribute
 WHERE attrelid='public.evidence_decisions'::regclass AND attname='actor' AND NOT attisdropped
 AND atttypid='pg_catalog.text'::regtype AND attnotnull AND attgenerated='' AND attidentity=''
 AND attcollation=(SELECT typcollation FROM pg_catalog.pg_type WHERE oid='pg_catalog.text'::regtype);
 IF actor_number IS NULL OR EXISTS(SELECT 1 FROM pg_catalog.pg_attrdef WHERE adrelid='public.evidence_decisions'::regclass AND adnum=actor_number) THEN
  RAISE EXCEPTION 'Assistant wording actor column differs from reviewed schema';
 END IF;
 IF (SELECT COUNT(*) FROM pg_catalog.pg_constraint WHERE conrelid='public.evidence_decisions'::regclass AND contype='c' AND actor_number=ANY(conkey))<>1 THEN
  RAISE EXCEPTION 'Assistant wording actor constraint is ambiguous';
 END IF;
 SELECT pg_catalog.pg_get_expr(conbin,conrelid) INTO actor_check FROM pg_catalog.pg_constraint
 WHERE conrelid='public.evidence_decisions'::regclass AND conname='evidence_decisions_actor_check'
 AND contype='c' AND convalidated AND conkey=ARRAY[actor_number];
 IF actor_check IS NULL OR actor_check NOT IN ('(actor = ''owner''::text)','(actor = ANY (ARRAY[''owner''::text, ''assistant''::text]))') THEN
  RAISE EXCEPTION 'Assistant wording actor constraint differs from reviewed schema';
 END IF;
 SELECT COUNT(*) INTO immutable_count FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
 WHERE ((t.tgrelid='public.evidence_decisions'::regclass AND t.tgname='evidence_decision_immutable')
 OR (t.tgrelid='public.evidence_approval_receipts'::regclass AND t.tgname='evidence_receipt_immutable'))
 AND t.tgtype=27 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
 AND p.oid='public.studio_evidence_immutable()'::regprocedure AND p.prorettype='pg_catalog.trigger'::regtype
 AND NOT p.prosecdef AND p.pronargs=0 AND p.proconfig IS NULL AND p.provolatile='v'
 AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
 AND btrim(regexp_replace(p.prosrc,'\\s+',' ','g'))='BEGIN RAISE EXCEPTION ''Evidence audit records are immutable''; END;';
 IF immutable_count<>2 THEN RAISE EXCEPTION 'Evidence immutability differs from reviewed schema'; END IF;
 IF actor_check='(actor = ''owner''::text)' THEN
  ALTER TABLE public.evidence_decisions DROP CONSTRAINT evidence_decisions_actor_check;
  ALTER TABLE public.evidence_decisions ADD CONSTRAINT evidence_decisions_actor_check CHECK(actor IN ('owner','assistant'));
 END IF;
END;
$$;
INSERT INTO public.schema_versions(version) VALUES(23) ON CONFLICT DO NOTHING;
`;
