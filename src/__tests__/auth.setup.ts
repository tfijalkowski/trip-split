import { test as setup } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const authFile = path.join(import.meta.dirname, ".auth/user.json");
const E2E_EMAIL = "e2e-seed@test.local";
const E2E_PASSWORD = "Test1234!";

setup("authenticate", async ({ page }) => {
  const url = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing } = await admin.auth.admin.listUsers();
  const found = existing.users.find((u) => u.email === E2E_EMAIL);
  if (!found) {
    const { error } = await admin.auth.admin.createUser({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);
  }

  const cookies: { name: string; value: string }[] = [];
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookies;
      },
      setAll(cookiesToSet) {
        cookies.length = 0;
        cookies.push(...cookiesToSet.map(({ name, value }) => ({ name, value })));
      },
    },
  });

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
  });
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`);

  const playwrightCookies = cookies.map(({ name, value }) => ({
    name,
    value,
    domain: "localhost",
    path: "/",
  }));

  await page.context().addCookies(playwrightCookies);
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
