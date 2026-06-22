// seed.spec.ts
// Risk anchor: group created via UI persists after page reload (auth → API → DB → SSR re-render).
// Exemplar for this project — model every generated spec on the four patterns shown here:
//   1. Role-based locators (getByRole, getByPlaceholder — no CSS selectors or XPath)
//   2. Test independence (own setup + cleanup inside the test, unique name via Date.now())
//   3. Wait for state (toBeVisible, waitForURL — never waitForTimeout)
//   4. Risk-tied test name
// Cleanup: Supabase admin delete (no delete-group UI exists in the app).
// See: .claude/skills/10x-e2e/references/seed-test-pattern.md

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("created group persists after page reload", async ({ page }) => {
  const groupName = `Test Group ${Date.now()}`;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    await page.goto("/dashboard");

    await page.getByRole("button", { name: "New group" }).click();

    // Input has placeholder="Group name" but no <label> or aria-label —
    // getByRole("textbox", { name: "Group name" }) would not find it because
    // ARIA accessible name computation does not include placeholder.
    await page.getByPlaceholder("Group name").fill(groupName);

    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/\/groups\//);

    await expect(page.getByRole("heading", { name: groupName })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: groupName })).toBeVisible();
  } finally {
    // Cleanup runs even if the test fails — cascades group_members and expenses
    await admin.from("groups").delete().eq("name", groupName);
  }
});
