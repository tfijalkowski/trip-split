# Critical-Path Safety Net — Plan Brief

> Full plan: `context/changes/testing-critical-path-safety-net/plan.md`
> Research: `context/changes/testing-critical-path-safety-net/research.md`

## What & Why

Bootstrap Vitest and ship the first two integration test suites that prove the two highest-signal risks in the rollout: that balance calculations are mathematically correct (Risk #5) and that a non-member user cannot read another group's expenses or balances (Risk #1). Both risks surface from the PRD's trust-critical requirements — "a balance error destroys trust" and "no financial data visible to non-members."

## Starting Point

No test runner, no test files, no test config. Balance calculation lives entirely in a SQL VIEW (`member_balances`), not in JS. RLS isolation for reads is policy-only (0 rows, 200 OK) — there is no GET API endpoint for expenses.

## Desired End State

`npm test` runs and 7 assertions pass across two test files in `src/__tests__/`. The balance suite proves the zero-sum invariant holds and per-user values match the oracle formula. The RLS suite proves a dynamically created non-member gets 0 rows from both `expenses` and `member_balances`, while the member still sees her data. `test-plan.md §6.1` and `§6.2` are filled in for Phase 2 to extend.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Test layer | Integration (real Supabase local) | Balance is SQL; RLS requires real JWT and real policy evaluation — no mock can give a real signal | Research |
| Test file location | `src/__tests__/` centralized | Integration tests span SQL + policy + SDK, not a single TS module — co-location would be misleading | Plan |
| Non-member user | Dynamic creation in `beforeAll` (admin API), deleted in `afterAll` | No seed pollution; tests are self-contained regardless of seed state | Plan |
| Test credentials | `.env.test` file (gitignored) | Clean separation mirroring `.dev.vars`; no Wrangler format coupling | Plan |
| Test data scope | Fresh group per `describe` block | Tests run in any order without shared state; safe to extend with more suites | Plan |
| POST 403 test | Deferred to Phase 2 | Requires a running Astro dev server; Phase 2 tests all endpoint guards together | Research / Plan |
| Coverage threshold | Skipped for Phase 1 | Bootstrapping only; any threshold is vacuously met with 7 tests | Plan |

## Scope

**In scope:**
- Vitest + `@vitest/coverage-v8` install and config
- `vitest.config.ts` (node env, `@/*` alias, `.env.test` loading)
- `src/__tests__/balance.test.ts` — 3 scenarios (zero-sum, individual values, rounding edge)
- `src/__tests__/rls-isolation.test.ts` — 4 scenarios (non-member 0 rows × 3 tables + member positive path)
- `test-plan.md §6.1` and `§6.2` cookbook entries

**Out of scope:**
- POST 403 endpoint guard (Phase 2)
- Component or UI tests
- Coverage threshold
- Mocking Supabase
- Playwright or e2e tests (Phase 3)

## Architecture / Approach

Each test suite follows a two-client pattern: `supabaseAdmin` (service_role key) is used only for user and group lifecycle — create users with known passwords, create groups, add memberships; `supabaseAsUser` (anon key + user JWT from `signInWithPassword`) is used for all RLS-scoped assertions. Oracle values for balance tests are derived from the formula `total_paid − total_owed`, computed independently before querying the VIEW.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Environment Setup | Vitest runs cleanly with 0 tests | Config mismatch breaks `@/*` alias or doesn't load `.env.test` |
| 2. Balance Tests | 3 passing assertions proving zero-sum + oracle values | Oracle problem: expected values accidentally derived from VIEW output |
| 3. RLS Isolation Tests | 4 passing assertions proving non-member 0-rows + member positive path | Missing positive path (`it` 4) makes the test green even on broken group setup |
| 4. Cookbook Update | §6.1 + §6.2 filled in; Phase 1 marked complete | TBD placeholder left in test-plan.md blocks Phase 2 from knowing the baseline pattern |

**Prerequisites:** `supabase start` must be running before `npm test`. Service_role key available in `.dev.vars`.
**Estimated effort:** ~2-3 sessions; each phase is independently completable.

## Open Risks & Assumptions

- **Supabase local must be running manually** — no globalSetup health check; a connection error is the failure signal.
- **`create_expense()` RPC callable with user JWT** — RPC is `GRANT EXECUTE ... TO authenticated`; requires a signed-in user, not anon. If this assumption is wrong, direct admin inserts into `expenses` + `expense_participants` are the fallback.
- **`admin.createUser()` and `admin.deleteUser()` available** — requires SDK v2.x with admin methods; confirmed by `@supabase/supabase-js: ^2.99.1` in package.json.

## Success Criteria (Summary)

- `npm test` passes with 7 assertions; `npm run test:coverage` produces a report.
- Running `supabase stop` then `npm test` produces a connection error — proves tests require real infra.
- No orphaned test data in Supabase local after any run.
