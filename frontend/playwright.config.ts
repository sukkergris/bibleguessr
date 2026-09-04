import { defineConfig } from '@playwright/test'

// Assumes both dev servers (`task dotnet:dev` and `task frontend:dev`) are
// already running, matching the repo's existing convention of running
// backend/frontend as two separate long-lived processes in separate
// terminals — Playwright's `webServer` isn't natively built to also manage
// a `dotnet run` process, so it isn't asked to spawn either one. A `url`
// health check plus `reuseExistingServer: true` makes `playwright test`
// fail fast with a clear message if the frontend isn't up yet, rather than
// silently hanging.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'echo "Expecting dev servers already running (task dotnet:dev / task frontend:dev)"',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 5_000,
  },
})
