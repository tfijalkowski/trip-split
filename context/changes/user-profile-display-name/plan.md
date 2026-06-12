# User Profile — Display Name Change Implementation Plan

## Overview

Allow logged-in users to view and edit their display name on a dedicated `/profile` page. The new name propagates retroactively to all group views (expense list, balance panel, member list) because those views resolve names from the `profiles` table on each SSR request.

## Current State Analysis

- `profiles` table (`supabase/migrations/20260609213602_initial_schema.sql:13-18`): columns `id`, `email`, `display_name` (nullable text), `created_at`. Populated at sign-up via `handle_new_user()` trigger reading `raw_user_meta_data->>'full_name'` from Google OAuth. **No migration needed.**
- RLS on `profiles` (`migration:105-114`): authenticated `SELECT` (all users), own `INSERT`, own `UPDATE` (`auth.uid() = id`) — all three already in place. The write path is already authorized.
- `context.locals.user` (from `src/middleware.ts`) carries the raw Supabase `User` type (`id`, `email`, `user_metadata`) — no profile enrichment. The Astro page must query `profiles` itself.
- No existing profile API endpoint (`src/pages/api/` has only auth + groups routes).
- No shared navigation header — `src/layouts/Layout.astro` has no user menu; pages are standalone.
- Form pattern: raw `<input>` + Tailwind + `useState` for loading/error/success (matches `src/components/groups/CreateGroupForm.tsx`).
- Realtime subscription in `GroupExpensesIsland.tsx:56` does NOT refetch profiles — uses cached `members` prop. Name changes appear on the next full page load (consistent with PRD §Non-Goals).

## Desired End State

- A logged-in user navigates to `/profile` via a link on the dashboard.
- The page shows their email (read-only) and current display name (pre-filled, or empty with placeholder "Enter your name" if null).
- Entering a valid name (non-empty after trim, ≤50 chars) and saving shows "Name saved" inline confirmation; the page stays on `/profile`.
- The updated name appears in all group views on next page load.
- Blank or whitespace-only input is rejected inline before any network request fires.

### Key Discoveries

- `profiles` UPDATE RLS policy already covers `auth.uid() = id` — no migration needed (`migration:112`)
- `display_name` is rendered in 8+ locations, all reading from SSR query in `src/pages/groups/[id].astro:45`: `select("id, display_name, email")` from `profiles`
- Realtime subscription uses cached `members` prop — name change propagates on next full load only (PRD non-goal: no real-time profile propagation)
- `PROTECTED_ROUTES` array lives in `src/middleware.ts` — adding `/profile` enforces redirect to sign-in
- Project uses raw `<input>` throughout; no shadcn Input component installed (`src/components/ui/` has only button, sheet, table)
- `export const prerender = false` is mandatory on every API route (CLAUDE.md hard stop)

## What We're NOT Doing

- No DB migration (RLS + table already support the write path)
- No shadcn Input component installation (raw input follows project pattern)
- No global header/navigation menu (dashboard link only per user decision)
- No real-time propagation of name change to other open tabs (PRD §Non-Goals)
- No email editing (read-only per PRD)
- No name reset to Google-imported original (PRD §Non-Goals)

## Implementation Approach

Three sequential phases: API endpoint first (testable independently), then the profile page + React island (consumes the endpoint), then the dashboard navigation link (one-liner). The endpoint must not accept a `user_id` body param — identity is read exclusively from `context.locals.user.id`.

## Critical Implementation Details

**Security:** The PATCH endpoint derives the target row from `context.locals.user.id`, never from the request body. The RLS UPDATE policy is a second line of defence, not the primary guard.

**Null display_name:** `display_name` is nullable. The React island initializes input value to `''` when the prop is `null` and shows placeholder "Enter your name". Saving requires a non-empty trimmed value — the null state cannot be preserved once the user submits.

---

## Phase 1: API Endpoint

### Overview

Create `PATCH /api/users/profile` that validates `display_name` (non-empty after trim, ≤50 chars) and updates the `profiles` table for the authenticated user.

### Changes Required

#### 1. New type: `UserProfile`

**File:** `src/types.ts`

**Intent:** Add a `UserProfile` interface so the API response and the Astro page share a typed shape for the profile record.

**Contract:**
```typescript
export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
}
```

#### 2. API route: `PATCH /api/users/profile`

**File:** `src/pages/api/users/profile.ts` (new file)

**Intent:** Accept `{ display_name: string }` in the request body, validate it, update `profiles` for the authenticated user, and return the saved value.

**Contract:**
- `export const prerender = false` at the top
- Export a `PATCH` handler (Astro named export convention matching `GET`, `POST` in other routes)
- Auth check: `context.locals.user` — return 401 `{ error: "Unauthorized" }` if absent
- Supabase guard: `context.locals.supabase` — return 500 `{ error: "Supabase is not configured" }` if absent
- Body: wrap `await context.request.json()` in its own try/catch; on throw return 400 `{ error: "Invalid JSON body" }`; destructure `{ display_name }` from parsed result
- Validation: must be a string; trim it; reject empty string or length > 50 → return 400 `{ error: "Display name must be between 1 and 50 characters." }`
- Supabase call: `const { error } = await context.locals.supabase.from('profiles').update({ display_name: trimmed }).eq('id', context.locals.user.id).select('display_name').single()`
- DB error check: if `error` is truthy → return 500 `{ error: "Failed to update display name" }`
- Success: `new Response(JSON.stringify({ display_name: trimmed }), { status: 200, headers: { 'Content-Type': 'application/json' } })`
- Wrap entire handler body in outer try/catch; return 500 `{ error: "Internal server error" }` on unexpected throw

### Success Criteria

#### Automated Verification

- TypeScript compilation passes: `npx tsc --noEmit`
- Linting passes: `npx eslint src/pages/api/users/profile.ts src/types.ts`

#### Manual Verification

- `PATCH /api/users/profile` with a valid body updates `display_name` in `profiles` (verify in Supabase Studio or via a subsequent GET to the profiles table)
- Request with empty string body returns 400
- Request with whitespace-only string returns 400
- Request with name longer than 50 chars returns 400
- Request with no session cookie returns 401

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Profile Page + React Island

### Overview

Create `/profile` as a protected SSR Astro page that fetches the current user's profile and renders a `ProfileForm` React island. Register `/profile` in `PROTECTED_ROUTES`.

### Changes Required

#### 1. Protected route registration

**File:** `src/middleware.ts`

**Intent:** Ensure unauthenticated users who navigate to `/profile` are redirected to sign-in.

**Contract:** Append `"/profile"` to the existing `PROTECTED_ROUTES` array.

#### 2. `ProfileForm` React island

**File:** `src/components/profile/ProfileForm.tsx` (new file)

**Intent:** Single-field form for editing display name. Shows email as read-only context. Validates client-side before submitting to `PATCH /api/users/profile`. Shows inline "Name saved" on success and inline error on validation or server failure.

**Contract:**
- Props: `displayName: string | null`, `email: string`
- State (four `useState` hooks): `value: string` (init `displayName ?? ''`), `loading: boolean`, `error: string | null`, `success: boolean`
- Email rendered as static text (not an input) — label + value, clearly read-only
- Input: raw `<input type="text" maxLength={50} placeholder="Enter your name" />`, disabled when `loading`; `value` and `onChange` controlled
- On submit: trim `value`; if empty → set error "Name is required", return early (no fetch); if length > 50 → set error "Name must be 50 characters or fewer", return early
- Fetch: `fetch('/api/users/profile', { method: 'PATCH', body: JSON.stringify({ display_name: trimmed }), headers: { 'Content-Type': 'application/json' } })`
- On `response.ok`: set `success=true`, `error=null`, update `value` to trimmed
- On non-ok response: attempt `response.json()` in a try/catch; on success extract `{ error }` and set `error` state; on parse failure set `error` to `"Something went wrong. Please try again."`; set `success=false` in both cases
- Render `success && <p>Name saved</p>` and `error && <p>{error}</p>` below the submit button
- Clear `success` when the input value changes (so the confirmation disappears on next edit)

#### 3. Profile Astro page

**File:** `src/pages/profile.astro` (new file)

**Intent:** SSR page that fetches the current user's profile from the database and renders `ProfileForm` as a client-side island.

**Contract:**
- In frontmatter: destructure `{ supabase, user }` from `Astro.locals`; guard `if (!supabase || !user) return Astro.redirect('/auth/signin')`; query `supabase.from('profiles').select('id, email, display_name').eq('id', user.id).single()`; if no data returned, redirect to `/auth/signin`
- Import `ProfileForm` and render `<ProfileForm client:load displayName={profile.display_name} email={profile.email} />`
- Wrap in `Layout.astro`; set page `<title>Profile</title>`

### Success Criteria

#### Automated Verification

- TypeScript compilation passes: `npx tsc --noEmit`
- Linting passes: `npx eslint src/pages/profile.astro src/components/profile/ProfileForm.tsx src/middleware.ts`

#### Manual Verification

- `/profile` without a session redirects to sign-in
- Authenticated user sees their email (non-editable) and current display name pre-filled in the input
- If `display_name` is null in DB, the input is empty and shows placeholder "Enter your name"
- Saving a valid name shows "Name saved" inline; refreshing the page still shows the new name
- Saving blank/whitespace shows inline error before any network request fires (check DevTools Network tab)
- Saving a name of exactly 50 chars succeeds; 51 chars shows inline error
- After saving, navigating to a group page shows the updated name in the member list, paid-by column, and balance panel

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Dashboard Navigation Link

### Overview

Add a "Profile" link to the dashboard page so users can discover and navigate to `/profile`.

### Changes Required

#### 1. Profile link on dashboard

**File:** `src/pages/dashboard.astro`

**Intent:** Give users a visible path to their profile page from the dashboard.

**Contract:** Add `<a href="/profile">Profile</a>` (or equivalent with matching Tailwind link styles) within the existing dashboard markup. Placement: near the top of the page, consistent with other navigation elements present on that page.

### Success Criteria

#### Automated Verification

- TypeScript/Astro compilation passes: `npx tsc --noEmit`
- Linting passes: `npx eslint src/pages/dashboard.astro`

#### Manual Verification

- Dashboard page shows a "Profile" link
- Clicking the link navigates to `/profile`

---

## Testing Strategy

### Manual Testing Steps

1. Sign in with Google. Navigate to `/dashboard`. Confirm "Profile" link is visible.
2. Click the link → `/profile` loads showing email (read-only) and current display name pre-filled.
3. Clear the input and submit → inline error "Name is required"; DevTools shows no network request to `PATCH /api/users/profile`.
4. Enter 51+ characters → inline error before submit.
5. Enter a valid name (e.g. "Tomek") and submit → "Name saved" appears; input shows "Tomek".
6. Reload `/profile` → input still shows "Tomek".
7. Navigate to a group page → member list, paid-by column, and balance panel all show "Tomek".
8. Open `/profile` in incognito (no session) → redirected to sign-in.
9. Edit name again, start typing → "Name saved" confirmation disappears.

## Migration Notes

No database migration required. The `profiles` table, `display_name` column, and RLS UPDATE policy already exist.

## References

- PRD: `context/foundation/prd-v4.md` (US-02, FR-017, FR-018)
- Roadmap: `context/foundation/roadmap.md` (S-05)
- Profiles migration: `supabase/migrations/20260609213602_initial_schema.sql:13-18, 105-114`
- Form pattern reference: `src/components/groups/CreateGroupForm.tsx`
- API route pattern reference: `src/pages/api/groups/index.ts`
- Dashboard page: `src/pages/dashboard.astro`
- Group page SSR profile query: `src/pages/groups/[id].astro:45`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API Endpoint

#### Automated

- [ ] 1.1 TypeScript compilation passes: `npx tsc --noEmit`
- [ ] 1.2 Linting passes: `npx eslint src/pages/api/users/profile.ts src/types.ts`

#### Manual

- [ ] 1.3 PATCH with valid body updates `display_name` in `profiles` table
- [ ] 1.4 Empty/whitespace-only body returns 400
- [ ] 1.5 Name longer than 50 chars returns 400
- [ ] 1.6 Request with no session cookie returns 401

### Phase 2: Profile Page + React Island

#### Automated

- [ ] 2.1 TypeScript compilation passes: `npx tsc --noEmit`
- [ ] 2.2 Linting passes for new files and modified middleware

#### Manual

- [ ] 2.3 `/profile` without session redirects to sign-in
- [ ] 2.4 Current display name pre-fills (or placeholder if null)
- [ ] 2.5 Valid save shows "Name saved" and persists on page reload
- [ ] 2.6 Blank input shows inline error; no network request fires
- [ ] 2.7 Name longer than 50 chars shows inline error
- [ ] 2.8 Updated name appears in group views on next page load

### Phase 3: Dashboard Navigation Link

#### Automated

- [ ] 3.1 Compilation and linting pass

#### Manual

- [ ] 3.2 "Profile" link visible on dashboard
- [ ] 3.3 Link navigates to `/profile`
