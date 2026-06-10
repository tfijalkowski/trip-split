<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-02 Expense Split + Live Balances

- **Plan**: context/changes/expense-balance-live/plan.md
- **Scope**: All phases (1, 2, 3 of 3)
- **Date**: 2026-06-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical  6 warnings  4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — Participant inputs not validated as group members

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/groups/[id]/expenses.ts (body parsing section)
- **Detail**: Two related gaps. (1) `paid_by` UUID is accepted from the request body without verifying it belongs to the group — a member can attribute payment to any UUID, including non-members. (2) Each participant `user_id` is forwarded to the SECURITY DEFINER RPC without membership validation — a member can inject arbitrary user_ids into expense_participants. Both bypass RLS because the RPC is SECURITY DEFINER.
- **Fix A ⭐ Recommended**: After parsing the body, query group_members once to fetch all member user_ids for the group, then verify both `paid_by` and every participant `user_id` are in that set. Reject with 400 if any are missing.
  - Strength: One query covers both gaps. Follows the guard pattern already used for the caller's own membership check.
  - Tradeoff: One extra DB round-trip per expense POST.
  - Confidence: HIGH — identical shape to the caller membership guard already in the route.
  - Blind spot: None significant.
- **Fix B**: Add a FK constraint/trigger in the DB enforcing group membership for paid_by and participant user_ids.
  - Strength: Enforced at the DB layer; survives future routes.
  - Tradeoff: More complex migration; raises 500 instead of 400 with a message.
  - Confidence: MEDIUM — reliable but adds migration complexity.
  - Blind spot: Haven't verified whether expense_participants has group_id.
- **Decision**: FIXED via Fix A

### F2 — Missing GRANT SELECT on member_balances VIEW

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260610182008_expense_balance_layer.sql
- **Detail**: The `member_balances` VIEW is created without an explicit `GRANT SELECT ... TO authenticated`. The Realtime test passed because SSR uses the service key which bypasses privilege checks. But the browser client's `refetch()` in GroupExpensesIsland queries this VIEW with the session key — if Supabase's default project grants don't cover VIEWs, balances will silently return empty after the first Realtime event.
- **Fix**: Add a new migration: `GRANT SELECT ON public.member_balances TO authenticated;` Verify first with: `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name='member_balances';`
  - Strength: Explicit is always safer; matches the explicit GRANT on create_expense RPC in the same migration.
  - Tradeoff: Requires a new migration (cannot amend an applied one).
  - Confidence: HIGH — the create_expense RPC already demonstrates this explicit-grant pattern.
  - Blind spot: Realtime test 3.15 passed — default grant may already exist; verify before adding.
- **Decision**: FIXED — new migration 20260610230000_grant_member_balances_select.sql

### F3 — npm run lint crashes on src/pages/groups/[id].astro:13

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: src/pages/groups/[id].astro:13
- **Detail**: Progress checkbox 3.2 ("npm run lint passes") is marked [x] at commit 2f26ae0, but lint is currently failing: "Non-null Assertion Failed: Expected node to have a parent. Rule: @typescript-eslint/no-misused-promises". Known incompatibility between astro-eslint-parser and @typescript-eslint's projectService option when processing Astro's `return` nodes.
- **Fix A ⭐ Recommended**: Disable the rule at the eslint.config.js level for `**/*.astro` files: add `"@typescript-eslint/no-misused-promises": "off"` in an Astro file override. One fix covers all Astro pages.
  - Strength: Prevents this crash on any Astro page; the rule is not meaningfully applicable to Astro frontmatter anyway.
  - Tradeoff: Disables the rule for all Astro files.
  - Confidence: HIGH — the crash is a parser bug, not a real code issue.
  - Blind spot: Haven't checked if other Astro pages have the same trigger.
- **Fix B**: Add a file-level eslint-disable comment to groups/[id].astro only.
  - Strength: Narrowly scoped.
  - Tradeoff: Other Astro pages may trigger the same crash later.
  - Confidence: HIGH.
  - Blind spot: None.
- **Decision**: FIXED — disabled no-misused-promises for *.astro in eslint.config.js; auto-fixed 70 formatting errors; 7 real errors remain (2 in dead supabase.ts code, 4 in GroupExpensesIsland, 1 pre-existing in join/[invite_code].astro)

### F4 — Dead createBrowserClient() export in src/lib/supabase.ts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/supabase.ts
- **Detail**: The browser client function was correctly split into `src/lib/supabase.browser.ts` to avoid mixing astro:env/server and astro:env/client imports. However, the function was left in `supabase.ts` as well — it's dead code since the island imports from `supabase.browser`. Having both creates confusion and the function in `supabase.ts` imports from `astro:env/client` inside an SSR module — a latent build risk.
- **Fix**: Remove the `createBrowserClient` function and its import aliases from `src/lib/supabase.ts`. The canonical browser client lives in `src/lib/supabase.browser.ts`.
- **Decision**: FIXED — removed createBrowserClient() and its import aliases from supabase.ts

### F5 — amount_owed not validated as integers before RPC call

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/groups/[id]/expenses.ts (participant parsing)
- **Detail**: Individual `amount_owed` values are typed as `number` but not checked to be integers. A float like `33.33` passes the participant-sum validation but is cast `::integer` in the RPC, silently truncating the fraction and potentially corrupting grosze totals.
- **Fix**: Add `Number.isInteger(p.amount_owed) && p.amount_owed >= 0` to the participant validation loop. Return 400 if any value fails.
- **Decision**: FIXED

### F6 — Realtime refetch runs after unmount, no mount guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/expenses/GroupExpensesIsland.tsx (useEffect)
- **Detail**: If a Realtime event fires after the component unmounts (during navigation), `refetch()` calls setExpenses/setBalances on an unmounted component. React 18 silently discards these, but the network round-trips still fire. The plan specified removeChannel on unmount — the cleanup return references the channel, but async refetch calls have no mounted guard.
- **Fix**: Add a `mounted` flag: `let mounted = true;` inside useEffect; in the channel callback guard with `if (mounted)`; in cleanup set `mounted = false` before removeChannel.
- **Decision**: FIXED — added mount guard, useCallback for refetch, removed debug console.log calls, fixed 3 unnecessary-condition errors in groups/[id].astro

### F7 — zodResolver not wired; validation duplicated manually

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/expenses/AddExpenseSheet.tsx
- **Detail**: AddExpenseSheet uses react-hook-form but wires Zod validation manually via safeParse inside onSubmit instead of zodResolver from @hookform/resolvers/zod. RHF's own (no-resolver) validation runs first, then Zod re-validates — duplicate logic. Zod errors don't surface in formState.errors for per-field display.
- **Fix**: Install @hookform/resolvers, wire zodResolver(formSchema) in useForm, remove manual safeParse call.
- **Decision**: SKIPPED

### F8 — Sequential expense + balance fetches on the Astro page

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/pages/groups/[id].astro (data fetch section)
- **Detail**: The expenses and member_balances fetches are independent of each other but issued sequentially with await. At TripSplit's scale the delay is small but avoidable.
- **Fix**: Wrap in Promise.all: `const [{ data: expenseRows }, { data: balanceRows }] = await Promise.all([supabase.from("expenses").select(...).eq(...), supabase.from("member_balances").select("*").eq(...)]);`
- **Decision**: FIXED

### F9 — No server-side description length cap

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/groups/[id]/expenses.ts
- **Detail**: The description field has no server-side max length. Zod enforces max(255) on the client but a direct API call can bypass this. DB column is `text NOT NULL` with no length limit.
- **Fix**: Add `description.length > 255` check → 400 response, matching the client-side constraint.
- **Decision**: FIXED

### F10 — Dev SQL snippet committed to the repo

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/snippets/Untitled query 562.sql
- **Detail**: A Supabase Studio SQL editor scratch file (`select * from auth.users;`) was committed. No deployment impact but references `auth.users` and will confuse future developers.
- **Fix**: Delete the file and add `supabase/snippets/` to `.gitignore`.
- **Decision**: FIXED — deleted the file, added supabase/snippets/ to .gitignore
