export const prerender = false;

import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const GET: APIRoute = async (context) => {
  const params = context.url.searchParams;

  const oauthError = params.get("error");
  if (oauthError) {
    const msg = params.get("error_description") ?? oauthError;
    return context.redirect(`/auth/signin?error=${encodeURIComponent(msg)}`);
  }

  const code = params.get("code");
  if (!code) {
    return context.redirect("/auth/signin?error=Missing+auth+code");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
  }

  const destination = context.cookies.get("auth_redirect")?.value ?? "/dashboard";
  context.cookies.set("auth_redirect", "", { maxAge: 0, path: "/" });

  return context.redirect(destination, 302);
};
