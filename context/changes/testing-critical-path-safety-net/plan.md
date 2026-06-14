# Critical-Path Safety Net — Implementation Plan

## Overview

Phase 1 of the test rollout: bootstrap Vitest and ship the first two integration test suites proving balance correctness (Risk #5) and cross-group RLS isolation (Risk #1). All assertions run against Supabase local with real authenticated JWTs — no mocks, no superuser, no unauthenticated calls.

## Current State Analysis

- No test runner installed; no test files or test config exist.
- `member_balances` VIEW computes `net_balance = total_paid − total_owed` in integer grosze; there is no JS/TS balance function to unit-test — integration is the only valid layer.
- RLS SELECT policy on expenses filters by `is_group_member(group_id)`; non-member queries return 0 rows, not 403.
- Seed has Alice + Bob as members of a fixed group. We create fresh test users and groups in every suite `beforeAll` to keep tests fully isolated from seed state.
- `.dev.vars` already holds the service_role and anon keys for Supabase local.
- The explicit 403 guard for non-member writes lives in the Astro API handler (`src/pages/api/groups/[id]/expenses.ts:43–55`). Testing it requires a running Astro dev server; it is deferred to Phase 2 (API enforcement layer) where all endpoint guards are exercised together.

## Desired End State

- `npm test` finds and passes 7 `it` blocks across two test files in `src/__tests__/`.
- The balance suite proves: zero-sum invariant holds, per-user `net_balance` matches the oracle formula, rounding is correctly applied (prime-number edge case).
- The RLS suite proves: a dynamically created non-member gets 0 rows from both `expenses` and `member_balances`; a member gets their data.
- `context/foundation/test-plan.md §6.1` and `§6.2` document the integration patterns for Phase 2 to extend.

### Key Discoveries

- `member_balances` VIEW (`supabase/migrations/20260610182008_expense_balance_layer.sql:10–20`) is `SECURITY INVOKER` — RLS applies. Tests that assert balance values must authenticate as a group member; a non-member query returns 0 rows.
- `create_expense()` RPC (`supabase/migrations/20260610182008_expense_balance_layer.sql:25–54`) is `SECURITY DEFINER` — it can be called with an authenticated user JWT and will bypass RLS for the INSERT. Use it to seed test expenses.
- Oracle formula: `net_balance = SUM(expenses.amount WHERE paid_by = user) − SUM(expense_participants.amount_owed WHERE user_id = user)`. Derive expected values from this formula, not from querying the VIEW.
- Rounding rule (equal split, `AddExpenseSheet.tsx:73–80`): floor division, remainder goes to the first participant. For 101 grosze ÷ 2 users: first gets 51, second gets 50.
- Non-member `is_group_member()` check (`initial_schema.sql:63–66`): `SECURITY DEFINER` SQL function; returns false for any user not in `group_members`.

## What We're NOT Doing

- No unit tests — the calculation lives in SQL, not in a testable JS function.
- No snapshot, component, or UI tests (test-plan.md §7).
- No POST 403 test (API layer guard) — deferred to Phase 2.
- No coverage threshold — bootstrapping only; threshold deferred to Phase 4.
- No mock or stub Supabase client — real Supabase local is required.
- No globalSetup that starts Supabase local — `supabase start` is a manual prerequisite; SDK errors on connection failure are sufficient signal.

## Implementation Approach

Four ordered phases. Phase 1 is a gate — Phases 2 and 3 cannot run without it. Phases 2 and 3 are independent of each other. Phase 4 runs after both pass.

All test suites follow a consistent pattern:
- `supabaseAdmin`: service_role client used only for user and group lifecycle (create/delete).
- `supabaseAsUser`: anon-key client with a user JWT, used for all RLS-scoped assertions.
- Fresh test users and groups created in `beforeAll`, deleted in `afterAll`.

## Critical Implementation Details

**Supabase local must be running.** `npm test` will fail with a connection error if `supabase start` has not been run. No health check is added to `vitest.config.ts` — the error message from the SDK is clear enough.

**Admin client for user lifecycle; JWT client for assertions.** Use `supabase.auth.admin.createUser({ email, password })` to create test users, then `supabase.auth.signInWithPassword({ email, password })` to obtain a JWT. Pass the JWT as an `Authorization: Bearer <token>` header on a separate Supabase anon client for RLS-scoped queries. Never use the admin (service_role) client for RLS assertions — it bypasses RLS entirely.

---

## Phase 1: Environment Setup

### Overview

Install Vitest and `@vitest/coverage-v8`, wire configuration, and verify the runner starts cleanly with zero tests.

### Changes Required

#### 1. Install test dependencies

**File**: `package.json` (devDependencies)

**Intent**: Add the two packages that Phase 1 needs. No DOM environment (jsdom/happy-dom) is required because both test suites query Supabase over HTTP in a Node environment.

**Contract**: Run `npm install --save-dev vitest @vitest/coverage-v8`.

#### 2. Add test scripts

**File**: `package.json` (scripts)

**Intent**: Expose `test` and `test:coverage` so CI (Phase 4) can pick them up without configuration changes.

**Contract**:
```json
"test": "vitest run",
"test:coverage": "vitest run --coverage"
```

#### 3. Create vitest.config.ts

**File**: `vitest.config.ts` (new, root level)

**Intent**: Configure Vitest with node environment, the `@/*` path alias from tsconfig, and the test file include pattern.

**Contract**:
```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    globals: true,
    env: { loadEnvFile: true },   // loads .env.test automatically
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
```

#### 4. Update tsconfig.json

**File**: `tsconfig.json`

**Intent**: Exclude the coverage output directory from type-checking and register Vitest globals so `describe`, `it`, and `expect` are available without explicit imports.

**Contract**: Add `"coverage"` to the `exclude` array; add `"vitest/globals"` to `compilerOptions.types`.

#### 5. Create src/__tests__/ directory

**File**: `src/__tests__/.gitkeep` (new)

**Intent**: Establish the test directory so Vitest can include it on the first run, before test files are written.

#### 6. Create .env.test

**File**: `.env.test` (new, root level)

**Intent**: Supply Supabase local credentials to the Vitest process without coupling to Wrangler's `.dev.vars`.

**Contract**: Three keys — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — all targeting `http://127.0.0.1:54321`. Values copied from `.dev.vars`. File is gitignored.

#### 7. Update .gitignore

**File**: `.gitignore`

**Intent**: Prevent `.env.test` and the coverage directory from being tracked.

**Contract**: Add `.env.test` and `coverage/` if not already present.

#### 8. Update .env.example

**File**: `.env.example`

**Intent**: Document `.env.test` for the next developer so they know it exists and what keys to populate.

**Contract**: Add a commented block naming all three `.env.test` keys and pointing to `supabase status` as the source for the values.

### Success Criteria

#### Automated Verification

- `npm test` exits with "0 tests" or equivalent (no failures, no errors)
- `npm run test:coverage` exits cleanly and produces a `coverage/` directory
- `astro check` or `npx tsc --noEmit` passes with the updated tsconfig

#### Manual Verification

- `.env.test` appears in `.gitignore`; `git status` does not list it as untracked
- `vitest.config.ts` resolves `@/` to `src/` (no import errors in editor)

**Implementation Note**: After all automated checks pass, pause for manual confirmation before Phase 2.

---

## Phase 2: Balance Correctness Integration Tests (Risk #5)

### Overview

Write `src/__tests__/balance.test.ts`. Create two fresh test users and a fresh group in `beforeAll`, insert expenses via `create_expense()` RPC with a member JWT, then assert `member_balances` VIEW output against independently computed oracle values.

### Changes Required

#### 1. Create balance integration test file

**File**: `src/__tests__/balance.test.ts` (new)

**Intent**: Assert three scenarios using the oracle formula `net_balance = total_paid − total_owed`. Expected values must be derived from this formula, not from reading the VIEW's output first (oracle problem).

**Contract**: One `describe('member_balances — balance correctness')` block with three `it` blocks:

**`it` 1 — Zero-sum invariant**
Setup: testAlice pays an expense of 1000 grosze split equally between testAlice and testBob (500 each). Query `member_balances` as testAlice.
Oracle: Alice: `total_paid = 1000`, `total_owed = 500`, `net_balance = +500`. Bob: `total_paid = 0`, `total_owed = 500`, `net_balance = −500`.
Assertion: `alice.net_balance + bob.net_balance === 0`.

**`it` 2 — Individual balance values**
Same expense as `it` 1.
Assertion: `alice.net_balance === 500` AND `bob.net_balance === -500`. Values derived from oracle formula, not from prior VIEW query.

**`it` 3 — Equal-split rounding edge (prime total)**
Setup: testAlice pays 101 grosze split equally between testAlice and testBob. Per `AddExpenseSheet.tsx:73–80`, floor = 50, remainder = 1, first participant (testAlice) gets 51, testBob gets 50.
Assertion: `alice.net_balance === 50` (`101 − 51 = 50`) AND `bob.net_balance === -50` (`0 − 50 = -50`). Sum = 0.

`beforeAll`:
1. Create `supabaseAdmin` with service_role key from `process.env.SUPABASE_SERVICE_ROLE_KEY`.
2. Create testAlice and testBob via `supabaseAdmin.auth.admin.createUser({ email, password })` with unique test emails.
3. Sign in as testAlice and testBob via `supabase.auth.signInWithPassword()` to obtain JWTs.
4. Create a test group via admin insert into `groups` (or via `supabase.rpc` if available).
5. Add testAlice and testBob to `group_members` via admin insert.
6. Store `groupId`, both JWTs, and both user IDs for test use.

Expense insertion: call `supabaseAsAlice.rpc('create_expense', { p_group_id, p_description, p_amount, p_paid_by: alice.id, p_participants: [...] })` — this uses testAlice's JWT (authenticated) and the `SECURITY DEFINER` RPC to bypass RLS on INSERT.

`afterAll`:
1. Delete group via admin (cascades expenses and group_members).
2. Delete testAlice and testBob via `supabaseAdmin.auth.admin.deleteUser()`.

### Success Criteria

#### Automated Verification

- `npm test` finds and runs `balance.test.ts`; all 3 `it` blocks pass
- TypeScript in `balance.test.ts` compiles without errors

#### Manual Verification

- Test output names all 3 scenarios with descriptive labels
- No orphaned rows in `expenses` or `group_members` after test run (verify via Supabase Studio or `psql`)

**Implementation Note**: After automated checks pass, verify cleanup manually before Phase 3.

---

## Phase 3: RLS Cross-Group Isolation Tests (Risk #1)

### Overview

Write `src/__tests__/rls-isolation.test.ts`. Create testAlice (member) and testCharlie (non-member) dynamically. Insert an expense as testAlice. Assert that testCharlie's SDK queries return 0 rows from both `expenses` and `member_balances`; assert testAlice still sees her data (proves the empty result is the RLS filter, not a broken group).

### Changes Required

#### 1. Create RLS isolation test file

**File**: `src/__tests__/rls-isolation.test.ts` (new)

**Intent**: Prove cross-group isolation by authenticating as a real non-member user (not superuser, not unauthenticated) and asserting 0 rows from the two tables that carry financial data. Also prove the positive path works for a member, so the test fails if the group itself is broken.

**Contract**: One `describe('expenses + member_balances — non-member isolation')` block with four `it` blocks:

**`it` 1 — Non-member sees 0 rows in expenses**
`supabaseAsCharlie.from('expenses').select('*').eq('group_id', groupId)`.
Assertion: `data.length === 0`, `error === null`.

**`it` 2 — Non-member sees 0 rows in member_balances**
`supabaseAsCharlie.from('member_balances').select('*').eq('group_id', groupId)`.
Assertion: `data.length === 0`, `error === null`.

**`it` 3 — Non-member sees 0 rows in groups table**
`supabaseAsCharlie.from('groups').select('*').eq('id', groupId)`.
Assertion: `data.length === 0`, `error === null`. (Secondary signal: confirms isolation extends to the groups row, not just expenses.)

**`it` 4 — Member sees the expense (positive path)**
`supabaseAsAlice.from('expenses').select('*').eq('group_id', groupId)`.
Assertion: `data.length === 1` (the expense inserted in `beforeAll`). This is the load-bearing positive path that prevents false-green: if the group setup is broken, Alice also gets 0 rows and `it` 1–3 pass vacuously.

`beforeAll`:
1. Create `supabaseAdmin` with service_role key.
2. Create testAlice and testCharlie via `supabaseAdmin.auth.admin.createUser()` with unique test emails and passwords.
3. Sign in as testAlice and testCharlie to obtain JWTs.
4. Create a fresh group, add testAlice only to `group_members` (testCharlie is intentionally absent).
5. Insert one expense (1000 grosze, testAlice paid, testAlice owes 1000) via `supabaseAsAlice.rpc('create_expense', ...)`.

`afterAll`:
1. Delete group via admin (cascades expenses and memberships).
2. Delete testAlice and testCharlie via `supabaseAdmin.auth.admin.deleteUser()`.

### Success Criteria

#### Automated Verification

- `npm test` runs `rls-isolation.test.ts`; all 4 `it` blocks pass
- testCharlie does not exist in `supabase.auth.admin.listUsers()` after the test run (cleanup verified programmatically or by inspection)

#### Manual Verification

- Run `supabase stop` then `npm test` — confirm a clear connection error, not a silent pass (proves tests require real infra)
- Supabase Studio shows no leftover test groups, users, or expenses after the run

**Implementation Note**: Confirm cleanup manually and run the connection-error check before Phase 4.

---

## Phase 4: Cookbook Update

### Overview

Replace the `TBD` placeholders in `§6.1` and `§6.2` of `context/foundation/test-plan.md` with the patterns shipped in Phase 2 and 3. Advance Phase 1 status to `complete`.

### Changes Required

#### 1. Update §6.1 — balance integration pattern

**File**: `context/foundation/test-plan.md` (§6.1)

**Intent**: Document the pattern concretely so Phase 2 of the rollout can extend balance tests without re-discovering the setup.

**Contract**: Replace the TBD line with: test file location, oracle formula, two-client setup (admin + JWT), run command (`npm test`), and the oracle-problem anti-pattern warning.

#### 2. Update §6.2 — RLS two-user integration pattern

**File**: `context/foundation/test-plan.md` (§6.2)

**Intent**: Document the non-member isolation pattern so Phase 2's endpoint tests know the baseline infra contract.

**Contract**: Replace the TBD line with: test file location, dynamic user lifecycle (create/delete via admin API), two-client pattern, superuser anti-pattern, and the load-bearing positive path (`it` 4 — member sees data).

#### 3. Advance Phase 1 status in §3

**File**: `context/foundation/test-plan.md` (§3 rollout table)

**Intent**: Mark Phase 1 as `complete` once all Progress items are checked.

**Contract**: Change `implementing` → `complete` in the Phase 1 row of the §3 table.

### Success Criteria

#### Automated Verification

- `npm test` still passes after cookbook edits (no regressions)

#### Manual Verification

- §6.1 and §6.2 are filled in; no `TBD` remains in either sub-section
- Phase 1 row in §3 shows `complete`

---

## Testing Strategy

### Integration Tests

- `src/__tests__/balance.test.ts` — 3 scenarios (zero-sum, individual values, rounding edge case)
- `src/__tests__/rls-isolation.test.ts` — 4 scenarios (non-member 0 rows for expenses, balances, groups; member sees data)

### Manual Testing Steps

1. Run `supabase start` then `npm test` — all 7 assertions pass.
2. Run `supabase stop` then `npm test` — connection error, not silent pass.
3. Run `npm run test:coverage` — `coverage/` directory produced.
4. Inspect Supabase Studio after test run — no orphaned rows.

## References

- Research: `context/changes/testing-critical-path-safety-net/research.md`
- Balance VIEW: `supabase/migrations/20260610182008_expense_balance_layer.sql:10–20`
- RLS SELECT policy: `supabase/migrations/20260609213602_initial_schema.sql:141–143`
- `is_group_member()`: `supabase/migrations/20260609213602_initial_schema.sql:63–66`
- Rounding logic: `src/components/expenses/AddExpenseSheet.tsx:73–80`
- API 403 guard (Phase 2 scope): `src/pages/api/groups/[id]/expenses.ts:43–55`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Environment Setup

#### Automated

- [x] 1.1 `npm test` exits cleanly with 0 tests found — 2bd6a6a
- [x] 1.2 `npm run test:coverage` exits cleanly and produces coverage/ directory — 2bd6a6a
- [x] 1.3 `astro check` / `npx tsc --noEmit` passes with updated tsconfig — 2bd6a6a

#### Manual

- [x] 1.4 .env.test is listed in .gitignore and not in git status — 2bd6a6a
- [x] 1.5 vitest.config.ts resolves @/ to src/ without import errors in editor — 2bd6a6a

### Phase 2: Balance Correctness Tests (Risk #5)

#### Automated

- [x] 2.1 `npm test` finds and runs balance.test.ts; all 3 it blocks pass — 801c1ce
- [x] 2.2 TypeScript in balance.test.ts compiles without errors — 801c1ce

#### Manual

- [x] 2.3 Test output names all 3 scenarios with descriptive labels — 801c1ce
- [x] 2.4 No orphaned rows in expenses or group_members after test run — 801c1ce

### Phase 3: RLS Isolation Tests (Risk #1)

#### Automated

- [x] 3.1 `npm test` runs rls-isolation.test.ts; all 4 it blocks pass — 52d7f55
- [x] 3.2 testCharlie does not exist in admin user list after test run — 52d7f55

#### Manual

- [x] 3.3 `supabase stop` then `npm test` produces a clear connection error, not silent pass — 52d7f55
- [x] 3.4 No leftover test groups or users in Supabase Studio after test run — 52d7f55

### Phase 4: Cookbook Update

#### Automated

- [x] 4.1 `npm test` still passes after cookbook edits — c217539

#### Manual

- [x] 4.2 §6.1 and §6.2 in test-plan.md filled in; no TBD remains — c217539
- [x] 4.3 Phase 1 row in §3 shows complete — c217539
