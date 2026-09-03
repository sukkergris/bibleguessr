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
privately rather than serve to other players — see the note on the NWT
translation below.

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
| `task dotnet:status` | Show whether a `dotnet` process / the API port is already in use |
| `task dotnet:free-port` | Kill whatever's bound to the API port (fixes "address already in use") |
| `task dotnet:kill` | Stop all running `dotnet` processes |
| `task frontend:build` | Type-check and build the frontend for production |
| `task frontend:preview` | Preview the production frontend build locally |

## Translation sources

`bibles/bibelen-dk/` holds a public-domain Danish translation. `bibles/jw/`
holds the Ny Verden-Oversættelsen (NWT) — Jehovah's Witnesses restrict
redistribution of this text, so serving it to other players from a shared
backend deployment is a licensing concern; the "bring your own file" mode
above exists specifically so the NWT can be used privately (parsed
client-side, never served to anyone else) instead of loaded server-side for
everyone.
