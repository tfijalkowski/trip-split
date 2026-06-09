# F-02: DB Schema + RLS + Realtime — Plan Brief

> Full plan: `context/changes/db-schema-rls/plan.md`

## What & Why

Create the complete data foundation for TripSplit: five tables (`profiles`, `groups`, `group_members`, `expenses`, `expense_participants`), per-table RLS policies that isolate group data, a profile auto-creation trigger, and Supabase Realtime enabled on `expenses` and `expense_participants`. Without this, S-01 through S-04 cannot function.

## Starting Point

No migrations exist. `supabase/migrations/` directory does not exist; `supabase/seed.sql` is referenced in `config.toml` but does not exist. `supabase/config.toml` has `[realtime] enabled = true` and Google OAuth configured.

## Desired End State

`supabase db reset` leaves a local database with all 5 tables, RLS enabled and verified, both expense tables in the Realtime publication, and a seed baseline of 2 test users + 1 group ready for S-01 development.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Migration structure | Single file (all tables + RLS + trigger + Realtime) | Atomic apply; no partial-state window that would violate CLAUDE.md hard stop on RLS | Plan |
| profiles creation | DB trigger on auth.users INSERT | Profile always exists before app sees the user; no race condition, no app code | Planning |
| Creator tracking | `groups.created_by` UUID FK | Simple join-free RLS check; creator transfer is out of PRD scope | Planning |
| Invite code | 8-char uppercase hex, DB DEFAULT (`upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8))`) | No extra library; auto-generated; S-01 API omits the field | Planning |
| Settlement lock | `groups.is_locked BOOLEAN DEFAULT false` in F-02 | S-03 only needs to toggle it; no ALTER-policy migration needed in S-03 | Planning |
| Recursive RLS fix | `is_group_member()` SECURITY DEFINER function | Direct `EXISTS (SELECT 1 FROM group_members ...)` in group_members policy causes infinite recursion | Planning |
| expense_participants write access | SELECT-only for authenticated; no INSERT policy | create_expense RPC (S-02, SECURITY DEFINER) handles all writes; direct inserts blocked at DB level | S-02 plan |
| Realtime publication | Both `expenses` AND `expense_participants` | Forward-compatible; S-02 research.md lists both as the critical prerequisite | Research |
| Invite join RLS | `WITH CHECK (auth.uid() = user_id)` only | Invite-code validation is the S-01 API layer's job; DB enforces identity-only | Planning |
| Seed | Minimal: 2 users + 1 group (local only) | config.toml already references seed.sql; deterministic UUIDs speed up S-01 dev | Planning |

## Scope

**In scope:**
- `supabase/migrations/<timestamp>_initial_schema.sql` — all 5 tables, trigger, is_group_member() helper, RLS, Realtime
- `supabase/seed.sql` — 2 test users, 1 group, 2 memberships, 0 expenses

**Out of scope:**
- `member_balances` VIEW and `create_expense` RPC — S-02 Phase 2 (separate migration)
- `join_group()` RPC — S-01's responsibility; F-02 only sets the INSERT policy to allow self-insertion
- Any application code changes — this is pure DB schema

## Architecture / Approach

One migration file applied atomically. Section order matters: helper function → tables (FK order) → trigger → `ENABLE ROW LEVEL SECURITY` on all tables → all policies → Realtime publication. The `is_group_member()` SECURITY DEFINER function is the keystone — it is referenced by policies across four tables and must be created before any policy that uses it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Migration | All 5 tables + RLS + trigger + Realtime in one SQL file | Recursive RLS on group_members — mitigated by SECURITY DEFINER helper |
| 2. Seed | Local dev baseline: 2 users + 1 group | auth.users seed format varies by Supabase version — check `role` and `aud` columns are accepted |

**Prerequisites:** None (parallel with F-01)
**Estimated effort:** ~1 focused session

## Open Risks & Assumptions

- `supabase_realtime` publication may not exist in fresh local Supabase — if `ALTER PUBLICATION supabase_realtime ADD TABLE` fails, it needs to be created first: `CREATE PUBLICATION supabase_realtime`. Check with `SELECT pubname FROM pg_publication WHERE pubname = 'supabase_realtime'` before running migration.
- The profile trigger reads `raw_user_meta_data->>'full_name'`. If Google OAuth returns a different key (e.g., `name` instead of `full_name`), `display_name` will be NULL — harmless for MVP but worth noting.
- Seed `auth.users` INSERT format (required columns: `role`, `aud`) may vary between Supabase versions. Verify against the local Supabase version if seed fails.

## Success Criteria (Summary)

- `supabase db push` applies cleanly; all 5 tables + all policies visible in Supabase Studio
- Cross-group isolation verified: User A cannot read Group B's expenses
- Lock enforcement verified: INSERT into expenses on `is_locked = true` group fails
- `expense_participants` direct INSERT blocked
- `supabase db reset` seeds 2 users + 1 group; all check rows match expected counts
