DO $tlsn_testplay_bootstrap$
BEGIN
    IF to_regclass('public.user_member_map') IS NOT NULL THEN
        RAISE EXCEPTION 'refusing TLSN testplay bootstrap: public.user_member_map already exists';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM supabase_migrations.schema_migrations
        WHERE version = '20260417183000'
    ) OR EXISTS (
        SELECT 1
        FROM supabase_migrations.schema_migrations
        WHERE version > '20260417183000'
    ) THEN
        RAISE EXCEPTION 'refusing TLSN testplay bootstrap: expected migration boundary is not active';
    END IF;

    EXECUTE $legacy_user_member_map$
        CREATE TABLE public.user_member_map (
            user_id uuid NOT NULL,
            member_id_hash text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            salt_version text DEFAULT 'v1',
            hash_algorithm text DEFAULT 'sha256',
            client_version text,
            last_seen_at timestamptz,
            CONSTRAINT user_member_map_pkey PRIMARY KEY (user_id),
            CONSTRAINT user_member_map_member_id_hash_key UNIQUE (member_id_hash),
            CONSTRAINT user_member_map_user_id_fkey
                FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
        )
    $legacy_user_member_map$;
END
$tlsn_testplay_bootstrap$;
