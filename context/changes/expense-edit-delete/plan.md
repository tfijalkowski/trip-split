# S-04: Edycja i usuwanie wydatku — Implementation Plan

## Overview

Allow the expense payer to edit and delete their own expense from within the expense detail sheet. The existing read-only `ExpenseDetailSheet` gains an edit mode (view ↔ edit toggle) and an inline delete confirmation. Both operations are enforced server-side with explicit ownership and settlement-lock checks.

## Current State Analysis

What exists (confirmed by codebase research):

- `expenses: payer update (unlocked)` RLS policy exists (`migration:152–163`): restricts UPDATE to `auth.uid() = paid_by AND is_group_member AND NOT is_locked`
- `expenses: payer delete (unlocked)` RLS policy exists (`migration:165–171`): same constraints for DELETE
- `expense_participants` has `ON DELETE CASCADE` on `expense_id` (`migration:51`) — deleting an expense auto-removes all its participants; no manual cleanup needed
- `expense_participants` has **no INSERT/UPDATE/DELETE RLS policies** — only SELECT. Direct participant writes silently fail; all writes go through `SECURITY DEFINER` RPCs. This is why `create_expense` is SECURITY DEFINER — the same pattern is required for `update_expense`.
- `create_expense` RPC is SECURITY DEFINER (`20260610182008_expense_balance_layer.sql:33`) — bypasses RLS. `update_expense` will be SECURITY DEFINER for the same reason.
- No PATCH or DELETE expense endpoints exist in `src/pages/api/`
- `ExpenseDetailSheet` (`src/components/expenses/ExpenseDetailSheet.tsx`) is currently read-only; receives `expense`, `members`, `open`, `onOpenChange`
- `ExpenseTable` manages `selectedExpense` state internally and renders `ExpenseDetailSheet` — needs `groupId`, `currentUserId`, `onSuccess` (refetch) added as props
- `GroupExpensesIsland` has `groupId`, `currentUserId`, `members`, and `refetch` — all needed props already live here
- `AddExpenseSheet` contains all split-mode form logic (equal / percentage / custom) — edit form mirrors this, pre-filled in "custom" mode with stored grosze amounts
- The RLS UPDATE policy's `WITH CHECK (auth.uid() = paid_by)` means `paid_by` cannot be changed to another member — the API enforces this by locking that field; the edit form shows `paid_by` as read-only text

Missing for S-04:

- `update_expense` PL/pgSQL RPC (SECURITY DEFINER: UPDATE expenses + DELETE+INSERT participants atomically)
- `PATCH /api/groups/[id]/expenses/[expenseId]` endpoint
- `DELETE /api/groups/[id]/expenses/[expenseId]` endpoint
- Edit mode + delete confirmation in `ExpenseDetailSheet`
- Prop wiring from `GroupExpensesIsland` → `ExpenseTable` → `ExpenseDetailSheet`

## Desired End State

The payer (or group creator) opens an expense from the list, sees Edit and Delete buttons in the detail sheet. Clicking Edit switches the sheet to a pre-filled form (description, amount, date, split pre-loaded from stored values in custom mode; paid_by shown as read-only text). Saving updates the expense atomically; all members see refreshed balances within ~1 second via existing Realtime subscription. Clicking Delete shows an inline confirmation; confirming removes the expense and updates balances. Members who are neither the payer nor the group creator see the detail sheet without Edit/Delete buttons. All operations return 423 when the group is locked.

### Key Discoveries

- `expense_participants` ON DELETE CASCADE: `supabase/migrations/20260609213602_initial_schema.sql:51`
- RLS payer update + delete policies: `migration:152–171`
- No participant INSERT/UPDATE/DELETE policies — SECURITY DEFINER RPC required: `migration:178–187`
- `create_expense` SECURITY DEFINER pattern to follow: `20260610182008_expense_balance_layer.sql:33`
- `ExpenseTable` manages `selectedExpense` state + renders `ExpenseDetailSheet`: `src/components/expenses/ExpenseTable.tsx`
- `GroupExpensesIsland` props interface (groupId, currentUserId, members, refetch): `src/components/expenses/GroupExpensesIsland.tsx:14–20`
- Astro routing: `expenses.ts` (POST) and `expenses/[expenseId].ts` (PATCH+DELETE) coexist safely — different segment counts

## What We're NOT Doing

- Editing `paid_by` — the RLS WITH CHECK blocks it; the field is read-only in edit mode
- Editing or deleting another member's expense for regular members — only the payer and the group creator can edit/delete a given expense
- Showing edit/delete when the group is locked proactively in the UI (that's S-03 integration; S-04 handles it reactively via 423)
- Undo for delete — Non-Goal per PRD FR-012; balance change is visible in the app
- Bulk delete
- Editing `group_id` or `expense_id` metadata

## Implementation Approach

Two phases in dependency order:

1. **Data & API** — new `update_expense` RPC in a migration; single new file `expenses/[expenseId].ts` exports both `PATCH` and `DELETE` handlers with explicit ownership + lock checks.
2. **UI** — `ExpenseDetailSheet` grows a mode state, an edit form (mirrors `AddExpenseSheet` logic, pre-fills in custom split mode), and inline delete confirmation; `ExpenseTable` and `GroupExpensesIsland` get new prop wiring.

## Critical Implementation Details

**`update_expense` bypasses RLS — API must verify ownership and lock status before calling it.** The RPC is SECURITY DEFINER and runs as the function owner (postgres). Neither the `expenses: payer update (unlocked)` policy nor the participant policies fire inside the RPC. The PATCH handler must: SELECT `is_locked, created_by` from `groups` and `paid_by` from `expenses`, then confirm `(paid_by === user.id || created_by === user.id) && !is_locked`, then call the RPC.

**Group creator DELETE also needs a new RLS policy.** PATCH calls the SECURITY DEFINER RPC so RLS on `expenses` does not apply. But DELETE uses the authenticated Supabase session client directly — RLS does apply. The existing `expenses: payer delete (unlocked)` policy only allows `auth.uid() = paid_by`. A second policy `"expenses: creator delete (unlocked)"` must allow DELETE when `auth.uid() = group.created_by AND NOT is_locked`. Without it the creator's DELETE silently returns 0 rows even after the API's authorization check.

**Edit form pre-population in custom split mode:** The stored `expense_participants` have `amount_owed` in grosze — the original split mode (equal/percentage/custom) is not persisted. Pre-populate `split_mode = "custom"` and `customAmounts = { [user_id]: (amount_owed / 100).toFixed(2) }` for every existing participant. The user may switch modes freely in the form; the validation logic is the same as `AddExpenseSheet`.

**`update_expense` RETURNS void — check only `rpcError`, not `!data`.** Unlike `create_expense` which returns the new expense `uuid`, `update_expense` returns void. The Supabase client sets `data = null` for void functions. If the PATCH handler copies the POST handler's `if (rpcError || !expenseId)` guard, `!data` is always `true` → always 500. For PATCH, the correct check is `if (rpcError)` only.

**Two Realtime events, one refetch:** After a successful PATCH or DELETE, the API route calls `onSuccess` (refetch) immediately. The existing `expenses` Realtime subscription will also fire (triggering another refetch). Both are harmless at trip scale — refetch is idempotent.

---

## Phase 1: Data & API Layer

### Overview

Add the `update_expense` RPC via a new migration and create the `[expenseId].ts` route with PATCH and DELETE handlers. After this phase the data contract is complete and testable independently of the UI.

### Changes Required:

#### 1. Create the expense_edit_delete migration

**File**: `supabase/migrations/<timestamp>_expense_edit_delete.sql` (new, via `supabase migration new expense_edit_delete`)

**Intent**: Add `update_expense` as a SECURITY DEFINER function that atomically updates the `expenses` row and replaces all `expense_participants` in a single transaction. Mirrors the `create_expense` RPC pattern.

**Contract**:

```sql
CREATE OR REPLACE FUNCTION public.update_expense(
  p_expense_id   uuid,
  p_description  text,
  p_amount       integer,
  p_expense_date date,
  p_participants jsonb  -- [{"user_id": "...", "amount_owed": N}, ...]
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.expenses
     SET description  = p_description,
         amount       = p_amount,
         expense_date = p_expense_date
   WHERE id = p_expense_id;

  DELETE FROM public.expense_participants WHERE expense_id = p_expense_id;

  INSERT INTO public.expense_participants (expense_id, user_id, amount_owed)
  SELECT p_expense_id,
         (elem->>'user_id')::uuid,
         (elem->>'amount_owed')::integer
    FROM jsonb_array_elements(p_participants) AS elem;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.update_expense(uuid, text, integer, date, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_expense(uuid, text, integer, date, jsonb) TO authenticated;

-- Allow group creator to DELETE any expense in their group (payer delete policy already exists)
CREATE POLICY "expenses: creator delete (unlocked)"
  ON public.expenses
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_id
        AND g.created_by = auth.uid()
        AND NOT g.is_locked
    )
  );
```

Apply with `supabase db push`.

#### 2. Create PATCH + DELETE /api/groups/[id]/expenses/[expenseId].ts

**File**: `src/pages/api/groups/[id]/expenses/[expenseId].ts` (new)

**Intent**: Handle expense edit (PATCH) and expense delete (DELETE) for the authenticated payer. Both handlers share ownership and lock-status verification; PATCH additionally validates the request body and calls the `update_expense` RPC.

**Contract**:

`export const prerender = false`

Both handlers follow the same guard sequence:
0. Supabase client present → 500 if missing (matches POST pattern; never happens in practice)
1. Auth → 401 if no user
2. Extract `groupId` from `context.params.id`, `expenseId` from `context.params.expenseId` → 400 if missing
3. Membership check: SELECT from `group_members` WHERE `group_id = groupId AND user_id = user.id` → 403 if not a member
4. Group meta check: SELECT `is_locked, created_by` from `groups` WHERE `id = groupId` → 423 `{ error: "Group settlement is locked" }` if locked
5. Ownership check: SELECT `id, paid_by` from `expenses` WHERE `id = expenseId AND group_id = groupId` → 404 if not found, 403 if `paid_by !== user.id AND created_by !== user.id` (group creator may edit/delete any expense)

`PATCH` additionally:
- Parses JSON body: same fields and validation as `POST /api/groups/[id]/expenses` (description, amount_grosze, expense_date, participants) — no `paid_by` field (locked)
- Calls `supabase.rpc("update_expense", { p_expense_id: expenseId, p_description, p_amount: amount_grosze, p_expense_date: expense_date ?? null, p_participants: participants })`
- Returns `200 {}` on success; `500` on RPC error

`DELETE`:
- After ownership verified: `supabase.from("expenses").delete().eq("id", expenseId).select("id")` (CASCADE removes participants; `.select("id")` returns the deleted row so we can detect silent RLS rejection)
- If `error` → `500`. If `data?.length === 0` and no error → `423 { error: "Group settlement is locked" }` (group was locked between the lock check and the actual delete). Otherwise → `200 {}`

### Success Criteria:

#### Automated Verification:

- `supabase db push` applies migration with no errors
- `npx tsc --noEmit` passes with zero errors
- `npm run build` passes

#### Manual Verification:

- `PATCH /api/groups/:id/expenses/:expenseId` with payer auth + valid body → `200`
- `PATCH` with group creator auth on another member's expense → `200`
- `PATCH` with non-payer, non-creator auth (regular member) → `403`
- `PATCH` without auth → `401`
- `PATCH` on a locked group → `423`
- `DELETE /api/groups/:id/expenses/:expenseId` with payer auth → `200`; expense and all participants gone from DB
- `DELETE` with group creator auth on another member's expense → `200`; expense and participants gone
- `DELETE` with non-payer, non-creator auth → `403`
- `DELETE` on a locked group → `423`

**Implementation Note**: After Phase 1 manual verification passes, proceed to Phase 2.

---

## Phase 2: UI Integration

### Overview

Upgrade `ExpenseDetailSheet` to support view/edit mode toggle, an edit form pre-filled in custom split mode, and inline delete confirmation. Wire the required new props (`groupId`, `currentUserId`, `onSuccess`) from `GroupExpensesIsland` through `ExpenseTable` to `ExpenseDetailSheet`.

### Changes Required:

#### 1. Upgrade src/components/expenses/ExpenseDetailSheet.tsx

**File**: `src/components/expenses/ExpenseDetailSheet.tsx`

**Intent**: Transform the read-only detail view into a dual-mode sheet. Payers see Edit and Delete buttons in view mode. Clicking Edit switches to an editable form; clicking Delete shows an inline confirmation.

**Contract**:

Props interface gains: `groupId: string`, `currentUserId: string`, `isGroupCreator: boolean`, `onSuccess: () => void`

New state:
- `mode: "view" | "edit"` — init `"view"`, reset to `"view"` on `expense` change
- `confirmingDelete: boolean` — init `false`
- `serverError: string | null`
- Form state mirroring `AddExpenseSheet`: `description`, `amount`, `expense_date`, `splitMode`, `participantIds` (Set\<string\>), `customAmounts` (Record\<string, string\>), `percentages` (Record\<string, string\>), `isSubmitting`

`canEdit = expense?.paid_by === currentUserId || isGroupCreator`

**Entering edit mode** (on "Edit" button click): populate form state from `expense`:
- `description = expense.description`
- `amount = (expense.amount / 100).toFixed(2)` (string for the input)
- `expense_date = expense.expense_date ?? ""`
- `splitMode = "custom"`
- `participantIds = new Set(expense.expense_participants.map(p => p.user_id))`
- `customAmounts = Object.fromEntries(expense.expense_participants.map(p => [p.user_id, (p.amount_owed / 100).toFixed(2)]))`
- `percentages = {}`

**View mode render** (when `mode === "view"`): existing detail layout unchanged. If `canEdit`, add a footer row with "Edit" button (sets `mode = "edit"`) and "Delete" button. Delete button: if `confirmingDelete`, show "Confirm? [Cancel] [Delete]" inline; otherwise show "Delete" button.

**Delete flow** (when user confirms): call `PATCH` ... wait no. Call `DELETE /api/groups/${groupId}/expenses/${expense.id}`. On 423: `setServerError("Settlement is locked")`, `setConfirmingDelete(false)`. On success: `onSuccess()`, `onOpenChange(false)`.

**Edit mode render** (when `mode === "edit"`): same form layout as `AddExpenseSheet` except:
- `paid_by` is shown as read-only text (the member's display_name / email from `members`), not a select dropdown
- Split mode select + participant checkboxes + inline amount/percentage inputs — same logic as `AddExpenseSheet`
- Footer: "Save changes" button (submitting) + "Cancel" button (sets `mode = "view"`, clears error)

**Edit submit**: validate (same rules as `AddExpenseSheet` — description required, amount positive, participants non-empty, split sums correct). Call `PATCH /api/groups/${groupId}/expenses/${expense.id}` with body `{ description, amount_grosze, expense_date, participants }`. On 423: show "Settlement was locked while you were editing". On success: `onSuccess()`, `onOpenChange(false)`.

Reset `mode` to `"view"`, `confirmingDelete` to `false`, and clear all form/error state (`serverError = null`, form fields to defaults) when the sheet closes (`onOpenChange(false)`).

#### 2. Update src/components/expenses/ExpenseTable.tsx

**File**: `src/components/expenses/ExpenseTable.tsx`

**Intent**: Pass the three new props required by `ExpenseDetailSheet` through `ExpenseTable`.

**Contract**: Add `groupId: string`, `currentUserId: string`, `isGroupCreator: boolean`, `onSuccess: () => void` to the `Props` interface. Forward them verbatim to `<ExpenseDetailSheet>`.

#### 3. Update src/components/expenses/GroupExpensesIsland.tsx

**File**: `src/components/expenses/GroupExpensesIsland.tsx`

**Intent**: Accept `isGroupCreator` from the Astro page and forward it plus the three existing values to `<ExpenseTable>`.

**Contract**: Add `isGroupCreator: boolean` to the island's Props interface. Add `groupId={groupId}`, `currentUserId={currentUserId}`, `isGroupCreator={isGroupCreator}`, `onSuccess={refetch}` to the `<ExpenseTable>` JSX.

#### 4. Update src/pages/groups/[id].astro

**File**: `src/pages/groups/[id].astro`

**Intent**: Compute `isGroupCreator` server-side and pass it to the island. The `group` object is already fetched with `select("*")` which includes `created_by`.

**Contract**:
```ts
const isGroupCreator = user.id === group.created_by;
```
Pass `isGroupCreator={isGroupCreator}` to `<GroupExpensesIsland>`.

### Success Criteria:

#### Automated Verification:

- `npx tsc --noEmit` passes with zero errors
- `npm run lint` passes with no new errors
- `npm run build` passes

#### Manual Verification:

- Clicking any expense row opens the detail sheet with read-only info
- Payer's own expense shows "Edit" and "Delete" buttons; group creator sees "Edit" and "Delete" on any expense; a regular non-payer member sees neither
- Clicking "Edit" switches the sheet to a form pre-filled with the existing values (description, amount, date); split mode is "custom" with actual per-participant amounts
- `paid_by` is displayed as the member's name, not an editable dropdown
- Saving a valid edit closes the sheet, updates the expense in the list, and refreshes balances within ~1 second
- Realtime propagates the edit to other open tabs
- Clicking "Delete" shows inline confirmation; clicking "Cancel" returns to view mode
- Confirming delete closes the sheet, removes the expense from the list, and refreshes balances
- Realtime propagates the delete to other open tabs
- Editing an expense on a locked group (stale UI) → 423 inline error shown; sheet stays open in edit mode
- Deleting on a locked group → 423 inline error shown in view mode
- Group creator (non-payer) can edit another member's expense: detail sheet shows Edit + Delete; saving the edit → 200 and balance refresh
- Group creator (non-payer) can delete another member's expense: confirming delete → 200, expense removed from list, balances refresh

**Implementation Note**: The two-tab Realtime test (edit/delete in tab A → balance panel updates in tab B within ~1 s) is the final gate for S-04.

---

## Testing Strategy

### Unit Tests

No test runner is configured (per `CLAUDE.md`). Logic validated through manual verification.

### Manual Testing Steps

1. Verify Phase 1 API endpoints with browser dev tools or curl before building UI
2. Open group as the payer in tab A and as another member in tab B
3. Edit an expense in tab A — verify tab B balances update within ~1 second
4. Delete an expense in tab A — verify it disappears in tab B and balances update
5. As non-payer (tab B): click an expense row and confirm no Edit/Delete buttons appear
6. Lock the group (S-03, if implemented), then try to edit/delete — verify 423 error appears inline

## Performance Considerations

`update_expense` RPC does one UPDATE + one DELETE (batch) + one INSERT batch — all within one PL/pgSQL transaction. At trip scale (dozens of expenses, single-digit participants per expense) this is negligible.

The PATCH + DELETE handlers each add two extra SELECT queries (membership + lock check) above the minimum. Identical pattern to the existing POST handler. No concern at this scale.

## Migration Notes

Run `supabase migration new expense_edit_delete` to create the timestamped file, paste both SQL statements: the `CREATE OR REPLACE FUNCTION update_expense` RPC and the `CREATE POLICY "expenses: creator delete (unlocked)"` policy. Apply with `supabase db push`. No schema changes (no new columns or tables) — this migration adds one function and one RLS policy.

## References

- `create_expense` pattern: `supabase/migrations/20260610182008_expense_balance_layer.sql`
- RLS payer policies: `supabase/migrations/20260609213602_initial_schema.sql:152–171`
- CASCADE DELETE: `migration:51`
- `AddExpenseSheet` (form logic to mirror): `src/components/expenses/AddExpenseSheet.tsx`
- `ExpenseDetailSheet` (file to upgrade): `src/components/expenses/ExpenseDetailSheet.tsx`
- API route pattern: `src/pages/api/groups/[id]/expenses.ts`
- PRD refs: FR-011, FR-012

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data & API Layer

#### Automated

- [ ] 1.1 `supabase db push` applies migration with no errors
- [ ] 1.2 `npx tsc --noEmit` passes with zero errors
- [ ] 1.3 `npm run build` passes

#### Manual

- [ ] 1.4 `PATCH /api/groups/:id/expenses/:expenseId` with payer auth + valid body → `200`
- [ ] 1.5 `PATCH` with group creator auth on another member's expense → `200`
- [ ] 1.6 `PATCH` with non-payer, non-creator auth → `403`
- [ ] 1.7 `PATCH` without auth → `401`
- [ ] 1.8 `PATCH` on a locked group → `423`
- [ ] 1.9 `DELETE /api/groups/:id/expenses/:expenseId` with payer auth → `200`; expense and participants gone
- [ ] 1.10 `DELETE` with group creator auth on another member's expense → `200`; expense and participants gone
- [ ] 1.11 `DELETE` with non-payer, non-creator auth → `403`
- [ ] 1.12 `DELETE` on a locked group → `423`

### Phase 2: UI Integration

#### Automated

- [ ] 2.1 `npx tsc --noEmit` passes with zero errors
- [ ] 2.2 `npm run lint` passes with no new errors
- [ ] 2.3 `npm run build` passes

#### Manual

- [ ] 2.4 Clicking any expense row opens detail sheet with read-only info
- [ ] 2.5 Payer's expense shows Edit + Delete; group creator sees Edit + Delete on any expense; regular non-payer member sees neither
- [ ] 2.6 Edit form opens pre-filled with existing values; split mode is custom with actual amounts
- [ ] 2.7 paid_by displayed as member name, not editable dropdown
- [ ] 2.8 Saving a valid edit closes sheet, updates expense in list, refreshes balances
- [ ] 2.9 Realtime propagates edit to other open tabs within ~1 second
- [ ] 2.10 Delete shows inline confirmation; Cancel returns to view mode
- [ ] 2.11 Confirming delete closes sheet, removes expense, refreshes balances
- [ ] 2.12 Realtime propagates delete to other open tabs within ~1 second
- [ ] 2.13 Editing on locked group → 423 inline error; sheet stays open
- [ ] 2.14 Deleting on locked group → 423 inline error in view mode
- [ ] 2.15 Group creator (non-payer) can edit another member's expense → 200, balance refresh
- [ ] 2.16 Group creator (non-payer) can delete another member's expense → 200, expense removed, balance refresh
