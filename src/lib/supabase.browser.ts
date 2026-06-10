import { createBrowserClient as createSSRBrowserClient } from "@supabase/ssr";
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from "astro:env/client";

export function createBrowserClient() {
  return createSSRBrowserClient(PUBLIC_SUPABASE_URL ?? "", PUBLIC_SUPABASE_ANON_KEY ?? "");
}
