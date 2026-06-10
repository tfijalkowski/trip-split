-- =============================================================================
-- S-02: expense_balance_layer
-- Adds: member_balances VIEW (SECURITY INVOKER — RLS applies)
--       create_expense RPC  (SECURITY DEFINER — API route enforces membership)
-- =============================================================================

-- member_balances: net balance per user per group.
-- SECURITY INVOKER (default) means the querying user's RLS policies apply,
-- so each user can only see rows for groups they belong to.
CREATE OR REPLACE VIEW public.member_balances AS
SELECT
  ep.user_id,
  e.group_id,
  SUM(ep.amount_owed)                                             AS total_owed,
  SUM(CASE WHEN e.paid_by = ep.user_id THEN e.amount ELSE 0 END) AS total_paid,
  SUM(CASE WHEN e.paid_by = ep.user_id THEN e.amount ELSE 0 END)
    - SUM(ep.amount_owed)                                         AS net_balance
FROM public.expense_participants ep
JOIN public.expenses e ON ep.expense_id = e.id
GROUP BY ep.user_id, e.group_id;

-- create_expense: atomically inserts into expenses then expense_participants.
-- SECURITY DEFINER bypasses RLS for the INSERT statements; the API route that
-- calls this function must validate group membership before invoking the RPC.
CREATE OR REPLACE FUNCTION public.create_expense(
  p_group_id     uuid,
  p_description  text,
  p_amount       integer,
  p_paid_by      uuid,
  p_participants jsonb,
  p_expense_date date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_expense_id uuid;
BEGIN
  INSERT INTO expenses (group_id, description, amount, paid_by, expense_date)
  VALUES (p_group_id, p_description, p_amount, p_paid_by,
          COALESCE(p_expense_date, CURRENT_DATE))
  RETURNING id INTO v_expense_id;

  INSERT INTO expense_participants (expense_id, user_id, amount_owed)
  SELECT v_expense_id,
         (p->>'user_id')::uuid,
         (p->>'amount_owed')::integer
  FROM jsonb_array_elements(p_participants) AS p;

  RETURN v_expense_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_expense(uuid, text, integer, uuid, jsonb, date)
  FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.create_expense(uuid, text, integer, uuid, jsonb, date)
  TO authenticated;
