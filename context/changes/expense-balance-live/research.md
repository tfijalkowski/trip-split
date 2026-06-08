---
change_id: expense-balance-live
type: research
created: 2026-06-08
sources: Supabase docs, Cloudflare Workers docs, GitHub reference projects, makerkit.dev
last_updated: 2026-06-08
last_updated_note: "Follow-up: codebase compatibility audit for api-docs-tanstack-table.md vs installed deps"
---

# Research: S-02 Library & Solution Survey

## 1. Live Balance Updates — Supabase Realtime

Two approaches in the Supabase docs:

| Approach | Setup cost | Scale | Recommended for |
|---|---|---|---|
| `postgres_changes` | Low — `ALTER PUBLICATION supabase_realtime ADD TABLE expenses` | Good for small groups (3–10 users) | **MVP / TripSplit** |
| Broadcast via DB trigger (`realtime.broadcast_changes`) | Higher — trigger + private channel + RLS on `realtime.messages` | Production-scale | Post-MVP |

**Decision: `postgres_changes`** on `expenses` and `expense_participants`. Sufficient for the group sizes TripSplit targets, minimal setup.

React pattern: `useEffect` sets up the channel, `useReducer` handles INSERT/UPDATE/DELETE events to update local state without a full re-fetch.

```ts
// Inside a React island
useEffect(() => {
  const channel = supabase
    .channel(`group-expenses:${groupId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'expenses', filter: `group_id=eq.${groupId}` },
      () => refetchBalances()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'expense_participants' },
      () => refetchBalances()
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}, [groupId])
```

**Cloudflare Workers compatibility:** Realtime subscriptions run in the **browser** (client-side React island), not in the Worker. The Worker only does SSR — the browser connects directly to Supabase Realtime over WebSocket. No Cloudflare Workers restriction applies here.

Note: `@supabase/realtime-js` v2.16.0 fixed edge-runtime WebSocket detection failures (supabase-js PR #1529). Keep `@supabase/supabase-js` current.

**Critical prerequisite (from roadmap risk):** F-02 must enable `supabase_realtime` publication on `expenses` and `expense_participants`. Without it, `postgres_changes` subscriptions connect but never fire — no error, just silence.

---

## 2. Balance Calculation — SQL View vs App Code

**Decision: PostgreSQL VIEW.** Automatically consistent, queryable via Supabase REST with RLS applied, no app-layer synchronisation needed. No materialized view needed at MVP scale (small groups, infrequent writes).

Canonical pattern:

```sql
CREATE OR REPLACE VIEW member_balances AS
SELECT
  ep.user_id,
  e.group_id,
  SUM(ep.amount_owed)                                                AS total_owed,
  SUM(CASE WHEN e.paid_by = ep.user_id THEN e.amount ELSE 0 END)    AS total_paid,
  SUM(CASE WHEN e.paid_by = ep.user_id THEN e.amount ELSE 0 END)
    - SUM(ep.amount_owed)                                            AS net_balance
FROM expense_participants ep
JOIN expenses e ON ep.expense_id = e.id
GROUP BY ep.user_id, e.group_id;
```

On a Realtime event (any change to `expenses`/`expense_participants`), the React component re-fetches:

```ts
supabase
  .from('member_balances')
  .select('*')
  .eq('group_id', groupId)
```

**Why not app-code calculation:**
- Risk of stale data between concurrent sessions
- Floating-point precision bugs (see cents note below)
- More state to synchronise across components

**Integer cents rule:** Store amounts as `INTEGER` (PLN grosze — 1 PLN = 100) in the DB. All arithmetic stays in integers. Multiple reference projects (SplitSimple, splitease) burned time on floating-point rounding — avoid by design.

---

## 3. Expense List — Pagination & Filtering

**`@tanstack/react-table` + shadcn/ui DataTable** is the standard pattern for this stack. Confirmed by:
- `thisisfel1x/supabase-shadcn-database-example` (Supabase + TanStack + shadcn/ui, SSR)
- `nainglinnkhant/shadcn-view-table` (Supabase + TanStack + shadcn/ui + server-side sort/filter)
- makerkit.dev pagination guide (Supabase `.range()` + TanStack `manualPagination`)

Supabase query pattern:

```ts
// Server-side pagination + optional filter by payer + date sort
supabase
  .from('expenses')
  .select('*, expense_participants(*)', { count: 'estimated' })
  .eq('group_id', groupId)
  .eq('paid_by', filterUserId)          // optional; omit when no filter active
  .order('expense_date', { ascending: false })
  .range(from, to)                       // offset pagination
```

- Use `count: 'estimated'` — fast (uses PG statistics), accurate enough for pagination controls
- `manualPagination: true` in TanStack Table — delegate page state to the server query
- New dependency: `@tanstack/react-table` (not currently in the project)

**Filter by participant (not payer):** Filtering "show expenses where person X participated" requires filtering on `expense_participants.user_id`, not a simple `.eq()` on `expenses`. Options:
  - Supabase `.filter()` on the joined relation: `.eq('expense_participants.user_id', userId)`
  - Or a separate subquery / RPC

Scope this carefully in the plan — it adds complexity over filter-by-payer.

---

## 4. Split Expense Form — UI & Validation

**`react-hook-form` + `zod`** — shadcn/ui forms already use this pattern; no new dependency beyond confirming both are installed.

Split modes and validation rules:

| Mode | Calculation | Zod validation |
|---|---|---|
| Equal | `Math.floor(totalCents / n)` per person; remainder → first participant | — (auto-computed, not user input) |
| Percentage | user inputs % per person | `sum === 100` refinement |
| Custom amount | user inputs cents per person | `sum === totalCents` refinement |

Integer cents rule applies here too — never divide PLN floats, always work in grosze.

Reference project closest to TripSplit's stack: `anshtrivediaiml/SplitEasy` (Next.js + Supabase + shadcn/ui, equal/custom/percentage splits, `ALTER PUBLICATION supabase_realtime ADD TABLE expense_splits`).

---

## 5. Recommended Library Set

| Area | Library / Approach | New dependency? |
|---|---|---|
| Realtime | `@supabase/supabase-js` `postgres_changes` | No |
| Balance calculation | PostgreSQL VIEW, re-fetched on Realtime event | No |
| Expense table | `@tanstack/react-table` + shadcn/ui DataTable | **Yes** |
| Form + validation | `react-hook-form` + `zod` | Likely already present — verify |
| Split state in form | `useReducer` in the expense form island | No |
| Cent-safe arithmetic | Native JS integers (store as `INTEGER` in DB) | No |

Only one net-new package: `@tanstack/react-table`.

---

## 6. Key Risks Surfaced

1. **Realtime silent failure** — `postgres_changes` fires only if the tables are added to the `supabase_realtime` publication in F-02. No error if missing. Mitigation: test subscription from two separate browser sessions before closing the slice (per roadmap risk note).

2. **Filter by participant complexity** — filtering the expense list by "person X participated" requires a subquery on `expense_participants`, not a simple column filter. Decide in the plan whether to support this for v1 or start with filter-by-payer only.

3. **Floating-point rounding** — store all monetary values as `INTEGER` (grosze). Multiple split-expense reference projects identified this as a source of bugs when using `DECIMAL`/`FLOAT`.

4. **RLS on the VIEW** — PostgreSQL views inherit the querying user's RLS context by default (`SECURITY INVOKER`). Verify RLS policies on `expenses` and `expense_participants` cover the view's access pattern before exposing `member_balances` via the REST API.

---

## Follow-up Research 2026-06-08 — API Docs Compatibility Audit

**Question:** Is `context/changes/expense-balance-live/api-docs-tanstack-table.md` compatible with the codebase for implementing S-02?

**Git commit at time of audit:** `e83faddc6083553a14a12c6104aa232e7bfd8233` (branch: `main`)

### Verdict: resolved — api-docs updated to v8 stable

`api-docs-tanstack-table.md` originally documented the **v9 alpha API** and was incompatible. It has been rewritten to v8 stable (2026-06-08). The codebase has `@tanstack/react-table` **not installed at all** — it must be added before implementation.

### Codebase baseline (from audit)

| Area | Finding |
|---|---|
| `@tanstack/react-table` | **Not in package.json, lockfile, or node_modules** — must be added |
| React | 19.2.6 — v8.21+ required for React 19 support |
| TypeScript | strict mode via `astro/tsconfigs/strict` |
| shadcn/ui | configured ("new-york"), but **no `table.tsx` or `data-table.tsx` yet** |
| `src/components/ui/` | only `button.tsx` + `LibBadge.astro` |
| `src/hooks/` | **does not exist** — needs to be created |
| `src/types.ts` | **does not exist** — `Expense` type needs to be defined |

### API mismatch: v9 alpha (docs) vs v8 stable (should use)

| Concept | v9 alpha — what the docs show | v8 stable — what to actually write |
|---|---|---|
| Hook | `useTable` | `useReactTable` |
| Feature registration | `tableFeatures({ columnFilteringFeature, rowSortingFeature, rowPaginationFeature })` | Not needed — row models passed directly |
| Column helper | `createColumnHelper<typeof _features, Expense>()` | `createColumnHelper<Expense>()` |
| Filtered row model | `createFilteredRowModel(filterFns)` | `getFilteredRowModel()` |
| Sorted row model | `createSortedRowModel(sortFns)` | `getSortedRowModel()` |
| Paginated row model | `createPaginatedRowModel()` | `getPaginationRowModel()` |
| Config keys | `_features`, `_rowModels` | Standard v8 option bag |

### What transfers correctly (concepts valid for v8)

These are accurate in the docs and apply 1:1 to v8:
- State types: `ColumnFiltersState`, `SortingState`, `PaginationState`
- Options: `getRowId`, `state`, `onColumnFiltersChange`, `onSortingChange`, `onPaginationChange`, `manualPagination: true`
- Table instance methods: `getColumn()`, `setFilterValue()`, `getFilterValue()`, `getToggleSortingHandler()`, `getCanSort()`, `getIsSorted()`, `getCanPreviousPage()`, `getCanNextPage()`, `previousPage()`, `nextPage()`, `setPageIndex()`, `setPageSize()`, `getPageCount()`, `getHeaderGroups()`, `getRowModel()`, `getVisibleCells()`
- `flexRender()` (standalone function, not `table.FlexRender`)
- S-02 feature mapping table (filtering / sorting / pagination features are all correct)

### Action required before implementation

1. ~~**Replace `api-docs-tanstack-table.md`** with v8 stable API snippets~~ — **done** (2026-06-08). Re-fetched from Context7 `/websites/tanstack_table` (tanstack.com/table/latest); sourced from official v8 examples: `useReactTable`, `getCoreRowModel`, `getFilteredRowModel`, `getSortedRowModel`, `getPaginationRowModel`, `firstPage()`/`lastPage()`, `rowCount` for server-side mode.
2. **Install:** `npm install @tanstack/react-table` (targets v8.21+ for React 19 compatibility).
3. **Add shadcn/ui table primitives:** `npx shadcn@latest add table` (generates `src/components/ui/table.tsx`).
4. **Create `src/hooks/`** directory for the expense table hook.
5. **Define `Expense` type** in `src/types.ts` (file does not exist yet).
