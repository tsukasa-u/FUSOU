BEGIN;

-- pending_member_syncs is an implementation detail of the Worker handoff.
-- Browser and desktop clients must never receive a direct table grant.
ALTER TABLE public.pending_member_syncs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pending_member_syncs_insert ON public.pending_member_syncs;
DROP POLICY IF EXISTS pending_member_syncs_select ON public.pending_member_syncs;
DROP POLICY IF EXISTS pending_member_syncs_update ON public.pending_member_syncs;
DROP POLICY IF EXISTS pending_member_syncs_delete ON public.pending_member_syncs;

DROP TRIGGER IF EXISTS trg_auto_delete_synced_pending_syncs
    ON public.pending_member_syncs;
DROP FUNCTION IF EXISTS public.delete_synced_pending_member_syncs();

REVOKE ALL ON TABLE public.pending_member_syncs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pending_member_syncs TO service_role;

DO $$
BEGIN
    IF has_table_privilege('anon', 'public.pending_member_syncs', 'SELECT')
       OR has_table_privilege('anon', 'public.pending_member_syncs', 'INSERT')
       OR has_table_privilege('anon', 'public.pending_member_syncs', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.pending_member_syncs', 'SELECT')
       OR has_table_privilege('authenticated', 'public.pending_member_syncs', 'INSERT')
       OR has_table_privilege('authenticated', 'public.pending_member_syncs', 'UPDATE') THEN
        RAISE EXCEPTION 'pending sync ACL postflight failed: client grants remain';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_publication p
          JOIN pg_publication_rel pr ON pr.prpubid = p.oid
         WHERE p.pubname = 'supabase_realtime'
           AND pr.prrelid = 'public.pending_member_syncs'::regclass
    ) THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE public.pending_member_syncs;
    END IF;
END;
$$;

-- Reassert the intended ACLs for identity tables after projects upgraded from
-- a schema with Supabase's default public grants.
REVOKE ALL ON TABLE public.member_id_mapping FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.user_member_map FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.user_member_map TO authenticated;
REVOKE ALL ON TABLE public.user_devices FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.user_devices TO authenticated;
REVOKE ALL ON TABLE public.anon_sync_nonce_consumptions FROM PUBLIC, anon, authenticated;

COMMIT;