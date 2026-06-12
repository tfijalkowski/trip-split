-- Supabase Realtime requires REPLICA IDENTITY FULL on tables with RLS policies
-- that are added to the supabase_realtime publication (matches pattern from
-- 20260610220000_expenses_replica_identity_full.sql).
ALTER TABLE public.groups REPLICA IDENTITY FULL;
