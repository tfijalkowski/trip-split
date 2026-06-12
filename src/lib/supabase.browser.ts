import { createBrowserClient as createSSRBrowserClient } from "@supabase/ssr";
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from "astro:env/client";

export function createBrowserClient() {
  const client = createSSRBrowserClient(PUBLIC_SUPABASE_URL ?? "", PUBLIC_SUPABASE_ANON_KEY ?? "");

  // @supabase/ssr keeps the session in cookies, so the realtime client falls back
  // to the anon key and postgres_changes channels register with claims_role=anon.
  // RLS on protected tables then silently drops every event. Sync the user JWT.
  void client.auth.getSession().then(({ data }) => {
    if (data.session) client.realtime.setAuth(data.session.access_token);
  });
  client.auth.onAuthStateChange((_event, session) => {
    client.realtime.setAuth(session?.access_token ?? null);
  });

  return client;
}
