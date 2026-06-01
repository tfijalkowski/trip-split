export const prerender = false;

import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const GET: APIRoute = async (context) => {
  const raw = context.url.searchParams.get("redirect_to") ?? "";
  const redirectTo = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";

  context.cookies.set("auth_redirect", redirectTo, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 300,
    path: "/",
  });

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const callbackUrl = new URL("/auth/callback", context.url.origin).toString();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl },
  });

  if (error || !data.url) {
    const msg = error?.message ?? "OAuth initiation failed";
    return context.redirect(`/auth/signin?error=${encodeURIComponent(msg)}`);
  }

  return context.redirect(data.url, 302);
};
