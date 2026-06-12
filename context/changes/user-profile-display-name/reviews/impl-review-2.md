<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: User Profile — Display Name Change (Round 2)

- **Plan**: context/changes/user-profile-display-name/plan.md
- **Scope**: All phases (1–3)
- **Date**: 2026-06-12
- **Verdict**: NEEDS ATTENTION (fixes applied — clean)
- **Findings**: 0 critical  1 warning  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Lint check 3.1 marked complete but fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: src/pages/dashboard.astro:65:70
- **Detail**: Progress item `3.1 Compilation and linting pass — ac44d30` is [x], but `npx eslint src/pages/dashboard.astro` fails with `@typescript-eslint/no-unsafe-argument` on `new Date(g.created_at)`. The error predates this feature (introduced in commit d548edc, group-join-flow). The pre-commit hook (`eslint --fix`) cannot auto-fix this error — the commit must have been made with `--no-verify` or the check was rubber-stamped without running the command.
- **Fix**: Added `as string` cast — `new Date(g.created_at as string).toLocaleDateString()` — with Prettier-required line break.
- **Decision**: FIXED

### F2 — UPDATE does not verify a row was actually modified

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/users/profile.ts:55
- **Detail**: If the profiles row for user.id is missing (sign-up trigger silently failed), the UPDATE returns error=null with 0 rows modified. The endpoint still returned 200. Consistent with existing codebase patterns.
- **Fix**: Chained `.select("display_name")` on the UPDATE call; added `if (!rows.length)` 404 guard before the success response.
- **Decision**: FIXED

### F3 — .single() maps PGRST116 (no rows) to fatal-error redirect

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: src/pages/profile.astro:14-22
- **Detail**: `.single()` returns error.code PGRST116 when no row is found. The `if (profileError)` guard treats missing-row and true DB errors identically. Acceptable given the ON INSERT trigger guarantee.
- **Fix**: No action required.
- **Decision**: SKIPPED

### F4 — success banner stays set between identical re-submits

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/profile/ProfileForm.tsx:27-28
- **Detail**: After a successful save, `success=true` was only cleared by onChange. Re-submitting without typing left the banner visible throughout. No data integrity concern — pure UX edge case.
- **Fix**: Added `setSuccess(false)` at the top of the try block in `handleSubmit`, before the fetch.
- **Decision**: FIXED
