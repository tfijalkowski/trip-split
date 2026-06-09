# Google SSO — Plan Brief

> Full plan: `context/changes/google-sso/plan.md`

## What & Why

Replace the existing email/password auth with Google OAuth via Supabase. The email/password flow was a scaffold placeholder; the PRD (FR-001, FR-002) requires Google SSO as the only auth method. This is foundation F-01 — nothing else in the roadmap (groups, expenses, balances) can be built until a real login exists.

## Starting Point

The Supabase SSR client and middleware are already wired: `createClient()` sets cookie sessions, middleware reads `getUser()` on every request, and `/dashboard` is protected. The auth endpoints use `signInWithPassword` — the adapter layer needs no changes, only the method being called changes.

## Desired End State

Visiting `/auth/signin` shows a single "Continue with Google" button. Clicking it completes an OAuth round-trip and lands the user at `/dashboard` (or at a `redirect_to` URL if one was passed). All email/password routes and components are deleted. A developer can reproduce the flow locally by adding two Google credentials to `.dev.vars`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Email/password cleanup | Delete entirely | Atomic switch — no dead fallback code | Plan |
| redirect_to carry | Short-lived `auth_redirect` cookie | Simpler than OAuth state param; works without Supabase SDK internals | Plan |
| OAuth trigger | Server-side `GET /api/auth/google` | Consistent with existing POST-based auth pattern; no client bundle changes | Plan |
| Error surface | Redirect to `/auth/signin?error=...` | Reuses existing `ServerError` component and query-param pattern | Plan |
| Callback URLs | All three (4321, 8788, production) | Zero-cost to register; missing one causes cryptic `redirect_uri_mismatch` | Plan |
| Post-login default | `/dashboard` | Only protected page that exists | Plan |

## Scope

**In scope:** Google OAuth flow end-to-end, `auth_redirect` cookie carry for `redirect_to`, deletion of all email/password files, UI cleanup (one CTA on home, no signup link on signin page), local dev setup documentation.

**Out of scope:** Email/password fallback, `/auth/error` page, account linking, multiple OAuth providers, env vars in Astro's `env.schema` (Google creds are Supabase config, not app config).

## Architecture / Approach

```
User clicks button
  → GET /api/auth/google?redirect_to=...
      set cookie auth_redirect=<destination>
      supabase.auth.signInWithOAuth({ provider: 'google', redirectTo: <absolute /auth/callback> })
      → 302 to Google
          → Google redirects to Supabase
              → Supabase redirects to GET /auth/callback?code=...
                  exchangeCodeForSession(code)   ← sets session cookie
                  read + clear auth_redirect cookie
                  → 302 to destination (or /dashboard)
```

The Supabase SSR client (`@supabase/ssr`) handles session cookie management; middleware and `locals.user` stay unchanged.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Supabase Config & Env | Google provider enabled in local Supabase; env vars documented | `supabase start` fails if config.toml has syntax errors |
| 2. OAuth Routes | Two new GET routes handle the full OAuth round-trip | Callback URL not allow-listed → `redirect_uri_mismatch` from Google |
| 3. UI Swap & Cleanup | Google button replaces email form; dead files deleted | Broken import from a deleted file causes type-check failure |

**Prerequisites:** `supabase start` running locally, Google Cloud Console OAuth app created with callback URLs registered, credentials in `.dev.vars`.

**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- Google credentials must be provisioned manually — the plan documents the steps but can't automate the Google Cloud Console setup.
- The production domain placeholder in `additional_redirect_urls` must be updated before deploying; until then, production OAuth will fail silently.
- `skip_nonce_check = true` is required for local dev but is safe for production (Supabase recommendation for Google provider).

## Success Criteria (Summary)

- Full OAuth round-trip completes and lands the user at `/dashboard`
- Visiting a protected route while logged out → sign in → returns to that route
- `/auth/signup` returns 404; no email/password form exists anywhere
