-- Explicit SELECT grant on member_balances VIEW for the authenticated role.
-- Without this, browser-client refetch() queries with the session key would
-- silently return empty rows on Supabase projects where the default grant
-- does not extend to newly-created views.
GRANT SELECT ON public.member_balances TO authenticated;
