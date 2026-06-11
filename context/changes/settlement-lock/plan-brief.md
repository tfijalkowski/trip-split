# S-03: Zamknięcie i otwarcie rozliczenia — Plan Brief

> Full plan: `context/changes/settlement-lock/plan.md`

## What & Why

Enable the group creator to lock and unlock the settlement. When locked, no one can add expenses — the server enforces it (423) and the UI makes it obvious with a full-width banner and a disabled "Add expense" button. The lock state propagates in real time to all open tabs via Supabase Realtime.

## Starting Point

S-02 (expense-balance-live) is complete. The `groups` table already has `is_locked boolean` and `created_by uuid`. The `GroupExpensesIsland` already has one Realtime channel (`expenses:${groupId}`). Missing: `locked_at` column, `groups` in the Realtime publication, a PATCH endpoint, and all UI for the lock.

## Desired End State

Creator sees a single "Lock settlement" / "Unlock settlement" toggle button. On lock: full-width amber banner ("Settlement locked by [name] on [date]") appears for all members, "Add expense" disables, Realtime propagates to other tabs within ~1 second. Server-side: `POST /api/groups/[id]/expenses` returns 423 on a locked group. Unlocking reverses everything.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Lock UI | Full-width banner + locked_at timestamp | Visible to all members without interaction; timestamp answers "when?" | User |
| Realtime scope | Refetch group state only (UPDATE event payload) | Lock state is a single boolean + timestamp — payload is sufficient, no full refetch needed | User |
| Creator UX | Single toggle button (Lock / Unlock) | Simplest mental model; no confirmation dialog (accidental lock is trivially undoable) | User |
| locked_at storage | New `locked_at timestamptz` column | `is_locked` has no timestamp; separate column keeps nullability semantics clear | User |
| 423 UX in sheet | Show inline error, keep sheet open | User fills form, lock happens mid-fill — they need to see the error and dismiss manually | User |
| Creator check | Explicit SELECT before UPDATE | RLS silently returns 0 rows on non-creator UPDATE — rows-affected count is not a reliable auth signal | Plan / lessons.md |
| Date display | `.slice(0, 10)` | Avoids SSR hydration mismatches with locale-dependent `toLocaleDateString()` | Plan (S-02 precedent) |
| Realtime channel | Separate `group:${groupId}` | Must not rename existing `expenses:${groupId}` — that would break tested S-02 Realtime flow | Plan |

## Scope

**In scope:**
- `supabase/migrations/<timestamp>_settlement_lock.sql` — adds `locked_at timestamptz`, adds `groups` to Realtime publication
- `src/types.ts` — `locked_at: string | null` added to `Group` interface
- `src/pages/api/groups/[id].ts` (new) — PATCH endpoint for lock toggle with explicit creator check
- `src/pages/api/groups/[id]/expenses.ts` — 423 guard after membership check
- `src/pages/groups/[id].astro` — derive `isCreator`, `creatorName`; pass 4 new props to island
- `src/components/expenses/SettlementLockBanner.tsx` (new) — full-width amber banner
- `src/components/expenses/GroupExpensesIsland.tsx` — lock state, second Realtime channel, toggle handler, auto-close, disabled button
- `src/components/expenses/AddExpenseSheet.tsx` — 423 error handling

**Out of scope:**
- Expense edit/delete guards (S-04)
- Lock/unlock permissions for non-creators
- Confirmation dialog before locking
- Server-side pagination changes

## Architecture / Approach

Phase 1 lands the data contract: migration + type update + PATCH endpoint + 423 guard. These are independently testable via curl before any UI ships. Phase 2 wires the island: the Astro page derives `isCreator`/`creatorName` server-side, a new `group:${groupId}` Realtime channel listens for UPDATE events and patches local React state, and the `SettlementLockBanner` / toggle button / disabled "Add expense" button render conditionally from that state.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Data & API | Migration (`locked_at` + Realtime publication), PATCH endpoint, 423 guard in expense POST | RLS silent failure — must SELECT `created_by` before UPDATE, never trust rows-affected |
| 2. UI Integration | SettlementLockBanner, island lock state + Realtime channel, toggle button, auto-close, 423 error in sheet | `groups` must be in Realtime publication (Phase 1) or the second channel fires no events |

**Prerequisites:** S-02 complete; Phase 1 verified before starting Phase 2
**Estimated effort:** ~2 focused sessions across 2 phases
