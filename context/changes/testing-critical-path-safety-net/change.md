---
change_id: testing-critical-path-safety-net
title: Testing critical path safety net
status: preparing
created: 2026-06-13
updated: 2026-06-14
archived_at: null
---

## Notes

Phase 1 of context/foundation/test-plan.md: "Critical-path safety net".

Risks covered: Risk #5 (balance calculation correctness), Risk #1 (cross-group RLS non-member isolation).
Test types planned: unit (balance calculation) + integration (Supabase local, real RLS).
Risk response intent:
- Risk #5: prove that sum of all participant balances equals zero and individual balances match independently calculated expected values; do not derive expected values from the implementation code (oracle problem).
- Risk #1: prove that a non-member receives 0 rows or 403 from the expenses endpoint — not a filtered 200; test as a real authenticated user, not as superuser (RLS does not apply to superuser).
After creating the folder, follow the downstream continuation rule: suggest the next natural command (/10x-research) rather than returning to /10x-test-plan.
