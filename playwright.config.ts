import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
// Optional: point at a pre-installed Chromium instead of running `playwright install`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } },
    },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], launchOptions: { executablePath } } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `npm run build && npm run start -- --port ${port}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          NEXT_PUBLIC_SITE_URL: baseURL,
          BETTER_AUTH_SECRET:
            process.env.BETTER_AUTH_SECRET ?? "e2e-only-auth-secret-0123456789abcdef",
          // A key pair made for the e2e run only, so the push controls render. Nothing is sent:
          // no browser in the tests subscribes.
          VAPID_PUBLIC_KEY:
            "BDGxPl9cf5B6msMj0JVQmVR7YfJUMqkbhiYaPm6b1FFP1mjOtFEpcn0ww0Rlen-OZ0-oI0u0jlzq-Q_yQB1n3_Y",
          VAPID_PRIVATE_KEY: "H9MOGE1FDC4DLEZtWh3b_bLY835uwYJbZ2JnedcRrhs",
          VAPID_SUBJECT: "mailto:e2e@example.test",
        },
      },
});
