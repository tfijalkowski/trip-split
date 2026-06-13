# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-13 (Phase 1 change opened)

---

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic assertion that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface in <area>" carry the
   same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is produced
   by `/10x-research` during each rollout phase. If the plan and research
   disagree about where the failure lives, research is the ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/` (30 commits / 30 days).

---

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|-------------------------|--------|------------|--------------------------------|
| 1 | A non-member requests another group's expenses or balances via direct API call and receives data — cross-group isolation broken | High | Low | PRD §NFR (cross-group isolation guardrail), user interview Q1, hot-spot dir `supabase/migrations` (11 commits/30d) |
| 2 | An expense is added, edited, or deleted while the settlement is locked — server-side lock guard absent or missing from a new endpoint | High | Medium | User interview Q1, S-03 plan risk note (guard required on every CRUD endpoint), roadmap S-03/S-04 |
| 3 | Realtime subscription stops firing after a change to the island — balance update in a second tab stops without any error | High | Medium | User interview Q2+Q3 (confirmed incident), S-02 risk note, hot-spot dir `src/components/expenses` (15 commits/30d) |
| 4 | User A mutates User B's expense in the same group — ownership check wrong, or silent RLS 0-rows masks the bypass | High | Medium | User interview Q1, S-04 plan context (endpoints not yet written), PRD §FR-011/012, lessons.md (RLS silent 0-rows) |
| 5 | Custom split produces an incorrect net balance — grosze rounding error, or percentage shares not validated to sum to 100 server-side | High | Medium | PRD §Guardrails ("błąd w kwocie niszczy zaufanie"), §Business Logic, hot-spot dir `supabase/migrations` (11 commits/30d) |
| 6 | Invalid input bypasses the form and reaches the API — negative amount, whitespace-only display name, split percentages ≠ 100 — corrupting balance data | Medium | Medium | PRD §Business Logic, §FR-017/018, hot-spot dir `src/pages/api/groups/[id]` (6 commits/30d) |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | Non-member receives 0 rows or 403 — not a filtered 200 with empty array | "Empty array means RLS is working" — silent 0-rows is indistinguishable from correct policy; a test must verify with a second authenticated user, not an unauthenticated call | How the expenses endpoint checks group membership; what the RLS policy returns for a non-member; whether the API adds an explicit membership check on top of RLS | Integration (two real users against Supabase local) | Testing as superuser — RLS does not apply to superuser; the test must authenticate as a regular database user |
| #2 | A direct API call (bypassing UI) to mutate an expense in a locked group returns 423 Locked | "The UI disables the button, so the lock is enforced" — the UI is client-side; the server endpoint is the only enforcement point | Which endpoints exist and which carry the `is_locked` guard; how the guard is implemented; whether new S-04 endpoints include it | Integration (API call with fetch, assert 423, verify DB unchanged) | Testing only the UI button disabled state — catches nothing about server-side enforcement |
| #3 | After an expense mutation in session A, session B shows updated balances without a page refresh | "If the Realtime channel is subscribed, updates arrive" — the callback might not update state correctly after a prop refactor | How the Realtime channel is set up in the island; which events are subscribed; how the callback triggers a refetch or state update | E2e (Playwright two-page test — only layer that simulates two concurrent sessions) | Mocking the Realtime event — the test must trigger a real database write and observe the UI change |
| #4 | User A's PATCH or DELETE on User B's expense returns 403; the database row is unchanged after the call | "RLS blocks the mutation" — silent 0-rows means the API might return 200 while nothing was written; lessons.md confirms this pattern | API endpoint ownership-check logic; whether the check is RLS-only or also explicit in the handler; how the endpoint distinguishes "not found" from "not authorized" | Integration (two authenticated users; assert response status AND verify DB row unchanged) | Verifying only the response status — must also confirm the row was not modified in the database |
| #5 | Sum of all participant balances equals zero (zero-sum invariant); individual balances match an independently calculated expected value | "The UI shows the right number, so the calculation is correct" — the UI may display a rounded figure hiding an underlying fractional error | Where balance calculation lives (SQL function/view or application code); how grosze rounding is handled; how the zero-sum invariant is enforced | Unit (pure calculation function) if in JS/TS; integration (SQL function test against Supabase local) if in SQL | Deriving expected values from the implementation code (oracle problem — asserts current output, green-lights current bugs) |
| #6 | Direct API calls with invalid payloads each return 400; no invalid row exists in the database after the call | "The form validates it, so invalid data can't reach the API" — direct API calls bypass all form validation | What server-side validation schema (if any) exists per endpoint; which fields are validated and which are trusted from the client | Integration (malformed POST; assert 400 and DB state) | Testing only the happy path with valid input — these tests are exclusively about invalid and boundary inputs |

---

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|---------------|------------|--------|---------------|
| 1 | Critical-path safety net | Bootstrap test runner; prove balance correctness and RLS cross-group isolation at the cheapest layer | #5, #1 | unit + integration | change opened | context/changes/testing-critical-path-safety-net/ |
| 2 | API enforcement layer | Integration tests that lock bypass, ownership bypass, and invalid input all fail at the server boundary | #2, #4, #6 | integration | not started | — |
| 3 | Realtime + critical e2e | Two-session Playwright test proves live balance update; invite-link join on a locked group is exercised | #3, subset of #2 | e2e | not started | — |
| 4 | Quality-gates wiring | Typecheck, lint, unit+integration, and critical e2e are all enforced in CI; no gate is optional | cross-cutting | CI config | not started | — |

**Status vocabulary** (parser literals):
`not started` → `change opened` → `researched` → `planned` → `implementing` → `complete`

---

## 4. Stack

The classic test base for this project. No test runner is installed yet —
Phase 1 bootstraps it. Recommendations below are grounded in the detected
project manifest (Vite/Astro, Node 22, TypeScript) and the MCP tools
available in the current session.

| Layer | Tool | Notes |
|-------|------|-------|
| unit + integration | none yet — see §3 Phase 1 | Vitest recommended: native Vite ecosystem, co-located with the Astro config, TypeScript out-of-the-box. Integration tests target Supabase local dev (`supabase start`) for real RLS behavior — never a mock DB. |
| e2e | none yet — see §3 Phase 3 | Playwright recommended: multi-page / multi-session support required for Realtime tests (Risk #3). |
| typecheck | `astro check` / `tsc --noEmit` | Currently not in CI — Phase 4 adds it. |
| AI-native | not applicable | Product has no AI features (`has_ai: false`); no AI-native test layer justified under cost × signal. |

**Stack grounding tools (current session):**
- Docs: Context7 — available; not queried for specific tooling (manifest evidence sufficient); checked: 2026-06-13
- Search: Exa.ai — available; not queried (stack is well-known); checked: 2026-06-13
- Runtime/browser: Computer use — available (browser at read-tier; Playwright MCP not loaded in session); checked: 2026-06-13
- Provider/platform: Supabase MCP — available; relevant for Phase 1+2 integration test seeding (execute SQL, apply migrations against local branch); checked: 2026-06-13

---

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned but not enforced.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint | local + CI (already wired) | required | style and import errors |
| typecheck | local + CI | required after §3 Phase 4 | type drift across API, components, and Supabase types |
| unit + integration | local + CI | required after §3 Phase 1 | balance logic regressions, RLS policy regressions, API enforcement regressions |
| e2e on critical flows | CI on PR | required after §3 Phase 3 | Realtime subscription regressions, join-flow regressions |
| pre-deploy smoke | manual before prod deploy | optional | environment-specific config failures |

---

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships.

### 6.1 Adding a unit test (balance calculation)

TBD — see §3 Phase 1 for balance-correctness pattern (zero-sum invariant, custom split scenarios).

### 6.2 Adding an integration test (RLS + API endpoint)

TBD — see §3 Phase 1 (RLS non-member isolation) and Phase 2 (lock bypass, ownership, input validation) for the Supabase local + authenticated-user pattern.

### 6.3 Adding an e2e test (Playwright)

TBD — see §3 Phase 3 for the two-session Realtime pattern and the invite-link flow.

### 6.4 Adding a test for a new API endpoint

- **Test type**: integration (preferred over e2e unless full deployed shape is required).
- **Pattern**: TBD — see §3 Phase 2 for the endpoint-test pattern (authenticated fetch → assert status → verify DB state).
- **When to add e2e instead**: only when the failure mode requires a real browser session (auth cookie + handler crossing + UI state).

### 6.5 Per-rollout-phase notes

(Appended after each phase ships.)

---

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Google OAuth callback and auth pages** — the OAuth handshake is Google's and Supabase's responsibility; our code only handles the redirect destination. Re-evaluate if we ever implement a custom OAuth provider or add magic-link auth. (Source: Phase 2 interview Q5.)
- **Supabase client setup and SDK internals** — trust the SDK; tests that only call `createClient()` or check that a Supabase import resolves are not signal. Re-evaluate if we swap the Supabase client or add a custom fetch wrapper. (Source: implied by project constraints.)
- **UI snapshot tests** — Tailwind-heavy components change class strings constantly; snapshot churn catches nothing about behavior. Visual regressions are out of scope for this rollout. (Source: Phase 2 interview Q5 spirit; cost × signal principle §1.)

---

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-13
- Stack versions last verified: 2026-06-13
- AI-native tool references last verified: 2026-06-13 (not applicable — no AI-native layer)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
