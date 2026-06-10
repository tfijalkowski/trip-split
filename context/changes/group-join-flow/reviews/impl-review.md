<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-01 Group Join Flow

- **Plan**: context/changes/group-join-flow/plan.md
- **Scope**: All Phases (1–3)
- **Date**: 2026-06-10
- **Verdict**: NEEDS ATTENTION → resolved to APPROVED after triage
- **Findings**: 0 critical, 4 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Orphaned group possible if member INSERT fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/groups/index.ts:47-65
- **Detail**: Two sequential inserts without atomicity. Plan explicitly accepted this for MVP but noted the orphan risk.
- **Decision**: FIXED via Fix B — replaced two-insert handler with `create_group()` SECURITY DEFINER RPC (supabase/migrations/20260610000002_create_group_rpc.sql). True atomicity. GRANT/REVOKE restricts to authenticated only.

### F2 — Query errors silently swallowed in groups/[id].astro

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/groups/[id].astro:20-26
- **Detail**: group_members and profiles queries discarded errors; transient failure showed empty member list.
- **Decision**: FIXED — destructured `membersError` and `profilesError`; redirect to /dashboard?error=join_failed if either fails.

### F3 — Unbounded groups query + silent error discard on dashboard

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:7-9
- **Detail**: No .limit(), error discarded; failed query shows "No groups yet".
- **Decision**: SKIPPED

### F4 — invite_code param not validated before use

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/join/[invite_code].astro:8-12
- **Detail**: Raw param used in redirect URL without format validation before downstream guards.
- **Decision**: FIXED via Fix A — added `/^[A-F0-9]{8}$/` check at entry; redirects to /dashboard?error=invalid_invite immediately on mismatch.

### F5 — dashboard.astro missing prerender = false

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dashboard.astro:1
- **Detail**: Not required (output:server defaults to SSR; CLAUDE.md rule targets API routes), but inconsistent with other new pages in this change.
- **Decision**: SKIPPED

### F6 — GroupWithMembers type defined but never used

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/types.ts:18-26
- **Detail**: Planned for joined member query; two-query approach used instead; type was dead code.
- **Decision**: FIXED — removed GroupWithMembers from src/types.ts.

### F7 — Anonymous callers can probe invite_code existence via SECURITY DEFINER RPC

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260610000001_join_group_rpc.sql:5-7
- **Detail**: SECURITY DEFINER function callable by anon; member INSERT safely fails but invite_code existence is probed.
- **Decision**: FIXED — added REVOKE/GRANT to migration 20260610000001_join_group_rpc.sql.

### F8 — join page redirects to /groups/null if RPC returns null

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/join/[invite_code].astro:28
- **Detail**: No null guard before `data as string` interpolation into redirect URL.
- **Decision**: FIXED — added `if (!data) return Astro.redirect("/dashboard?error=join_failed");`.

### F9 — Dashboard error banner duplicates ServerError component pattern

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dashboard.astro:36-40
- **Detail**: Inline error div instead of existing ServerError island; XSS-safe via whitelist lookup.
- **Decision**: SKIPPED

### F10 — Copy button inline onclick load-bearing on JSON.stringify

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/groups/[id].astro:57
- **Detail**: JSON.stringify was the sole XSS guard; maintenance trap if edited without context.
- **Decision**: FIXED — extracted to CopyButton React island (src/components/groups/CopyButton.tsx).
