-- S-03: Settlement Lock
-- Adds locked_at timestamptz to groups, adds groups to Realtime publication,
-- and updates join_group RPC to block joining locked groups.

ALTER TABLE public.groups ADD COLUMN locked_at timestamptz;

ALTER PUBLICATION supabase_realtime ADD TABLE public.groups;

CREATE OR REPLACE FUNCTION public.join_group(p_invite_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_group_id uuid;
  v_is_locked boolean;
BEGIN
  SELECT id, is_locked INTO v_group_id, v_is_locked
  FROM public.groups WHERE invite_code = p_invite_code;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'invalid_invite_code';
  END IF;
  IF v_is_locked THEN
    RAISE EXCEPTION 'group_is_locked';
  END IF;
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (v_group_id, auth.uid())
  ON CONFLICT (group_id, user_id) DO NOTHING;
  RETURN v_group_id;
END;
$$;
