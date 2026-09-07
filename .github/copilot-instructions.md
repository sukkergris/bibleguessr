# Copilot instructions for BibleGuessr

A Bible-verse guessing game: `backend/` is an F# / ASP.NET Core minimal API
(+ SignalR hub) for multiplayer; `frontend/` is TypeScript + Lit web
components (Vite). See `README.md` and `CLAUDE.md` for project-wide
conventions (English (US) only, DDD/TDD "don't be dogmatic", WCAG 2.2 AA
accessibility, versioning rules) — those apply here too and are not repeated
below.

## Commands

Requires [Task](https://taskfile.dev), the .NET SDK, and Node. Run
`task --list-all` for the full list.

```sh
task dotnet:dev          # backend API,      http://localhost:5162
task frontend:dev        # Vite dev server,  http://localhost:5173
task dotnet:build        # build backend
task dotnet:test         # backend unit tests (xUnit)
task frontend:build      # tsc + vite build (type-checks)
task frontend:test       # frontend unit tests (Vitest)
task frontend:test-e2e   # Playwright — requires dotnet:dev AND frontend:dev already running
```

Single-test runs (use these instead of the full suite while iterating):

```sh
cd backend && dotnet test --filter "FullyQualifiedName~ScoringTests"
cd frontend && npx vitest run src/scoring.test.ts -t "test name"
cd frontend && npx playwright test e2e/game-preferences.spec.ts -g "test name"
```

`dotnet:free-port` / `frontend:free-port` kill whatever's bound to the API
(5162) or dev server (5173) port ("address already in use"); `dotnet:kill` /
`frontend:kill` stop stray processes from previous runs.

Playwright browser binaries must be installed once per machine:
`cd frontend && npx playwright install`. Tests that exercise the bug-report
email flow additionally need a local SMTP server — see CLAUDE.md's
"Running tests" section for the Mailpit setup.

When fixing a bug, verify the regression test actually fails against the
reverted/broken code before restoring the fix (see CLAUDE.md's Testing
section) — don't trust a test you haven't watched fail.

## Architecture

- **`backend/Domain`** — pure F# types and logic, no ASP.NET dependency:
  `Verses.fs` (Verse/VerseReference/book-number matching), `Game.fs`
  (Player/Guess/RoundState/GameSession/GameType, plus its `Scoring`
  module), and separate report DTOs (`AbuseReport.fs`,
  `BibleFileUploadReport.fs`, `GeneralBugReport.fs`). Covered by
  `backend/Tests`.
- **`backend/Api`** — `Program.fs` (minimal API endpoints, JSON
  configuration, CORS, DI), `GameHub.fs` (SignalR hub + in-memory
  `RoomStore`), `BibelenDkLoader.fs` (loads `bibles/` at startup),
  `MailSender.fs` (report emails via SMTP).
- **`frontend/src`** — `components/*.ts` are Lit elements (shadow DOM);
  `api.ts` wraps `fetch` against the backend; `signalr-client.ts` wraps the
  SignalR hub connection; `types.ts` hand-mirrors the backend's F# Domain
  types (kept in sync manually — see its header comment); `local-verses.ts`
  + `epub-parser.ts` implement the client-only "bring your own Bible file"
  path.

**Cross-boundary contracts to preserve:**
- F# discriminated unions (e.g. `RoundState`, `GameType`, `TimeLimit`)
  serialize as `{ Case: "...", Fields: [...] }`; `types.ts` mirrors this
  shape by hand — update both sides together when a DU changes.
- F# `Map` fields (e.g. `GameSession.Scores`, `GameType.Chapters`) are
  configured to serialize as plain JSON objects (`MapFormat.Object` in
  `Program.fs`), matching `Record<K, V>` on the TypeScript side. Don't
  assume the JsonFSharpConverter default (array-of-pairs) — it's
  explicitly overridden.
- **Verse text never crosses the multiplayer wire.** Server-side round
  state carries only a `VerseReference` (book/chapter/verseNumber); each
  client resolves it to displayable text from its own `VerseSource`
  (`api.ts` or `local-verses.ts`). This is also a hard data-security rule:
  an uploaded Bible file's text must never reach the server or other
  players — only book/chapter/verse numbers may be transmitted.
- **Book matching is by number, not name.** The same book can be spelled
  differently across translations/uploaded files (or even inconsistently
  within one loader's output), so multiplayer scoring and game-type
  restrictions match on `bookNumber` (each player's own 1-based position
  in their own `VerseSource`'s Bible order), never on the display name.
  Singleplayer scoring (`Scoring.pointsForVerseGuess`) still matches by
  name — see `ScoringTests.fs` vs. `MultiplayerScoringByNumberTests.fs`.
- A `GameId` (not the player pair) identifies a game instance — two
  players can immediately start a new game after finishing one, and stale
  messages from the old game must be ignored by id (see
  `docs/SCRUM/BUGS/BUG.StaleGameOverEndsTheWrongGame.md`).
- `RoomStore.Update` (`GameHub.fs`) is a compare-and-swap loop, not
  get-then-set — concurrent hub calls on the same room must go through it
  to avoid lost updates (see `RoomStoreConcurrencyTests.fs`).

## Conventions

- New request/response DTOs at the API boundary use nullable `string`
  fields (not `string option`) since they're bound directly from
  untrusted client JSON; validate into a proper domain type immediately
  after. Give each report/request type (upload-error report, abuse report,
  bug report, play request, ...) its own dedicated type/endpoint rather
  than reusing another's shape, even when the fields look similar.
- Frontend components are Lit elements using default (shadow-DOM)
  rendering; accessibility audits (`frontend/e2e/helpers/a11y.ts`) walk
  shadow roots deliberately — plain `document.querySelectorAll` won't see
  into them.
- Every completed feature gets a doc page at `docs/web/<feature>/index.html`
  (static HTML/CSS/JS only, using `docs/web/shared/styles.css`) and,
  typically, a spec under `docs/SCRUM/` (`BACKLOG`/`TODO`/`DONE`/`BUGS`).
  Comments in source frequently point at these docs for the "why" — follow
  those references before assuming a design choice is arbitrary.
- Config: 2-space indent for JS/TS/JSON/YAML/HTML, 4-space for F#
  (`.editorconfig`); Prettier for JS/TS/MD/YAML formatting
  (`.prettierrc`: single quotes, semicolons, `es5` trailing commas).
- Don't commit generated build output, test reports/traces, local
  `appsettings.Development.json`, or private Bible files (`bibles/jw.org/`
  is gitignored except its `README.md`/`.gitkeep`).
