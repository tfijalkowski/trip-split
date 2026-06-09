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

## 10xDevs AI Toolkit - Module 2, Lesson 4

Prepare for a harder implementation stream with the **research-backed planning chain**:

```
internal research (/10x-research) + external research (exa.ai, Context7) -> /10x-plan -> /10x-implement -> success
```

The lesson focus is distinguishing internal from external research and using evidence to back planning decisions.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Internal research (lesson focus)** | |
| `/10x-research <change-id>` | You need evidence from the existing codebase — patterns, conventions, integration points, or existing implementations. Runs parallel sub-agents over the repo and writes structured findings to `research.md`. |
| **External research (lesson focus)** | |
| exa.ai | You need AI-native web search for library comparisons, best practices, or ecosystem context that the codebase cannot answer. |
| Context7 (`resolve-library-id` → `get-library-docs`) | You need live, current documentation for a specific library or framework. Resolves a library ID first, then fetches relevant doc pages. |
| **Framing spare wheel** | |
| `/10x-frame <change-id>` | The plan won't converge, the plan doesn't deliver expected results, or persistent drift keeps breaking the implementation. Use as an escape hatch on a separate problem (demonstrated on Space Explorers example), not as pre-research ritual. |
| **Planning and execution** | |
| `/10x-plan <change-id>` / `/10x-implement <change-id> phase <n>` | Use the same planning and execution chain from Lesson 2, now with upstream research evidence feeding the plan. |

### Research discipline

- Internal research (`/10x-research`) answers "what does our codebase already do?" — patterns, schemas, conventions, integration points.
- External research (exa.ai, Context7) answers "what should we do?" — library capabilities, API docs, ecosystem best practices.
- Combine both as evidence-backed input to `/10x-plan`. A plan without research evidence on a non-trivial stream is a guess.
- Agent-friendly docs (`llms.txt`, markdown-for-agents, `/md` endpoints) are a quality signal for library selection — libraries that publish agent-readable docs integrate faster.

### `/10x-frame` as spare wheel

Three triggers for reaching for `/10x-frame`:
1. The plan won't converge — research keeps opening more questions instead of narrowing to a contract.
2. The plan doesn't deliver — implementation repeatedly fails to meet success criteria.
3. Persistent drift — the implementation keeps diverging from the plan in ways that suggest the problem was mis-framed.

Demonstrated on a Space Explorers example, not the SRS path. It is an escape hatch, not a mandatory step.

### Paths used by this lesson

- `context/changes/<change-id>/research.md` - internal research output
- `context/changes/<change-id>/frame.md` - framing output when needed
- `context/changes/<change-id>/plan.md` - evidence-backed implementation contract
- `context/foundation/lessons.md` - recurring rules and pitfalls

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
