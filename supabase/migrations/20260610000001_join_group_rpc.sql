-- join_group(invite_code) — atomically validates an invite code and adds the caller as a member.
-- SECURITY DEFINER bypasses the groups SELECT RLS policy (USING is_group_member(id)), which
-- would return 0 rows for a non-member querying by invite_code. The exception message
-- 'invalid_invite_code' is the sentinel the /join page checks to distinguish bad codes from
-- other DB errors. ON CONFLICT DO NOTHING makes repeated calls idempotent (already-a-member).
CREATE OR REPLACE FUNCTION public.join_group(p_invite_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_group_id uuid;
BEGIN
  SELECT id INTO v_group_id FROM public.groups WHERE invite_code = p_invite_code;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'invalid_invite_code';
  END IF;
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (v_group_id, auth.uid())
  ON CONFLICT (group_id, user_id) DO NOTHING;
  RETURN v_group_id;
END;
$$;
