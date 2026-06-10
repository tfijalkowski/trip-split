<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: F-02 DB Schema + RLS + Realtime

- **Plan**: context/changes/db-schema-rls/plan.md
- **Scope**: Phase 1 + Phase 2 (all phases)
- **Date**: 2026-06-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical  3 warnings  4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — is_group_member SECURITY DEFINER uses weaker search_path

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260609213602_initial_schema.sql:64
- **Detail**: is_group_member uses SET search_path = public while handle_new_user in the same file uses SET search_path = '' (the stricter pattern). The plan specified the weaker form; the implementation matched the plan. Future SECURITY DEFINER authors may cargo-cult the weaker pattern.
- **Fix A ⭐**: Change to SET search_path = '' and qualify body with public.group_members in a follow-up migration.
  - Strength: Matches handle_new_user; closes the theoretical attack surface.
  - Tradeoff: Requires a new migration.
  - Confidence: HIGH — identical pattern proven in same file.
  - Blind spot: None significant.
- **Fix B**: Keep current, add a comment documenting the intentional difference.
  - Strength: No migration needed.
  - Tradeoff: Weaker pattern stays; future authors may copy it.
  - Confidence: MEDIUM.
  - Blind spot: Comment doesn't survive careless edits.
- **Decision**: FIXED via Fix A — supabase/migrations/20260610000000_fix_is_group_member_search_path.sql

### F2 — Seed file supabase/seed.sql not committed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/seed.sql (git status: untracked)
- **Detail**: Phase 2 progress items (2.1–2.5) marked [x] without commit SHA. File existed on disk but was never staged. A developer pulling the branch would get no seed file.
- **Fix**: git add supabase/seed.sql and commit.
- **Decision**: FIXED — committed as 2ba5ec6

### F3 — Missing index on group_members.user_id

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260609213602_initial_schema.sql:31–37
- **Detail**: UNIQUE (group_id, user_id) composite index does not cover user_id-only lookups. is_group_member() is called on every policy evaluation across 4 tables.
- **Fix**: CREATE INDEX ON public.group_members (user_id);
- **Decision**: FIXED — added to supabase/migrations/20260610000000_fix_is_group_member_search_path.sql

### F4 — Three additional FK columns without indexes

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: migration:39 (expenses.group_id), :44 (expenses.paid_by), :52 (expense_participants.user_id)
- **Detail**: Three FK columns on hot RLS and balance calculation paths have no indexes.
- **Fix**: CREATE INDEX on expenses(group_id), expenses(paid_by), expense_participants(user_id).
- **Decision**: FIXED — added to supabase/migrations/20260610000000_fix_is_group_member_search_path.sql

### F5 — Section A/B order swap not captured as a plan addendum

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/db-schema-rls/plan.md Key Discoveries
- **Detail**: Plan had helper first, tables second. Implementation correctly reversed this (Postgres validates sql function bodies at CREATE time). Migration comment documented the reason; plan did not.
- **Fix**: Add note to plan Key Discoveries section.
- **Decision**: FIXED — note added to plan.md

### F6 — No DELETE policy on groups or group_members — silent RLS block

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260609213602_initial_schema.sql (absent)
- **Detail**: RLS default-deny returns 0 rows / no error on DELETE — indistinguishable from "row not found". Intentional for MVP but undocumented.
- **Fix**: Add comment in migration noting intentional omission. Save as recurring lesson.
- **Decision**: FIXED + ACCEPTED-AS-RULE: RLS default-deny silent 0-rows (lessons.md)

### F7 — Seed ON CONFLICT (id) doesn't cover invite_code uniqueness

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/seed.sql:27–34
- **Detail**: Theoretical: db reset always wipes first so collision is impossible in normal use.
- **Fix**: Switch to ON CONFLICT (id) DO UPDATE if seed is ever decoupled from db reset.
- **Decision**: SKIPPED
