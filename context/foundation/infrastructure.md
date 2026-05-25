---
project: TripSplit
researched_at: 2026-05-25
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript / JavaScript
  framework: Astro 6 SSR
  runtime: Cloudflare workerd (edge)
  database: Supabase (PostgreSQL + Realtime, external)
  adapter: "@astrojs/cloudflare v13.5.0"
---

## Recommendation

**Deploy on Cloudflare Workers.**

The project is already wired for it: `@astrojs/cloudflare` v13.5.0 is installed, `wrangler.jsonc` uses the Workers `main` entrypoint and `assets` binding, and `wrangler` v4.90.0 is in devDependencies. No adapter swap, no migration, no new runtime to learn. The platform scores Pass on all five agent-friendly criteria, offers a generous free tier (100k requests/day ≈ 3M/month), and Cloudflare publishes best-in-class agent-readable docs (`llms.txt`, per-product full text, Markdown for Agents on every docs page). For an after-hours solo MVP with DX as the priority, this is the lowest-friction path from code to production.

---

## Platform Comparison

Six platforms were researched and scored against the five agent-friendly criteria. Hard filters were applied first: no platforms were dropped (no persistent server connections required from the hosting layer — Supabase Realtime handles live updates client-side). Interview weights: DX over cost, single region acceptable, external providers (Supabase, OpenRouter) fine.

| Platform | CLI-first | Managed/Serverless | Agent Docs | Stable Deploy API | MCP / Integration | **Score** |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | **5 Pass** |
| **Vercel** | Pass | Pass | Pass | Pass | Partial¹ | **4P + 1Pa** |
| **Netlify** | Partial² | Pass | Pass | Pass | Pass | **4P + 1Pa** |
| **Render** | Partial³ | Pass | Pass | Pass | Partial⁴ | **3P + 2Pa** |
| **Railway** | Partial² | Partial⁵ | Pass | Pass | Partial⁶ | **2P + 3Pa** |
| **Fly.io** | Partial⁷ | Partial⁵ | Partial⁸ | Pass | Partial⁹ | **1P + 4Pa** |

¹ Vercel MCP is Public Beta (Aug 2025). ² No CLI rollback — dashboard only. ³ Render MCP is read-only — cannot trigger deploys. ⁴ Same as ³. ⁵ Requires container/Dockerfile or Nixpacks — more operational surface than serverless. ⁶ MCP is Preview / work-in-progress. ⁷ `fly launch` auto-detection broken for Astro 5/6 (unresolved Jan 2026). ⁸ No `llms.txt` (404) — docs available on GitHub but no structured index. ⁹ `fly mcp server` is Experimental.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Already the target runtime in the scaffold. `@astrojs/cloudflare` v13.5.0 exclusively targets Workers; `wrangler.jsonc` is already in Workers format. Free tier covers 3M requests/month (well above MVP scale). Docs are the most agent-friendly of any platform researched — `llms.txt`, per-product `llms-full.txt`, and `Accept: text/markdown` on every docs page. Cloudflare's MCP server is GA. No adapter swap, no Dockerfile, no extra configuration needed.

#### 2. Vercel

Strong DX, native CLI rollback (`vercel rollback [url]`), automatic PR preview URLs in GitHub. Requires switching from `@astrojs/cloudflare` to `@astrojs/vercel` (adapter swap, Cloudflare-specific imports must be removed). Commercial MVP requires Pro plan at $20/month (Hobby is explicitly non-commercial). Vercel MCP is in Public Beta. Runner-up for teams willing to pay for the smoother PR-preview workflow.

#### 3. Netlify

GA MCP server (June 2025), atomic deploys, free `llms.txt`. Personal plan at $9/month is viable. Requires adapter swap to `@astrojs/netlify` plus awareness of the mixed-runtime architecture: Astro middleware runs on Deno (edge functions), SSR pages run on Node.js Lambda — two separate runtimes with different env-var access patterns. No CLI rollback; free tier hard-caps (site goes dark at 300 credits). Third place due to mixed-runtime complexity and rollback gap.

---

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **10ms CPU time limit on the free tier is invisible until it breaks production.** The limit counts CPU cycles consumed by the V8 isolate — not elapsed time. Async Supabase I/O doesn't count; tight expense-balance calculation loops do. Most developers assume it's a wall-clock limit and are surprised when low-traffic pages return 1101 errors.
2. **No historical logs on the free tier.** `wrangler tail` is real-time only. Workers Logs (persistent, queryable) requires the Workers Paid plan ($5/month). Debugging a production error from 2 hours ago is impossible on free — you must reproduce it or upgrade.
3. **`Astro.locals.runtime.env` is deprecated in v13 and fails silently.** The adapter deprecated this API in v13. Scaffold code that accesses env through `Astro.locals.runtime` may return `undefined` for some bindings rather than throwing, producing subtle auth failures rather than an obvious error.
4. **`workerd` rejects CommonJS at runtime.** Any npm dependency using `require()`/`module.exports` fails in production (but may work in `astro dev` which runs on Node.js). A single transitive CJS dependency is enough to break a route with a cryptic error.
5. **No automatic PR preview URLs without custom CI.** Cloudflare Workers doesn't auto-comment preview URLs on GitHub pull requests (Cloudflare Pages had this). Setting it up requires `wrangler versions upload` in CI plus a custom script to post the URL as a PR comment.

### Pre-Mortem — How This Could Fail

The team shipped TripSplit on Cloudflare Workers. Three months in, a participant reported expense pages returning HTTP 1101 errors during an actual trip — the worst possible moment. The culprit was a `Intl.NumberFormat` locale library added for PLN formatting that burned more than 10ms CPU on large expense lists. Debugging took two days: there were no historical logs on the free plan, only real-time tail, which showed nothing by the time anyone looked. The team upgraded to the Workers Paid plan ($5/month) to get persistent logs and a higher CPU ceiling, but the diagnosis had already cost a weekend.

The second incident was subtler: `Astro.locals.runtime.env.SUPABASE_KEY` returned `undefined` in two API routes because the v13 adapter deprecated that access pattern. The Supabase client silently initialized with `undefined` as the key, producing 401 errors that looked like Supabase auth failures. It took a week to trace back to the deprecated scaffold pattern rather than a Supabase configuration issue.

The platform itself was not wrong. The workerd-specific constraints and the deprecated scaffold API patterns were underestimated — both are fixable before first deploy with the right awareness.

### Unknown Unknowns

- **CPU time ≠ wall clock time**: The 10ms free-tier limit counts V8 CPU cycles. JSON parsing, regex, and arithmetic burn CPU; `await fetch()` waiting for Supabase does not. Profile CPU-bound code paths before assuming the free tier is sufficient at scale.
- **Workers doesn't auto-comment PR preview URLs**: Setting up branch-preview-URL workflows requires `wrangler versions upload` in CI and a custom GitHub Actions step. Teams expecting Vercel/Pages-style automatic previews will be surprised.
- **`wrangler dev` vs `astro dev` differ for Workers bindings**: `astro dev` runs on Node.js and doesn't load Workers bindings (KV, D1, etc.). `wrangler dev` runs on `workerd` and does. Since the app uses Supabase externally rather than Workers-native bindings, this isn't a risk today — but becomes one the moment any Workers binding is added.
- **`observability.enabled: true` in `wrangler.jsonc` requires the Workers Paid plan to activate**: The config key is already set in the scaffold, but persistent Workers Logs telemetry is silently dropped on the free plan. Upgrade to Workers Paid ($5/month) to enable it.
- **`wrangler.jsonc` `name` is "10x-astro-starter" — must be updated before first deploy**: Deploying without changing the name will create a Worker named `10x-astro-starter` in Cloudflare's dashboard, not `trip-split`. It cannot be renamed after creation — you would have to delete and redeploy.

---

## Operational Story

- **Preview deploys**: No automatic PR-preview-URL comments on GitHub. To get a preview URL: run `npx wrangler versions upload` in CI, then retrieve the versioned URL from the Cloudflare dashboard or Workers API. Accept this gap for MVP; wire the PR comment step when CI is set up. Preview URLs require manual Cloudflare Access protection if they should be private.
- **Secrets**: `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY` — secrets live in Cloudflare's encrypted store per Worker. Local dev uses `.dev.vars` (gitignored). Rotation: re-run `wrangler secret put <name>` with the new value; takes effect on the next request with no redeploy required.
- **Rollback**: No native `wrangler rollback` command. Options: (1) `git revert` + `npm run build && npx wrangler deploy` (~2 min to rebuild and go live); (2) Cloudflare dashboard → Workers → select a prior deployment → "Activate". Database migrations do not roll back automatically — coordinate schema rollbacks separately.
- **Approval**: Agent may automate: `wrangler deploy`, `wrangler tail`, `wrangler secret put` (adding/rotating secrets). Human-only: deleting the Worker project, rotating the primary Supabase service role key, billing changes, Workers Paid plan upgrades.
- **Logs**: Real-time tail: `npx wrangler tail --format json` (free). Historical/persistent: Workers Logs via `observability.enabled: true` in `wrangler.jsonc` (already set) — requires Workers Paid plan ($5/month) to activate.

---

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `wrangler.jsonc` name is "10x-astro-starter" — Worker created with wrong name on first deploy | Research finding | H | M | Update `name` to `"trip-split"` in `wrangler.jsonc` before running `wrangler deploy` |
| 10ms CPU time limit causes 1101 errors for CPU-intensive SSR routes on free tier | Unknown unknowns | M | H | Profile CPU-bound routes (balance calc, JSON parse of large expense lists); upgrade to Workers Paid ($5/mo) before launch |
| No historical logs on free plan — debugging past incidents impossible | Research finding | H | M | Enable Workers Logs by upgrading to Workers Paid ($5/mo); `observability.enabled: true` already set in `wrangler.jsonc` |
| `Astro.locals.runtime.env` deprecated in v13 — silently returns undefined | Research finding | M | H | Audit all API routes; replace with `astro:env/server` imports (`SUPABASE_URL`, `SUPABASE_KEY` already declared in `astro.config.mjs`) |
| CJS npm dependency fails in workerd at runtime with no dev-time warning | Devil's advocate | M | H | Run `npx publint` on suspicious dependencies; prefer ESM alternatives; test with `wrangler dev` not `astro dev` |
| No automatic PR preview URLs without custom CI | Pre-mortem | H | L | For MVP: use Cloudflare dashboard to retrieve version URLs manually; wire `wrangler versions upload` + GitHub comment script when CI is set up |
| `observability.enabled: true` silently drops telemetry on free plan | Unknown unknowns | H | L | Upgrade to Workers Paid ($5/mo) to activate persistent logs; treat free-tier telemetry config as non-functional |
| KV eventual consistency (~60s) if KV caching is added later | Unknown unknowns | L | M | Keep sessions in Supabase (already planned); document KV consistency limits before any KV caching is introduced |

---

## Getting Started

The project is already configured for Cloudflare Workers. These are the exact steps for the first deploy:

1. **Rename the Worker in `wrangler.jsonc`** — change `"name": "10x-astro-starter"` to `"name": "trip-split"`. This cannot be changed after first deploy without deleting the Worker.

2. **Authenticate with Cloudflare:**
   ```bash
   npx wrangler login
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

4. **Deploy:**
   ```bash
   npx wrangler deploy
   ```
   This creates the `trip-split` Worker at `trip-split.<your-account>.workers.dev`.

5. **Set secrets** (after the Worker exists):
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   ```
   Enter each value at the interactive prompt. Secrets take effect on the next request — no redeploy needed.

6. **Verify the deploy is live:**
   ```bash
   npx wrangler tail --format json
   ```
   Open the Workers URL in a browser; requests will stream in the tail output.

7. **Upgrade to Workers Paid ($5/month)** via the Cloudflare dashboard to activate persistent Workers Logs (already configured with `observability.enabled: true`) and raise the CPU time limit. Recommended before inviting real users.

---

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions wiring, auto-deploy on merge)
- Custom domain setup and DNS configuration
- Production-scale architecture (multi-region, HA, DR)
- Cloudflare Access configuration for preview URL protection
