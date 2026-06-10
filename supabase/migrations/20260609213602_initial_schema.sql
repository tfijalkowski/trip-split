-- =============================================================================
-- F-02: Initial Schema — TripSplit
-- Tables: profiles, groups, group_members, expenses, expense_participants
-- Includes: is_group_member() helper, profile trigger, RLS, Realtime publication
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Section A: Tables (FK-dependency order)
-- Must precede is_group_member() — Postgres validates SQL function bodies
-- at CREATE time and requires the referenced table to already exist.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email        text NOT NULL,
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.groups (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text    NOT NULL,
  description text,
  invite_code text    NOT NULL UNIQUE
                      DEFAULT upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by  uuid    NOT NULL REFERENCES auth.users ON DELETE RESTRICT,
  is_locked   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.group_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES public.groups ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.expenses (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid    NOT NULL REFERENCES public.groups ON DELETE CASCADE,
  description  text    NOT NULL,
  amount       integer NOT NULL CHECK (amount > 0),
  paid_by      uuid    NOT NULL REFERENCES auth.users ON DELETE RESTRICT,
  expense_date date    NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.expense_participants (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id  uuid    NOT NULL REFERENCES public.expenses ON DELETE CASCADE,
  user_id     uuid    NOT NULL REFERENCES auth.users ON DELETE RESTRICT,
  amount_owed integer NOT NULL CHECK (amount_owed >= 0),
  UNIQUE (expense_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Section B: SECURITY DEFINER helper
-- Defined after tables so Postgres can validate the function body.
-- SECURITY DEFINER bypasses RLS during its own execution, preventing infinite
-- recursion when used in group_members policies.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM group_members WHERE group_id = p_group_id AND user_id = auth.uid())
$$;

-- -----------------------------------------------------------------------------
-- Section C: Profile auto-creation trigger
-- Fires AFTER INSERT ON auth.users (Supabase internal auth table).
-- Reads raw_user_meta_data->>'full_name' set by Google OAuth.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Section D: Enable RLS on all tables
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_participants ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Section E: RLS Policies
-- -----------------------------------------------------------------------------

-- profiles: readable by all authenticated users (display names; not financial data)
CREATE POLICY "profiles: authenticated read"
  ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles: own insert"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles: own update"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- groups
CREATE POLICY "groups: member read"
  ON public.groups FOR SELECT TO authenticated
  USING (is_group_member(id));

CREATE POLICY "groups: authenticated insert"
  ON public.groups FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "groups: creator update"
  ON public.groups FOR UPDATE TO authenticated
  USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);

-- group_members: uses is_group_member() to avoid recursive RLS
CREATE POLICY "group_members: member read"
  ON public.group_members FOR SELECT TO authenticated
  USING (is_group_member(group_id));

-- Invite-code validation is the S-01 API route's responsibility;
-- DB enforces that users can only insert themselves (not others).
CREATE POLICY "group_members: self insert"
  ON public.group_members FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- expenses
CREATE POLICY "expenses: member read"
  ON public.expenses FOR SELECT TO authenticated
  USING (is_group_member(group_id));

CREATE POLICY "expenses: member insert (unlocked)"
  ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (
    is_group_member(group_id)
    AND NOT (SELECT is_locked FROM public.groups WHERE id = group_id)
  );

CREATE POLICY "expenses: payer update (unlocked)"
  ON public.expenses FOR UPDATE TO authenticated
  USING (
    auth.uid() = paid_by
    AND is_group_member(group_id)
    AND NOT (SELECT is_locked FROM public.groups WHERE id = group_id)
  )
  WITH CHECK (
    auth.uid() = paid_by
    AND is_group_member(group_id)
    AND NOT (SELECT is_locked FROM public.groups WHERE id = group_id)
  );

CREATE POLICY "expenses: payer delete (unlocked)"
  ON public.expenses FOR DELETE TO authenticated
  USING (
    auth.uid() = paid_by
    AND is_group_member(group_id)
    AND NOT (SELECT is_locked FROM public.groups WHERE id = group_id)
  );

-- groups: no DELETE policy (intentional) — group deletion is not part of MVP scope.
-- group_members: no DELETE policy (intentional) — leave-group is not part of MVP scope.
-- Note: RLS default-deny returns 0 rows / no error on DELETE, not an explicit error.
-- Add DELETE policies in the migration that ships the corresponding feature.

-- expense_participants: SELECT-only for group members
-- No INSERT/UPDATE/DELETE: create_expense RPC (SECURITY DEFINER, S-02) handles all writes
CREATE POLICY "expense_participants: member read"
  ON public.expense_participants FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id AND is_group_member(e.group_id)
    )
  );

-- -----------------------------------------------------------------------------
-- Section F: Supabase Realtime publication
-- -----------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE public.expense_participants;
