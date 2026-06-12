# S-03: Zamknięcie i otwarcie rozliczenia — Implementation Plan

## Overview

Enable the group creator to lock and unlock the settlement. When locked, no participant (including the creator) can add expenses; a full-width banner with "locked by [name] on [date]" is shown to all members; the lock state propagates to other open tabs in real time via Supabase Realtime.

## Current State Analysis

What exists (confirmed by codebase research):
- `groups` table (`supabase/migrations/20260609213602_initial_schema.sql:20–29`) already has `is_locked boolean NOT NULL DEFAULT false` and `created_by uuid NOT NULL REFERENCES auth.users`
- RLS UPDATE policy on `groups` (`migration:125–127`) already restricts updates to the group creator — but it produces a **silent 0-rows result** for non-creators, not an error (see lessons.md). The API endpoint must verify creator status before calling UPDATE.
- `Group` interface in `src/types.ts:1–9` already includes `is_locked: boolean` — no type change needed for this field
- `groups` table is **NOT** in the `supabase_realtime` publication (`migration:190–193` adds only `expenses` and `expense_participants`) — must be added
- No PATCH endpoint for groups exists anywhere in `src/pages/api/`
- `POST /api/groups/[id]/expenses.ts` has no `is_locked` guard; the insertion point is after the membership check (after line 54, before body parsing at line 57)
- `GroupExpensesIsland.tsx` has one Realtime channel (`expenses:${groupId}`) subscribing to the `expenses` table — a second channel for `groups` must be added alongside it, not merged into the existing one
- `src/pages/groups/[id].astro` fetches the full `group` object (line 16, includes `is_locked`) but does not pass lock state or creator identity to the island
- `join_group` RPC (`supabase/migrations/20260610000001_join_group_rpc.sql`) is `SECURITY DEFINER` — it bypasses the `group_members: self insert` RLS policy entirely. An RLS guard on `group_members` would not fire for this path. The `is_locked` check must be added inside the RPC itself.
- `src/pages/join/[invite_code].astro` calls `supabase.rpc("join_group", ...)` with no awareness of `is_locked`; the error handler recognises only `invalid_invite_code` and a generic fallback

Missing for S-03:
- `locked_at timestamptz` column in `groups` (needed for banner timestamp)
- `groups` added to Realtime publication
- `PATCH /api/groups/[id].ts` endpoint
- `is_locked` guard in `POST /api/groups/[id]/expenses.ts`
- `is_locked` check inside `join_group` RPC (SECURITY DEFINER path — RLS alone is insufficient)
- `group_is_locked` error handling in `src/pages/join/[invite_code].astro`
- `src/components/expenses/SettlementLockBanner.tsx`
- Lock-related props and logic in `GroupExpensesIsland.tsx`
- `locked_at: string | null` added to `Group` type

## Desired End State

The group creator sees a "Lock settlement" toggle button on the group detail page. Clicking it locks the group: the button changes to "Unlock settlement", a full-width banner appears for all members ("Settlement locked by [creator name] on [date]"), and the "Add expense" button is disabled for everyone including the creator. Any member with the page open sees the change within ~1 second via Realtime — no page refresh required. The lock is enforced server-side: a direct API call to `POST /api/groups/[id]/expenses` while the group is locked returns 423. Unlocking reverses all of the above.

### Key Discoveries:

- `is_locked` and `created_by` in schema: `supabase/migrations/20260609213602_initial_schema.sql:26–27`
- RLS UPDATE (creator only) in place: `migration:125–127` — but silent on failure (lessons.md rule)
- Realtime publication gap: `migration:190–193` — `groups` missing
- Expense POST guard insertion point: `src/pages/api/groups/[id]/expenses.ts:54–57`
- Island's existing Realtime channel name: `expenses:${groupId}` (`GroupExpensesIsland.tsx:51`) — do not rename; add a separate `group:${groupId}` channel
- `group` object already fetched SSR: `src/pages/groups/[id].astro:16` — extend props passed to island

## What We're NOT Doing

- Guarding expense edit/delete endpoints (S-04 doesn't exist yet; guards will be added in that slice)
- Delegating lock/unlock permissions to non-creator participants (PRD Non-Goal → v2)
- Confirmation dialog before locking (PRD doesn't require it; accidental lock is trivially undoable)
- Persisting who locked beyond `created_by` (creator is always the locker; no `locked_by` column needed)
- Server-side pagination changes (no data model impact)

## Implementation Approach

Two phases in dependency order:

1. **Data & API** — migration adds `locked_at` and enables Realtime on `groups`; TypeScript type gains `locked_at`; new PATCH endpoint handles toggle with explicit creator check; POST expenses gains a 423 guard.
2. **UI** — Astro page passes lock props to the island; new `SettlementLockBanner` component; island gains a `group:${groupId}` Realtime channel, local lock state, a toggle handler, auto-close logic for the open sheet, and a disabled "Add expense" button.

## Critical Implementation Details

**RLS silent failure on UPDATE**: The existing `groups: creator update` RLS policy silently returns 0 rows for non-creators — indistinguishable from success at the JS layer. The PATCH endpoint **must** query `groups` for `created_by` and return 403 before issuing the UPDATE; do not rely on rows-affected count as the authorization check.

**`groups` Realtime requires publication entry**: Without `ALTER PUBLICATION supabase_realtime ADD TABLE public.groups` in the migration, the `postgres_changes` subscription on `groups` fires no events — the island silently never updates. This must be in Phase 1.

**Two separate Realtime channels**: The island already has `expenses:${groupId}` subscribed to the `expenses` table. Add a new channel `group:${groupId}` subscribed to `UPDATE` events on `groups` with filter `id=eq.${groupId}`. Both channels must be removed on unmount. Do not merge them — changing the existing channel name would break the tested S-02 Realtime flow.

**`locked_at` display**: Format as `value.slice(0, 10)` (YYYY-MM-DD) in the banner — same approach used in `ExpenseTable` to avoid SSR hydration mismatches with locale-dependent date formatting.

---

## Phase 1: Data & API Layer

### Overview

Add the `locked_at` column and Realtime publication entry via migration, update the TypeScript type, create the PATCH toggle endpoint, and add the lock guard to the expense creation endpoint. After this phase the data contract is complete and testable independently of the UI.

### Changes Required:

#### 1. Create the settlement_lock migration

**File**: `supabase/migrations/<timestamp>_settlement_lock.sql` (new, via `supabase migration new settlement_lock`)

**Intent**: Add `locked_at timestamptz` to `groups` (NULL = never locked) and add `groups` to the Realtime publication so the island's subscription receives events.

**Contract**:
```sql
ALTER TABLE public.groups ADD COLUMN locked_at timestamptz;
ALTER PUBLICATION supabase_realtime ADD TABLE public.groups;
```
No default value on `locked_at` — existing rows are NULL (never locked). The existing RLS UPDATE policy already covers this column. Apply with `supabase db push`.

#### 2. Update Group type in src/types.ts

**File**: `src/types.ts`

**Intent**: Add `locked_at` to the `Group` interface so the Astro page and island are typed correctly.

**Contract**: Add `locked_at: string | null` to the existing `Group` interface alongside `is_locked: boolean`.

#### 3. Create PATCH /api/groups/[id].ts

**File**: `src/pages/api/groups/[id].ts` (new)

**Intent**: Allow the group creator to toggle `is_locked`. Returns 403 for non-creators, 400 for invalid body, 200 with the updated group on success.

**Contract**:
- `export const prerender = false`
- `export const PATCH: APIRoute` — follows the `signout.ts` / `groups/index.ts` pattern
- Auth check → 401 if no user
- Extract `groupId` from `context.params.id` → 400 if missing
- Parse JSON body: `{ is_locked: boolean }` → 400 if missing or wrong type
- Query `groups` SELECT `created_by` WHERE `id = groupId` → 403 if `created_by !== user.id` (explicit check before UPDATE — do not rely on RLS silent failure)
- UPDATE `groups` using `.update({ is_locked: body.is_locked, locked_at: body.is_locked ? new Date().toISOString() : null }).eq("id", groupId).select("is_locked, locked_at").single()` — the `.select()` chain is required; without it Supabase JS v2 returns no rows and the handler has no `locked_at` to return
- Return `200 { is_locked, locked_at }` from the Supabase `data` result on success; `500` on Supabase error

#### 4. Add is_locked guard to POST /api/groups/[id]/expenses.ts


**File**: `src/pages/api/groups/[id]/expenses.ts`

**Intent**: Reject expense creation when the group is locked, server-enforcing the settlement lock regardless of UI state.

**Contract**: After the membership check (currently ending around line 54) and before JSON body parsing, query `groups` SELECT `is_locked` WHERE `id = groupId`. If `is_locked === true`, return `423 { error: "Group settlement is locked" }`. Reuse the same Supabase client already created earlier in the handler.

#### 5. Update join_group RPC to block joining a locked group

**File**: `supabase/migrations/<timestamp>_settlement_lock.sql` (same migration as Change 1)

**Intent**: Prevent new members from joining a group whose settlement is locked. The `join_group` RPC runs as `SECURITY DEFINER` — it bypasses RLS, so an RLS guard on `group_members` would not fire for this path. The check must live inside the RPC.

**Contract**: Add `CREATE OR REPLACE FUNCTION public.join_group` to the settlement_lock migration. Extend the existing SELECT to also fetch `is_locked`, then raise `'group_is_locked'` before the INSERT if true:

```sql
CREATE OR REPLACE FUNCTION public.join_group(p_invite_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_group_id uuid;
  v_is_locked boolean;
BEGIN
  SELECT id, is_locked INTO v_group_id, v_is_locked
  FROM public.groups WHERE invite_code = p_invite_code;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'invalid_invite_code';
  END IF;
  IF v_is_locked THEN
    RAISE EXCEPTION 'group_is_locked';
  END IF;
  INSERT INTO public.group_members (group_id, user_id)
  VALUES (v_group_id, auth.uid())
  ON CONFLICT (group_id, user_id) DO NOTHING;
  RETURN v_group_id;
END;
$$;
```

#### 6. Handle group_is_locked error in the join page

**File**: `src/pages/join/[invite_code].astro`

**Intent**: Surface a clear redirect when a user tries to join a locked group via an invite link.

**Contract**: In the existing error handler (lines 21–26), add a branch before the generic fallback:

```ts
if (error.message.includes("group_is_locked")) {
  return Astro.redirect("/dashboard?error=group_locked");
}
```

The dashboard already handles `?error=` params (pattern established by `invalid_invite` and `join_failed`). No new component needed.

### Success Criteria:

#### Automated Verification:

- `supabase db push` applies migration with no errors
- `npx tsc --noEmit` passes with zero errors
- `npm run build` passes

#### Manual Verification:

- `SELECT is_locked, locked_at FROM groups` in Supabase SQL editor shows new column present; existing rows have `locked_at = null`
- `PATCH /api/groups/:id` with creator auth + `{ is_locked: true }` → `200`, `is_locked = true`, `locked_at` set to current timestamp
- `PATCH /api/groups/:id` with creator auth + `{ is_locked: false }` → `200`, `is_locked = false`, `locked_at = null`
- `PATCH /api/groups/:id` without auth → `401`
- `PATCH /api/groups/:id` from non-creator member → `403`
- `POST /api/groups/:id/expenses` on a locked group (valid auth, valid body) → `423`
- `POST /api/groups/:id/expenses` on an unlocked group → `201` (no regression)
- Visiting an invite link for a locked group → redirected to `/dashboard?error=group_locked`
- Visiting an invite link for an unlocked group → join succeeds (no regression)

**Implementation Note**: After Phase 1 manual verification passes, proceed to Phase 2.

---

## Phase 2: UI Integration

### Overview

Wire the lock state through the Astro page into the island. Add the `SettlementLockBanner` component. Update `GroupExpensesIsland` with a second Realtime channel, lock state, the toggle handler, auto-close logic, and disabled button. Handle the 423 error in `AddExpenseSheet`.

### Changes Required:

#### 1. Update src/pages/groups/[id].astro

**File**: `src/pages/groups/[id].astro`

**Intent**: Derive `isCreator` and `creatorName` from already-fetched data and pass all lock-related props to the island.

**Contract**:
- `group` is already fetched at line 16 and includes `is_locked` and `locked_at` (available after Phase 1 migration)
- Compute `isCreator = user.id === group.created_by`
- Derive `creatorName`: find the member in the `members` array where `user_id === group.created_by`; use `display_name ?? email`
- Pass four new props to `<GroupExpensesIsland>`: `isGroupLocked={group.is_locked}`, `lockedAt={group.locked_at ?? null}`, `isCreator={isCreator}`, `creatorName={creatorName}`

#### 2. Create src/components/expenses/SettlementLockBanner.tsx

**File**: `src/components/expenses/SettlementLockBanner.tsx` (new)

**Intent**: Full-width banner displayed to all members when the group is locked, showing who locked it and when.

**Contract**:
- Props: `{ lockedAt: string | null, creatorName: string | null }`
- Renders an amber/warning-toned full-width banner: `"Settlement locked by [creatorName ?? 'the group creator'] on [lockedAt.slice(0,10)]"`
- If `lockedAt` is null, omit the date part: `"Settlement locked by [name]"`
- No close/dismiss button — the banner disappears only when the group is unlocked

#### 3. Update src/components/expenses/GroupExpensesIsland.tsx

**File**: `src/components/expenses/GroupExpensesIsland.tsx`

**Intent**: Add lock state management, a second Realtime channel for `groups`, a toggle handler, auto-close when locked mid-fill, and conditional UI (banner, disabled button, lock/unlock button for creator).

**Contract**:

Props interface gains: `isGroupLocked: boolean`, `lockedAt: string | null`, `isCreator: boolean`, `creatorName: string | null`

New state: `groupLocked` (init from `isGroupLocked`), `groupLockedAt` (init from `lockedAt`)

Second Realtime channel (in the same `useEffect` as the expenses channel, cleaned up together):
```ts
const groupChannel = client
  .channel(`group:${groupId}`)
  .on('postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'groups', filter: `id=eq.${groupId}` },
    (payload) => {
      const newLocked = payload.new.is_locked as boolean
      const newLockedAt = payload.new.locked_at as string | null
      setGroupLocked(newLocked)
      setGroupLockedAt(newLockedAt)
      if (newLocked && sheetOpen) setSheetOpen(false)
    })
  .subscribe()
```
Remove `groupChannel` in the cleanup return alongside the expenses channel.

Toggle handler:
```ts
async function handleToggleLock() {
  const res = await fetch(`/api/groups/${groupId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_locked: !groupLocked }),
  })
  if (res.ok) {
    const data = await res.json()
    setGroupLocked(data.is_locked)
    setGroupLockedAt(data.locked_at ?? null)
  } else {
    console.error('[lock toggle] failed', res.status)
  }
}
```

Render changes:
- Render `<SettlementLockBanner lockedAt={groupLockedAt} creatorName={creatorName} />` when `groupLocked`
- "Add expense" `<Button>` gains `disabled={groupLocked}`
- After the "Add expense" button, render (creator only): `<Button variant="outline" onClick={handleToggleLock}>{groupLocked ? 'Unlock settlement' : 'Lock settlement'}</Button>`

#### 4. Update src/components/expenses/AddExpenseSheet.tsx

**File**: `src/components/expenses/AddExpenseSheet.tsx`

**Intent**: Handle the 423 response from the POST endpoint gracefully — display an inline error message explaining that the settlement was locked mid-fill.

**Contract**: In the form submit handler, after the `fetch` call, check `res.status === 423`. If true, display `"Settlement was locked while you were filling this out"` via the existing `ServerError` component / error state pattern (same mechanism used for other non-201 responses). Do not auto-close on 423 — user dismisses manually.

### Success Criteria:

#### Automated Verification:

- `npx tsc --noEmit` passes with zero errors
- `npm run lint` passes with no new errors
- `npm run build` passes

#### Manual Verification:

- Creator sees "Lock settlement" button; non-creator members do not
- Creator clicks "Lock settlement" → button changes to "Unlock settlement", banner appears with name and date, "Add expense" button becomes disabled
- Non-creator member's open tab updates within ~1 second via Realtime (lock banner appears, button disables)
- Creator clicks "Unlock settlement" → banner disappears, "Add expense" button re-enables; Realtime propagates to other tabs
- Non-creator cannot see or interact with the toggle button
- Member opens `AddExpenseSheet`, creator locks in another tab → sheet auto-closes, banner visible
- Member fills `AddExpenseSheet` and submits after group is locked (stale UI) → inline 423 error shown; sheet stays open; user dismisses manually
- `locked_at` date in banner matches when the lock was set (YYYY-MM-DD format)

**Implementation Note**: The two-tab Realtime test (creator locks in tab A → non-creator tab B updates within ~1 s) is the final gate for S-03.

---

## Testing Strategy

### Unit Tests:

No test runner is configured (per `CLAUDE.md`). Logic is validated through manual verification steps above.

### Integration Tests:

Not applicable at this stage.

### Manual Testing Steps:

1. Verify Phase 1 API with curl or browser dev tools before building UI
2. Open group page as creator in tab A and as a non-creator member in tab B
3. Creator (tab A) locks settlement — verify tab B updates within ~1 second
4. Non-creator (tab B) tries "Add expense" — button should be disabled; direct API call should return 423
5. Creator (tab A) unlocks — verify both tabs restore full functionality
6. Edge case: open `AddExpenseSheet` in tab B, then lock from tab A — sheet should auto-close in tab B

## Performance Considerations

The `groups` Realtime subscription adds one lightweight channel per open group page. At TripSplit's scale (one group per trip, typically one active tab per user) this is negligible.

The `is_locked` check in the POST expenses endpoint adds one extra Supabase query per expense creation attempt. At trip scale (a few dozen expenses total) this is not a concern.

## Migration Notes

Run `supabase migration new settlement_lock` to create the timestamped file, paste three SQL statements in order: `ALTER TABLE` (adds `locked_at`), `ALTER PUBLICATION` (adds `groups` to Realtime), and `CREATE OR REPLACE FUNCTION join_group` (adds `is_locked` guard). Apply with `supabase db push`. Existing rows will have `locked_at = NULL` — no backfill needed.

## References

- S-02 plan (Realtime pattern): `context/changes/expense-balance-live/plan.md`
- API route pattern: `src/pages/api/auth/signout.ts`, `src/pages/api/groups/index.ts`
- Groups table schema: `supabase/migrations/20260609213602_initial_schema.sql:20–29`
- RLS UPDATE policy: `migration:125–127`
- Realtime publication: `migration:190–193`
- PRD refs: `context/foundation/prd-v3.md` (FR-015, FR-016)
- lessons.md: RLS silent 0-rows rule

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data & API Layer

#### Automated

- [x] 1.1 `supabase db push` applies migration with no errors — 21c56bc
- [x] 1.2 `npx tsc --noEmit` passes with zero errors — 21c56bc
- [x] 1.3 `npm run build` passes — 21c56bc

#### Manual

- [x] 1.4 `locked_at` column present in `groups`; existing rows have `locked_at = null` — 21c56bc
- [x] 1.5 `PATCH /api/groups/:id` with creator auth + `{ is_locked: true }` → `200`, `locked_at` set — 21c56bc
- [x] 1.6 `PATCH /api/groups/:id` with creator auth + `{ is_locked: false }` → `200`, `locked_at = null` — 21c56bc
- [x] 1.7 `PATCH /api/groups/:id` without auth → `401` — 21c56bc
- [x] 1.8 `PATCH /api/groups/:id` from non-creator → `403` — 21c56bc
- [x] 1.9 `POST /api/groups/:id/expenses` on locked group → `423` — 21c56bc
- [x] 1.10 `POST /api/groups/:id/expenses` on unlocked group → `201` (no regression) — 21c56bc
- [ ] 1.11 Invite link for a locked group → `/dashboard?error=group_locked`
- [ ] 1.12 Invite link for an unlocked group → join succeeds (no regression)

### Phase 2: UI Integration

#### Automated

- [x] 2.1 `npx tsc --noEmit` passes with zero errors
- [x] 2.2 `npm run lint` passes with no new errors
- [x] 2.3 `npm run build` passes

#### Manual

- [x] 2.4 Creator sees "Lock settlement" button; non-creators do not
- [x] 2.5 Creator locks → button label changes, banner appears with name and date, "Add expense" disabled
- [ ] 2.6 Non-creator tab updates within ~1 second via Realtime on lock
- [ ] 2.7 Creator unlocks → banner disappears, "Add expense" re-enabled; Realtime propagates
- [ ] 2.8 AddExpenseSheet open when Realtime lock fires → sheet auto-closes, banner visible
- [ ] 2.9 AddExpenseSheet submits to locked group → 423 inline error shown, sheet stays open
- [x] 2.10 `locked_at` date in banner matches lock time (YYYY-MM-DD)
- [x] 2.11 Non-creator cannot see or interact with the toggle button
