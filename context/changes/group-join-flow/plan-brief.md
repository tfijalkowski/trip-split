# S-01: Group Join Flow — Plan Brief

> Full plan: `context/changes/group-join-flow/plan.md`

## What & Why

Build the group creation and invite-join flow — the prerequisite slice for all of TripSplit's expense and balance work. Users need to form a group and bring others into it before any expense can be recorded. This slice delivers the minimum: create a group, get a shareable link, join via that link.

## Starting Point

Both foundations are complete: Google SSO (F-01) is wired with a `redirect_to` cookie pattern, and the DB schema (F-02) has `groups`, `group_members`, RLS, and an auto-generated `invite_code` per group. The dashboard is a stub showing only `user.email`. No group-related API routes or pages exist yet.

## Desired End State

A logged-in user can create a named group from the dashboard and immediately get a `/join/[code]` invite URL to share. Anyone clicking that link — authenticated or not — ends up in the group after Google sign-in, and lands on the group's detail page showing the member list and invite URL. Invalid codes redirect to the dashboard with an error banner.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| RLS bypass for invite-code lookup | SECURITY DEFINER `join_group()` RPC | Non-members can't query groups by invite_code via authenticated client — a DB function bypassing RLS is the idiomatic Supabase fix and aligns with `is_group_member()` already in the project | Plan |
| Create-group UI | Inline form/modal on dashboard (React island) | Keeps the user in context; dashboard already needs to be a React-capable page | Plan |
| Dashboard structure | Astro SSR groups list + React island for form | SSR for fast list load; React only where client state is needed — follows CLAUDE.md convention | Plan |
| `/join` in PROTECTED_ROUTES | No — handled in-page | Middleware redirects to `/auth/signin` without `redirect_to`, breaking the return-after-auth flow | Plan |
| join_group idempotency | `ON CONFLICT DO NOTHING` in RPC | Visiting the invite link twice must not error or create duplicate memberships | Plan |
| Shared types | Introduce `src/types.ts` with Group + GroupMember | Sets the pattern S-02 will extend with Expense and ExpenseParticipant | Plan |

## Scope

**In scope:**
- `join_group()` SECURITY DEFINER RPC migration
- `src/types.ts` (Group, GroupMember, GroupWithMembers)
- `POST /api/groups` — create group + add creator as member
- `/dashboard` — groups list (SSR) + inline create-group form (React island)
- `/groups/[id]` — invite link + member list + expense placeholder
- `/join/[invite_code]` — pure server-side redirect handler (auth redirect + join + error handling)
- Add `/groups` to PROTECTED_ROUTES

**Out of scope:**
- Group deletion, group leave, invite code rotation (no DELETE policy — v2)
- Expense or balance display (S-02)
- Error display on the sign-in page
- Middleware `redirect_to` preservation for protected routes (acceptable gap for S-01)

## Architecture / Approach

The auth redirect chain already exists: `GoogleSignInButton(redirectTo)` → `/api/auth/google?redirect_to=…` → `auth_redirect` cookie → callback restores it. The join page plugs straight in: if unauthenticated, redirect to `/api/auth/google?redirect_to=/join/[code]`. If authenticated, call `join_group()` RPC and redirect to `/groups/[id]` or `/dashboard?error=…`.

The RLS bypass problem is solved once, in the DB, by the SECURITY DEFINER RPC. All application code uses the normal authenticated Supabase client everywhere else.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. join_group() Migration | SECURITY DEFINER RPC that atomically validates invite code and inserts membership | Must ship before Phase 3 join page can function |
| 2. Types + API route | `src/types.ts` + `POST /api/groups` (create group + self-membership) | Two-step insert has no rollback — partial state possible on DB error (edge case, acceptable for MVP) |
| 3. Pages | Dashboard rework, group detail, join handler, middleware update | Join page must NOT be in PROTECTED_ROUTES — easy to get wrong |

**Prerequisites:** F-01 (google-sso) ✓ done, F-02 (db-schema-rls) ✓ done  
**Estimated effort:** ~2 sessions across 3 phases

## Open Risks & Assumptions

- The two-insert create-group sequence (group then membership) is not atomic — a failure between the two leaves an invisible group. Probability is very low; acceptable for MVP.
- Cross-group isolation relies entirely on RLS (`is_group_member()`). The impl-review confirmed all policies are correct, but manual testing with two separate user sessions is mandatory before closing this slice.

## Success Criteria (Summary)

- Creator flow works end-to-end: create group → copy link → new user joins via link → both see each other in the member list
- Invalid invite code produces a visible error on the dashboard
- Non-member cannot see group data (RLS enforced, confirmed via cross-group isolation test)
