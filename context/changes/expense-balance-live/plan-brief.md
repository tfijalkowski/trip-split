# S-02: Dodawanie wydatku z podziałem + salda na żywo — Plan Brief

> Full plan: `context/changes/expense-balance-live/plan.md`
> Research: `context/changes/expense-balance-live/research.md`
> API docs: `context/changes/expense-balance-live/api-docs-tanstack-table.md`

## What & Why

Implement the north-star feature for TripSplit: a group member adds an expense with a split across participants and immediately sees all members' net balances update without a page refresh. This is the earliest moment that proves the product hypothesis — the core calculation works and is live for all participants.

## Starting Point

F-01 (Google SSO) and F-02 (DB schema + RLS + Realtime) are complete. S-01 (group join flow) is assumed complete. The codebase has no expense API routes, no group detail page, no `member_balances` VIEW, no React islands, and is missing `@tanstack/react-table`, `react-hook-form`, and `zod`.

## Desired End State

A logged-in group member navigates to `/groups/<id>`, sees a balance panel and expense list. They click "Add expense", fill in a slide-over form (description, amount, participants, split mode), submit, and immediately see updated balances — without a page reload. Members in other browser tabs also see the update via Supabase Realtime.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Page ownership | S-02 creates `src/pages/groups/[id].astro` | Self-contained; testable without S-01 scope creep | Plan |
| Split modes | All three at once (equal, %, custom) | FR-008 is must-have; all modes are required for correctness | Plan |
| Pagination | Client-side (TanStack) | Trip-scale data (dozens of expenses) makes full-fetch + in-browser paging the right trade-off | Plan |
| Filter target | Payer only (`paid_by`) | Participant-subquery filter adds complexity not justified for MVP | Plan |
| Form validation | Install react-hook-form + zod | Neither was installed; zod `.superRefine()` makes split-sum invariants explicit and safe | Research → Plan |
| Realtime update | Full refetch on any event | Matches the SQL VIEW approach; trivially consistent at this scale | Research → Plan |
| Layout | Single page, stacked (balance top, list below) | Mobile-first PRD NFR; keeps the live-update demo dramatic | Plan |
| Form UX | shadcn/ui Sheet (slide-over) | Keeps expense list visible behind the form; natural on mobile | Plan |
| Browser client | `createBrowserClient()` in `src/lib/supabase.ts` | `@supabase/ssr` is already installed; one place for all Supabase client creation | Plan |
| Client credentials | `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY` as `context: "client"` env vars | Astro env system handles browser exposure correctly; anon key is safe to expose | Plan |
| Monetary storage | Integer grosze (1 PLN = 100) | Avoids floating-point rounding bugs identified in multiple reference projects | Research |
| Atomic insert | `create_expense` PL/pgSQL RPC | REST API cannot insert into two tables atomically; orphaned expenses corrupt balances | Plan |

## Scope

**In scope:**
- `src/pages/groups/[id].astro` — SSR group detail page with initial data fetch
- `member_balances` PostgreSQL VIEW + `create_expense` RPC (one migration)
- `POST /api/groups/[id]/expenses` API route
- `GroupExpensesIsland`, `BalancePanel`, `ExpenseTable`, `AddExpenseSheet` React components
- Three split modes: equal (auto-distributed), percentage, custom amount
- Supabase Realtime subscription on `expenses` filtered by `group_id`

**Out of scope:**
- Expense edit / delete (S-04)
- Settlement lock / unlock (S-03)
- Filter by participant (participant-subquery required — not MVP)
- Server-side pagination
- Revolut import (FR-013, FR-014) — parked
- Multi-currency

## Architecture / Approach

The Astro SSR page fetches initial expenses, balances, and group members server-side (using the existing SSR Supabase client) and hydrates the React island with that data. The island creates a browser Supabase client (via a new `createBrowserClient()` export using `@supabase/ssr`) and subscribes to `postgres_changes` on `expenses`. On any event it re-queries both `expenses` and `member_balances` and updates React state. The Sheet form submits to a new API route, which validates group membership and calls the `create_expense` RPC — a PL/pgSQL function that inserts into `expenses` and `expense_participants` atomically.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Infrastructure | npm deps, env vars, browser client, types, shadcn primitives, route protection | `astro:env/client` must not be called server-side — lazy init required |
| 2. Data Layer | `member_balances` VIEW, `create_expense` RPC, POST API route | RPC uses `SECURITY DEFINER` — API route must validate membership before calling |
| 3. UI | Group detail page + four React components, all split modes, Realtime | Two-session Realtime test is the north-star gate |

**Prerequisites:** F-01, F-02, S-01 complete; local `.env` / `.dev.vars` populated with `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`
**Estimated effort:** ~3 focused sessions across 3 phases

## Open Risks & Assumptions

- S-01 is assumed complete. The Astro page queries `group_members` and `profiles` — if the schema differs from what F-02 specified, types and queries in Phase 3 will need adjustment.
- `expense_participants` has no `group_id` column — Realtime subscription on `expenses` only (RPC is atomic, so this is sufficient; but if expenses and participants were ever inserted separately, subscriptions would miss participant-only updates).
- RLS on `member_balances` VIEW relies on the underlying table policies from F-02 (`SECURITY INVOKER` default). If F-02 RLS policies are missing or misconfigured, the VIEW may expose cross-group data — verify before Phase 3.

## Success Criteria (Summary)

- All three split modes create correct grosze amounts in `expense_participants` with `sum(amount_owed) === expense.amount`
- `member_balances` VIEW returns mathematically correct net balances after any expense change
- Two browser sessions: expense added in session A causes balance panel update in session B within ~1 second (Realtime north-star test)
