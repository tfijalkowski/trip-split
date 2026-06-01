# Google SSO Implementation Plan

## Overview

Replace the existing email/password authentication with Google OAuth via Supabase. The flow: user lands on `/auth/signin` → clicks "Continue with Google" → redirected to Google → Google redirects to Supabase → Supabase redirects to `/auth/callback` → session cookie set → user lands at their destination (default `/dashboard`).

## Current State Analysis

The app has a complete email/password stack: `signInWithPassword`/`signUp` API routes, `SignInForm`/`SignUpForm` React components, and three auth pages (`signin.astro`, `signup.astro`, `confirm-email.astro`). The Supabase client (`src/lib/supabase.ts`) uses `@supabase/ssr` with cookie-based sessions — the correct adapter for OAuth too. Middleware already resolves `locals.user` via `getUser()` and protects `/dashboard`. No Google provider is configured in `supabase/config.toml`.

## Desired End State

A developer who fills in `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in `.dev.vars` and runs `supabase start && npm run dev` can complete a full Google OAuth sign-in ending at `/dashboard`. All email/password routes and components are deleted. Visiting `/auth/signin?redirect_to=/some/path` before signing in lands the user at `/some/path` after OAuth completes.

### Key Discoveries

- `src/lib/supabase.ts:createClient()` — works unchanged for OAuth; `exchangeCodeForSession()` sets the same cookie-based session
- `src/middleware.ts:PROTECTED_ROUTES` — guards `/dashboard` via `getUser()`; no changes needed
- `src/env.d.ts` — `locals.user` typed as `@supabase/supabase-js.User | null`; Google OAuth returns the same type
- `supabase/config.toml:[auth.external.apple]` — the commented template to copy for the Google block; note the `skip_nonce_check` flag
- `supabase/config.toml:site_url` — currently `http://127.0.0.1:3000`; should be `http://127.0.0.1:4321` (Astro dev port)
- `src/components/auth/ServerError.tsx` — kept; used in updated `signin.astro` as a static import (no `client:load` needed — not interactive)

## What We're NOT Doing

- Adding email/password as a fallback method
- Handling Google accounts without email (Supabase Google OAuth always returns email)
- Building a dedicated `/auth/error` page — errors surface via `/auth/signin?error=...`
- Changing `src/types.ts` or `src/env.d.ts` — the `User` type covers Google OAuth users unchanged
- Encoding `redirect_to` through the OAuth state param — cookie carry is simpler and doesn't require Supabase SDK internals

## Implementation Approach

Three phases in dependency order: configure Supabase for Google → add the two OAuth routes → swap UI and delete dead files. The `auth_redirect` cookie carries the post-login destination across the OAuth round-trip, avoiding any dependency on the OAuth state parameter.

## Critical Implementation Details

**Absolute callback URL**: `signInWithOAuth`'s `redirectTo` must be an absolute URL. Construct it as `new URL('/auth/callback', context.url.origin).toString()` — this picks the right host for local dev (4321), Wrangler (8788), and production automatically.

**Open redirect guard**: before storing `redirect_to` in the cookie in `/api/auth/google`, validate the value starts with `/` and does not start with `//` (to block protocol-relative URLs like `//evil.com`). Reject silently — fall back to `/dashboard`.

**skip_nonce_check**: required in `[auth.external.google]` for local Supabase dev with Google OAuth (per config.toml inline comment on the Apple block); safe to enable.

---

## Phase 1: Supabase Config & Env

### Overview

Wire the Google OAuth provider into the local Supabase config and document the required env vars. No application code changes in this phase.

### Changes Required

#### 1. Google provider block

**File**: `supabase/config.toml`

**Intent**: Enable Google as an auth provider for the local Supabase instance.

**Contract**: Add after the existing `[auth.external.apple]` block:

```toml
[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
redirect_uri = ""
skip_nonce_check = true
```

#### 2. Callback URL allow-list + site_url

**File**: `supabase/config.toml`

**Intent**: Allow Supabase to redirect to the callback route from all three environments, and correct the dev `site_url`.

**Contract**: Replace `site_url` and `additional_redirect_urls` under `[auth]`:

```toml
site_url = "http://127.0.0.1:4321"
additional_redirect_urls = [
  "http://127.0.0.1:4321/auth/callback",
  "http://127.0.0.1:8788/auth/callback",
  "https://<your-production-domain>/auth/callback"
]
```

#### 3. Env placeholder documentation

**File**: `.env.example`

**Intent**: Document the two new Google credentials that developers must supply locally.

**Contract**: Append after existing entries:

```
# Google OAuth (via Supabase) — obtain from Google Cloud Console
# Steps: console.cloud.google.com → Credentials → OAuth 2.0 Client ID → Web application
# Register these Authorized redirect URIs:
#   http://127.0.0.1:4321/auth/callback
#   http://127.0.0.1:8788/auth/callback
#   https://<your-production-domain>/auth/callback
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=
```

### Success Criteria

#### Automated Verification

- `supabase start` completes without errors (parses and validates config.toml on startup)

#### Manual Verification

- Supabase Studio (http://127.0.0.1:54323) → Authentication → Providers shows Google enabled

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: OAuth Routes

### Overview

Add two GET routes: `GET /api/auth/google` (initiates OAuth, carries `redirect_to` via cookie) and `GET /auth/callback` (exchanges the auth code for a session, reads the cookie, redirects).

### Changes Required

#### 1. OAuth initiation route

**File**: `src/pages/api/auth/google.ts`

**Intent**: Read `redirect_to` from query params, store it in a short-lived cookie, then send the user to Google via Supabase OAuth.

**Contract**:
- `export const prerender = false`
- `export const GET: APIRoute`
- Validate `redirect_to`: accept only values that start with `/` and do not start with `//`; default to `/dashboard`
- Set cookie `auth_redirect` with the validated destination: `httpOnly: true, sameSite: 'lax', maxAge: 300, path: '/'`
- Construct `callbackUrl = new URL('/auth/callback', context.url.origin).toString()`
- Call `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl } })`
- On Supabase error or missing `data.url`: redirect to `/auth/signin?error=${encodeURIComponent(error.message)}`
- On success: `return context.redirect(data.url, 302)`

#### 2. OAuth callback route

**File**: `src/pages/auth/callback.ts`

**Intent**: Exchange the OAuth code for a session, then send the user to their destination.

**Contract**:
- `export const prerender = false`
- `export const GET: APIRoute`
- Read `error` and `error_description` from URL search params; if present, redirect to `/auth/signin?error=${encodeURIComponent(error_description ?? error)}`
- Read `code` from URL search params; if missing, redirect to `/auth/signin?error=Missing+auth+code`
- Call `supabase.auth.exchangeCodeForSession(code)`; on error, redirect to `/auth/signin?error=${encodeURIComponent(error.message)}`
- Read `auth_redirect` cookie value; clear it by setting the cookie with `maxAge: 0`
- Redirect to the cookie value or `/dashboard`

### Success Criteria

#### Automated Verification

- `npm run typecheck` passes — no type errors in the two new routes

#### Manual Verification

- Clicking "Continue with Google" on `/auth/signin` redirects to accounts.google.com
- After completing Google sign-in, browser lands at `/dashboard`
- Denying Google permission redirects to `/auth/signin` with a visible error message
- Visiting `/dashboard` while logged out → sign in with Google → lands at `/dashboard` (redirect_to carried correctly)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 3.

---

## Phase 3: UI Swap & Cleanup

### Overview

Replace the sign-in form with a Google button, remove defunct signup entry points, and delete all email/password files.

### Changes Required

#### 1. Google sign-in button component

**File**: `src/components/auth/GoogleSignInButton.astro`

**Intent**: A static link styled as a button that initiates Google OAuth, forwarding `redirectTo` as a query param when present.

**Contract**:
- Props: `{ redirectTo?: string | null }`
- Renders an `<a>` with `href="/api/auth/google"` (append `?redirect_to=${encodeURIComponent(redirectTo)}` when `redirectTo` is truthy)
- Style: full-width, `border border-white/20 bg-white/10 hover:bg-white/20`, matching the existing glass-card button style
- Include the Google "G" inline SVG logo + "Continue with Google" label

#### 2. Updated sign-in page

**File**: `src/pages/auth/signin.astro`

**Intent**: Replace the React form island with the static Google button; thread `redirect_to` through.

**Contract**:
- Add `const redirectTo = Astro.url.searchParams.get("redirect_to")`
- Replace `import SignInForm from "@/components/auth/SignInForm"` with `import GoogleSignInButton from "@/components/auth/GoogleSignInButton.astro"`
- Import `ServerError` as a named export: `import { ServerError } from "@/components/auth/ServerError"` (no `client:load` — static server render)
- Replace the `<SignInForm serverError={error} client:load />` block with `<ServerError message={error} />` then `<GoogleSignInButton redirectTo={redirectTo} />`
- Remove the "Don't have an account? Sign up" paragraph

#### 3. Home page cleanup

**File**: `src/components/Welcome.astro`

**Intent**: Remove the Sign Up CTA — only the Sign In button remains.

**Contract**: Delete the Sign Up `<a>` element and its containing flex wrapper if it becomes a single-child. Keep the `<a href="/auth/signin">Sign In</a>` button.

#### 4. Topbar cleanup

**File**: `src/components/Topbar.astro`

**Intent**: Remove the Sign Up link from the unauthenticated nav — no signup entry point should remain after `signup.astro` is deleted.

**Contract**: Delete the `<a href="/auth/signup">Sign up</a>` element (and its surrounding whitespace). The parent `<div class="flex gap-3">` retains the Sign In link.

#### 5. Delete email/password files

**Files**:
- `src/pages/api/auth/signin.ts`
- `src/pages/api/auth/signup.ts`
- `src/pages/auth/signup.astro`
- `src/pages/auth/confirm-email.astro`
- `src/components/auth/SignInForm.tsx`
- `src/components/auth/SignUpForm.tsx`

**Intent**: Atomic removal — no dead routes or unreachable pages remain after this phase.

### Success Criteria

#### Automated Verification

- `npm run typecheck` passes — no broken imports from deleted files
- `npm run lint` passes

#### Manual Verification

- `/auth/signin` shows only "Continue with Google", no email/password form, no signup link
- `/` shows a single "Sign In" CTA, no "Sign Up" button
- `/auth/signup` returns 404

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Manual Testing Steps

1. Sign in with Google → land at `/dashboard` → `user?.email` shows your Google account email
2. Click Sign Out on dashboard → redirected to `/`, session cleared
3. Visit `/dashboard` while logged out → redirected to `/auth/signin`
4. Visit `/auth/signin?redirect_to=/dashboard` → sign in → land at `/dashboard`
5. Click "Continue with Google" → deny on Google consent screen → land at `/auth/signin` with error message
6. `/auth/signup` → confirm 404

## Migration Notes

No database changes. No existing user accounts (greenfield). `signout.ts` is unchanged — it works identically for OAuth sessions.

## References

- Roadmap: `context/foundation/roadmap.md` (F-01)
- Change: `context/changes/google-sso/change.md`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Supabase Config & Env

#### Automated

- [x] 1.1 `supabase start` completes without errors

#### Manual

- [x] 1.2 Supabase Studio shows Google provider enabled

### Phase 2: OAuth Routes

#### Automated

- [ ] 2.1 `npm run typecheck` passes (new routes)

#### Manual

- [ ] 2.2 Clicking Google button redirects to accounts.google.com
- [ ] 2.3 Successful sign-in lands at `/dashboard`
- [ ] 2.4 Denied consent redirects to `/auth/signin` with error
- [ ] 2.5 Logged-out `/dashboard` visit → sign in → lands at `/dashboard`

### Phase 3: UI Swap & Cleanup

#### Automated

- [ ] 3.1 `npm run typecheck` passes (no broken imports)
- [ ] 3.2 `npm run lint` passes

#### Manual

- [ ] 3.3 `/auth/signin` shows Google button only, no form, no signup link
- [ ] 3.4 `/` shows one Sign In CTA
- [ ] 3.5 `/auth/signup` returns 404
