import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The backend's dev port — matches backend/Api/Properties/launchSettings.json's
// "http" profile and Taskfile.Dotnet.yml's API_PORT.
const apiTarget = 'http://localhost:5162';

// The single source of truth for the frontend revision is package.json's
// `revision` — a plain integer, bumped by hand when the frontend changes.
// It is read here and injected into index.html's meta tag at build time,
// so the revision can never be edited in two places and drift apart.
const packageJson = readFileSync(
  new URL('./package.json', import.meta.url),
  'utf-8'
);
const appRevision = String(JSON.parse(packageJson).revision);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    {
      name: 'inject-app-revision',
      // Runs for both `vite dev` and `vite build`, so the Nerd tab shows
      // the same revision in development and in a production bundle.
      transformIndexHtml(html) {
        return html.replace(
          /(<meta name="application-revision" content=")[^"]*(")/,
          `$1${appRevision}$2`
        );
      },
    },
    {
      name: 'generate-xyz-file',
      apply: 'build',

      generateBundle() {
        const buildSha = process.env.BUILD_SHA?.trim() || '<unset>';
        const build_context = process.env.BUILD_CONTEXT?.trim() || 'missing';
        this.emitFile({
          type: 'asset',
          fileName: 'build-sha.txt',
          source: buildSha,
        });
        this.emitFile({
          type: 'asset',
          fileName: 'build-context.txt',
          source: build_context,
        });
      },
    },
  ],
  server: {
    // Bind to all interfaces so the dev server is reachable from outside
    // the devcontainer (e.g. via VS Code port forwarding).
    host: true,
    allowedHosts: ['bibleguessr.single', 'www.bibleguessr.single'],
    // The frontend calls the API and the SignalR hub same-origin (see
    // frontend/src/api.ts), so the dev server has to route both to the
    // backend itself. In front of the server replica nginx does this
    // instead; these keep plain `vite dev` on :5173 working the same way.
    proxy: {
      '/api': apiTarget,
      // `ws: true` is required for the hub: the client pins the
      // WebSockets transport, so this path only ever sees an upgrade
      // request, which the default HTTP-only proxy would not forward.
      '/hubs': { target: apiTarget, ws: true },
    },
  },
});
