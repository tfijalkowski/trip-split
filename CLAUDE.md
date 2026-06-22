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

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
