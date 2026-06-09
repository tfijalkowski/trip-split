<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Google SSO Implementation Plan

- **Plan**: context/changes/google-sso/plan.md
- **Scope**: All 3 phases
- **Date**: 2026-06-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 3 warnings · 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Phase 2 commit silently edited supabase/config.toml

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: supabase/config.toml:158, 329 (commit 166331e)
- **Detail**: Phase 2 ("OAuth Routes") was scoped to two new files. Commit 166331e also added a fourth redirect URL `http://localhost:4321/auth/callback` and set `redirect_uri = "http://127.0.0.1:54321/auth/v1/callback"` in `[auth.external.google]`. Phase 1's contract specified exactly three URLs and `redirect_uri = ""`. Both edits look defensible (localhost vs 127.0.0.1 cookie quirks; explicit provider callback) but they happened mid-implementation without an addendum and never reached `.env.example`, which still tells developers to register only three URIs in Google Cloud Console.
- **Fix A ⭐ Recommended**: Document the two changes as a Phase 1 addendum and add the localhost URI to the `.env.example` instructions block.
  - Strength: Keeps the plan as ground truth for future reviews; cures the .env.example/config.toml mismatch in one pass.
  - Tradeoff: Plan becomes a slightly moving target.
  - Confidence: HIGH — both edits were exercised via Phase 2 manual verification (2.2–2.5 all ✅).
  - Blind spot: Whether the explicit `redirect_uri` is actually required, or just defensive — Supabase derives it from project URL by default.
- **Fix B**: Revert both edits, rerun the OAuth flow, and only re-add whichever one breaks.
  - Strength: Keeps the implementation minimal to what the plan prescribed.
  - Tradeoff: Costs another round of manual OAuth testing for uncertain benefit; the localhost variant is mildly helpful even if not strictly required.
  - Confidence: MED — the explicit redirect_uri may not be needed, but removing it without testing is risky.
  - Blind spot: Whether Google Cloud Console already has both 127.0.0.1 and localhost registered in your project.
- **Decision**: FIXED via Fix A — Phase 1 addendum added to plan.md; .env.example updated with localhost URI.

### F2 — Dead helper components after SignInForm/SignUpForm deletion

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/auth/FormField.tsx, src/components/auth/PasswordToggle.tsx, src/components/auth/SubmitButton.tsx
- **Detail**: Phase 3's "Delete email/password files" list named `SignInForm.tsx` and `SignUpForm.tsx` but stopped there. The three helpers above were imported only by those two forms — `grep -rn` across `src/` now returns zero importers. They're dead code in the tree.
- **Fix**: Delete all three files in a follow-up commit.
- **Decision**: FIXED — three helper files deleted.

### F3 — Welcome.astro still advertises "sign up"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/Welcome.astro:68
- **Detail**: The "Authentication Ready" feature card body still reads "Built-in Supabase auth with sign in, sign up, and protected routes out of the box." After Phase 3 there is no sign-up path — `/auth/signup` returns 404. User-facing copy now lies. Phase 3's contract caught the Sign Up CTA but missed the body copy of the card directly below it.
- **Fix**: Edit the sentence to drop "sign up" — e.g. "Built-in Supabase auth with Google sign-in and protected routes out of the box."
- **Decision**: FIXED — feature card copy updated.

### F4 — Plan's `npm run typecheck` script doesn't exist

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/google-sso/plan.md:164, 242; package.json (no `typecheck` script)
- **Detail**: Phase 2 and Phase 3 automated verification call for `npm run typecheck`, and Progress marks 2.1, 3.1 as `[x]`. `npm run` lists only dev/build/preview/astro/lint/lint:fix/format — no typecheck. Running `npx astro check` now passes with 0 errors / 0 warnings, so the code is type-correct, but the literal command in the plan cannot have been run. Either the box was ticked against `astro check` informally, or against nothing at all.
- **Fix**: Either add `"typecheck": "astro check"` to package.json scripts so future plans can use it verbatim, or update the plan to call `npx astro check` directly.
- **Decision**: SKIPPED — not worth fixing now.

## Notes — what looked clean

The OAuth routes (`src/pages/api/auth/google.ts`, `src/pages/auth/callback.ts`) match the plan's contracts line-for-line: open-redirect guard correct (`startsWith("/") && !startsWith("//")`), absolute callback URL via `new URL(...).toString()`, error paths funneled to `/auth/signin?error=...`, cookie has `httpOnly` / `sameSite: lax` / `maxAge: 300`. `GoogleSignInButton.astro`, `signin.astro`, and the Phase 3 deletions all match. No leftover imports of any deleted symbol. `npm run lint` passes; `npx astro check` passes 0/0.
