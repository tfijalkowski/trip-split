# S-02: Dodawanie wydatku z podziałem + salda na żywo — Implementation Plan

## Overview

Deliver the north-star flow for TripSplit: an authenticated group member opens the group detail page, adds an expense with a split across participants, and immediately sees all members' net balances update without a page refresh. The expense list is paginated, filterable by payer, and sorted by date.

## Current State Analysis

What exists (confirmed by codebase audit, commit `e83faddc`):
- Astro SSR app with Google SSO (F-01 ✓) and DB schema + RLS + Realtime (F-02 ✓) in place
- S-01 assumed complete: `groups`, `group_members`, `profiles` tables exist with RLS
- `src/lib/supabase.ts` — SSR client only (`createClient(headers, cookies)`); no browser client
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard"]`; group routes not protected
- `src/components/ui/` — only `button.tsx`; no `table.tsx` or `sheet.tsx`
- `package.json` — no `@tanstack/react-table`, no `react-hook-form`, no `zod`
- `src/types.ts` — does not exist; no expense domain types defined
- `supabase/migrations/` — directory does not exist; F-02 was applied outside this repo

Missing for S-02:
- `member_balances` PostgreSQL VIEW for net-balance calculation
- `create_expense` PL/pgSQL RPC for atomic expense + participants insert
- `POST /api/groups/[id]/expenses` API route
- `src/pages/groups/[id].astro` — group detail page (SSR)
- React islands: `GroupExpensesIsland`, `BalancePanel`, `ExpenseTable`, `AddExpenseSheet`

## Desired End State

A logged-in group member navigates to `/groups/<id>`, sees the balance panel (net amount per person) and the expense list. Clicking "Add expense" opens a slide-over Sheet form. After submitting, the balance panel updates immediately — and any other member with the page open in another browser tab also sees the update via Supabase Realtime.

### Verification:
1. Open two browser sessions as two different group members
2. Add an expense in session A
3. Balance panel in session B updates within ~1 second without a refresh (Realtime criterion)
4. All split modes (equal, %, custom amount) validate correctly and produce correct grosze totals in the DB

### Key Discoveries:

- `src/pages/api/auth/signout.ts` — canonical API route pattern: `export const prerender = false`, uppercase verb export, `createClient(context.request.headers, context.cookies)`, redirect for errors
- `src/middleware.ts:4` — `PROTECTED_ROUTES` uses `startsWith` matching; adding `"/groups"` covers `/groups/*` pages but not `/api/groups/*` routes (API routes live under `/api/`)
- `astro.config.mjs:17-22` — existing `SUPABASE_URL`/`SUPABASE_KEY` are `context: "server", access: "secret"`; cannot be read in the browser; two new public vars needed
- `@supabase/ssr` is already installed — `createBrowserClient` import is available without adding a dependency
- `react-hook-form` and `zod` confirmed NOT installed (research.md said "likely present — verify" was incorrect)
- No existing React island with `useState`/`useEffect` — `GroupExpensesIsland` establishes the first pattern

## What We're NOT Doing

- Edit or delete expenses (S-04, separate change)
- Settlement lock/unlock (S-03, separate change)
- Server-side pagination — client-side TanStack is sufficient for trip-scale expense counts (dozens, not thousands)
- Filter by participant (any participant in expense) — targets `paid_by` (payer) only; the participant-filter variant requires a subquery and is not in scope
- Import from Revolut (FR-013, FR-014) — parked in roadmap
- Multi-currency support — all amounts in PLN grosze

## Implementation Approach

Three phases in strict dependency order:

1. **Infrastructure** — install packages, expose public env vars, create browser client, define types, add shadcn primitives, extend route protection. No business logic — pure scaffolding that later phases import.
2. **Data layer** — DB VIEW + atomic RPC migration, then the API route that calls the RPC. After this phase, expenses can be created and balances queried.
3. **UI** — Astro SSR page (initial data fetch + island mount) and four React components (Realtime, balance display, paginated table, form with 3 split modes).

The Astro page loads initial expenses and balances server-side and passes them as props to the React island. The island subscribes to Supabase Realtime and issues a full re-query of both expenses and balances on any `expenses` change event for the group. No optimistic updates — consistency beats speed at this scale.

All monetary values are stored and computed as **integer grosze** (1 PLN = 100 grosze). The form collects PLN floats, converts on submit; the UI formats grosze back to PLN for display.

## Critical Implementation Details

**Integer grosze conversion**: The form collects amounts as decimal PLN strings (e.g., "25.50"). Before submitting to the API, multiply by 100 and `Math.round()`. The API stores and returns grosze integers. Display divides by 100 and formats with `toFixed(2)`. Never store or compute with floating-point PLN.

**Atomic expense insert via RPC**: Supabase REST cannot insert into two tables atomically. Create a PL/pgSQL function `create_expense(...)` that inserts into `expenses` then `expense_participants` in a single transaction. The POST route calls `supabase.rpc('create_expense', {...})`. Without this, a failed participants insert leaves an orphaned expense row that silently corrupts `member_balances`.

**Zod split-mode refinement**: The three split modes share one form schema but need per-mode invariants checked with `.superRefine()`:
- `equal`: amounts are auto-computed server-side; validate that `participants` array is non-empty
- `percentage`: `participants.reduce(sum of percentages) === 100` (±0.01 tolerance for float input)
- `custom`: `participants.reduce(sum of PLN amounts) === total PLN amount` (±0.01 tolerance)

**Browser Supabase client**: `astro:env/client` vars are `undefined` during SSR in the Cloudflare Worker. `createBrowserClient()` must never be called at module load time or in server code — initialize it lazily inside the React island (a module-level `let` variable set on first call from a `useEffect`).

**Realtime subscription scope**: Subscribe only to `expenses` with `filter: 'group_id=eq.${groupId}'`. Do NOT subscribe to `expense_participants` separately — the RPC inserts both atomically, so the `expenses` INSERT event is sufficient to trigger the refetch. Subscribing to `expense_participants` without a group filter would fire for unrelated groups the user belongs to.

**paid_by filter**: The `paid_by` column stores a UUID. The filter `<select>` must show member display names but call `setFilterValue(uuid)` with the raw UUID. The column definition's `filterFn` must be `'equals'` (exact match), not the default text-contains function.

**`create_expense` RPC uses `SECURITY DEFINER`**: The RPC runs as the function owner (bypasses RLS for the INSERT statements). This is intentional — the API route enforces group membership before calling the RPC. The `member_balances` VIEW uses `SECURITY INVOKER` (default) so RLS applies normally when users query it.

---

## Phase 1: Infrastructure

### Overview

Install all new dependencies, expose Supabase public env vars for the browser, create the browser client utility, define shared types, add shadcn/ui primitives, and extend route protection. No business logic — pure scaffolding.

### Changes Required:

#### 1. Install npm dependencies

**File**: `package.json` (via npm install)

**Intent**: Add the three packages missing from the project that phases 2 and 3 depend on.

**Contract**: `npm install @tanstack/react-table react-hook-form zod`. All three must appear in `dependencies`.

#### 2. Install shadcn/ui table and sheet primitives

**File**: `src/components/ui/table.tsx`, `src/components/ui/sheet.tsx` (generated)

**Intent**: Generate the two shadcn/ui primitives that `ExpenseTable` and `AddExpenseSheet` will wrap.

**Contract**: `npx shadcn@latest add table sheet`. Follows the project's "new-york" style as configured in `components.json`.

#### 3. Add public env vars to Astro env schema

**File**: `astro.config.mjs`

**Intent**: Expose the Supabase URL and anon key to the browser bundle so React islands can create a Realtime client. The anon key is designed to be public; RLS enforces data access.

**Contract**: Add two fields to `env.schema` alongside the existing server-only vars:
```ts
PUBLIC_SUPABASE_URL: envField.string({ context: "client", access: "public", optional: true }),
PUBLIC_SUPABASE_ANON_KEY: envField.string({ context: "client", access: "public", optional: true }),
```

#### 4. Update .env.example

**File**: `.env.example`

**Intent**: Document the two new public vars so any developer setting up the project knows to populate them.

**Contract**: Add `PUBLIC_SUPABASE_URL=` and `PUBLIC_SUPABASE_ANON_KEY=` lines with a brief comment ("browser Supabase client / Realtime").

#### 5. Add createBrowserClient to src/lib/supabase.ts

**File**: `src/lib/supabase.ts`

**Intent**: Provide a browser-side Supabase client factory. `@supabase/ssr` is already installed and exports `createBrowserClient` — wrap it with the project's public env vars so callers don't need to import env vars directly.

**Contract**: Export a `createBrowserClient()` function that calls `createBrowserClient` from `@supabase/ssr` with `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` from `astro:env/client`. Alias the import to avoid the naming clash:
```ts
import { createBrowserClient as createSSRBrowserClient } from '@supabase/ssr'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from 'astro:env/client'

export function createBrowserClient() {
  return createSSRBrowserClient(PUBLIC_SUPABASE_URL!, PUBLIC_SUPABASE_ANON_KEY!)
}
```

#### 6. Update src/types.ts

**File**: `src/types.ts` (existing — ADD to, do NOT replace)

**Intent**: Add expense domain interfaces alongside the existing `Group` and `GroupMember` definitions. Merge the existing raw `GroupMember` (DB row shape) with the profile data needed by Phase 3 UI into a single canonical type so callers need only one import.

**Contract**: Keep the existing `Group` interface unchanged. Replace the existing `GroupMember` with the canonical merged shape, then add four new expense interfaces:
- `GroupMember`: `id` (uuid), `group_id` (uuid), `user_id` (uuid), `display_name` (string | null), `email` (string), `created_at` (ISO timestamp) — requires a JOIN of `group_members` with `profiles` when queried
- `Expense`: `id` (uuid string), `group_id`, `description`, `amount` (integer grosze), `paid_by` (user_id uuid), `expense_date` (ISO date string or null), `created_at` (ISO timestamp)
- `ExpenseParticipant`: `id`, `expense_id`, `user_id`, `amount_owed` (integer grosze)
- `ExpenseWithParticipants`: `Expense & { expense_participants: ExpenseParticipant[] }`
- `MemberBalance`: `user_id`, `group_id`, `total_owed`, `total_paid`, `net_balance` (all integer grosze)

**Note**: Any S-01 code that queries `group_members` and types the result as `GroupMember` now needs to JOIN `profiles` to satisfy the new shape. Check S-01 pages for raw `group_members` selects before implementing Phase 3.

### Success Criteria:

#### Automated Verification:

- `npm run build` completes without errors
- `npx tsc --noEmit` passes with zero errors
- `npm run lint` passes with no new errors
- `src/components/ui/table.tsx` and `src/components/ui/sheet.tsx` exist

#### Manual Verification:

- `package.json` lists `@tanstack/react-table`, `react-hook-form`, `zod` in `dependencies`
- `astro.config.mjs` env schema has `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` with `context: "client"`
- `.env.example` documents both public vars
- `src/lib/supabase.ts` exports `createBrowserClient()`
- `src/types.ts` exports all five types

**Implementation Note**: After this phase passes automated checks, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Data Layer

### Overview

Create the `member_balances` VIEW and `create_expense` RPC via a Supabase migration, then wire the API route that calls the RPC. After this phase, the entire data contract for S-02 is in place and testable independently of the UI.

### Changes Required:

#### 1. Create the expense_balance_layer migration

**File**: `supabase/migrations/<timestamp>_expense_balance_layer.sql` (new)

**Intent**: Define the `member_balances` VIEW and the `create_expense` RPC in one atomic migration. Both must land together because the RPC inserts the data that the VIEW reads.

**Contract** — Initialize with: `supabase migration new expense_balance_layer` (creates the `supabase/migrations/` directory if absent).

VIEW (SECURITY INVOKER — RLS applies when users query it):
```sql
CREATE OR REPLACE VIEW member_balances AS
SELECT
  ep.user_id,
  e.group_id,
  SUM(ep.amount_owed)                                             AS total_owed,
  SUM(CASE WHEN e.paid_by = ep.user_id THEN e.amount ELSE 0 END) AS total_paid,
  SUM(CASE WHEN e.paid_by = ep.user_id THEN e.amount ELSE 0 END)
    - SUM(ep.amount_owed)                                         AS net_balance
FROM expense_participants ep
JOIN expenses e ON ep.expense_id = e.id
GROUP BY ep.user_id, e.group_id;
```

RPC (SECURITY DEFINER — runs as function owner; group membership is enforced by the API route before calling this):
```sql
CREATE OR REPLACE FUNCTION create_expense(
  p_group_id     uuid,
  p_description  text,
  p_amount       integer,
  p_paid_by      uuid,
  p_participants jsonb,
  p_expense_date date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_expense_id uuid;
BEGIN
  INSERT INTO expenses (group_id, description, amount, paid_by, expense_date)
  VALUES (p_group_id, p_description, p_amount, p_paid_by,
          COALESCE(p_expense_date, CURRENT_DATE))
  RETURNING id INTO v_expense_id;

  INSERT INTO expense_participants (expense_id, user_id, amount_owed)
  SELECT v_expense_id,
         (p->>'user_id')::uuid,
         (p->>'amount_owed')::integer
  FROM jsonb_array_elements(p_participants) AS p;

  RETURN v_expense_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_expense(uuid, text, integer, uuid, jsonb, date)
  FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.create_expense(uuid, text, integer, uuid, jsonb, date)
  TO authenticated;
```

Apply to remote with `supabase db push`.

#### 2. Create POST /api/groups/[id]/expenses.ts

**File**: `src/pages/api/groups/[id]/expenses.ts` (new)

**Intent**: Accept a new expense submission, validate the caller's group membership, validate the split-sum invariant, and call `create_expense` RPC.

**Contract**:
- `export const prerender = false`
- `export const POST: APIRoute` — follows the `signout.ts` pattern
- Reads `context.params.id` as `groupId`
- Verifies `context.locals.user` exists → 401 if not
- Queries `group_members` for `(user_id = currentUser.id, group_id = groupId)` → 403 if no row
- Parses JSON body: `{ description: string, amount_grosze: number, paid_by: string, expense_date?: string, participants: Array<{ user_id: string, amount_owed: number }> }`
- Server-side validation: `amount_grosze` is a positive integer; `participants.length >= 1`; `sum(amount_owed) === amount_grosze` → 400 with error message if invalid
- Calls `supabase.rpc('create_expense', { p_group_id: groupId, p_description, p_amount: amount_grosze, p_paid_by, p_expense_date, p_participants: JSON.stringify(participants) })`
- Returns `201 { expense_id }` on success; `500` on RPC error

### Success Criteria:

#### Automated Verification:

- `supabase db push` applies migration with no errors
- `npm run build` still passes
- `npx tsc --noEmit` still passes

#### Manual Verification:

- `SELECT * FROM member_balances` in Supabase SQL editor returns rows after inserting test data manually
- Call `create_expense` RPC from SQL editor — both `expenses` and `expense_participants` rows appear in one transaction
- `POST /api/groups/:id/expenses` with valid body and auth cookie → `201`
- `POST /api/groups/:id/expenses` without auth cookie → `401`
- `POST /api/groups/:id/expenses` from a user not in the group → `403`
- `POST /api/groups/:id/expenses` with `sum(amount_owed) ≠ amount_grosze` → `400`
- After RPC call, `SELECT * FROM member_balances WHERE group_id = :id` shows correct updated balances

**Implementation Note**: Pause here for DB and API verification before building the UI in Phase 3.

---

## Phase 3: Group Detail Page & React Islands

### Overview

Build the Astro SSR page and the four React components. The Astro page handles the server-side data fetch and island mount; the island handles Realtime, state, and the three sub-components.

### Changes Required:

#### 1. Create src/pages/groups/[id].astro

**File**: `src/pages/groups/[id].astro` (new)

**Intent**: SSR entry point for the group detail view. Validates group membership, fetches the initial data set, and renders the client island.

**Contract**:
- Read `Astro.params.id` as `groupId`
- Verify `Astro.locals.user` (middleware ensures auth, but assert for type narrowing)
- Query `group_members` to confirm the current user belongs to this group → `return Astro.redirect('/dashboard')` if not
- Fetch `ExpenseWithParticipants[]`: `expenses` joined with `expense_participants`, ordered `expense_date desc`
- Fetch `MemberBalance[]`: `member_balances` filtered by `group_id`
- Fetch `GroupMember[]`: `group_members` joined with `profiles`, filtered by `group_id`
- Render `<GroupExpensesIsland client:load />` with props: `groupId`, `initialExpenses`, `initialBalances`, `members`, `currentUserId`

#### 2. Create src/components/expenses/GroupExpensesIsland.tsx

**File**: `src/components/expenses/GroupExpensesIsland.tsx` (new)

**Intent**: Top-level React island that owns all client-side state. Sets up the Realtime subscription, triggers refetches, and composes the three child components.

**Contract**:
- Props: `{ groupId: string, initialExpenses: ExpenseWithParticipants[], initialBalances: MemberBalance[], members: GroupMember[], currentUserId: string }`
- State: `expenses` (init from `initialExpenses`), `balances` (init from `initialBalances`), `sheetOpen: boolean`
- Module-level lazy singleton for the browser Supabase client (avoids recreating WebSocket on re-renders):
  ```ts
  let _supabase: ReturnType<typeof createBrowserClient> | null = null
  function getClient() { return (_supabase ??= createBrowserClient()) }
  ```
- On mount (`useEffect`): subscribe to `postgres_changes` on table `expenses`, event `*`, filter `group_id=eq.${groupId}`; call `refetch()` on any event
- `refetch()`: parallel fetch of `ExpenseWithParticipants[]` and `MemberBalance[]` using `getClient()`; update state
- On unmount: `supabase.removeChannel(channel)`
- Renders: `<BalancePanel />`, an "Add expense" `<Button>` that sets `sheetOpen(true)`, `<ExpenseTable />`, `<AddExpenseSheet open={sheetOpen} onOpenChange={setSheetOpen} onSuccess={refetch} />`

#### 3. Create src/components/expenses/BalancePanel.tsx

**File**: `src/components/expenses/BalancePanel.tsx` (new)

**Intent**: Display the net balance for each group member. Positive = owed money (green); negative = owes money (red); zero = settled (neutral).

**Contract**:
- Props: `{ balances: MemberBalance[], members: GroupMember[] }`
- For each member in `members`, find their balance by `user_id` (or treat as 0 if no row yet)
- Format grosze → PLN: `(net_balance / 100).toFixed(2) + " PLN"` with sign prefix (`+` / `−`)
- All members shown even if `net_balance === 0`

#### 4. Create src/components/expenses/ExpenseTable.tsx

**File**: `src/components/expenses/ExpenseTable.tsx` (new)

**Intent**: Paginated, payer-filterable, date-sorted expense list using TanStack Table v8 wrapped in the shadcn/ui `Table` primitive.

**Contract**:
- Props: `{ expenses: ExpenseWithParticipants[], members: GroupMember[] }`
- `createColumnHelper<ExpenseWithParticipants>()` with four columns:
  - `description`: plain string accessor
  - `amount`: accessor, cell formats grosze → PLN string
  - `expense_date`: accessor, cell formats as locale date; falls back to `created_at` date if null
  - `paid_by`: accessor returning UUID string; `filterFn: 'equals'`; cell renderer resolves UUID → member display name via `members` prop
- `useReactTable` with `getCoreRowModel()`, `getFilteredRowModel()`, `getSortedRowModel()`, `getPaginationRowModel()`
- Initial state: `sorting: [{ id: 'expense_date', desc: true }]`, `pagination: { pageIndex: 0, pageSize: 20 }`
- Filter UI: `<select>` above the table — `<option value="">All payers</option>` plus one option per member (display name shown, UUID as value); on change calls `table.getColumn('paid_by')?.setFilterValue(value || undefined)`
- Uses shadcn/ui `<Table>`, `<TableHeader>`, `<TableBody>`, `<TableRow>`, `<TableHead>`, `<TableCell>` from `@/components/ui/table`

#### 5. Create src/components/expenses/AddExpenseSheet.tsx

**File**: `src/components/expenses/AddExpenseSheet.tsx` (new)

**Intent**: shadcn/ui Sheet containing the add-expense form. Handles all three split modes (equal, percentage, custom amount) with react-hook-form + zod. On successful submit, closes the sheet and triggers a balance refetch.

**Contract**:
- Props: `{ open: boolean, onOpenChange: (v: boolean) => void, groupId: string, members: GroupMember[], currentUserId: string, onSuccess: () => void }`
- Zod schema:
  - `description`: `z.string().min(1).max(255)`
  - `amount`: `z.number().positive()` (PLN float)
  - `expense_date`: `z.string().optional()`
  - `paid_by`: `z.string().uuid()` (default: `currentUserId`)
  - `split_mode`: `z.enum(['equal', 'percentage', 'custom'])`
  - `participants`: `z.array(z.object({ user_id: z.string().uuid(), percentage: z.number().min(0).max(100).optional(), amount: z.number().min(0).optional() })).min(1)`
  - `.superRefine()` validates per-mode invariants (see Critical Implementation Details)
- Default values: all members selected, `split_mode: 'equal'`, `paid_by: currentUserId`
- On submit — grosze conversion and participant `amount_owed` computation:
  - `totalGrosze = Math.round(formValues.amount * 100)`
  - `equal`: `floorAmount = Math.floor(totalGrosze / n)`; participant[0] gets `floorAmount + (totalGrosze - floorAmount * n)`; others get `floorAmount`
  - `percentage`: floor+remainder — `amount_owed[i] = Math.floor(totalGrosze * pct[i] / 100)` for all participants, then `amount_owed[0] += totalGrosze - sum(amount_owed)` to absorb rounding remainder. Using independent `Math.round()` per participant can produce totals ≠ `totalGrosze`, which the API route rejects as 400.
  - `custom`: `amount_owed = Math.round(participant.amount * 100)`
  - POST body: `{ description, amount_grosze: totalGrosze, paid_by, expense_date, participants: [{ user_id, amount_owed }] }` to `/api/groups/${groupId}/expenses`
- On 201: `onSuccess()` then `onOpenChange(false)`
- On error: display message via the existing `ServerError` component pattern (`src/components/auth/ServerError.tsx`)

### Success Criteria:

#### Automated Verification:

- `npm run build` passes with zero TypeScript errors across all new files
- `npm run lint` passes with no errors

#### Manual Verification:

- `/groups/<valid-id>` loads for an authenticated member — balance panel and expense list visible
- `/groups/<invalid-id>` or access by a non-member → redirected to `/dashboard`
- `/groups/<id>` while unauthenticated → redirected to `/auth/signin`
- "Add expense" button opens the Sheet
- Equal split: form submits, expense appears in the list, balances update
- Percentage split where `sum ≠ 100%` → zod error shown, submit blocked
- Percentage split where `sum = 100%` → submits, balances update
- Custom amount split where `sum ≠ total` → zod error shown, submit blocked
- Custom amount split where `sum = total` → submits, balances update
- Payer filter `<select>` filters rows to the selected member; "All payers" resets
- Sorting by column header works; default is date descending
- Pagination controls navigate pages and change page size
- All amounts display as PLN (grosze ÷ 100, two decimal places) throughout
- **Two-session Realtime test**: balance panel in browser B updates within ~1 second after expense added in browser A — this is the north-star criterion; complete all other checks first, then run this last

**Implementation Note**: The two-session Realtime test is the final gate for S-02. Mark the phase complete only after it passes.

---

## Phase 4: Expense Total & Detail View

### Overview

Two UI enhancements discovered during manual testing of Phase 3: a running total sum in the expense list header (respects the payer filter) and a slide-over detail sheet opened by clicking any expense row.

### Changes Required:

#### 1. Expense total in ExpenseTable header

**File**: `src/components/expenses/ExpenseTable.tsx`

**Intent**: Show the sum of all currently filtered expenses above the table. When the payer filter is active, label the total with the member's name instead of "Total". Uses `table.getFilteredRowModel()` so the sum spans all pages, not just the visible one.

**Contract**: Compute `filteredTotal` from `table.getFilteredRowModel().rows` after `useReactTable`. Derive `filteredMember` from `memberMap` using the active filter UUID. Render `{filteredMember?.display_name ?? filteredMember?.email ?? "Total"}: {(filteredTotal / 100).toFixed(2)} PLN` in the header row alongside the payer `<select>`.

#### 2. Row click → expense detail

**File**: `src/components/expenses/ExpenseTable.tsx`

**Intent**: Add `selectedExpense` state and wire `onClick` on each `<TableRow>` to set it. Render `<ExpenseDetailSheet>` controlled by that state.

**Contract**: `useState<ExpenseWithParticipants | null>(null)`. Pass `open={selectedExpense !== null}` and `onOpenChange={(v) => { if (!v) setSelectedExpense(null); }}`. Import `ExpenseDetailSheet` from `./ExpenseDetailSheet`.

#### 3. Create ExpenseDetailSheet component

**File**: `src/components/expenses/ExpenseDetailSheet.tsx` (new)

**Intent**: Read-only slide-over Sheet showing all fields of an expense: description (title), date, total amount, payer name resolved from `members`, and the participant split as a list of name → amount rows.

**Contract**: Props `{ expense: ExpenseWithParticipants | null, members: GroupMember[], open: boolean, onOpenChange: (v: boolean) => void }`. Uses `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription` (required by Radix — set `className="sr-only"` to keep it visually hidden). Content renders only when `expense` is non-null. Resolves payer and each participant's display name via `memberMap`.

#### 4. Enable dark mode in Layout

**File**: `src/layouts/Layout.astro`

**Intent**: Activate shadcn/ui dark-mode CSS variables across the app. Without this, `bg-background` on `SheetContent` resolves to white (`:root` default), making white-on-white text invisible.

**Contract**: Add `class="dark"` to `<html lang="en">`. The `.dark` CSS selector in `global.css` sets `--background: oklch(0.145 0 0)` and all dark-variant tokens, which shadcn/ui components consume via `bg-background` / `text-foreground`.

### Success Criteria:

#### Automated Verification:

- `npx tsc --noEmit` passes with zero errors
- `npm run lint` passes with no new errors

#### Manual Verification:

- Total sum visible in the Expenses panel header; value equals sum of all filtered rows (not just current page)
- Switching the payer filter changes the total and updates the label to the selected member's name
- Clicking any expense row opens the detail Sheet from the right
- Detail Sheet shows: description, date, total PLN amount, payer name, and per-participant split amounts
- Detail Sheet closes via the × button or clicking the overlay

**Implementation Note**: Phase 4 is a pure UI addition — no DB or API changes. Mark complete after manual verification passes.

---

## Testing Strategy

### Unit Tests:

No test runner is configured (per `CLAUDE.md`). Validation logic lives in zod schemas, which are type-safe and exercised by the manual verification steps above.

### Integration Tests:

Not applicable at this stage.

### Manual Testing Steps:

1. Apply migration, verify `member_balances` VIEW with manual SQL inserts in Supabase dashboard
2. Verify `create_expense` RPC atomicity: confirm both `expenses` and `expense_participants` rows appear together; confirm no orphan if called with an invalid participant UUID
3. Test all three split modes end-to-end through the Sheet UI
4. Resize browser to mobile viewport — verify form and table are usable (PRD NFR: mobile-first)
5. Perform the two-session Realtime test as the final criterion

## Performance Considerations

Client-side TanStack pagination fetches all group expenses on page load. This is correct for TripSplit's target scale (3–10 people, one trip = dozens of expenses). If a group exceeds ~500 expenses in the future, switch to server-side pagination with `manualPagination: true`, `rowCount` from Supabase `count: 'estimated'`, and `.range()` queries — but this is not needed for MVP.

## Migration Notes

`supabase/migrations/` does not exist. Initialize with:
```
supabase migration new expense_balance_layer
```
This creates the directory and a timestamped `.sql` file. Paste the VIEW + RPC SQL, then apply with `supabase db push` (remote) or `supabase db reset` (local dev).

## References

- Research doc: `context/changes/expense-balance-live/research.md`
- TanStack Table v8 API: `context/changes/expense-balance-live/api-docs-tanstack-table.md`
- PRD: `context/foundation/prd-v3.md` (US-01, FR-006–010)
- API route pattern: `src/pages/api/auth/signout.ts`
- shadcn/ui table: `src/components/ui/table.tsx` (generated in Phase 1)

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Infrastructure

#### Automated

- [x] 1.1 `npm run build` completes without errors — e6c8a97
- [x] 1.2 `npx tsc --noEmit` passes with zero errors — e6c8a97
- [x] 1.3 `npm run lint` passes with no new errors — e6c8a97
- [x] 1.4 `src/components/ui/table.tsx` and `src/components/ui/sheet.tsx` exist — e6c8a97

#### Manual

- [x] 1.5 `package.json` lists `@tanstack/react-table`, `react-hook-form`, `zod` in `dependencies` — e6c8a97
- [x] 1.6 `astro.config.mjs` has `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` with `context: "client"` — e6c8a97
- [x] 1.7 `.env.example` documents both public vars — e6c8a97
- [x] 1.8 `src/lib/supabase.ts` exports `createBrowserClient()` — e6c8a97
- [x] 1.9 `src/types.ts` exports `Expense`, `ExpenseParticipant`, `MemberBalance`, `ExpenseWithParticipants`, and updated `GroupMember` (with `display_name`, `email`) — e6c8a97

### Phase 2: Data Layer

#### Automated

- [x] 2.1 `supabase db push` applies migration with no errors — 65f1301
- [x] 2.2 `SELECT * FROM member_balances` returns rows after test data inserted — 65f1301
- [x] 2.3 `npm run build` still passes — 65f1301
- [x] 2.4 `npx tsc --noEmit` still passes — 65f1301

#### Manual

- [x] 2.5 `create_expense` RPC inserts atomically — verified via Supabase SQL editor — 65f1301
- [x] 2.6 `POST /api/groups/:id/expenses` with valid auth + body → `201` — 65f1301
- [x] 2.7 `POST /api/groups/:id/expenses` without auth → `401` — 65f1301
- [x] 2.8 `POST /api/groups/:id/expenses` by non-member → `403` — 65f1301
- [x] 2.9 `POST /api/groups/:id/expenses` with mismatched participant sum → `400` — 65f1301
- [x] 2.10 `member_balances` shows updated balances after RPC call — 65f1301

### Phase 3: Group Detail Page & React Islands

#### Automated

- [x] 3.1 `npm run build` passes with zero TypeScript errors — 2f26ae0
- [x] 3.2 `npm run lint` passes with no errors — 2f26ae0

#### Manual

- [x] 3.3 `/groups/<valid-id>` loads for authenticated member — 2f26ae0
- [x] 3.4 `/groups/<invalid-id>` or non-member access → redirect to `/dashboard` — 2f26ae0
- [x] 3.5 Unauthenticated access to `/groups/<id>` → redirect to `/auth/signin` — 2f26ae0
- [x] 3.6 "Add expense" button opens the Sheet — 2f26ae0
- [x] 3.7 Equal split expense submits, expense appears, balances update — 2f26ae0
- [x] 3.8 Percentage split with `sum ≠ 100%` → zod error, submit blocked — 2f26ae0
- [x] 3.9 Percentage split with `sum = 100%` → submits, balances update — 2f26ae0
- [x] 3.10 Custom amount split with `sum ≠ total` → zod error, submit blocked — 2f26ae0
- [x] 3.11 Custom amount split with `sum = total` → submits, balances update — 2f26ae0
- [x] 3.12 Payer filter filters correctly; "All payers" resets — 2f26ae0
- [x] 3.13 Column sorting and pagination controls work — 2f26ae0
- [x] 3.14 All amounts display as PLN (grosze ÷ 100, two decimal places) — 2f26ae0
- [x] 3.15 Two-session Realtime test: balance updates in session B within ~1 second after add in session A — 2f26ae0

### Phase 4: Expense Total & Detail View

#### Automated

- [x] 4.1 `npx tsc --noEmit` passes with zero errors
- [x] 4.2 `npm run lint` passes with no new errors

#### Manual

- [x] 4.3 Total sum visible in header; equals sum of all filtered rows across all pages
- [x] 4.4 Payer filter changes total label to selected member's name
- [x] 4.5 Clicking an expense row opens the detail Sheet
- [x] 4.6 Detail Sheet shows description, date, amount, payer name, and per-participant split
- [x] 4.7 Detail Sheet closes via × or overlay click
