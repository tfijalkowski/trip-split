import { defineConfig, devices } from "@playwright/test";

// Load Supabase local credentials for auth.setup.ts and any spec that needs the admin client.
// CI supplies these via environment; locally they live in .env.test (gitignored).
try {
  process.loadEnvFile(".env.test");
} catch {
  /* missing in CI — env vars supplied externally */
}

export default defineConfig({
  testDir: "./src/__tests__",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "src/__tests__/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:4321",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
