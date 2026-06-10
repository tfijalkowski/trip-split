-- Fix is_group_member() to use SET search_path = '' instead of 'public'.
-- Matches the stricter pattern used by handle_new_user() in the initial schema migration.
-- Fully-qualifies public.group_members in the function body to compensate.
CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.group_members WHERE group_id = p_group_id AND user_id = auth.uid())
$$;

-- Index on group_members.user_id for is_group_member() lookups.
-- UNIQUE (group_id, user_id) covers searches by group but not by user; this covers
-- "which groups does this user belong to?" — called on every RLS policy evaluation.
CREATE INDEX IF NOT EXISTS group_members_user_id_idx ON public.group_members (user_id);

-- Indexes on FK columns used in RLS policy evaluation and balance calculations.
CREATE INDEX IF NOT EXISTS expenses_group_id_idx             ON public.expenses (group_id);
CREATE INDEX IF NOT EXISTS expenses_paid_by_idx              ON public.expenses (paid_by);
CREATE INDEX IF NOT EXISTS expense_participants_user_id_idx  ON public.expense_participants (user_id);
