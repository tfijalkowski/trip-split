-- create_group: atomically creates a group and adds the caller as the first member.
-- SECURITY DEFINER is required to keep both inserts in the same transaction without
-- the is_group_member SELECT policy blocking the intermediate state.
CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_description text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_group_id uuid;
BEGIN
  v_group_id := gen_random_uuid();
  INSERT INTO public.groups (id, name, description, created_by)
  VALUES (v_group_id, p_name, p_description, auth.uid());
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (v_group_id, auth.uid());
  RETURN v_group_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_group(text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_group(text, text) TO authenticated;
