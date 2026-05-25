DROP POLICY IF EXISTS "Users can delete their own social member link"
    ON public.social_member_links;

CREATE POLICY "Users can delete their own social member link"
    ON public.social_member_links
    FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);
