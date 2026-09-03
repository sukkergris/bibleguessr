import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  server: {
    // Bind to all interfaces so the dev server is reachable from outside
    // the devcontainer (e.g. via VS Code port forwarding).
    host: true,
  },
});
