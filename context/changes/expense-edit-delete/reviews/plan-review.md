<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-04 — Edycja i usuwanie wydatku

- **Plan**: context/changes/expense-edit-delete/plan.md
- **Mode**: Deep
- **Date**: 2026-06-11
- **Verdict**: REVISE → SOUND (all findings fixed)
- **Findings**: 0 critical | 2 warnings | 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

6/6 paths ✓, 4/4 symbols ✓, brief↔plan ✓

Paths verified: ExpenseDetailSheet.tsx, ExpenseTable.tsx, GroupExpensesIsland.tsx, src/pages/groups/[id].astro, src/pages/api/groups/[id]/expenses.ts, AddExpenseSheet.tsx.
Symbols verified: create_expense SECURITY DEFINER (returns uuid), RLS payer update (line 152) + payer delete (line 165), Group.created_by in types.ts.
No other callers of the three modified components outside the prop-threading chain.

## Findings

### F1 — update_expense returns void; create_expense pattern check always fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — PATCH handler, Critical Implementation Details
- **Detail**: create_expense RETURNS uuid. POST handler checks `if (rpcError || !expenseId)`. update_expense RETURNS void — data is always null. An implementer copying the pattern writes `if (rpcError || !data)` and always gets 500. Plan said "Mirrors the create_expense RPC pattern" without flagging this difference.
- **Fix**: Added note to Critical Implementation Details: "Since update_expense RETURNS void, check only `if (rpcError)` — not `if (rpcError || !data)` as in the create_expense pattern."
- **Decision**: FIXED

### F2 — Silent 200 on race-condition-locked DELETE

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — DELETE handler
- **Detail**: DELETE handler checks is_locked → 423 then calls .delete(). If group is locked between those steps, RLS silently rejects (0 rows, no error), handler returns 200 {}. Expense stays in DB; Realtime corrects it but creates ghost-delete UX. lessons.md explicitly warns about silent-0-rows pattern.
- **Fix**: Updated DELETE contract to use `.delete().select("id")` and check `data?.length === 0` → 423.
- **Decision**: FIXED

### F3 — confirmingDelete not listed in sheet-close reset

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — ExpenseDetailSheet, sheet-close state reset
- **Detail**: Plan's close-reset spec said "clear all form/error state" without listing confirmingDelete explicitly. If user clicks Delete then closes via Escape without confirming, the confirmation UI could persist on reopen.
- **Fix**: Added `confirmingDelete = false` explicitly to the close-reset spec.
- **Decision**: FIXED

### F4 — !supabase null guard absent from new route guard sequence

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — PATCH/DELETE handler guard sequence
- **Detail**: Existing POST handler checks `if (!supabase) return 500`. Plan's guard sequence for PATCH/DELETE omitted this step. Never triggers in practice (middleware always sets it) but inconsistent with the established pattern.
- **Fix**: Added step 0: supabase client present check to the guard sequence.
- **Decision**: FIXED
