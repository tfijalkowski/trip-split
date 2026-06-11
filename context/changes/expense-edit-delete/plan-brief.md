# S-04: Edycja i usuwanie wydatku — Plan Brief

> Full plan: `context/changes/expense-edit-delete/plan.md`

## What & Why

Enable the expense payer (and the group creator) to correct or remove an expense. PRD FR-011 and FR-012 are marked nice-to-have but are part of the secondary success criterion ("możliwość edycji i usunięcia własnego wydatku po dodaniu"). Without this, a typo in amount or description requires a workaround (delete the whole group). The creator override addresses the case where a creator records an expense on behalf of another member and later needs to fix it.

## Starting Point

S-02 is complete. The expense list is live, balances update via Realtime, and `ExpenseDetailSheet` exists as a read-only view. RLS policies for payer UPDATE and DELETE already exist in the schema; `expense_participants` has ON DELETE CASCADE. No PATCH or DELETE API endpoints exist; `expense_participants` has no write RLS policies — all participant writes must go through a SECURITY DEFINER RPC.

## Desired End State

A payer (or the group creator) clicks an expense in the list and sees Edit and Delete buttons in the detail sheet. Edit switches the sheet to a pre-filled form (custom split mode, all stored amounts shown); saving updates the expense atomically for all tabs via Realtime. Delete shows an inline confirmation then removes the expense and updates balances. Members who are neither the payer nor the group creator see the detail sheet without Edit/Delete. Both operations return 423 when the group is locked.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Edit UX | Upgrade `ExpenseDetailSheet` with view/edit mode toggle | Single sheet keeps context; avoids open/close sequence of two separate sheets |
| Update mechanism | New `update_expense` RPC (SECURITY DEFINER) | `expense_participants` has no write RLS — must use SECURITY DEFINER for atomic participant replacement, same as `create_expense` |
| Delete confirmation | Inline confirmation within the sheet | Prevents accidental deletion that changes all members' balances with no undo |
| `paid_by` in edit | Read-only text (not editable) | RLS WITH CHECK requires `auth.uid() = paid_by` in the new row — changing payer to another member would silently fail |
| Lock guard | Explicit 423 checks in PATCH + DELETE | Consistent with POST; avoids ambiguous silent 0-rows from RLS when group is locked |
| Edit pre-population | `split_mode = "custom"` with stored grosze amounts | Original split mode is not persisted; custom mode faithfully represents what's stored |
| Success callback | Call `onSuccess` immediately after API response | Instant feedback for the acting user; Realtime handles other tabs independently |
| Creator override | Group creator can edit/delete any member's expense | Fixes the case where creator records an expense for someone else and needs to correct it; no new schema column required |
| Creator DELETE RLS | New `"expenses: creator delete (unlocked)"` policy | DELETE uses the authenticated session so RLS applies; PATCH goes through SECURITY DEFINER RPC so only API-level check needed |

## Scope

**In scope:**
- `supabase/migrations/<timestamp>_expense_edit_delete.sql` — `update_expense` SECURITY DEFINER RPC + `"expenses: creator delete (unlocked)"` RLS policy
- `src/pages/api/groups/[id]/expenses/[expenseId].ts` (new) — PATCH + DELETE handlers
- `src/components/expenses/ExpenseDetailSheet.tsx` — view/edit mode toggle, edit form, delete confirmation; `isGroupCreator` prop
- `src/components/expenses/ExpenseTable.tsx` — add `groupId`, `currentUserId`, `isGroupCreator`, `onSuccess` props
- `src/components/expenses/GroupExpensesIsland.tsx` — add `isGroupCreator` prop; wire all new props to ExpenseTable
- `src/pages/groups/[id].astro` — compute `isGroupCreator = user.id === group.created_by`; pass to island

**Out of scope:**
- Changing `paid_by` when editing (blocked by RLS; out of MVP scope)
- Editing or deleting expenses by a regular non-payer member (only payer + group creator can)
- Proactive lock UI in detail sheet (S-03 integration; 423 error handles it reactively)
- Undo for delete (Non-Goal per PRD)

## Architecture / Approach

Phase 1 lands the data contract: a `update_expense` RPC that atomically replaces expense + participants, a new RLS policy allowing the group creator to DELETE any expense, and two API handlers that verify membership → lock → ownership-or-creator before any mutation. Phase 2 upgrades `ExpenseDetailSheet` to dual-mode and wires four new props (`groupId`, `currentUserId`, `isGroupCreator`, `onSuccess`) from `[id].astro` down through the island and table. The existing `refetch` / Realtime subscription handles balance propagation to all tabs unchanged.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Data & API | `update_expense` RPC + creator DELETE policy; PATCH + DELETE endpoint with ownership-or-creator + lock guards | RPC is SECURITY DEFINER — API must verify ownership + lock explicitly; creator DELETE uses session RLS so policy is required |
| 2. UI Integration | Detail sheet edit/delete; `isGroupCreator` prop wired from Astro page | Edit form pre-population: split mode is not stored — must default to "custom" with stored amounts; reset mode to "view" on sheet close |

**Prerequisites:** S-02 complete  
**Estimated effort:** ~2 focused sessions across 2 phases

## Open Risks & Assumptions

- S-03 (settlement-lock) runs in parallel. If S-03 ships first and adds `groupLocked` to the island, edit/delete buttons can be proactively disabled. Until then, 423 handling in the sheet is the guard.
- `update_expense` RPC does no ownership check internally — relies entirely on the API route's prior verification. If ever called directly (e.g., from a future admin tool), it would update any expense without authorization.

## Success Criteria (Summary)

- Payer can edit description, amount, date, and split of their own expense; balance panel reflects the change for all members within ~1 second
- Payer can delete their own expense with confirmation; expense disappears for all members within ~1 second
- Group creator can edit or delete any member's expense (including ones they didn't pay for)
- Regular non-payer members see no Edit/Delete buttons in the detail sheet
