# User Profile — Display Name Change — Plan Brief

> Full plan: `context/changes/user-profile-display-name/plan.md`

## What & Why

Users whose Google account name doesn't match how their travel companions know them have no way to update their display name within TripSplit — their only recourse is changing their Google profile, which affects every other Google service they use. This change adds a dedicated `/profile` page where a logged-in user can view and edit their display name.

## Starting Point

The `profiles` table already exists with a `display_name` column and an RLS UPDATE policy scoped to the record owner (`auth.uid() = id`). The field is populated at sign-up from Google OAuth metadata. There is currently no API endpoint to write to it, no profile page, and no navigation entry pointing to one.

## Desired End State

A logged-in user can reach `/profile` via a link on the dashboard, see their email (read-only) and current display name (pre-filled), and save a new name (non-empty, ≤50 chars). The updated name immediately becomes their identifier in all group views — member list, expense list paid-by column, balance panel — on next page load.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Max char limit | 50 characters | PRD's suggested default; fits all realistic name formats without overflow in balance panels | Plan |
| Navigation entry | Dashboard link only | Smallest scope — no shared header or layout changes needed | Plan |
| Form pattern | Plain `useState` | Single-field form; matches the simpler `CreateGroupForm.tsx` pattern already in the codebase | Plan |
| Post-save UX | Stay on `/profile`, inline "Name saved" | PRD requires inline confirmation; no toast library is installed | Plan |
| Null name handling | Empty input + placeholder "Enter your name" | Honest — user must deliberately enter a name; pre-filling email would be confusing | Plan |

## Scope

**In scope:**
- `UserProfile` type in `src/types.ts`
- `PATCH /api/users/profile` endpoint (validate, update `profiles` table)
- `/profile` Astro page (SSR, protected, fetches current profile in frontmatter)
- `ProfileForm.tsx` React island (`useState`, inline error + "Name saved" confirmation)
- `/profile` added to `PROTECTED_ROUTES` in `src/middleware.ts`
- Profile link added to `src/pages/dashboard.astro`

**Out of scope:**
- Database migration (RLS and table already exist)
- shadcn Input component (raw `<input>` is the project pattern)
- Global header or shared navigation
- Real-time propagation of name change to other members' open tabs
- Email editing, name reset to Google original, per-group display name aliases

## Architecture / Approach

Thin vertical slice: the Astro page SSR-queries `profiles` in its frontmatter, passes `display_name` and `email` as props to a React island, which submits to the new PATCH endpoint via plain `fetch`. The endpoint reads user identity from `context.locals.user.id` — never from the request body. No new DB objects needed.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. API Endpoint | `PATCH /api/users/profile` — validates and persists the new name | Forgetting `export const prerender = false` → silent 404 (CLAUDE.md hard stop) |
| 2. Profile Page + Island | `/profile` Astro page + `ProfileForm.tsx` React island | SSR query must use `Astro.locals.supabase` (server client), not the browser client |
| 3. Dashboard Link | Profile link added to dashboard | Trivial — match existing Tailwind link styles |

**Prerequisites:** F-01 (Google SSO) and F-02 (DB schema + RLS) are both `done`.  
**Estimated effort:** ~1–2 after-hours sessions across 3 phases.

## Open Risks & Assumptions

- Users whose `display_name` is null in the DB (Google didn't provide `full_name` at sign-up) will see an empty input with a placeholder. They must set a name before the field is non-null — acceptable per PRD.
- Other group members with the group page open will not see the name change until they reload — explicit PRD non-goal; acceptable for MVP.

## Success Criteria (Summary)

- A logged-in user can navigate to `/profile`, enter a new display name, and see "Name saved" inline.
- Refreshing `/profile` shows the updated name still pre-filled.
- The updated name appears in the group member list, expense list (paid-by column), and balance panel on the next page load.
