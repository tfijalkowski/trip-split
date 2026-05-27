# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard stops

- **API routes**: export `const prerender = false` on every API route — omitting it silently serves a static 404.
- **Database**: enable RLS on every new table with per-operation, per-role policies before any data is exposed.
- **Archive guard**: never write to `context/archive/`. If a resolved target path starts with `context/archive/`, abort — archived changes are immutable.

## Commands

`@README.md`

Pre-commit hooks (husky + lint-staged): `eslint --fix` on `*.{ts,tsx,astro}`, `prettier --write` on `*.{json,css,md}`.

No test runner is configured yet.

## Architecture

**Astro 6 SSR app** — React 19 islands, Tailwind 4, Supabase auth, shadcn/ui, deployed to Cloudflare Workers.

### Rendering

`output: "server"` in `astro.config.mjs` — all pages are SSR.

### Auth flow

- `src/lib/supabase.ts` — `createClient()` builds a Supabase SSR client using cookie-based sessions. `SUPABASE_URL` and `SUPABASE_KEY` are server-only secrets declared via Astro's `env.schema` in `astro.config.mjs` and accessed via `astro:env/server`.
- `src/middleware.ts` — resolves the current user on every request and attaches it to `context.locals.user`. Add paths to `PROTECTED_ROUTES` to require authentication; unauthenticated users are redirected to `/auth/signin`.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`

### Conventions

- **Path alias**: `@/*` → `./src/*` (tsconfig paths).
- **Astro vs React**: use Astro components for static layout/content; React only for island components requiring client-side state, event handlers, or browser APIs.
- **Class merging**: always use `cn()` from `@/lib/utils` (clsx + tailwind-merge) — never concatenate Tailwind class strings manually.
- **shadcn/ui**: components live in `src/components/ui/`, "new-york" style. Add new ones with `npx shadcn@latest add <name>`.
- **API routes**: export uppercase `GET`, `POST`, etc.
- **Supabase migrations**: `supabase/migrations/`, naming `YYYYMMDDHHmmss_short_description.sql`.
- **React hooks**: extract to `src/components/hooks/`. No Next.js-style directives (`"use client"` etc.).
- **Business logic / helpers**: `src/lib/` (or `src/lib/services/` when extracted).
- **Shared types** (entities, DTOs): `src/types.ts`.

### Environment

- Node.js v22.14.0 (see `.nvmrc`)
- Copy `.env.example` → `.env` (Node dev) or `.dev.vars` (Cloudflare local dev — gitignored)
- Local Supabase, Deploy & CI `@README.md`

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Change setup (lesson focus)** | |
| `/10x-new <change-id>` | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`. |
| **Planning (lesson focus)** | |
| `/10x-plan <change-id>` | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)** | |
| `/10x-plan-review <change-id>` | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin. |
| **Implementation (lesson focus)** | |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`. |
| **Lifecycle closure** | |
| `/10x-archive <change-id>` | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state. |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
