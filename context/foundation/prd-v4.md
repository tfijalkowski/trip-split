---
project: "TripSplit"
version: 4
status: draft
created: 2026-06-11
context_type: brownfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  delivery_weeks: 1
  hard_deadline: null
  after_hours_only: true
---

## Current System Overview

TripSplit is a web app for tracking shared vacation expenses and settling group balances. It is built on Astro 6 SSR with React islands, Tailwind CSS, and Supabase (authentication and database), deployed on Cloudflare Workers. Authentication is Google SSO only — there are no passwords or alternative auth methods.

Core functionality today: Google SSO sign-up and sign-in; group creation with an invite-link join flow; expense addition with flexible per-participant splits (equal, percentage, or custom); a live balance panel updated via Supabase Realtime; a paginated, filterable expense list; settlement lock/unlock by the group creator; expense editing and deletion by the payer.

User base: small vacation groups of 3–10 people per trip. At sign-up, each user's display name is imported automatically from their Google account profile. This name is used as the user's identifier in all groups they belong to — in member lists, expense lists (paid-by column), and balance panels. There is currently no way to change the display name from within TripSplit.

## Problem Statement & Motivation

A user's Google account name may not match the name their travel companions know them by. Common situations: the Google profile name is a formal full name or work identity, while the group communicates by nickname; the Google name contains characters or formatting the user would not choose for a leisure context.

Because TripSplit imports the display name once at sign-up and provides no way to update it, the user's only recourse is to change their Google account profile — which affects every other Google service they use. There is no workaround inside the app.

The change is needed now because the display name is the primary identifier in all group views. A name the user cannot control undermines the sense of ownership over their own presence in the app.

## User & Persona

**Existing user: vacation group participant** (same persona as prd-v3.md)

A member of a group trip (3–10 people) who adds expenses and monitors balances. The affected user is anyone whose Google-imported name differs from what they want their travel companions to see. No new persona is introduced by this change.

## Success Criteria

### Primary
- A logged-in user can open a profile page, enter a new display name (non-empty, non-whitespace-only), save it, and see the updated name as their identifier across all groups they belong to.

### Secondary
- The updated display name appears retroactively in expense history (paid-by column) and balance panel for all existing groups — no per-group action required.

### Guardrails
- Google SSO authentication and session management must not be affected.
- Existing expense records, group memberships, and balance calculations must not be altered by this change.
- No other participant's profile data is readable or writable from the profile page.
- The sign-up flow that imports the display name from Google must continue to work for new users.

## User Stories

### US-02: User changes their display name

- **Given** a logged-in user on the profile page who wants a different name visible to their group members
- **When** they enter a new display name (non-empty, non-whitespace-only) and save
- **Then** the new name is shown as their identifier in all groups they belong to — in the member list, expense list (paid-by column), and balance panel — the next time those pages are viewed

#### Acceptance Criteria
- Blank or whitespace-only input is rejected with an inline error before submission
- The current display name is pre-filled in the input field when the profile page loads
- The user receives inline confirmation after a successful save
- No other profile fields (email address, connected Google account) are editable on this page
- The email address is shown as read-only context so the user can confirm which account they are managing

## Scope of Change

- [new] Profile page accessible to all authenticated users at a dedicated route
- [new] FR-017: Logged-in user can view their profile page, which shows their current display name (editable) and their account email address (read-only). Priority: must-have
- [new] FR-018: Logged-in user can update their display name; the new name must be non-empty and non-whitespace-only; the change is reflected as their identifier in all groups they belong to. Priority: must-have
- [new] Navigation entry providing access to the profile page (e.g. a link on the dashboard or a persistent UI element accessible from any page)
- [preserved] Google SSO authentication and sign-up flow — no changes
- [preserved] Display name imported from Google at first sign-up — behavior unchanged for new users who have not yet edited their name
- [preserved] All expense, group, balance, and membership data — not altered by this change

## Constraints & Compatibility

No data migration is needed: the display name field already exists in the user profile store and is populated at sign-up from Google. This change adds a write path to a field that was previously read-only within the app.

The change propagates automatically to all groups the user belongs to without any per-group action — display names are not stored per group but resolved from the user's account each time a group view is loaded. No backfill is required.

Existing integrations (Google SSO, Realtime subscription for expenses and groups) are unaffected.

## Business Logic Changes

**New rule**: A user's display name must not be blank or whitespace-only. The display name is the sole identifier by which the user is recognised by other group members in expense lists and balance panels; a blank name would make the user unidentifiable.

No change to the balance-calculation rule or any other existing domain logic.

## Access Control Changes

New: each authenticated user can read and update only their own display name. No user can view or modify another user's profile data via this page.

All existing access control is otherwise unchanged: group-scoped data isolation, Google SSO as the sole authentication method, group-creator-only settlement lock/unlock.

## Non-Goals

- Changing the account email address — controlled by Google; not editable in TripSplit.
- Account deletion — out of scope for this change.
- Profile photo or avatar support.
- Per-group display name aliases — one display name applies across all groups the user belongs to.
- Real-time propagation of a display name change to other members' currently open tabs — the updated name appears on their next page load; a Realtime channel for profile changes is not part of this change.
- Resetting the display name back to the Google-imported original after it has been changed.
- Admin or group-creator ability to override another user's display name.

## Open Questions

1. **What is the maximum character length for a display name?** — Owner: user. Block: yes (needed to define the validation rule in FR-018 before implementation). Suggested default if not specified: 50 characters.
2. **Where exactly does the navigation entry to the profile page appear?** — Owner: user. Block: no (implementation can proceed with a reasonable default, e.g. a link on the dashboard). Needs confirmation before UI is finalised.
