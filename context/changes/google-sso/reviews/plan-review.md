<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Google SSO Implementation Plan

- **Plan**: `context/changes/google-sso/plan.md`
- **Mode**: Deep
- **Date**: 2026-05-29
- **Verdict**: SOUND (after fixes)
- **Findings**: 1 critical · 2 warnings · 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL → PASS (F1 fixed) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → PASS (F2 fixed) |
| Plan Completeness | WARNING → PASS (F3 fixed) |

## Grounding

9/9 paths ✓ (8 existing files confirmed, 3 new files correctly absent), 5/5 symbols ✓, brief↔plan ✓

## Findings

### F1 — Callback handler at wrong file path

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Phase 2 — OAuth Callback Route file path
- **Detail**: `src/pages/api/auth/callback.ts` → Astro serves at `/api/auth/callback`, but the plan uses `/auth/callback` in config.toml allow-list, `new URL('/auth/callback', origin)`, and manual verification. Supabase redirects to `/auth/callback` which would 404 — OAuth cannot complete.
- **Fix**: Changed Phase 2 file path to `src/pages/auth/callback.ts`.
- **Decision**: FIXED

### F2 — Topbar.astro /auth/signup dead link not cleaned up

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — missing file in cleanup list
- **Detail**: `src/components/Topbar.astro:27,30` links to `/auth/signup`. Phase 3 removes the Sign Up CTA from Welcome.astro but missed Topbar.astro. After `signup.astro` is deleted, every page with the Topbar has a dead link.
- **Fix**: Added Topbar.astro cleanup as Phase 3 item 4; delete step renumbered to item 5.
- **Decision**: FIXED

### F3 — ServerError import syntax unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Updated sign-in page, Change 2
- **Detail**: `ServerError.tsx:7` uses `export function ServerError` (named export). Plan said "Import `ServerError` from..." which reads as default import — would fail TypeScript.
- **Fix**: Updated instruction to `import { ServerError } from "@/components/auth/ServerError"`.
- **Decision**: FIXED
