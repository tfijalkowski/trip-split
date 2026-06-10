-- Supabase Realtime requires REPLICA IDENTITY FULL on tables with RLS policies
-- so the Realtime server can evaluate the full row when checking subscriber access.
ALTER TABLE public.expenses             REPLICA IDENTITY FULL;
ALTER TABLE public.expense_participants REPLICA IDENTITY FULL;
