CREATE TABLE IF NOT EXISTS public.social_member_links (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    member_id_hash text NOT NULL UNIQUE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_member_links_member_id_hash
    ON public.social_member_links (member_id_hash);

ALTER TABLE public.social_member_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own social member link"
    ON public.social_member_links
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own social member link"
    ON public.social_member_links
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own social member link"
    ON public.social_member_links
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_member_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_member_links TO service_role;
