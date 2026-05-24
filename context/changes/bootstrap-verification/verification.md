---
bootstrapped_at: 2026-05-24T10:26:43Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: trip-split
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: trip-split
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: true
  has_ai: false
  has_background_jobs: false
```

TripSplit is a solo after-hours web app serving small travel groups (3–10 users) who need auth, persistent expense data, live balance updates, and mobile-friendly UX — all in a 3-week MVP window. The `10x-astro-starter` (Astro + Supabase + Cloudflare) is the recommended default for `(web-app, js)` and clears all four agent-friendly gates: TypeScript throughout, file-based routing conventions, popular in JS training data, well-documented. Supabase delivers Google OAuth integration for FR-001/002, PostgreSQL for expense persistence, and Realtime subscriptions for the "live balance update without page refresh" requirement in Business Logic. Cloudflare Pages provides global edge delivery matching the mobile-in-the-field NFR. Standard path taken — recommended cell match accepted, no custom feature audit or quality override fired.

## Pre-scaffold verification

| Signal          | Value                                              | Severity | Notes                                         |
| --------------- | -------------------------------------------------- | -------- | --------------------------------------------- |
| npm package     | create-astro v5.0.6 published 2026-04-22T17:12:43Z | fresh    | resolved from cmd_template (npm create astro) |
| GitHub repo     | przeprogramowani/10x-astro-starter                 | not run  | gh CLI not installed; check skipped           |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold`
**Strategy**: clone starter repo without keeping its git history (git-clone)
**Exit code**: 0
**Files moved**: 20 (all non-conflicting scaffold files moved to cwd)
**Conflicts (.scaffold siblings)**: CLAUDE.md → CLAUDE.md.scaffold
**.gitignore handling**: moved silently (no pre-existing .gitignore in cwd)
**.bootstrap-scaffold cleanup**: in progress (deletion pending — user ran `rm -rf .bootstrap-scaffold/.git` manually; final `rm -rf .bootstrap-scaffold/` requires manual `! rm -rf .bootstrap-scaffold/` in terminal)

**npm install**: exit code 0, 774 packages installed

## Post-scaffold audit

**Tool**: npm audit --json
**Summary (pre-fix)**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0
**After `npm audit fix`**: 0 CRITICAL, 0 HIGH, 5 MODERATE, 0 LOW (5 resolved; 5 remaining require `--force` / semver-major downgrade of @astrojs/check — accepted as dev-only risk)

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** (transitive)
  Advisory: Svelte devalue: DoS via sparse array deserialization
  Advisory ID: GHSA-77vg-94rm-hx3p
  Affected range: 5.6.3 – 5.8.0
  Fix available: yes (`npm audit fix`)

#### MODERATE findings

- **@astrojs/check** (direct) — via @astrojs/language-server → volar-service-yaml → yaml-language-server. Fix: downgrade to @astrojs/check@0.9.2 (semver major).
- **wrangler** (direct) — via miniflare → ws. Fix available (`npm audit fix`).
- **@astrojs/language-server** (transitive) — via volar-service-yaml.
- **@cloudflare/vite-plugin** (transitive) — via miniflare, wrangler, ws.
- **miniflare** (transitive) — via ws.
- **volar-service-yaml** (transitive) — via yaml-language-server.
- **ws** (transitive) — Uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx), affected range 8.0.0–8.20.0.
- **yaml** (transitive) — Stack Overflow via deeply nested YAML (GHSA-48c2-rrv3-qjmp).
- **yaml-language-server** (transitive) — via yaml.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value               |
| ----------------------- | ------------------- |
| bootstrapper_confidence | first-class         |
| quality_override        | false               |
| path_taken              | standard            |
| self_check_answers      | null                |
| team_size               | solo                |
| deployment_target       | cloudflare-pages    |
| ci_provider             | github-actions      |
| ci_default_flow         | auto-deploy-on-merge|
| has_auth                | true                |
| has_payments            | false               |
| has_realtime            | true                |
| has_ai                  | false               |
| has_background_jobs     | false               |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- Run `! rm -rf .bootstrap-scaffold/` in your terminal to finish cleanup (the directory contains only the conflicting CLAUDE.md which was already saved as CLAUDE.md.scaffold).
- Run `git init` to start your own repo history.
- Review `CLAUDE.md.scaffold` — this is the starter's CLAUDE.md. Your existing CLAUDE.md was preserved as the winner; diff them if you want to pull in any starter-specific instructions.
- Address audit findings per your project's risk tolerance. The 1 HIGH finding (devalue DoS) is transitive and affects a dev-only path — low production risk. Run `npm audit fix` to resolve what's auto-fixable.
