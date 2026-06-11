<!-- PLAN-REVIEW-REPORT -->
# Plan Review: User Profile — Display Name Change

- **Plan**: context/changes/user-profile-display-name/plan.md
- **Mode**: Deep
- **Date**: 2026-06-11
- **Verdict**: REVISE → SOUND (all findings fixed)
- **Findings**: 0 critical  2 warnings  1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

6/6 paths ✓, 3/3 symbols ✓, brief↔plan ✓

## Findings

### F1 — Phase 1 endpoint spec diverges from established route pattern

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — API Endpoint, "Supabase call" and "Wrap" bullets
- **Detail**: Three deviations from groups/index.ts pattern: (a) Supabase call errors silently dropped — plan proceeded to 200 without checking { error } from the update call; (b) missing !supabase guard — plan only checked !user → 401; (c) JSON parse error returned 500 not 400 — single outer try/catch covered the body parse.
- **Fix**: (a) Destructure { error } from Supabase call, return 500 if truthy. (b) Add !supabase → 500 guard after !user → 401. (c) Wrap request.json() in its own try/catch → 400 on throw.
- **Decision**: FIXED

### F2 — ProfileForm fetch error branch doesn't guard against non-JSON bodies

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — ProfileForm.tsx, "On non-ok response" bullet
- **Detail**: response.json() in the error branch throws on non-JSON bodies (proxy 502s, HTML error pages), leaving loading=true and form frozen with no visible error.
- **Fix**: Wrap error-branch response.json() in try/catch; fall back to "Something went wrong. Please try again." on parse failure.
- **Decision**: FIXED

### F3 — Phase 2 Astro page spec omits !supabase null-guard

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Profile Astro page, frontmatter contract
- **Detail**: Plan called Astro.locals.supabase.from(...) without first checking !supabase. Every existing page (groups/[id].astro:12) opens with if (!supabase || !user) return redirect. Safe in practice due to PROTECTED_ROUTES + middleware, but creates defensive code discrepancy.
- **Fix**: Add `if (!supabase || !user) return Astro.redirect('/auth/signin');` as first frontmatter guard.
- **Decision**: FIXED
