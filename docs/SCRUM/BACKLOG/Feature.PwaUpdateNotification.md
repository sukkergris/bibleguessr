# Feature: PWA New Version Notification (Update Available Prompt)

Add Progressive Web App (PWA) capabilities and a graceful update notification to the frontend. When a new frontend build is deployed, players running an open tab or an installed PWA should be notified that an update is ready and given an accessible, one-click action to update to the latest revision, without disrupting any game in progress.

## Today

The frontend is a single-page application built with Vite and Lit (`frontend/package.json`, `frontend/vite.config.ts`). Currently:

1. **No Service Worker or PWA manifest exists.** The application does not register a Service Worker or provide a web app manifest.
2. **Stale tabs remain on old revisions.** Players frequently keep browser tabs open across multiple days or install/bookmark the site on mobile devices. When a new frontend revision is published (containing bug fixes, scoring rule updates, or layout refinements), these clients continue running the older cached code indefinitely until a manual hard refresh occurs.
3. **Chunk loading errors on deployment.** When a new version ships with new asset hashes, navigation or dynamic imports in an older open session can trigger chunk load failures (`Failed to fetch dynamically imported module`).
4. **No visual cue for updates.** The only place a user can inspect the running revision is by manually checking the Nerd panel (`frontend/src/components/nerd-panel.ts`), which reads `<meta name="application-revision">`. There is no proactive notification when a newer revision is ready.

## Scope

### In Scope

- Introduce PWA support to `frontend/` using a Service Worker in **prompt** mode (`registerType: 'prompt'`).
- Web App Manifest (`manifest.webmanifest` / `manifest.json`) for standalone installability with proper app name, branding, and theme colors.
- Detect when a newly deployed build has downloaded and is waiting in the browser (`waitingWorker` / `needRefresh`).
- Provide an accessible, non-intrusive update banner or toast notification informing the player that a new version of BibleGuessr is available.
- "Update now" action: prompts the waiting Service Worker to take over (`SKIP_WAITING`), triggering a clean page reload with the newest assets.
- "Dismiss" / "Later" action: closes the prompt for the current session without interrupting the user.
- Game awareness: defer or suppress prompt popups during active gameplay (mid-verse guessing in singleplayer or live multiplayer rounds) so the player is not distracted or disadvantaged.
- Precache the static app shell (HTML, CSS, JS, SVGs, fonts) for fast initial load and offline readiness.

### Out of Scope

- Aggressive auto-reloads (`registerType: 'autoUpdate'`) that restart the page without user consent while a player is active.
- Caching backend API endpoints (`/api/*`) or SignalR connections (`/hubs/*`) in the Service Worker cache. These must remain NetworkOnly.
- Storing or caching Bible translation files or verse text in the Service Worker cache. Uploaded Bibles remain isolated in IndexedDB in the browser, adhering to the project's data privacy and copyright rules (`CLAUDE.md`, `NOTICE.md`).

## Requirements

### 1. Update Detection & Service Worker Lifecycle

- The Service Worker must be configured in **prompt** mode:
  - On app launch, the Service Worker registers and caches the static app shell.
  - In the background, the browser periodically checks for an updated Service Worker file (or on route navigation / tab focus).
  - When a new Service Worker is found, it installs in the background. Once installed, it enters the `waiting` state rather than immediately evicting the active controller.
  - The client detects the `waiting` worker and triggers the update notification.
- When the player clicks **Update**:
  - The client posts a `{ type: 'SKIP_WAITING' }` message to the waiting worker.
  - The waiting worker activates, fires `controllerchange`, and the frontend initiates `window.location.reload()`.

### 2. User Experience & Non-Disruptive UI

- **Unobtrusive placement:** The update banner or toast should float at a predictable, visible position (e.g. bottom-right or top banner) that does not obscure the verse card, guess input buttons, or score table.
- **Copy:** A brief, clear message such as *"A new version of BibleGuessr is available."* (Optionally indicating the new revision number if available).
- **Actions:**
  - **"Update now"** (primary button): Activates the update and reloads the application.
  - **"Later"** / **"Dismiss"** (secondary button): Closes the banner.
- **Game flow protection:**
  - If the player is actively in a singleplayer game (`singleplayerStage === 'playing'`) or an active multiplayer round, do not display or pop up the banner until the round or game finishes (`singleplayerStage === 'gameOver'`).
  - If dismissed, a subtle indicator remains in the header bar or Nerd panel (e.g., *"Update available: Reload to apply"*) so the player can trigger it whenever they are ready.

### 3. Caching & Network Strategy

- **App Shell (Cache-First):** Precache production bundles (HTML, JS, CSS, icons, fonts) to enable instant boot and offline singleplayer play when combined with cached Bibles (`docs/SCRUM/DONE/Feature.OflineContentGaminig.md`).
- **Backend API (`/api/*`):** Strictly **NetworkOnly**. The Service Worker must never serve stale HTTP responses for game endpoints, verse lookups, health checks, or abuse reports.
- **SignalR Hub (`/hubs/*`):** Strictly bypass Service Worker. WebSockets and Server-Sent Events must never be intercepted.
- **Bible Files:** Uploaded EPUB/RTF Bibles and parsed verses are stored in IndexedDB (`frontend/src/bible-sources/verse-cache.ts`). The Service Worker cache must not touch or inspect Bible data.

### 4. Accessibility (WCAG 2.2 AA)

- **Semantic announcement:** The notification must use `role="status"` and `aria-live="polite"` so screen readers announce that an update is available without cutting off verse recitation or game audio/announcements.
- **No focus stealing:** The appearance of the update notification must never pull keyboard focus away from the active guess input or button.
- **Keyboard navigation:**
  - All interactive elements ("Update now", "Dismiss") are keyboard-focusable with visible focus rings adhering to project contrast guidelines.
  - Pressing `Escape` while the banner is focused dismisses the prompt.
- **Theme & contrast compliance:**
  - The banner and its action buttons must meet WCAG 2.2 AA contrast ratios in both Light and Dark themes (see `docs/SCRUM/DONE/Bug.DarkThemeAccentContrast.md`).
  - Do not rely solely on color to convey update availability.
- **Reduced motion:**
  - Respect `prefers-reduced-motion` by disabling slide/bounce animations for the banner.

## Design Notes

### State Model

Model the PWA update state explicitly rather than relying on loose flags:

```typescript
export type PwaUpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'update-available'; newRevision?: number }
  | { status: 'updating' }
  | { status: 'dismissed'; newRevision?: number };
```

### Tooling & Library Choices

- `vite-plugin-pwa` (Workbox) is the standard recommended solution for Vite applications:
  - Generates the Service Worker with asset precache manifest during `vite build`.
  - Provides `registerSW` with callbacks (`onNeedRefresh`, `onOfflineReady`).
  - Automatically manages hashing of production chunks.
- If implementing without an external plugin, a custom Service Worker script (`sw.js`) with Workbox build CLI or manual cache versioning can be used, but `vite-plugin-pwa` keeps Vite configuration unified and avoids duplicate revision management.

### Component Integration

- Create a dedicated Web Component: `<bg-pwa-update-banner>` (e.g. in `frontend/src/components/pwa-update-banner.ts`).
- Integrate into `frontend/src/components/bg-app.ts` root layout, passing down current game stage to coordinate when the banner may be rendered.

## Rollout & Verification

1. In local dev (`npm run dev`), the Service Worker can be disabled or tested via `devOptions: { enabled: true }`.
2. Unit tests verify the update banner states, button actions, keyboard interactions, and accessibility attributes using Vitest and `@open-wc/testing` / Lit test harnesses.
3. E2E tests (Playwright) verify the banner's rendering, dismiss behavior, and reload trigger without breaking active game views.

## Acceptance Criteria

- [ ] PWA Service Worker and Web App Manifest are configured in `frontend/`.
- [ ] Requests to `/api/*` and `/hubs/*` are strictly bypassed by the Service Worker (NetworkOnly).
- [ ] Uploaded Bible files and parsed verse data remain solely in IndexedDB and are never stored in Service Worker caches.
- [ ] When a new frontend build is deployed and detected, a non-intrusive update notification is presented to the player.
- [ ] Clicking "Update now" sends `SKIP_WAITING` and reloads the page into the fresh revision.
- [ ] Clicking "Later" / "Dismiss" hides the prompt without blocking the game.
- [ ] The update prompt is suppressed or deferred while a player is actively playing a singleplayer or multiplayer round.
- [ ] The notification uses `role="status"` and `aria-live="polite"`, never steals focus, supports keyboard dismissal (`Escape`), and meets WCAG 2.2 AA contrast standards in both light and dark themes.
- [ ] Unit tests cover all component states (`idle`, `update-available`, `updating`, `dismissed`) and demonstrate failure when broken.
- [ ] Frontend `revision` in `frontend/package.json` is bumped upon completing the feature.
- [ ] Documentation is added under `docs/web/pwa/index.html`.

