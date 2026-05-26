# Cloudflare Workers — First Deploy Plan

## Context

TripSplit is an Astro 6 SSR app already scaffolded and wired for Cloudflare Workers (`@astrojs/cloudflare` v13.5.0, `wrangler.jsonc` present, `wrangler` v4.90.0). The infrastructure research (`context/foundation/infrastructure.md`) has already selected Cloudflare Workers and documented risks. This plan executes the first deploy end-to-end: two blocking code fixes, authentication, build, deploy, secrets injection, Supabase external config, and verification.

---

## Prerequisites

### P1 — Cloudflare Account & Wrangler CLI

Wrangler is already in `devDependencies` — no global install needed. All `wrangler` commands run via `npx`.

- [x] **[HUMAN GATE]** Create a free Cloudflare account at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) if you don't have one
- [x] Confirm Node.js version matches `.nvmrc`: `node --version` (expect `v22.14.0`); run `nvm use` if not
- [x] Install dependencies: `npm ci`
- [x] Verify Wrangler is available: `npx wrangler --version` (expect `4.90.0`)
- [x] **[HUMAN GATE]** Authenticate Wrangler with your Cloudflare account: `! npx wrangler login`
  - This opens a browser OAuth flow — approve access in the browser
  - Session is stored in `~/.wrangler/config/default.toml` (machine-local, not committed)
- [x] Confirm session: `npx wrangler whoami` — note your **Account ID** and **email**

> **Tip**: `wrangler login` uses OAuth (browser). For CI/CD later, swap to an API token scoped to `Workers Scripts:Edit` only — never use the global API key.

---

### P2 — Supabase Remote Project

The app needs a **hosted** Supabase project (not just the local Docker instance). If you only have local Supabase running, complete this section first.

- [x] **[HUMAN GATE]** Create a project at [supabase.com/dashboard](https://supabase.com/dashboard) if you don't have one:
  - Choose a region close to your users (Cloudflare Workers are edge-deployed globally, but Supabase is single-region — latency matters)
  - Note the **Project ref** (the short ID in the URL, e.g. `abcdefghijklmnop`)
- [x] **[HUMAN GATE]** Collect credentials from Supabase dashboard → **Project Settings → API**:
  - `Project URL` → this is your `SUPABASE_URL` (e.g. `https://abcdefghijklmnop.supabase.co`)
  - `anon` / public key → this is your `SUPABASE_KEY` (safe to use with RLS; do NOT use the `service_role` key here)
- [ ] **[HUMAN GATE]** Install Supabase CLI if not present: `npm install -g supabase` or use `npx supabase`
- [ ] **[HUMAN GATE]** Authenticate the Supabase CLI: `! npx supabase login`
  - Opens browser to generate a personal access token; paste it back in the terminal
- [ ] Link the local project to the remote: `npx supabase link --project-ref <your-project-ref>`
  - Prompts for the database password you set when creating the project
- [ ] Verify the link: `npx supabase status` — should show `API URL` matching your remote project URL

> **RLS reminder** (from `CLAUDE.md`): Enable Row-Level Security on every table before exposing data. If your schema was created via Supabase Studio, verify RLS is on in the Table Editor → the table should show a shield icon.

> **Auth email settings**: Supabase projects default to email confirmations **enabled** in production. Make sure SMTP is configured (Supabase provides a default transactional email service) or use a custom SMTP provider under Authentication → Email Templates.

---

## Ordering Constraints (hard dependencies)

```
P1 (CF account + wrangler login) ──────────────────────────────────────────────→ Phase 4 (deploy)
P2 (Supabase project + creds)    ──────────────────────────────────────────────→ Phase 5 (secrets)
Phase 1 (code fixes)             → Phase 3 (build) → Phase 4 → Phase 5 → Phase 7 (smoke tests)
Phase 6 (Supabase URL config)    ──────────────────────────────────────────────→ Phase 7 (email test)
```

---

## Phase 0 — Environment Preflight

> Prerequisites P1 and P2 must be completed before this phase.

- [x] Confirm `node_modules` is present (P1 runs `npm ci`): `ls node_modules/.bin/wrangler`
- [x] Confirm active Wrangler session: `npx wrangler whoami`

---

## Phase 1 — Blocking Code Fixes

Two hard stops from `CLAUDE.md` must be resolved before building.

### Fix 1 — Worker name (immutable after first deploy)

- [x] Edit `wrangler.jsonc`: change `"name": "10x-astro-starter"` → `"name": "trip-split"`
- [x] **[HUMAN GATE]** Confirm `trip-split` is the correct name for the Cloudflare account — cannot be renamed post-deploy

> **Edge case 1**: Deploying with the wrong name creates an irrecoverable Worker entry. The only fix is delete + redeploy (new URL, secrets must be re-entered).

### Fix 2 — Missing `export const prerender = false` on API routes

Per `CLAUDE.md` hard stop: "omitting it silently serves a static 404."

- [x] Add `export const prerender = false;` as the first export in `src/pages/api/auth/signin.ts`
- [x] Add `export const prerender = false;` as the first export in `src/pages/api/auth/signup.ts`
- [x] Add `export const prerender = false;` as the first export in `src/pages/api/auth/signout.ts`

### Commit the fixes

- [x] Stage `wrangler.jsonc` + the three API route files
- [x] Commit: `fix: rename Worker to trip-split, add prerender=false to auth API routes`
- [x] Verify lint-staged (eslint + prettier) passes cleanly via pre-commit hook

---

## Phase 2 — Confirm Authentication

- [x] Verify active Wrangler session: `npx wrangler whoami` — confirms P1 login is still valid
- [x] Note the Account subdomain from the output (used to construct the Workers URL: `https://trip-split.tomekef.workers.dev`)

---

## Phase 3 — Build

- [x] Run `npm run build` (`astro build`)
- [x] Confirm `dist/` is produced and non-empty
- [x] Confirm the Workers entrypoint exists in `dist/` (the path `main` in `wrangler.jsonc` resolves to: `@astrojs/cloudflare/entrypoints/server`)
- [x] No TypeScript errors in build output

> **Edge case 7**: `import.meta.env.DEV` resolves to `false` at build time for Workers. The `confirm-email.astro` page will always show "Check your email" (no auto-confirm). This is correct production behavior — email confirmation is required.

---

## Phase 4 — First Deploy (Worker Registration)

- [x] Run `npx wrangler deploy`
- [x] Capture the deployed Workers URL from output (`https://trip-split.tomekef.workers.dev`)
- [x] Note: Worker is **unhealthy at this point** — Supabase secrets are not yet injected. Auth flows will fail until Phase 5 completes. Do not run smoke tests yet.

> **Edge case 3**: The 10ms free-tier CPU time limit counts V8 cycles (not wall-clock time). Async Supabase I/O doesn't count; balance calculations, JSON parsing, and regex do. Profile CPU-bound routes before real user traffic. Upgrade to Workers Paid ($5/mo) before launch to raise the limit.

> **Edge case 10** (ordering): `wrangler secret put` requires the Worker to exist — this is why Phase 4 must precede Phase 5.

---

## Phase 5 — Secrets Injection

- [x] **[HUMAN GATE]** Retrieve `SUPABASE_URL` and `SUPABASE_KEY` (anon public key) from Supabase dashboard → Project Settings → API → Project URL and `anon` key. Have both values ready.
- [x] Run `npx wrangler secret put SUPABASE_URL` — enter value at interactive prompt
- [x] Run `npx wrangler secret put SUPABASE_KEY` — enter value at interactive prompt
- [x] Verify both secrets are registered: `npx wrangler secret list`

> **Edge case 4**: Secrets take effect on the **next request** — no redeploy is needed after `wrangler secret put`.

> **Important**: `SUPABASE_KEY` is the `anon` public key (row-level security key), not the service role key. The service role key must never be stored here.

---

## Phase 6 — Supabase External Configuration

These are Cloudflare-independent settings in the Supabase dashboard that control where Auth redirects and what URLs appear in email templates.

- [x] **[SUPABASE DASHBOARD]** Navigate to: Authentication → URL Configuration
- [x] **[SUPABASE DASHBOARD]** Update `Site URL` from `http://127.0.0.1:3000` to `https://trip-split.tomekef.workers.dev`

> **Edge case 5**: Supabase embeds the `Site URL` in password-reset and email-confirmation links. A stale `Site URL` breaks all email-based auth flows in production.

- [x] **[SUPABASE DASHBOARD]** Add `https://trip-split.tomekef.workers.dev/**` to the `Redirect URLs` allowlist
- [x] **[SUPABASE DASHBOARD]** Keep `http://127.0.0.1:3000` in the allowlist (local dev must continue to work)

> **Edge case 6**: Without the Workers URL in the allowlist, OAuth and magic-link callbacks are blocked by Supabase with a redirect error.

---

## Phase 7 — Smoke Tests

Run these in order. Open `npx wrangler tail --format json` in a second terminal to stream live logs during testing.

- [x] `curl -I https://trip-split.tomekef.workers.dev` — expect HTTP 200 homepage
- [x] **[HUMAN GATE]** Open the Workers URL in a browser; confirm homepage renders
- [x] **[HUMAN GATE]** Navigate to `/auth/signup`; create a test account with a real email
- [x] **[HUMAN GATE]** Check inbox for Supabase confirmation email; click the confirmation link (email confirm is mandatory in production — `isAutoConfirmed` is `false` on Workers)
- [x] **[HUMAN GATE]** Navigate to `/auth/signin`; sign in with the test account; confirm redirect to `/dashboard`
- [x] **[HUMAN GATE]** Click "Sign out"; confirm redirect back to `/`
- [x] **[HUMAN GATE]** Attempt to access `/dashboard` while unauthenticated; confirm redirect to `/auth/signin`
- [x] Verify `wrangler tail` shows HTTP 200s for all flows above (no 500s or 1101s)

> **Edge case 8**: `wrangler tail` is the correct live-log tool for Workers (real-time only on free plan). `astro dev` logs are Node.js only — they do not reflect Workers behavior. If you see subtle auth failures in production that don't appear locally, test with `wrangler dev` (runs on `workerd`, not Node.js).

---

## Phase 8 — Post-Deploy Hardening

These are not blockers for first deploy but should be addressed before real users arrive.

### Persistent logs (Workers Paid)

- [ ] **[CLOUDFLARE DASHBOARD]** Decide: upgrade to Workers Paid plan ($5/month)?

> **Edge case 2**: `observability.enabled: true` is set in `wrangler.jsonc` but silently drops telemetry on the free plan. Persistent, queryable Workers Logs only activate on Workers Paid. Debugging a past incident without logs requires reproductions — this cost a weekend in the infrastructure pre-mortem scenario.

- [ ] If upgrading: Cloudflare dashboard → Workers & Pages → switch to Workers Paid
- [ ] Verify Workers Logs appear in the dashboard for recent requests after upgrade

### Known operational gaps (document, no action needed now)

- [ ] Document: No automatic PR preview URL comments on GitHub — to get preview URLs, use `npx wrangler versions upload` in CI + a custom script to post the URL as a PR comment. Acceptable gap for MVP.
- [ ] Document: Rollback procedure — no `wrangler rollback` command. Options: (1) `git revert` + `npm run build && npx wrangler deploy` (~2 min), or (2) Cloudflare dashboard → Workers → select prior deployment → "Activate".

---

## Files Modified

| File | Change |
|---|---|
| `wrangler.jsonc` | `name` → `"trip-split"` |
| `src/pages/api/auth/signin.ts` | Add `export const prerender = false` |
| `src/pages/api/auth/signup.ts` | Add `export const prerender = false` |
| `src/pages/api/auth/signout.ts` | Add `export const prerender = false` |

## Key References

- `context/foundation/infrastructure.md` — risk register, operational story, getting started steps
- `wrangler.jsonc` — Workers config (name, entrypoint, observability)
- `src/lib/supabase.ts` — uses `astro:env/server` (no deprecated `Astro.locals.runtime.env`)
- `astro.config.mjs` — `env.schema` declares `SUPABASE_URL` / `SUPABASE_KEY` as server-only secrets
