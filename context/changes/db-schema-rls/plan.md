# F-02: DB Schema + RLS + Realtime — Implementation Plan

## Overview

Create the complete data foundation for TripSplit in a single Supabase migration: five tables, a `is_group_member()` SECURITY DEFINER helper, per-table RLS policies, a profile auto-creation trigger, and the Realtime publication. A seed file gives every developer an immediately testable local state after `supabase db reset`.

## Current State Analysis

What exists (confirmed 2026-06-09, commit `e83faddc`):
- `supabase/config.toml` — `[realtime] enabled = true`; Google OAuth configured; `seed.sql` referenced at `[db.seed] sql_paths = ["./seed.sql"]` but file does not exist
- `supabase/migrations/` — directory does not exist; no migrations have ever been applied
- `src/lib/supabase.ts` — auth client setup only; no application tables referenced
- `context/changes/expense-balance-live/plan.md` — specifies authoritative column contracts for `expenses` (INTEGER grosze, UUID FKs) and `expense_participants` (INTEGER grosze); these types are non-negotiable

## Desired End State

After `supabase db push` (remote) or `supabase db reset` (local):
- Five tables exist with correct constraints, FKs, and CHECK constraints
- RLS is `ENABLED` on all five tables; policies isolate data per group
- `expenses` and `expense_participants` are in the `supabase_realtime` publication
- `on_auth_user_created` trigger auto-populates `profiles` on Google sign-in
- Local dev: `supabase db reset` seeds 2 users, 1 group, 2 memberships, 0 expenses — ready for S-01 testing immediately

### Verification:

1. All five tables visible in Supabase Studio with correct columns and FK links
2. Trigger `on_auth_user_created` and function `is_group_member` appear under Database → Functions/Triggers
3. As User A (non-superuser JWT): `SELECT * FROM expenses` for a group they don't belong to → 0 rows
4. As User A: `INSERT INTO expenses` against a locked group (`is_locked = true`) → RLS violation
5. Direct `INSERT INTO expense_participants` as an authenticated user → fails (no INSERT policy; RPC handles this)

## Key Discoveries:

- `supabase/migrations/` does not exist — initialize with `supabase migration new initial_schema` to create both directory and file
- The S-02 plan locks in `expenses.amount` and `expense_participants.amount_owed` as `INTEGER` (grosze, 1 PLN = 100); these are non-negotiable column types
- Supabase `config.toml` already references `./supabase/seed.sql` — the file just needs to exist
- RLS policy on `group_members` that queries its own table causes infinite recursion; a `SECURITY DEFINER` helper function is the canonical Supabase fix
- `is_locked DEFAULT false` means the settlement lock is schema-present but functionally inactive until S-03 ships; no new migration needed in S-03 for expense policies
- Tables must precede `is_group_member()` in migration order — Postgres validates `sql`-language function bodies at `CREATE` time, so `group_members` must exist before the function that references it

## What We're NOT Doing

- `member_balances` VIEW and `create_expense` RPC — live in S-02 Phase 2 (separate migration in a later change)
- `join_group()` RPC — invite_code validation is the S-01 API layer's responsibility; group_members INSERT RLS only enforces self-insertion
- Expense edit/delete ownership enforcement beyond `paid_by` check (S-04 adds nothing structural)
- Settlement lock API/UI — S-03; only the `is_locked` column is added now

## Critical Implementation Details

**`is_group_member()` SECURITY DEFINER helper**: RLS policies on `group_members` that use `EXISTS (SELECT 1 FROM group_members ...)` inline cause infinite recursion. All policies across all tables must reference a single SECURITY DEFINER function instead — it bypasses RLS during its own execution, breaking the cycle:

```sql
CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM group_members WHERE group_id = p_group_id AND user_id = auth.uid())
$$;
```

**Profile trigger**: Fires `AFTER INSERT ON auth.users` (Supabase internal auth table). Uses `SECURITY DEFINER SET search_path = ''` (prevents search_path injection). Reads `NEW.raw_user_meta_data->>'full_name'` (populated by Google OAuth) and `NEW.email`. ON CONFLICT DO NOTHING for idempotency.

**Invite code generation**: An 8-char uppercase hex substring of a random UUID as a DB DEFAULT:
```sql
DEFAULT upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8))
```
The S-01 API route for group creation omits this field — the DB generates it automatically. Invite URL pattern: `/join/<invite_code>`.

**Lock check in expense policies**: Added to USING and WITH CHECK for INSERT/UPDATE/DELETE:
```sql
AND NOT (SELECT is_locked FROM public.groups WHERE id = group_id)
```
Since `is_locked DEFAULT false`, all expenses are mutable until S-03 toggles it. S-03 needs no migration to alter these policies.

**`expense_participants` write access**: No INSERT/UPDATE/DELETE RLS policy is created for the `authenticated` role. The `create_expense` PL/pgSQL function (S-02 Phase 2) runs as `SECURITY DEFINER` and bypasses RLS for the participants insert — direct writes are intentionally blocked at the DB level.

**Seed UUIDs**: Two hardcoded test user UUIDs (`...0001`, `...0002`) and one group UUID (`...0010`) documented in seed file header. Run `supabase db reset` locally to apply. These UUIDs have no meaning on remote — seed is local-only.

---

## Phase 1: Core Migration

### Overview

Write and apply a single SQL migration file with clearly-labelled sections. All DDL runs atomically — tables, helper function, trigger, RLS, and Realtime publication land together or not at all.

### Changes Required:

#### 1. Initialize the migrations directory

**Command**: `supabase migration new initial_schema`

**Intent**: Creates `supabase/migrations/` directory and a timestamped `.sql` file.

**Contract**: Run this command first. The generated filename will have format `<timestamp>_initial_schema.sql`. All SQL below goes into that file.

#### 2. Write the migration SQL

**File**: `supabase/migrations/<timestamp>_initial_schema.sql`

**Section A — SECURITY DEFINER helper (must precede all policies that reference it)**:

```sql
-- Helper: group membership check
-- SECURITY DEFINER bypasses RLS during its own execution, preventing infinite
-- recursion when used in group_members policies.
CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM group_members WHERE group_id = p_group_id AND user_id = auth.uid())
$$;
```

**Section B — Tables** (FK-dependency order: profiles → groups → group_members → expenses → expense_participants):

```sql
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
```

**Section C — Profile auto-creation trigger**:

```sql
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
```

**Section D — Enable RLS on all tables**:

```sql
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_participants ENABLE ROW LEVEL SECURITY;
```

**Section E — RLS Policies**:

```sql
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
```

**Section F — Supabase Realtime publication**:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE public.expense_participants;
```

#### 3. Apply the migration

**Remote**: `supabase db push`

**Local** (also applies seed): `supabase db reset`

### Success Criteria:

#### Automated Verification:

- `supabase db push` or `supabase db reset` completes with exit code 0
- `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename` returns: `expense_participants`, `expenses`, `group_members`, `groups`, `profiles`
- `SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'` includes `expenses` and `expense_participants`
- `SELECT trigger_name FROM information_schema.triggers WHERE trigger_name = 'on_auth_user_created'` returns 1 row
- `SELECT proname FROM pg_proc WHERE proname = 'is_group_member'` returns 1 row

#### Manual Verification:

- All 5 tables visible in Supabase Studio → Table editor with correct columns
- All 5 tables show "RLS Enabled" in Studio → Authentication → Policies
- All policies listed by name matching the plan above
- `is_group_member` function visible under Studio → Database → Functions with `SECURITY DEFINER`
- Trigger `on_auth_user_created` visible under Studio → Database → Triggers

**Implementation Note**: Complete all automated and manual checks above before writing the seed file. Confirm RLS testing steps from the Testing Strategy section before marking Phase 1 done.

---

## Phase 2: Seed File

### Overview

Create `supabase/seed.sql` for local development. Two test users with known UUIDs, one group, two memberships — enough to start S-01 testing immediately after `supabase db reset`.

### Changes Required:

#### 1. Create supabase/seed.sql

**File**: `supabase/seed.sql` (new)

**Intent**: Deterministic local baseline for all downstream slices. Not applied on remote.

**Contract**:

```sql
-- seed.sql — local dev only; applied by `supabase db reset`
-- Test user UUIDs:
--   Alice: 00000000-0000-0000-0000-000000000001
--   Bob:   00000000-0000-0000-0000-000000000002
-- Test group UUID:
--   Trip:  00000000-0000-0000-0000-000000000010

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, role, aud
)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'alice@example.com', '', now(),
   '{"full_name": "Alice Test"}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000002', 'bob@example.com', '', now(),
   '{"full_name": "Bob Test"}'::jsonb, now(), now(), 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- profiles rows (trigger also creates them; ON CONFLICT ensures idempotency)
INSERT INTO public.profiles (id, email, display_name)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'alice@example.com', 'Alice Test'),
  ('00000000-0000-0000-0000-000000000002', 'bob@example.com',   'Bob Test')
ON CONFLICT (id) DO NOTHING;

-- group (Alice is creator)
INSERT INTO public.groups (id, name, invite_code, created_by)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  'Test Trip',
  'TESTCODE',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- memberships
INSERT INTO public.group_members (group_id, user_id)
VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002')
ON CONFLICT (group_id, user_id) DO NOTHING;
```

### Success Criteria:

#### Manual Verification:

- `supabase db reset` completes without errors
- `SELECT COUNT(*) FROM profiles` → 2
- `SELECT name, invite_code FROM groups` → `Test Trip | TESTCODE`
- `SELECT COUNT(*) FROM group_members` → 2
- `SELECT COUNT(*) FROM expenses` → 0

---

## Testing Strategy

RLS is the security guardrail — the roadmap explicitly calls this out as the primary risk. Test each policy as a non-superuser before marking the change done.

### Manual Testing Steps:

1. Run `supabase db reset` locally; confirm seed applied

2. Open Supabase Studio → SQL editor

3. **Cross-group isolation** (most critical):
   - Create a second group without Alice (`INSERT INTO groups ... created_by = Bob's UUID`)
   - As Alice's JWT: `SELECT * FROM groups WHERE id = <second group id>` → 0 rows
   - As Alice's JWT: `SELECT * FROM expenses WHERE group_id = <second group id>` → 0 rows

4. **Shared group access**:
   - As Alice's JWT: `SELECT * FROM groups WHERE id = '00000000-0000-0000-0000-000000000010'` → 1 row
   - As Bob's JWT: same → 1 row

5. **Lock enforcement**:
   - `UPDATE groups SET is_locked = true WHERE id = '00000000-0000-0000-0000-000000000010'`
   - As Alice's JWT: attempt `INSERT INTO expenses (group_id, description, amount, paid_by) VALUES (...)` → should fail with RLS violation

6. **expense_participants write block**:
   - As any authenticated JWT: attempt `INSERT INTO expense_participants (expense_id, user_id, amount_owed) VALUES (...)` → should fail with no INSERT policy

7. **Trigger**: In local Supabase auth UI, sign up a new Google account; confirm `profiles` row auto-created

### Simulating non-superuser JWT in SQL editor:

Supabase Studio does not natively simulate a user JWT in the SQL editor. Use `psql` or an API call with a real JWT from the client:
```bash
# With psql connected to local Supabase:
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';
SELECT * FROM expenses;
```

---

## Migration Notes

`supabase/migrations/` does not exist. Initialize with:
```
supabase migration new initial_schema
```
This creates the directory and a timestamped `.sql` file. Paste the full SQL above, then apply with `supabase db push` (remote) or `supabase db reset` (local, also applies seed).

The S-02 migration (`member_balances` VIEW + `create_expense` RPC) will be a separate file created in S-02 Phase 2.

## References

- PRD: `context/foundation/prd-v3.md` (FR-003–016, Business Logic, NFR)
- Roadmap: `context/foundation/roadmap.md` (F-02 risk note)
- S-02 plan: `context/changes/expense-balance-live/plan.md` (column type contracts for expenses + expense_participants; create_expense RPC design)
- Supabase Realtime prerequisite: `context/changes/expense-balance-live/research.md`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Migration

#### Automated

- [x] 1.1 `supabase db push` (or `db reset`) completes with exit code 0 — 0d49700
- [x] 1.2 All 5 tables present in `pg_tables WHERE schemaname = 'public'` — 0d49700
- [x] 1.3 `expenses` and `expense_participants` in `pg_publication_tables` for `supabase_realtime` — 0d49700
- [x] 1.4 `on_auth_user_created` trigger exists in `information_schema.triggers` — 0d49700
- [x] 1.5 `is_group_member` function exists in `pg_proc` — 0d49700

#### Manual (RLS verification)

- [x] 1.6 All 5 tables show "RLS Enabled" in Supabase Studio — 0d49700
- [x] 1.7 All policies present and named correctly per table — 0d49700
- [x] 1.8 Cross-group isolation: User A cannot SELECT from a group they don't belong to — 0d49700
- [x] 1.9 Lock enforcement: INSERT into expenses on a locked group fails with RLS violation — 0d49700
- [x] 1.10 Direct INSERT into expense_participants fails (no INSERT policy for authenticated) — 0d49700

### Phase 2: Seed

#### Manual

- [x] 2.1 `supabase db reset` completes without errors
- [x] 2.2 `SELECT COUNT(*) FROM profiles` → 2
- [x] 2.3 `SELECT name, invite_code FROM groups` → `Test Trip | TESTCODE`
- [x] 2.4 `SELECT COUNT(*) FROM group_members` → 2
- [x] 2.5 `SELECT COUNT(*) FROM expenses` → 0
