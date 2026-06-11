<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-03 Zamknięcie i otwarcie rozliczenia

- **Plan**: context/changes/settlement-lock/plan.md
- **Mode**: Deep
- **Date**: 2026-06-11
- **Verdict**: REVISE → SOUND (all 3 findings fixed during triage)
- **Findings**: 1 critical  1 warning  1 observation

## Verdicts

| Dimension | Verdict |
|---|---|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

## Grounding

6/6 paths ✓ ([id].ts correctly absent; 5 existing files present), 5/5 symbols ✓ (is_locked, created_by, sheetOpen, expenses channel, is_group_member), brief↔plan ✓

Deep verification:
- `groups: member read` SELECT RLS policy exists at migration:117-119 — PATCH endpoint creator check is safe
- `create_expense` RPC is `SECURITY DEFINER` (expense migration:33) — API-level 423 guard is necessary and correct
- `[id].ts` + `[id]/` coexistence is safe: Astro collision detection only fires on identical segment paths
- `Group` type has one consumer (`[id].astro:16`, cast only, no literal) — `locked_at` addition is non-breaking

## Findings

### F1 — Phase 2 progress/criteria count mismatch

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 Progress section
- **Detail**: 8 manual success criteria bullets but only 7 manual progress items (2.4–2.10). "Non-creator cannot see or interact with the toggle button" (criteria #5) had no dedicated progress item — folded into 2.4. /10x-implement parses 1:1 mapping; mismatch causes mistracking.
- **Fix**: Add `- [ ] 2.11 Non-creator cannot see or interact with the toggle button` after item 2.10.
- **Decision**: FIXED — item 2.11 added to Progress section

### F2 — PATCH contract gap: locked_at not retrievable without .select()

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Change 3, PATCH endpoint contract
- **Detail**: In Supabase JS v2, `.update().eq()` returns no rows unless `.select()` is chained. The original contract said "UPDATE … Return 200 { is_locked, locked_at }" without specifying how to retrieve the values. A naive implementation would have no `locked_at` to return.
- **Fix**: Updated contract to specify `.update({...}).eq("id", groupId).select("is_locked, locked_at").single()`.
- **Decision**: FIXED — Phase 1 Change 3 contract updated with `.select()` chain

### F3 — handleToggleLock has no feedback on non-OK response

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Change 3, GroupExpensesIsland toggle handler
- **Detail**: Toggle handler updated state on res.ok and silently dropped failures. A 500 leaves the creator with a non-responsive button and no feedback.
- **Fix**: Added `else { console.error('[lock toggle] failed', res.status) }` to the handler contract.
- **Decision**: FIXED — else branch added to toggle handler contract
