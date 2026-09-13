import { defineConfig } from "vite";

// The backend's dev port — matches backend/Api/Properties/launchSettings.json's
// "http" profile and Taskfile.Dotnet.yml's API_PORT.
const apiTarget = "http://localhost:5162";

// https://vite.dev/config/
export default defineConfig({
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
