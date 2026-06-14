---
date: 2026-06-14T10:20:16Z
researcher: Tomasz Fijałkowski
git_commit: a7a6832977376dfdc44e8a9c582504464e908c49
branch: master
repository: trip-split
topic: "Critical-path safety net — Phase 1: balance correctness (Risk #5) and RLS cross-group isolation (Risk #1)"
tags: [research, codebase, balance-calculation, rls, supabase, vitest, expenses]
status: complete
last_updated: 2026-06-14
last_updated_by: Tomasz Fijałkowski
---

# Research: Critical-path safety net (Phase 1)

**Date**: 2026-06-14T10:20:16Z
**Researcher**: Tomasz Fijałkowski
**Git Commit**: a7a6832977376dfdc44e8a9c582504464e908c49
**Branch**: master
**Repository**: trip-split

## Research Question

What is the oracle for balance correctness (Risk #5) and cross-group RLS isolation (Risk #1), and what environment setup does Phase 1 need?

---

## Summary

- **Balance calculation** lives entirely in a SQL VIEW (`member_balances`), not in JS. Every test assertion must derive expected values from the formula `total_paid − total_owed`, never from the implementation code.
- **Zero-sum** is enforced at the API layer (not by a DB constraint): the POST handler rejects any request where `SUM(amount_owed) ≠ amount_grosze`.
- **Cross-group isolation** for reads is RLS-only (0 rows, 200 OK); for writes it is an explicit 403 guard in the API handler before the RPC call. Both paths satisfy the test plan requirement ("0 rows or 403"). There is **no GET API endpoint** for expenses — reads go through the Supabase JS client directly.
- **Test environment** is greenfield: Vitest is not installed, no test files exist. Supabase local seed has two deterministic users (Alice + Bob), both members of the same group. A **third non-member user** must be created in test setup for Risk #1.
- Recommended test layer: **integration against Supabase local** for both risks (balance is SQL, RLS must be exercised with a real authenticated user).

---

## Detailed Findings

### 1. Balance Calculation Oracle (Risk #5)

#### Where the calculation lives

Balance is computed in a **read-only SQL VIEW** with `SECURITY INVOKER` (RLS applies to the querying user). There is no JS/TS balance calculation function — the frontend only distributes amounts before sending to the API.

**File**: [`supabase/migrations/20260610182008_expense_balance_layer.sql:10–20`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/supabase/migrations/20260610182008_expense_balance_layer.sql#L10-L20)

```sql
CREATE OR REPLACE VIEW public.member_balances AS
SELECT
  ep.user_id,
  e.group_id,
  SUM(ep.amount_owed)                                             AS total_owed,
  SUM(CASE WHEN e.paid_by = ep.user_id THEN e.amount ELSE 0 END) AS total_paid,
  SUM(CASE WHEN e.paid_by = ep.user_id THEN e.amount ELSE 0 END)
    - SUM(ep.amount_owed)                                         AS net_balance
FROM public.expense_participants ep
JOIN public.expenses e ON ep.expense_id = e.id
GROUP BY ep.user_id, e.group_id;
```

**Oracle formula (derive expected values from this, not from the implementation):**
```
net_balance[user, group] =
  SUM(expenses.amount WHERE paid_by = user AND group_id = group)
  − SUM(expense_participants.amount_owed WHERE user_id = user AND expense.group_id = group)
```

Positive = user is owed money. Negative = user owes money.

#### Data model

**expenses table** — [`supabase/migrations/20260609213602_initial_schema.sql:39–47`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/supabase/migrations/20260609213602_initial_schema.sql#L39-L47):
```sql
CREATE TABLE IF NOT EXISTS public.expenses (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid    NOT NULL REFERENCES public.groups ON DELETE CASCADE,
  description  text    NOT NULL,
  amount       integer NOT NULL CHECK (amount > 0),
  paid_by      uuid    NOT NULL REFERENCES auth.users ON DELETE RESTRICT,
  expense_date date    NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

`amount` is **INTEGER (grosze)** — 100 grosze = 1 PLN. No decimals anywhere in the DB.

**expense_participants table** — [`supabase/migrations/20260609213602_initial_schema.sql:49–55`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/supabase/migrations/20260609213602_initial_schema.sql#L49-L55):
```sql
CREATE TABLE IF NOT EXISTS public.expense_participants (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id  uuid    NOT NULL REFERENCES public.expenses ON DELETE CASCADE,
  user_id     uuid    NOT NULL REFERENCES auth.users ON DELETE RESTRICT,
  amount_owed integer NOT NULL CHECK (amount_owed >= 0),
  UNIQUE (expense_id, user_id)
);
```

`amount_owed` is **INTEGER (grosze)**, must be ≥ 0.

#### Split rounding strategy

All rounding happens client-side before sending to the API. The server validates the result.

**Equal split** — [`src/components/expenses/AddExpenseSheet.tsx:73–80`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/src/components/expenses/AddExpenseSheet.tsx#L73-L80):
```typescript
const floor = Math.floor(totalGrosze / n);
const remainder = totalGrosze - floor * n;
participants = selected.map((m, i) => ({
  user_id: m.user_id,
  amount_owed: i === 0 ? floor + remainder : floor,  // first person absorbs remainder
}));
```

**Percentage split** — [`src/components/expenses/AddExpenseSheet.tsx:81–97`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/src/components/expenses/AddExpenseSheet.tsx#L81-L97):
```typescript
const rawAmounts = pcts.map((pct) => Math.floor((totalGrosze * pct) / 100));
const adjustment = totalGrosze - rawSum;
// first person absorbs rounding adjustment
```
Frontend validates: percentages must sum to 100 ± 0.01%.

**Custom split** — [`src/components/expenses/AddExpenseSheet.tsx:99–111`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/src/components/expenses/AddExpenseSheet.tsx#L99-L111):
User-entered PLN amounts are converted with `Math.round(v * 100)` and must sum **exactly** to total.

#### Server-side zero-sum enforcement

**File**: [`src/pages/api/groups/[id]/expenses.ts:110–131`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/src/pages/api/groups/%5Bid%5D/expenses.ts#L110-L131)

The API rejects any expense where `SUM(participant.amount_owed) ≠ amount_grosze` with status 400. This is the only enforcement — no DB constraint.

```typescript
if (participantSum !== amount_grosze) {
  return new Response(
    JSON.stringify({ error: `Participant amounts sum (${participantSum}) must equal total amount (${amount_grosze})` }),
    { status: 400 }
  );
}
```

#### Insertion RPC

**File**: [`supabase/migrations/20260610182008_expense_balance_layer.sql:25–54`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/supabase/migrations/20260610182008_expense_balance_layer.sql#L25-L54)

`create_expense()` is `SECURITY DEFINER` — bypasses RLS for INSERTs. It atomically inserts into `expenses` then `expense_participants`. No membership check inside the RPC (that responsibility belongs to the API handler).

#### PRD oracle

**File**: `context/foundation/prd.md` (Business Logic section):
> "saldo netto na osobę — kwota do otrzymania (+) lub do oddania (−) względem sumy wszystkich wydatków grupy"

Success criterion (prd.md):
> "Obliczenia rozliczenia są matematycznie poprawne — błąd w kwocie niszczy zaufanie do aplikacji."

#### Zero-sum invariant — concrete proof

For any group where every expense satisfies `SUM(amount_owed) = expense.amount`:

```
SUM_all_users(net_balance)
  = SUM_all_users(total_paid) − SUM_all_users(total_owed)
  = SUM_all_expenses(amount) − SUM_all_participants(amount_owed)
  = 0    ← because the API enforces amount = SUM(amount_owed) per expense
```

The invariant is mathematically guaranteed by the API's per-expense sum check, not by a DB constraint.

---

### 2. RLS Cross-Group Isolation Oracle (Risk #1)

#### `is_group_member()` helper function

**File**: [`supabase/migrations/20260609213602_initial_schema.sql:63–66`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/supabase/migrations/20260609213602_initial_schema.sql#L63-L66)

```sql
CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.group_members WHERE group_id = p_group_id AND user_id = auth.uid())
$$;
```

`SECURITY DEFINER` prevents recursive RLS when querying `group_members`. Indexed on `(user_id)`.

#### SELECT policy on expenses — RLS only, returns 0 rows

**File**: [`supabase/migrations/20260609213602_initial_schema.sql:141–143`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/supabase/migrations/20260609213602_initial_schema.sql#L141-L143)

```sql
CREATE POLICY "expenses: member read"
  ON public.expenses FOR SELECT TO authenticated
  USING (is_group_member(group_id));
```

A non-member SELECT returns **0 rows, HTTP 200** (Supabase SDK default). No 403 is generated by RLS alone.

There is **no GET API endpoint** for expenses — reads go directly via the Supabase JS client with this RLS policy applied.

#### POST endpoint — explicit 403 guard before RPC

**File**: [`src/pages/api/groups/[id]/expenses.ts:43–55`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/src/pages/api/groups/%5Bid%5D/expenses.ts#L43-L55)

```typescript
const { data: membership } = await supabase
  .from("group_members")
  .select("id, groups!inner(is_locked)")
  .eq("group_id", groupId)
  .eq("user_id", user.id)
  .maybeSingle();

if (!membership) {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}
```

This guard fires **before** the `create_expense()` RPC, so a non-member write attempt never reaches the DB.

#### Behaviour summary

| Path | Mechanism | Non-member response |
|------|-----------|---------------------|
| Read expenses (browser Supabase client) | RLS `is_group_member()` | 0 rows, 200 OK |
| POST expense (API route) | Explicit 403 guard | 403 Forbidden |
| member_balances VIEW (browser) | SECURITY INVOKER → same RLS | 0 rows, 200 OK |

Both paths satisfy the test plan requirement: "Non-member receives 0 rows **or** 403 — not a filtered 200 with empty array." The read path returns 0 rows (not a 200 with data) which satisfies the PRD NFR ("no financial data visible to non-members").

#### PRD oracle

**File**: `context/foundation/prd.md` (NFR section):
> "Dados grupy — wydatki i salda — są dostępne wyłącznie dla zalogowanych członków tej grupy; uczestnik spoza grupy nie widzi żadnych danych finansowych innej grupy."

#### group_members table

**File**: [`supabase/migrations/20260609213602_initial_schema.sql:31–37`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/supabase/migrations/20260609213602_initial_schema.sql#L31-L37)

```sql
CREATE TABLE IF NOT EXISTS public.group_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES public.groups ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);
```

Membership = exactly one row with `(group_id, user_id)`.

#### Anti-patterns to avoid (from test-plan.md)

- Do **not** test as superuser — RLS is skipped for superuser, the test would pass vacuously.
- Do **not** test with an unauthenticated request — a different code path.
- Must use **two real authenticated users** against Supabase local (real JWT, real RLS evaluation).

---

### 3. Test Environment Bootstrap

#### Current state

| Component | Status | Detail |
|-----------|--------|--------|
| Node.js | ✓ ready | 22.14.0 (`.nvmrc`), Vitest 2.x requires ≥ 18 |
| TypeScript | ✓ ready | strict config, `@/*` → `./src/*` alias in `tsconfig.json:10` |
| Vite | ✓ ready | 7.3.3 (via override in `package.json`) |
| Supabase local | ✓ ready | port 54321 (API), 54322 (DB), seed.sql present |
| Seed users | ✓ ready | Alice `00000000-0000-0000-0000-000000000001`, Bob `00000000-0000-0000-0000-000000000002` — **both members of the same group** |
| Vitest | ✗ missing | not installed |
| vitest.config.ts | ✗ missing | does not exist |
| test scripts | ✗ missing | no `test` script in package.json |
| test files | ✗ missing | zero `*.test.ts` files |
| @vitest/coverage-v8 | ✗ missing | not installed |

#### What to install (devDependencies)

```
vitest
@vitest/coverage-v8
```

No DOM environment (jsdom/happy-dom) needed for Phase 1 — both risks use integration tests against a real Supabase DB, not component tests.

#### What to configure

1. **`vitest.config.ts`** (new file at root) — extend Vite config, set `environment: 'node'`, configure `@/*` path alias.
2. **`package.json`** — add `"test": "vitest run"`, `"test:coverage": "vitest run --coverage"`.
3. **`tsconfig.json`** — add `"vitest/globals"` to `compilerOptions.types` if using globals; add `"coverage"` to `exclude`.
4. **`eslint.config.js`** — add vitest plugin override for `*.test.ts` files (optional for Phase 1, required before Phase 4 gate).

#### Supabase local credentials for tests

From `.dev.vars` (gitignored):
- `SUPABASE_URL=http://127.0.0.1:54321`
- `SUPABASE_KEY=<service_role or anon key>`

Integration tests need the **service_role key** to create test users via `auth.admin.createUser()`, then switch to anon key with user JWT for RLS-scoped queries.

#### Seed data gap for Risk #1

The existing seed (`supabase/seed.sql`) has Alice and Bob both as **members of Group X**. Risk #1 requires a **non-member**. Test setup must create a third user (e.g. Charlie) via `supabase.auth.admin.createUser()` in a `beforeAll` block. Charlie must not appear in `group_members` for Group X.

---

## Code References

- [`supabase/migrations/20260610182008_expense_balance_layer.sql:10–20`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/supabase/migrations/20260610182008_expense_balance_layer.sql#L10-L20) — `member_balances` VIEW (balance oracle)
- [`supabase/migrations/20260610182008_expense_balance_layer.sql:25–54`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/supabase/migrations/20260610182008_expense_balance_layer.sql#L25-L54) — `create_expense()` RPC (SECURITY DEFINER)
- [`supabase/migrations/20260609213602_initial_schema.sql:39–55`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/supabase/migrations/20260609213602_initial_schema.sql#L39-L55) — `expenses` + `expense_participants` tables
- [`supabase/migrations/20260609213602_initial_schema.sql:63–66`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/supabase/migrations/20260609213602_initial_schema.sql#L63-L66) — `is_group_member()` helper
- [`supabase/migrations/20260609213602_initial_schema.sql:141–143`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/supabase/migrations/20260609213602_initial_schema.sql#L141-L143) — `expenses: member read` RLS policy
- [`src/pages/api/groups/[id]/expenses.ts:43–55`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/src/pages/api/groups/%5Bid%5D/expenses.ts#L43-L55) — explicit 403 membership guard
- [`src/pages/api/groups/[id]/expenses.ts:110–131`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/src/pages/api/groups/%5Bid%5D/expenses.ts#L110-L131) — server-side sum validation
- [`src/components/expenses/AddExpenseSheet.tsx:70–111`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/src/components/expenses/AddExpenseSheet.tsx#L70-L111) — client-side split rounding
- [`supabase/seed.sql`](https://github.com/tfijalkowski/trip-split/blob/a7a6832977376dfdc44e8a9c582504464e908c49/supabase/seed.sql) — deterministic test users
- `tsconfig.json:10` — `@/*` path alias
- `package.json:5–12` — current scripts (no test script)

---

## Architecture Insights

1. **Calculation is in SQL, not JS.** The `member_balances` VIEW is the single source of truth. Tests must query the VIEW (via Supabase SDK with user JWT) or replicate the SQL formula in test assertions — never reverse-engineer from the implementation.

2. **RLS and API guards are layered but not symmetric.** Reads are RLS-only (0 rows). Writes have an extra explicit guard (403). Both satisfy the NFR but the test plan's "0 rows or 403" requirement must be verified for the read path specifically, because the empty array is the *correct* response (not an error to catch).

3. **SECURITY DEFINER chain.** `create_expense()` runs as its definer (bypasses RLS). The API handler is the only membership gate for writes. If a future developer adds a new write endpoint and forgets the guard, the RPC will happily insert for non-members. This is the architectural risk that Risk #2 (Phase 2) will stress.

4. **No GET API route for expenses.** Reads happen via the Supabase JS SDK client directly. Testing the read isolation means authenticating as a real user and calling `supabase.from("expenses").select()` — not hitting an API endpoint.

5. **Amounts are always integers.** No floating-point anywhere in the DB or in the split-to-participants logic. Rounding is deterministic (floor + first-participant adjustment). Oracle assertions must use integer grosze.

---

## Historical Context (from prior changes)

- `context/changes/db-schema-rls/` — earlier RLS investigation; the `is_group_member()` fix (`20260610000000_fix_is_group_member_search_path.sql`) traces back to a search_path vulnerability patched in that change.
- `context/foundation/lessons.md` — "RLS default-deny produces a silent 0-rows response, not an error." Confirms the read isolation pattern. Reinforces: a test must assert 0 rows with a second authenticated user, not test for an error response.

---

## Open Questions

1. **Non-member user creation in tests.** Seed has Alice + Bob (both members). Risk #1 needs Charlie (non-member). Will tests create Charlie via `supabase.auth.admin.createUser()` in `beforeAll` and clean up in `afterAll`? Or add Charlie to `seed.sql`? Recommendation: create dynamically in test to avoid polluting seed state across test runs.

2. **Service role key availability.** Creating users via the admin API requires the `service_role` key. Is it safe to expose in `vitest.config.ts` or a `.env.test` file (gitignored)? The `.dev.vars` file already has the local key — a `.env.test` mirror pointing to local Supabase should be sufficient.

3. **Test isolation between Risk #5 and Risk #1.** Should both use the same group and users from seed, or isolated test-specific groups? Recommendation: create fresh groups in each test's `beforeAll` for isolation, use seed users as the authenticated actors.

4. **Vitest `environment`** for integration tests. Tests query real Supabase local over HTTP — no DOM needed. `environment: 'node'` is correct. No jsdom/happy-dom required for Phase 1.

5. **Coverage threshold.** No target set in the test plan. Phase 1 is bootstrapping — any threshold will be vacuously met. Recommend skipping a numeric threshold until Phase 2 adds more tests.
