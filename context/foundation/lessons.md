# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## RLS default-deny produces a silent 0-rows response, not an error

**Context:** supabase/migrations RLS policies (groups, group_members)

**Problem:** When no DELETE policy exists on a table with RLS enabled, a DELETE
returns { data: [], error: null } — zero rows affected, no error. This is
indistinguishable from "row not found" at the API layer and silently confuses
future developers implementing leave-group, archive-group, or any delete flow.

**Rule:** Always document intentional RLS omissions (no DELETE policy) in the migration comment or plan's "What We're NOT Doing" section. When adding delete flows later, check for missing RLS policies first — the silent 0-rows response is the only signal.

**Applies to:** All Supabase migrations that enable RLS on tables where delete/update flows may be added later.
