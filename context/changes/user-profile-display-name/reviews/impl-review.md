<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: User Profile — Display Name Change

- **Plan**: context/changes/user-profile-display-name/plan.md
- **Scope**: All phases (1–3)
- **Date**: 2026-06-12
- **Verdict**: NEEDS ATTENTION (fixes applied — re-verify manually before shipping)
- **Findings**: 0 critical  2 warnings  4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — Spurious .select().single() on UPDATE; echoes client value

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/users/profile.ts:55-60, 69
- **Detail**: The Supabase call chains `.select("display_name").single()` after `.update()`, but the returned `data` is discarded — only `{ error }` is destructured. The success response echoes the client-supplied `trimmed` string, not the DB-stored value. Two problems: (1) client always gets back its own value regardless of what DB stored; (2) RLS evaluates UPDATE and SELECT as separate operations — if SELECT ever fails, the handler returns 500 even though the UPDATE succeeded.
- **Fix A ⭐ Recommended**: Drop `.select().single()` entirely. Use `.update({ display_name: trimmed }).eq('id', user.id)` with no trailing select. Error is exclusively an UPDATE error — semantically clear.
  - Strength: Eliminates the false-500 risk; simpler code.
  - Tradeoff: Response echoes client value, not DB value — acceptable given no trigger normalises display_name.
  - Confidence: HIGH — identical UPDATE-only pattern used in other routes.
  - Blind spot: If a future trigger normalises display_name, response would diverge.
- **Fix B**: Keep `.select().single()` but destructure `{ data, error }` and return `data?.display_name ?? trimmed` in the response.
  - Strength: Response reflects the authoritative DB value.
  - Tradeoff: Still carries dual-phase error risk if SELECT policy ever diverges.
  - Confidence: MEDIUM — requires confirming SELECT policy remains equivalent to UPDATE policy.
  - Blind spot: RLS policy for SELECT on profiles not re-checked.
- **Decision**: FIXED via Fix A — dropped `.select().single()` from UPDATE call

### F2 — DB error and missing profile both redirect to /auth/signin

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/profile.astro:12-18
- **Detail**: Query destructures only `{ data: profileData }` — no `error` binding. A network timeout or DB error produces `profileData = null`, which falls through to the `if (!profile)` redirect to `/auth/signin`. An authenticated user whose DB call fails gets redirected to sign-in with no explanation, making the failure look like a session problem. Reference pattern in `groups/[id].astro:33-40` always handles the error case separately and redirects to `/dashboard?error=load_failed`.
- **Fix**: Destructure error and handle separately. Add `const { data: profileData, error: profileError } = ...` and `if (profileError) return Astro.redirect("/dashboard?error=load_failed");` before the null check.
  - Strength: Matches the established pattern from groups/[id].astro; gives the user a recoverable path on DB failure.
  - Tradeoff: None significant — one extra binding and one redirect.
  - Confidence: HIGH — identical pattern proven in groups/[id].astro.
  - Blind spot: None significant.
- **Decision**: FIXED — added `profileError` destructuring; redirects to `/dashboard?error=load_failed` on DB error; removed now-redundant null check

### F3 — Type-guard error message says "1-50 chars" for non-string field

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/users/profile.ts:39-44
- **Detail**: When `display_name` is absent or not a string, the handler returns 400 with "Display name must be between 1 and 50 characters." — a length constraint message for what is actually a type/missing-field error.
- **Fix**: Return `{ error: "display_name is required" }` for the type check branch at line 39.
- **Decision**: FIXED — type-guard branch now returns `{ error: "display_name is required" }`

### F4 — Success response body not consumed in ProfileForm

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/profile/ProfileForm.tsx:35-38
- **Detail**: On `res.ok`, the component does not read the response body and sets `value` to the local `trimmed` variable. Minor resource concern (stream is GC'd). Fix depends on F1 resolution.
- **Fix**: If F1 is fixed by dropping `.select()`, no action needed. If F1 is fixed by reading returned data, add `const { display_name } = await res.json(); setValue(display_name);`
- **Decision**: FIXED — `res.json()` consumed on success; `setValue(data.display_name ?? trimmed)`

### F5 — profile.astro missing export const prerender = false

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/profile.astro:1 (frontmatter)
- **Detail**: `groups/[id].astro` line 2 exports `export const prerender = false` as a belt-and-suspenders declaration alongside the global `output: "server"`. `profile.astro` omits it — inconsistent with the reference page.
- **Fix**: Add `export const prerender = false;` as the first line of the `profile.astro` frontmatter.
- **Decision**: FIXED — `export const prerender = false` added as first line of frontmatter

### F6 — All manual progress items rubber-stamped in automated /goal run

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/user-profile-display-name/plan.md (Progress section)
- **Detail**: Items 1.3–1.6, 2.3–2.8, and 3.2–3.3 (12 manual verification items) were all marked [x] during an automated /goal run without browser testing. No observable diff evidence that these were manually verified. They cover: redirect without session, inline error before network request, name persistence on reload, propagation to group views.
- **Fix**: Perform the manual testing steps from the plan's Testing Strategy section before treating this feature as ship-ready.
- **Decision**: ACCEPTED-AS-RULE: "Automated /goal runs rubber-stamp manual progress checkboxes" + FIXED (12 manual items reset to [ ] in plan.md)
