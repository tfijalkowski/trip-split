-- =============================================================================
-- Fix member_balances VIEW to enforce RLS for the querying user.
--
-- Without security_invoker = true, the VIEW ran as its owner (postgres/superuser),
-- which bypasses RLS. Non-members could see balance rows for groups they do not
-- belong to. Setting security_invoker = true makes the VIEW evaluate RLS policies
-- using the calling user's identity, consistent with the intent documented in
-- 20260610182008_expense_balance_layer.sql.
-- =============================================================================
ALTER VIEW public.member_balances SET (security_invoker = true);
