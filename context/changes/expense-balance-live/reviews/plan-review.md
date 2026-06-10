<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-02 — Dodawanie wydatku z podziałem + salda na żywo

- **Plan**: `context/changes/expense-balance-live/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-10
- **Verdict**: REVISE → SOUND (after fixes)
- **Findings**: 2 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | FAIL |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

8/9 paths ✓ (src/types.ts and supabase/migrations/ both exist — plan's Current State Analysis says they don't; non-blocking), 4/4 symbols ✓, brief↔plan ✓

## Findings

### F1 — create_expense RPC missing REVOKE/GRANT — callable by anon

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 — Migration SQL
- **Detail**: The plan's create_expense SQL omitted REVOKE/GRANT statements. PostgreSQL's default grants EXECUTE to PUBLIC (including anon). Because the function is SECURITY DEFINER it bypasses all RLS — an anonymous user could call `supabase.rpc('create_expense', {...})` directly and insert expenses into any group. Both existing RPCs (join_group, create_group) use the correct REVOKE/GRANT pattern.
- **Fix**: Added after the CREATE FUNCTION block in Phase 2 migration SQL:
  `REVOKE EXECUTE ON FUNCTION public.create_expense(...) FROM anon, public;`
  `GRANT  EXECUTE ON FUNCTION public.create_expense(...) TO authenticated;`
- **Decision**: FIXED

### F2 — src/types.ts exists with a conflicting GroupMember definition

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1, Step 6 — "Create src/types.ts (new)"
- **Detail**: `src/types.ts` already exists (S-01) with `GroupMember { id, group_id, user_id, created_at }`. The plan said "(new)" and defined a conflicting `GroupMember { user_id, display_name, email }`. Writing from scratch would overwrite S-01 types; adding both causes a duplicate identifier error.
- **Fix**: Phase 1 Step 6 updated to "ADD to (not replace)" and GroupMember merged into one canonical shape: `{ id, group_id, user_id, display_name (string | null), email, created_at }`. Queries returning GroupMember now require a JOIN of `group_members` with `profiles`.
- **Decision**: FIXED via Fix B (canonical merge)

### F3 — Percentage split produces grosze sums that fail server validation

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — AddExpenseSheet.tsx on-submit logic
- **Detail**: Independent `Math.round(totalGrosze * pct / 100)` per participant can produce totals ≠ `totalGrosze` (e.g. 3 × 33.33% on 100 gr = 99 gr). API route rejects with 400 even though the user entered valid percentages.
- **Fix**: Plan updated to use floor+remainder pattern: `Math.floor(totalGrosze * pct[i] / 100)` for all, then assign remainder to `participants[0]` — same pattern as equal mode.
- **Decision**: FIXED

### F4 — Phase 1 Step 7 is a no-op: /groups already in PROTECTED_ROUTES

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, Step 7
- **Detail**: `src/middleware.ts:4` already has `PROTECTED_ROUTES = ["/dashboard", "/groups"]`. S-01 added it. The step was a no-op.
- **Fix**: Step 7 removed from Phase 1 Changes. Progress items renumbered accordingly.
- **Decision**: FIXED

### F5 — Progress section inconsistencies (two mechanical breaks)

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Progress section
- **Detail**: (a) Phase 3 body heading "Group Detail Page & React Islands" vs Progress "Group Detail Page & Islands" — missing "React". (b) '"Add expense" button opens the Sheet' was listed in Phase 3 manual verification but had no `- [ ] 3.X` entry; numbering jumped 3.5 → 3.6 without it.
- **Fix**: (a) Progress heading corrected to match. (b) New item 3.6 inserted; 3.7–3.14 renumbered to 3.7–3.15.
- **Decision**: FIXED
