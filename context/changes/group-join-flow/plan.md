# S-01: Group Join Flow — Implementation Plan

## Overview

Build the group creation and invite-join flow for TripSplit. A logged-in user creates a group, gets a shareable invite link, and anyone with the link can join. This is the prerequisite slice for all expense and balance work.

## Current State Analysis

- `/dashboard` exists as a stub — shows `user.email` and a sign-out button only
- Google OAuth is fully wired: `GoogleSignInButton` accepts `redirectTo`, the callback restores it from `auth_redirect` cookie, enabling the invite-link → sign-in → land-back flow without any new auth plumbing
- `groups` RLS SELECT policy is `USING (is_group_member(id))` — a non-member querying by invite_code gets 0 rows, not the group. Invite code validation cannot use the normal authenticated client before membership is established
- `group_members` INSERT policy only checks `auth.uid() = user_id`; invite code validation is delegated to the application layer (documented in the migration)
- `src/types.ts` does not exist yet
- No API routes exist for groups

## Desired End State

After this slice:

1. Authenticated user visits `/dashboard` → sees their groups (empty state if none) and can open an inline create-group form
2. Creating a group: submits name + optional description → group appears in their list → detail page loads at `/groups/[id]` with the invite URL and member list
3. Unauthenticated user clicks invite link `/join/[code]` → redirected to Google sign-in → after auth lands back at `/join/[code]` → automatically joined → arrives at `/groups/[id]`
4. Invalid invite code → redirected to `/dashboard?error=invalid_invite`
5. Already-a-member visits invite link → silently redirected to `/groups/[id]`

### Verification:

1. `POST /api/groups` with valid name returns `{ id }` 201
2. `POST /api/groups` without authentication returns 401
3. Visiting `/join/[code]` unauthenticated redirects to `/api/auth/google?redirect_to=…` (preserving the join URL)
4. Visiting `/join/[invalid-code]` authenticated redirects to `/dashboard?error=invalid_invite`
5. Visiting `/join/[code]` twice as the same user redirects to the same group both times (idempotent)

### Key Discoveries:

- `GoogleSignInButton` already accepts `redirectTo` and encodes it as `?redirect_to=` — the join → auth → return flow plugs in without middleware changes
- `/join` must NOT be added to `PROTECTED_ROUTES` — middleware redirects to `/auth/signin` without preserving the URL, breaking the redirect_to flow. The join page handles unauthenticated users itself
- `SELECT * FROM groups` with RLS returns only groups the user is a member of — the dashboard query needs no filter beyond auth
- The `join_group()` RPC must run as SECURITY DEFINER to bypass the member-read-only SELECT policy when looking up a group by invite code

## What We're NOT Doing

- Group deletion (no DELETE policy on groups — see migration comment; v2)
- Group leave / removing a member (no DELETE policy on group_members — v2)
- Invite code rotation / expiry — one static code per group for MVP
- Role-based permissions beyond creator vs. member
- Expense or balance UI — that is S-02
- Error display on the sign-in page — errors arrive at `/dashboard?error=` for MVP

## Critical Implementation Details

**`/join/[invite_code]` is always-redirect**: the page has no HTML body — all logic is in Astro frontmatter and every code path ends with `return Astro.redirect(...)`. This is intentional; the page is a pure server-side action.

**join_group() is the only RLS bypass for invite-code lookup**: the function must be SECURITY DEFINER with `SET search_path = ''` (consistent with `handle_new_user` in the initial migration). It uses `ON CONFLICT (group_id, user_id) DO NOTHING` on the insert, making it idempotent for the already-a-member case.

**Two-step group creation is intentional**: `POST /api/groups` does two sequential inserts — groups then group_members. The RLS policies allow both with the authenticated client; no RPC is needed. If the membership insert fails after a successful group insert, the group exists but is invisible to everyone including the creator (RLS blocks the SELECT). This edge case is acceptable for MVP — it cannot be triggered under normal operation.

---

## Phase 1: join_group() DB Migration

### Overview

Add a `join_group(p_invite_code)` SECURITY DEFINER function that atomically looks up a group by invite code (bypassing RLS) and inserts the caller as a member. This is the only piece that cannot be done with the authenticated client, and it must land before the API route or join page can function.

### Changes Required:

#### 1. New migration file

**File**: `supabase/migrations/20260610000001_join_group_rpc.sql`

**Intent**: Create the `join_group` RPC. No table changes — schema is complete from F-02.

**Contract**:
```sql
CREATE OR REPLACE FUNCTION public.join_group(p_invite_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_group_id uuid;
BEGIN
  SELECT id INTO v_group_id FROM public.groups WHERE invite_code = p_invite_code;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'invalid_invite_code';
  END IF;
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (v_group_id, auth.uid())
  ON CONFLICT (group_id, user_id) DO NOTHING;
  RETURN v_group_id;
END;
$$;
```

The exception message `'invalid_invite_code'` is the sentinel the join page checks to distinguish "bad code" from other DB errors.

### Success Criteria:

#### Automated Verification:

- `supabase db push` (remote) or `supabase db reset` (local) completes with exit code 0
- `SELECT proname FROM pg_proc WHERE proname = 'join_group'` returns 1 row
- `SELECT prosecdef FROM pg_proc WHERE proname = 'join_group'` returns `true`

#### Manual Verification:

- `join_group` visible in Supabase Studio → Database → Functions with SECURITY DEFINER label
- Calling `SELECT join_group('INVALID')` as authenticated user raises exception containing `invalid_invite_code`
- Calling `SELECT join_group('TESTCODE')` as Alice's JWT inserts into group_members and returns the trip group UUID

---

## Phase 2: Shared Types + Create Group API Route

### Overview

Establish `src/types.ts` with the two entity types this slice uses, then wire up the single API endpoint the React island will call. Both pieces are prerequisites for Phase 3.

### Changes Required:

#### 1. Create src/types.ts

**File**: `src/types.ts` (new)

**Intent**: Single source of truth for entity shapes used across API routes and page components. Establishes the pattern S-02 extends with `Expense` and `ExpenseParticipant`.

**Contract**: Export `Group` and `GroupMember` interfaces with field names matching the DB schema exactly (snake_case). Include a `GroupWithMembers` convenience type used on the group detail page.

#### 2. Create POST /api/groups

**File**: `src/pages/api/groups/index.ts` (new)

**Intent**: Accept group name + optional description, create the group, add the caller as a member, return the new group id.

**Contract**:
- `export const prerender = false` (required — API route)
- `export const POST: APIRoute`
- Reads `context.locals.user`; returns 401 if absent
- Parses JSON body: `{ name: string, description?: string }`
- Returns 400 if `name` is blank after trim
- Insert 1: `supabase.from('groups').insert({ name, description, created_by: user.id }).select().single()` — RLS allows (`auth.uid() = created_by`)
- Insert 2: `supabase.from('group_members').insert({ group_id: group.id, user_id: user.id })` — RLS allows (`auth.uid() = user_id`)
- On success: `{ id: group.id }` with status 201
- On DB error: `{ error: message }` with status 500

### Success Criteria:

#### Automated Verification:

- `npx tsc --noEmit` passes with no new errors
- `npx eslint src/types.ts src/pages/api/groups/index.ts` passes

#### Manual Verification:

- `curl -X POST /api/groups -H 'Content-Type: application/json' -d '{"name":"Test"}' ` (with valid session cookie) returns `{"id":"..."}` 201
- Same call without session cookie returns 401
- Same call with `{"name":""}` returns 400

---

## Phase 3: Dashboard, Group Detail, and Join Pages

### Overview

Three Astro pages and one React island. Dashboard replaces the stub with a server-rendered groups list and a hydrated create-group form. Group detail shows the invite link and member list. Join page is a pure server-side redirect handler.

### Changes Required:

#### 1. Create src/components/groups/CreateGroupForm.tsx

**File**: `src/components/groups/CreateGroupForm.tsx` (new)

**Intent**: React island rendered on the dashboard. Shows a "New group" button; on click reveals an inline form (name required, description optional). On submit calls `POST /api/groups`, on success navigates to `/groups/[id]`.

**Contract**:
- No props required
- Uses `fetch('/api/groups', { method: 'POST', body: JSON.stringify(...) })`
- On success: `window.location.href = '/groups/' + data.id`
- Shows inline error text on failure (does not use global error state)
- Uses `cn()` from `@/lib/utils` for class merging
- Uses `button.tsx` from shadcn/ui for buttons

#### 2. Update src/pages/dashboard.astro

**File**: `src/pages/dashboard.astro` (replace stub)

**Intent**: SSR groups list + CreateGroupForm island. Replace the existing placeholder content entirely.

**Contract**:
- Server-side: `supabase.from('groups').select('id, name, created_at').order('created_at', { ascending: false })` — RLS returns only the user's groups
- Renders a list of group cards linking to `/groups/[group.id]`
- Empty state when groups array is empty
- Reads `?error` query param and shows an error banner if present (handles `invalid_invite` and `join_failed` values)
- Includes `<CreateGroupForm client:load />` island

#### 3. Create src/pages/groups/[id].astro

**File**: `src/pages/groups/[id].astro` (new)

**Intent**: Group detail page. Shows group name, the shareable invite URL, and the member list. Placeholder section for expenses (S-02 will populate it).

**Contract**:
- `export const prerender = false` in the frontmatter script block (Astro convention for SSR pages with dynamic params)
- Reads `Astro.params.id`
- Fetches group: `supabase.from('groups').select('*').eq('id', id).single()` — returns null if user is not a member (RLS) → redirect to `/dashboard`
- Fetches members: `supabase.from('group_members').select('user_id, profiles(display_name, email)').eq('group_id', id)`
- Invite URL: `` `${Astro.url.origin}/join/${group.invite_code}` ``
- Shows a copy-to-clipboard button for the invite URL (inline `<button onclick="navigator.clipboard.writeText(...)">` is sufficient for MVP — no React island needed)
- Renders member list with display names
- Placeholder `<section>` with text "Expenses will appear here (S-02)" for the expense area
- Add `/groups` to `PROTECTED_ROUTES` in `src/middleware.ts`

#### 4. Create src/pages/join/[invite_code].astro

**File**: `src/pages/join/[invite_code].astro` (new)

**Intent**: Pure server-side redirect handler for invite links. No HTML output — every code path ends with `Astro.redirect(...)`.

**Contract**:
- Reads `Astro.params.invite_code`
- If `!Astro.locals.user`: redirect to `` `/api/auth/google?redirect_to=${encodeURIComponent(`/join/${invite_code}`)}` ``
- Calls `supabase.rpc('join_group', { p_invite_code: invite_code })`
- On success (`data` is a uuid): redirect to `/groups/${data}`
- On error where `error.message` includes `'invalid_invite_code'`: redirect to `/dashboard?error=invalid_invite`
- On any other error: redirect to `/dashboard?error=join_failed`
- Do NOT add `/join` to `PROTECTED_ROUTES` — middleware would redirect to `/auth/signin` without the `redirect_to` param, breaking the flow

#### 5. Update src/middleware.ts

**File**: `src/middleware.ts`

**Intent**: Protect `/groups` routes so unauthenticated direct-URL access is blocked.

**Contract**: Add `"/groups"` to the `PROTECTED_ROUTES` array. Do not add `"/join"`.

### Success Criteria:

#### Manual Verification:

- **Create + visit**: Log in → dashboard shows empty state → click "New group" → fill in name → submit → land on `/groups/[id]` with invite URL and your name in members list
- **Invite flow (new user)**: Open the invite URL in an incognito window → redirected to Google sign-in → after auth → land on `/groups/[id]` as the new member
- **Invite flow (existing user)**: Open the invite URL while already logged in → immediately land on `/groups/[id]`
- **Already a member**: Open the same invite URL again → land on `/groups/[id]` (no error, no duplicate membership row)
- **Invalid code**: Visit `/join/BADCODE` while logged in → land on `/dashboard` with the invalid invite error banner visible
- **Protected route**: Visit `/groups/[any-id]` while logged out → redirected to `/auth/signin`
- **Cross-group isolation**: Log in as a second user who has NOT been invited → visiting `/groups/[id-of-first-group]` → redirected to dashboard (group not found via RLS)

---

## Testing Strategy

### Manual Testing Steps:

1. `supabase db reset` locally; verify `join_group` function exists in Studio
2. Run dev server: `npm run dev`
3. Full creator flow: create account → create group → copy invite URL from group page
4. Full joiner flow: open invite URL in incognito → sign in with Google → verify lands in group, appears in member list on group page
5. Error flows: `/join/BADCODE`, `/join/TESTCODE` twice with same user
6. Cross-group check: sign in as a different account (no invite) → attempt to navigate to the first group's URL → verify redirect to dashboard

### Simulating two-user flow locally:

Use two separate browser profiles (or one incognito window) — each holds an independent Supabase session cookie.

## Migration Notes

The new migration (`20260610000001_join_group_rpc.sql`) adds a function only — no table changes. Apply with `supabase db push` (remote) or include in `supabase db reset` (local). The seed file already has `TESTCODE` as the invite code for the test group, enabling immediate manual testing without creating a group first.

## References

- Roadmap: `context/foundation/roadmap.md` (S-01, prerequisites F-01 + F-02)
- PRD: `context/foundation/prd-v3.md` (FR-003, FR-004, FR-005)
- Schema: `supabase/migrations/20260609213602_initial_schema.sql`
- Auth flow: `src/pages/api/auth/google.ts`, `src/pages/auth/callback.ts`
- GoogleSignInButton with redirectTo: `src/components/auth/GoogleSignInButton.astro`
- Lessons: `context/foundation/lessons.md` (RLS silent 0-rows on missing DELETE policy)

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: join_group() DB Migration

#### Automated

- [ ] 1.1 `supabase db push` or `db reset` completes with exit code 0
- [ ] 1.2 `join_group` exists in `pg_proc`
- [ ] 1.3 `join_group` is `SECURITY DEFINER` (`prosecdef = true`)

#### Manual

- [ ] 1.4 `join_group` visible in Supabase Studio with SECURITY DEFINER label
- [ ] 1.5 `SELECT join_group('INVALID')` raises exception containing `invalid_invite_code`
- [ ] 1.6 `SELECT join_group('TESTCODE')` as Alice's JWT inserts membership and returns group UUID

### Phase 2: Shared Types + Create Group API Route

#### Automated

- [ ] 2.1 `npx tsc --noEmit` passes
- [ ] 2.2 `npx eslint src/types.ts src/pages/api/groups/index.ts` passes

#### Manual

- [ ] 2.3 `POST /api/groups` with valid session + `{"name":"Test"}` → 201 `{"id":"..."}`
- [ ] 2.4 `POST /api/groups` without session → 401
- [ ] 2.5 `POST /api/groups` with `{"name":""}` → 400

### Phase 3: Dashboard, Group Detail, and Join Pages

#### Manual

- [ ] 3.1 Creator flow: create group → land on `/groups/[id]` with invite URL and member list
- [ ] 3.2 Invite flow (new user, incognito): open invite URL → sign in → land on `/groups/[id]` as new member
- [ ] 3.3 Invite flow (existing user): open invite URL while logged in → immediately land on `/groups/[id]`
- [ ] 3.4 Already-a-member: open invite URL twice → no error, no duplicate row
- [ ] 3.5 Invalid code: `/join/BADCODE` → `/dashboard` with error banner
- [ ] 3.6 Protected route: `/groups/[id]` unauthenticated → `/auth/signin`
- [ ] 3.7 Cross-group isolation: non-member navigates to group URL → redirected to dashboard
