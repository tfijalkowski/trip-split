<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-03 Settlement Lock

- **Plan**: context/changes/settlement-lock/plan.md
- **Scope**: Phase 1 + Phase 2 (all phases)
- **Date**: 2026-06-12
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical  4 warnings  4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | FAIL (resolved by triage) |

## Findings

### F1 — npm run lint fails with 4 new errors from fix commits

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: src/lib/supabase.browser.ts:11,:14 | GroupExpensesIsland.tsx:71,:72
- **Detail**: Four ESLint errors introduced by fix commits c4a1596 and 6a37450 after d2c9bef (where lint was verified passing): floating promise on `client.realtime.setAuth()` calls (3 sites), and `!mounted` no-unnecessary-condition false-positive (TS flow analysis can't track cross-closure mutation).
- **Fix**: Prepended `void` to each `setAuth()` call; added `// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition` before the `!mounted` guard.
- **Decision**: FIXED

### F2 — Realtime group channel subscribes to all events instead of UPDATE only

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/expenses/GroupExpensesIsland.tsx:92
- **Detail**: `event: "*"` means DELETE events trigger `payload.new = {}`, silently setting `groupLocked = undefined` (falsy) if the group row is deleted while the user is on the page. Plan specified `event: "UPDATE"`.
- **Fix**: Change `event: "*"` to `event: "UPDATE"`.
- **Decision**: SKIPPED

### F3 — PATCH endpoint returns null body on silent 0-row UPDATE

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/groups/[id]/index.ts (UPDATE block)
- **Detail**: `updated` from `.single()` was never null-checked. Attempted fix introduced new lint errors; on investigation, `.single()` populates `updateError` (PGRST116) when 0 rows are returned, so `updated` is never null when `updateError` is null. Original code is correct.
- **Decision**: SKIPPED (finding invalidated — `.single()` error semantics cover the case)

### F4 — Three unplanned files added (all feature-necessary)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/supabase.browser.ts | supabase/migrations/20260612151059_groups_replica_identity_full.sql | src/pages/dashboard.astro
- **Detail**: Three files not in the plan were created/modified. All are direct technical requirements: supabase.browser.ts (Realtime JWT fix), groups_replica_identity_full migration (Realtime payload.new), dashboard.astro group_locked message.
- **Fix**: Added plan addendum documenting the three files.
- **Decision**: FIXED

### F5 — Two sequential DB round-trips in expenses POST

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/groups/[id]/expenses.ts:43–63
- **Detail**: Membership check and is_locked guard were two separate awaited SELECTs.
- **Fix**: Combined into one query using `groups!inner(is_locked)` PostgREST FK embedding.
- **Decision**: FIXED

### F6 — refetch silently drops DB errors

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/components/expenses/GroupExpensesIsland.tsx:44–56
- **Detail**: `refetch` never reads error fields; session expiry preserves stale data silently.
- **Fix**: Destructure and log errors from both query results.
- **Decision**: SKIPPED

### F7 — handleToggleLock has no in-flight guard

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/components/expenses/GroupExpensesIsland.tsx:113–126
- **Detail**: Rapid double-click fires concurrent PATCH requests; errors are console.error only.
- **Fix**: Add `isLockPending` state to disable button during request and surface errors.
- **Decision**: SKIPPED

### F8 — lockedAt.slice(0,10) is timezone-sensitive

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/components/expenses/SettlementLockBanner.tsx:8
- **Detail**: `lockedAt.slice(0, 10)` assumes leading YYYY-MM-DD format; works today but fragile.
- **Fix**: Replaced with `new Date(lockedAt).toISOString().slice(0, 10)`.
- **Decision**: FIXED
