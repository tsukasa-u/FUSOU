-- Allow service_role to relink canonical ownership for rotation continuity fixes.
-- register flow may need to update canonical_user_id when old anonymous users are pruned.
GRANT UPDATE ON public.member_id_hash_rotations TO service_role;
