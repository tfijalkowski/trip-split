---
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
---

## Why this stack

TripSplit is a solo after-hours web app serving small travel groups (3–10 users) who need auth, persistent expense data, live balance updates, and mobile-friendly UX — all in a 3-week MVP window. The `10x-astro-starter` (Astro + Supabase + Cloudflare) is the recommended default for `(web-app, js)` and clears all four agent-friendly gates: TypeScript throughout, file-based routing conventions, popular in JS training data, well-documented. Supabase delivers Google OAuth integration for FR-001/002, PostgreSQL for expense persistence, and Realtime subscriptions for the "live balance update without page refresh" requirement in Business Logic. Cloudflare Pages provides global edge delivery matching the mobile-in-the-field NFR. Standard path taken — recommended cell match accepted, no custom feature audit or quality override fired.
