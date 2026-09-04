# bibleguessr

A Bible-verse guessing game: you're shown a verse and guess its book,
chapter, and verse number. Points are awarded per level, each gated on the
level before it also being correct — book alone is worth 10, +100 more for
also getting the chapter right, +1000 more for also getting the verse
number right.

## Project structure

```
backend/       F# / ASP.NET Core minimal API
  Domain/      Verse, scoring, and game types
  Api/         HTTP endpoints, SignalR hub, and the translation loaders
frontend/      TypeScript + Lit web components (Vite)
bibles/        Local translation source files the backend loads at startup
```

## Two ways to get verses

**Server translation** — the backend loads one or more Bible translations
from `bibles/` at startup and serves them over HTTP. This is the default
mode in the app's setup screen.

**Bring your own file** — the setup screen also offers "My own Bible file":
drop in a `.epub` export and it's parsed entirely in your browser (via
`frontend/src/epub-parser.ts`), cached locally in IndexedDB, and never
uploaded anywhere. Useful for translations you're only entitled to use
privately rather than serve to other players from a shared backend.

## Running it

Requires [Task](https://taskfile.dev), the .NET SDK, and Node.

```
task dotnet:dev     # backend API, http://localhost:5162
task frontend:dev   # frontend dev server, http://localhost:5173
```

Other useful tasks — run `task --list-all` for the full list:

| Task | What it does |
|---|---|
| `task dev` | Alias for `task frontend:dev` |
| `task dotnet:build` | Build the backend |
| `task dotnet:test` | Run backend tests |
| `task dotnet:status` | Show whether a `dotnet` process / the API port is already in use |
| `task dotnet:free-port` | Kill whatever's bound to the API port (fixes "address already in use") |
| `task dotnet:kill` | Stop all running `dotnet` processes |
| `task frontend:build` | Type-check and build the frontend for production |
| `task frontend:test` | Run frontend unit tests |
| `task frontend:test-e2e` | Run end-to-end tests (requires `dotnet:dev` and `frontend:dev` already running) |
| `task frontend:preview` | Preview the production frontend build locally |
| `task frontend:status` | Show whether a Vite dev server / the dev port is already in use |
| `task frontend:free-port` | Kill whatever's bound to the dev server port |
| `task frontend:kill` | Stop all running Vite dev server processes |

## Running tests

```
task dotnet:test        # backend unit tests (xUnit)
task frontend:test      # frontend unit tests (Vitest)
task frontend:test-e2e  # end-to-end tests (Playwright)
```

End-to-end tests need both dev servers already running (`task dotnet:dev`
and `task frontend:dev`, in separate terminals) and, once per machine,
Playwright's browser binaries installed: `cd frontend && npx playwright install`.

## Translation sources

`bibles/bibelen-dk/` holds a public-domain Danish translation, loaded and
served by the backend. Translations the app isn't entitled to redistribute
(e.g. Jehovah's Witnesses' Ny Verden-Oversættelsen) are never loaded
server-side at all — they only work through "bring your own file" above,
where the text stays in the player's own browser.
