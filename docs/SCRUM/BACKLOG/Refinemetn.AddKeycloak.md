# Refinement: Add Keycloak Authentication and Identity Management

Introduce [Keycloak](https://www.keycloak.org/) as the centralized Identity and Access Management (IAM) provider for BibleGuessr. This establishes a verified, stable user identity across the frontend (Lit SPA), the backend API (ASP.NET Core / F#), and the realtime multiplayer engine (SignalR).

---

## Motivation

Today, BibleGuessr has **no authentication or persistent identity**:

1. **Ephemeral players:** In multiplayer, players enter an arbitrary display name. The server mints a random GUID (`PlayerId`) on each join. If a player reloads, switches tabs, or reconnects after a temporary drop, they lose their identity and receive a brand-new `PlayerId`.
2. **Blocked features:** Multiple key features on the backlog are blocked or undermined by the lack of identity:
   - `Feature.UsersShuldBeAbleToIgnoreEachother.md` explicitly states: _"Because the current application mints a fresh server PlayerId on every join and remembers only the display name locally, this feature requires an identity design before implementation."_
   - `Feature.GameScoreBoard.md` requires tracking player ranks and All-Star scores across 48-hour reset cycles. Without authenticated accounts, scoreboards are trivial to spoof or lose.
   - `Feature.ReportAbuse.md` and `Feature.BugReport.md` rely on client-supplied names and email strings without verification, making moderation and ban enforcement difficult.
3. **Session resumption:** As noted in `docs/web/index.html`: _"Reconnecting to the same identity. A dropped-then-restored connection always mints a brand-new player id — there's no session resume."_

Keycloak provides open-standard OpenID Connect (OIDC) and OAuth 2.1 capabilities (Single Sign-On, Authorization Code Flow with PKCE, user federation, JWT tokens, account self-service, role-based access control), giving BibleGuessr a robust, self-hostable identity foundation.

---

## Current Architecture vs. Target Architecture

```
CURRENT ARCHITECTURE (UNAUTHENTICATED)
┌────────────────┐      HTTP fetch (no auth)      ┌────────────────────────┐
│  Browser / SPA │ ─────────────────────────────> │  Backend API (ASP.NET) │
│  (Lit / TS)    │ <───────────────────────────── │  No auth middleware    │
└────────────────┘   SignalR WebSocket (no token) └────────────────────────┘
  - Ephemeral PlayerId                              - Ephemeral RoomStore
  - localStorage name                               - No identity validation

TARGET ARCHITECTURE (WITH KEYCLOAK)
                         OIDC PKCE / Login
┌────────────────┐ <───────────────────────────> ┌───────────────────────────┐
│  Browser / SPA │                               │ Keycloak IAM              │
│  (keycloak-js) │ ─── Token (JWT) ─┐            │ auth.bibleguessr.single   │
└────────────────┘                  │            └───────────────────────────┘
         │                          │                          ▲
         │ HTTP with Bearer Token   │                          │ JWKS / OIDC
         ▼                          │                          ▼ Metadata
┌────────────────────────────────────────┐       ┌───────────────────────────┐
│  Nginx Reverse Proxy                   │       │  Backend API (ASP.NET 10) │
│  bibleguessr.single                    │ ────> │  JwtBearer middleware     │
└────────────────────────────────────────┘       │  SignalR Hub (Auth)       │
                                                 │  Verified Player.UserId   │
                                                 └───────────────────────────┘
```

---

## Key Decisions

### D1 — Authentication is optional for casual play, required for identity-linked features

- **Single-player mode:** Stays 100% playable without an account. Zero barrier to entry for reading verses or casual single-player guessing.
- **Multiplayer mode (Hybrid):**
  - **Authenticated players:** Log in via Keycloak. Their display name defaults to their registered username, scores persist to their profile, stable identity survives reconnects, and they can ignore/be ignored reliably.
  - **Guest players:** Can still join with a temporary name (flagged as `Guest`), maintaining quick frictionless play. However, competitive features (ranked scoreboard, persistent ignore list) require an account.
- _Rationale:_ Forcing mandatory account registration on a casual web game creates high drop-off. A hybrid approach preserves instant playability while unlocking persistent features for registered users.

### D2 — Authorization Code Flow with PKCE via `keycloak-js`

- The frontend is a Single Page Application (SPA). Per OAuth 2.1 best practices (BCP), it must use the **Authorization Code Flow with PKCE** (Proof Key for Code Exchange).
- Consumed via the official [`keycloak-js`](https://www.npmjs.com/package/keycloak-js) client adapter.
- Tokens are held in-memory in the client runtime (never stored in `localStorage` or `sessionStorage` where XSS attacks could exfiltrate them). Token refresh is handled silently via `keycloak.updateToken()`.

### D3 — Token-based authentication for SignalR WebSockets

- SignalR browser WebSockets cannot send standard HTTP `Authorization: Bearer <token>` headers during the initial WebSocket HTTP upgrade handshake.
- SignalR's client provides an `accessTokenFactory` callback that appends the access token as a query parameter (`?access_token=<token>`).
- The backend ASP.NET Core `JwtBearer` middleware must inspect `context.Request.Query["access_token"]` on incoming `/hubs/game` connections and assign it to `context.Token`.

### D4 — Stable user identity maps to Keycloak Subject (`sub`)

- The `sub` claim (UUID) in the Keycloak JWT becomes the authoritative `UserId` in the domain.
- The `Player` record in `backend/Domain/Game.fs` is extended:

  ```fsharp
  type UserId = UserId of Guid

  type PlayerIdentity =
      | Authenticated of userId: UserId * username: string
      | Guest of guestId: Guid * displayName: string

  type Player =
      { Id: PlayerId
        Identity: PlayerIdentity
        Name: string
        Score: int }
  ```

- A client cannot claim another user's `UserId`. The server extracts identity exclusively from `HubCallerContext.User` (`ClaimsPrincipal`).

### D5 — Local infrastructure: Docker Compose + PostgreSQL + Realm Export

- Keycloak will run in the development environment via `.devcontainer/debian/docker-compose.yml` accompanied by a PostgreSQL container for state persistence.
- A pre-configured realm export file (`server-replica/keycloak/realm-bibleguessr.json`) will be mounted and imported automatically on container startup (`--import-realm`).
- This guarantees every developer gets identical test users (`alice`, `bob`, `admin`), client IDs, roles, and token configurations out of the box without manual web console setup.

### D6 — Subdomain routing under `auth.bibleguessr.single`

- Keycloak will be served at `https://auth.bibleguessr.single` via Nginx, matching the existing local multi-domain architecture (`bibleguessr.single`, `squidex.bibleguessr.single`).
- `scripts/certs/cert-issue.sh` will issue certificates and populate `/etc/hosts` for `auth.bibleguessr.single`.

---

## Component Breakdown & Technical Requirements

### 1. Infrastructure & Dev Environment

#### Docker Compose (`.devcontainer/debian/docker-compose.yml`)

- Add service `keycloak-db`:
  - Image: `postgres:16-alpine`
  - Volume: `bibleguessr-keycloak-data:/var/lib/postgresql/data`
  - Environment: `POSTGRES_DB=keycloak`, `POSTGRES_USER=keycloak`, `POSTGRES_PASSWORD=keycloak`
- Add service `keycloak`:
  - Image: `quay.io/keycloak/keycloak:26.1` (or latest stable Quarkus build)
  - Command: `start-dev --import-realm`
  - Environment:
    - `KC_DB=postgres`
    - `KC_DB_URL=jdbc:postgresql://keycloak-db:5432/keycloak`
    - `KC_DB_USERNAME=keycloak`
    - `KC_DB_PASSWORD=keycloak`
    - `KC_HOSTNAME=auth.bibleguessr.single`
    - `KC_HTTP_ENABLED=true`
    - `KEYCLOAK_ADMIN=admin`
    - `KEYCLOAK_ADMIN_PASSWORD=admin`
  - Volumes:
    - `../../server-replica/keycloak/realms:/opt/keycloak/data/import:ro`
  - Networks: `internal`

#### Nginx (`server-replica/nginx`)

- New configuration file: `server-replica/nginx/conf.d/20-keycloak.conf`:
  - Reverse proxies `auth.bibleguessr.single` to upstream `http://keycloak:8080`.
  - Configures standard proxy headers:
    - `Host $host`
    - `X-Real-IP $remote_addr`
    - `X-Forwarded-For $proxy_add_x_forwarded_for`
    - `X-Forwarded-Proto $scheme`
    - `X-Forwarded-Host $host`
    - `X-Forwarded-Port $server_port`
  - SSL certificate termination matching existing Let's Encrypt / dev certs.
- `server-replica/nginx/includes/upstreams.conf`:
  - Add `$keycloak_upstream` pointing to `http://keycloak:8080`.

#### Dev Certificates (`scripts/certs/cert-issue.sh`)

- Add `auth.bibleguessr.single` and `www.auth.bibleguessr.single` to `add_domain_to_hostfile` and certificate domain list.

#### Keycloak Realm Setup (`realm-bibleguessr.json`)

- **Realm:** `bibleguessr`
- **Clients:**
  - `bibleguessr-frontend`:
    - Public client (no client secret)
    - Standard Flow enabled (Authorization Code with PKCE)
    - Valid Redirect URIs:
      - `https://bibleguessr.single/*`
      - `https://www.bibleguessr.single/*`
      - `http://localhost:5173/*`
    - Web Origins: `+`
  - `bibleguessr-backend`:
    - Bearer-only / resource server
    - Audience: `bibleguessr-api`
- **Roles:**
  - `player`: Default role for all registered users.
  - `moderator`: Access to review abuse reports and manage flagged players.
  - `admin`: Full administrative privileges.
- **Pre-seeded Dev Users:**
  - `alice` / password: `password123` (Role: `player`)
  - `bob` / password: `password123` (Role: `player`)
  - `moderator` / password: `password123` (Roles: `player`, `moderator`)

---

### 2. Backend Changes (.NET 10 / ASP.NET Core / F#)

#### Dependencies (`backend/Api/BibleGuessr.Api.fsproj`)

- Add NuGet package:
  - `Microsoft.AspNetCore.Authentication.JwtBearer`

#### Configuration (`appsettings.json` / `appsettings.Development.json`)

- Add `Authentication` configuration section:

  ```json
  "Authentication": {
    "Authority": "https://auth.bibleguessr.single/realms/bibleguessr",
    "MetadataAddress": "http://keycloak:8080/realms/bibleguessr/.well-known/openid-configuration",
    "Audience": "bibleguessr-api",
    "RequireHttpsMetadata": false
  }
  ```

  _(Note: In container networking, the backchannel discovery can use internal `http://keycloak:8080`, while validating the public issuer `https://auth.bibleguessr.single`.)_

#### Middleware Setup (`backend/Api/Program.fs`)

- Register authentication services:

  ```fsharp
  builder.Services
      .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
      .AddJwtBearer(fun options ->
          options.Authority <- builder.Configuration["Authentication:Authority"]
          options.Audience <- builder.Configuration["Authentication:Audience"]
          options.RequireHttpsMetadata <- builder.Configuration.GetValue<bool>("Authentication:RequireHttpsMetadata")
          options.TokenValidationParameters <- TokenValidationParameters(
              ValidateIssuer = true,
              ValidIssuer = builder.Configuration["Authentication:Authority"],
              ValidateAudience = true,
              ValidAudience = builder.Configuration["Authentication:Audience"],
              ValidateLifetime = true
          )
          options.Events <- JwtBearerEvents(
              OnMessageReceived = fun context ->
                  let accessToken = context.Request.Query["access_token"]
                  let path = context.HttpContext.Request.Path
                  if not (String.IsNullOrEmpty accessToken) && path.StartsWithSegments("/hubs") then
                      context.Token <- accessToken
                  Task.CompletedTask
          )
      )
  builder.Services.AddAuthorization()
  ```

- Pipeline order: `app.UseAuthentication()` followed by `app.UseAuthorization()` before `app.MapHub` and `app.MapGet`/`app.MapPost`.

#### SignalR Hub & Identity Integration (`backend/Api/GameHub.fs`)

- Inspect `this.Context.User`:
  - If authenticated:
    - Extract `sub` (Keycloak Subject GUID) as `UserId`.
    - Extract `preferred_username` or `name` claim as authoritative username.
    - Prevent the client from submitting a fake name or taking another player's name.
  - If unauthenticated (Guest):
    - Mint ephemeral guest identity as done currently.
- Session Resumption / Reconnect:
  - If an authenticated player drops and reconnects, match their incoming connection by `UserId` rather than purely display name string matching.
  - Automatically reconnect the user to their active game and restore their seat.

#### Domain Model (`backend/Domain/Game.fs`)

- Add strongly typed `UserId` discriminated union and update `Player` structure.
- Add pure domain tests verifying identity equality, guest vs. authenticated discrimination, and reconnect validation.

---

### 3. Frontend Changes (TypeScript / Lit / Vite)

#### Dependencies (`frontend/package.json`)

- Add npm dependency:
  - `keycloak-js: ^26.x`

#### Auth Service Module (`frontend/src/auth.ts`)

- Encapsulate Keycloak initialization and state in a clean, framework-agnostic module:

  ```typescript
  export interface AuthUser {
    id: string;
    username: string;
    email?: string;
    roles: string[];
  }

  export interface AuthState {
    initialized: boolean;
    authenticated: boolean;
    user?: AuthUser;
    token?: string;
  }

  export function initAuth(): Promise<AuthState>;
  export function login(): Promise<void>;
  export function logout(): Promise<void>;
  export function register(): Promise<void>;
  export function getAccessToken(): Promise<string | undefined>;
  export function onAuthStateChanged(
    cb: (state: AuthState) => void
  ): () => void;
  ```

- Automatically refresh token before expiration:

  ```typescript
  keycloak.onTokenExpired = () => {
    keycloak.updateToken(30).catch(() => {
      // Handle session expiry / force logout
    });
  };
  ```

#### SignalR Client (`frontend/src/signalr-client.ts`)

- Update `getGameHubConnection()` to pass the token via `accessTokenFactory`:

  ```typescript
  const connection = new signalR.HubConnectionBuilder()
    .withUrl(`${api.baseUrl}/hubs/game`, {
      transport: signalR.HttpTransportType.WebSockets,
      skipNegotiation: true,
      accessTokenFactory: async () => {
        const token = await getAccessToken();
        return token ?? '';
      },
    })
    .withAutomaticReconnect()
    .build();
  ```

#### REST API Client (`frontend/src/api.ts`)

- Inject `Authorization: Bearer <token>` into fetch requests for authenticated endpoints (or when a token is present).

#### UI & Components

- **App Header / Navigation (`<bg-app>`):**
  - Display current user status in top bar (e.g. adjacent to connection indicator).
  - When logged out: Accessible "Log in" / "Register" buttons.
  - When logged in: Display username, avatar indicator, and an accessible dropdown menu with:
    - Account profile link (redirects to Keycloak Account Console: `https://auth.bibleguessr.single/realms/bibleguessr/account`).
    - "Log out" button.
- **Room Setup (`<bg-room-setup>`):**
  - If logged in: Pre-fill and lock the display name input with the authenticated username (with an optional badge indicating verified user).
  - If logged out: Show an optional callout: _"Playing as Guest. Log in to track scores across games, keep your name, and ignore players."_
- **Chat Panel (`<chat-panel>`):**
  - Visual indicator (e.g. verified badge or subtle icon) next to authenticated players in the roster vs. guests.

---

## Accessibility & UI Requirements (WCAG 2.2 AA)

Per the project standards in `CLAUDE.md`:

- **Interactive Controls:** Login, Logout, and User Menu buttons must be native `<button>` elements with persistent accessible labels (e.g. `aria-label="User account menu for Alice"`).
- **Keyboard Navigation:** User dropdown menu must support `Enter`/`Space` to open, arrow keys to navigate items, `Escape` to close, and return focus to the trigger element upon close.
- **Contrast & Themes:** All auth badges, login buttons, and account menus must maintain minimum 4.5:1 text contrast and 3:1 control boundary contrast across both light and dark themes.
- **No Color Alone:** Authenticated vs. Guest status in rosters must not rely on color alone (include text label or distinct icon with accessible description).

---

## Phased Implementation Plan

To keep pull requests safe, reviewable, and non-disruptive, the work should be split into 5 sequential phases:

### Phase 1: Infrastructure, Keycloak Container & Dev Routing

- [ ] Add `keycloak-db` (Postgres) and `keycloak` services to `.devcontainer/debian/docker-compose.yml`.
- [ ] Add `server-replica/nginx/conf.d/20-keycloak.conf` reverse proxy configuration.
- [ ] Update `scripts/certs/cert-issue.sh` to generate dev certs and host entries for `auth.bibleguessr.single`.
- [ ] Create `server-replica/keycloak/realms/realm-bibleguessr.json` with baseline realm, client, and test users.
- [ ] Verify Keycloak admin console and OIDC discovery endpoints respond at `https://auth.bibleguessr.single/realms/bibleguessr/.well-known/openid-configuration`.

### Phase 2: Backend JWT Bearer Authentication & SignalR Query Token

- [ ] Add `Microsoft.AspNetCore.Authentication.JwtBearer` to `backend/Api/BibleGuessr.Api.fsproj`.
- [ ] Configure JWT validation and WebSocket `OnMessageReceived` query token extractor in `backend/Api/Program.fs`.
- [ ] Add unit tests in `backend/Tests` for token validation logic and claims extraction.
- [ ] Add an authenticated health/test endpoint (e.g. `/api/auth/me`) returning caller identity claims to verify pipeline.

### Phase 3: Frontend Client Adapter & Auth UI

- [ ] Install `keycloak-js` in `frontend/`.
- [ ] Implement `frontend/src/auth.ts` service with reactive auth state and token lifecycle.
- [ ] Update `frontend/src/api.ts` to attach bearer tokens to HTTP requests.
- [ ] Add login/logout controls and user account dropdown to `<bg-app>` with full keyboard and screen-reader accessibility.
- [ ] Unit test auth service state transitions with Vitest.

### Phase 4: SignalR Authentication & Stable Player Identity

- [ ] Configure `accessTokenFactory` on `HubConnectionBuilder` in `frontend/src/signalr-client.ts`.
- [ ] Update `Player` domain type in `backend/Domain/Game.fs` to include `PlayerIdentity` (`Authenticated` vs `Guest`).
- [ ] Update `GameHub.fs` to bind caller identity from `Context.User`.
- [ ] Implement authenticated reconnection logic: reconnecting user reclaims existing player session in `RoomStore`.
- [ ] Add backend unit and concurrency tests for authenticated joins and reconnects.

### Phase 5: Downstream Feature Unlocks & Documentation

- [ ] Update `Feature.UsersShuldBeAbleToIgnoreEachother.md` to reference the new stable identity.
- [ ] Update `Feature.GameScoreBoard.md` to link scoreboard entries to authenticated `UserId`.
- [ ] Update documentation in `docs/web` explaining the authentication model, guest vs. registered accounts, and dev setup.
- [ ] Bump version numbers per `CLAUDE.md`: Frontend to `0.9.0`, Backend to `0.6.0`.

---

## Verification Plan

### Automated Tests

1. **Backend Unit & Integration Tests (`task dotnet:test`):**
   - Test JWT bearer authentication handler with mock tokens (valid, expired, wrong audience, wrong issuer).
   - Test SignalR query-token extraction during simulated WebSocket handshake.
   - Test `RoomStore` with authenticated `UserId` preserving identity upon reconnect.
2. **Frontend Unit Tests (`task frontend:test`):**
   - Test `auth.ts` state changes (logged out -> logging in -> authenticated -> expired).
   - Test `<bg-app>` renders user profile and handles keyboard interactions in user menu.
   - Test `signalr-client.ts` attaches token from `accessTokenFactory`.
3. **End-to-End Tests (`task frontend:test:e2e`):**
   - Playwright test: Log in as test user `alice` via Keycloak login page.
   - Playwright test: Verify user menu reflects `alice` and shows verified status.
   - Playwright test: Join multiplayer room as authenticated user; verify name is locked to username.
   - Playwright test: Simulate page reload; verify player automatically rejoins room with same stable identity.

### Manual Verification

- Verify running `task certs:add-dev-certs` trusts `auth.bibleguessr.single`.
- Verify Keycloak admin console is accessible at `https://auth.bibleguessr.single/admin`.
- Verify user self-registration flow (creating a new account, logging in, changing password).
- Verify Dark mode / Light mode contrast and styling of Keycloak login theme (or standard Keycloak page).
