import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts (which only configures the dev server's
// `host` option) so test-only settings don't couple into the prod build
// config. `node` environment is enough for now — the initial test targets
// are plain functions with no DOM dependency; a Lit component test would
// need `happy-dom`/`jsdom`, deliberately deferred.
export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
})
