import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 30_000, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:8080', trace: 'retain-on-failure' },
  webServer: { command: 'npm run build && cargo run', url: 'http://127.0.0.1:8080/health', timeout: 120_000, reuseExistingServer: true, env: { DATABASE_URL: 'sqlite://data/e2e.db?mode=rwc', EXPORT_SIGNING_KEY: 'e2e-only-signing-key', BUILD_SHA: 'e2e-regression' } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }]
});
