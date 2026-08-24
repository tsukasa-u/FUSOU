BEGIN;

-- The anonymous APP identity and the authenticated Web identity are separate
-- relationships. Keeping them in separate tables preserves existing device
-- tokens while allowing OAuth to associate the completed handoff.
CREATE TABLE public.web_user_member_map (
    user_id    uuid NOT NULL
               REFERENCES auth.users(id) ON DELETE CASCADE,
    public_id  uuid NOT NULL UNIQUE
               REFERENCES public.member_id_mapping(public_id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, public_id),
    CONSTRAINT chk_web_user_member_map_uuid_v4 CHECK (
        substring(public_id::text from 15 for 1) = '4'
        AND substring(public_id::text from 20 for 1) ~ '^[89ab]$'
    )
);

CREATE INDEX web_user_member_map_user_updated_idx
    ON public.web_user_member_map (user_id, updated_at DESC);

COMMENT ON TABLE public.web_user_member_map IS
    'Authenticated Web users associated with one or more UUID-only pseudonymous datasets.';

COMMENT ON TABLE public.user_member_map IS
    'Anonymous canonical Supabase user mapping for a UUID-only pseudonymous dataset.';

ALTER TABLE public.web_user_member_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.web_user_member_map FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.web_user_member_map TO service_role;

COMMIT;