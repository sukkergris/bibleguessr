# BibleGuessr - Project Context & Rules

## Project Overview

**BibleGuessr** is an open-source Bible-verse guessing game. Players are presented with a Bible verse and guess its book, chapter, and verse number. Scoring is tiered (standard rule: Book: 10 pts, Book+Chapter: +100 pts, Book+Chapter+Verse: +1000 pts); each game type has its own rule (what's given at setup earns nothing), the same in singleplayer and multiplayer — see `docs/web/scoring` and `scoring-scenarios/`.

- **Domain:** `bibleguessr.uk`
- **Future Roadmap:** Planned migration to Kubernetes (`k8s` / `k3s`) later this year.

---

## Architecture & Tech Stack

### Frontend (`frontend/`)

- **Framework:** TypeScript + [Lit](https://lit.dev) (Web Components).
- **Tooling:** Vite, Vitest (unit tests), Playwright (E2E tests).
- **Communication:** `@microsoft/signalr` for real-time multiplayer rounds and chat.
- **Client-side Storage & Parsing:** `fflate` for local `.epub` parsing (`epub-parser.ts`), cached in IndexedDB for private translation mode ("bring your own file").

### Backend (`backend/`)

- **Language / Framework:** F# on .NET 10 (`net10.0`), ASP.NET Core minimal API with SignalR (`GameHub.fs`).
- **Domain Layer (`backend/Domain/`):** Pure F# domain models (`Game.fs`, `Verses.fs`, `AbuseReport.fs`). Explicit discriminated unions for round and game states.
- **Data Loaders (`backend/Api/`):** Bundled public-domain translation (`bibles/bibelen-dk/`) unpacked on startup into `bibles/.data/` (or Docker volume).
- **Mailing:** SMTP client (`MailSender.fs`) for bug reports and translation upload error reports (tested with Mailpit in dev).

### Infrastructure & Tooling

- **Task Runner:** [Task](https://taskfile.dev) via `Taskfile.yml` and modular sub-taskfiles (`Taskfile.Dotnet.yml`, `Taskfile.Frontend.yml`, `Taskfile.Docker.yml`, etc.).
- **Containers:** Multi-platform Docker builds (`linux/amd64`, `linux/arm64`) with `docker buildx bake` (`build/docker-compose.build.yml`).

---

## Core Guidelines & Conventions

### Language

Code, comments, commit messages, and documentation are written in **English (US)**, regardless of the conversation language.

### Code Architecture

- Consider DDD and TDD in practice without being dogmatic.
- Prefer explicit state models (discriminated unions or state objects) over scattered conditional flags.
- Prefer configuration values over hardcoded values for system settings; use named bindings (`let`, `static readonly`) instead of magic numbers/strings.

### Data Security & Privacy

- **Critical:** Uploaded verse text must **never** be sent to the server or to other players.
- Only the book number, chapter number, and verse number (`VerseReference`) may be transmitted over the wire. Each client renders verse text locally from its own active translation source.

### Bible Translation Licensing

- Only public-domain or explicitly redistributable translations may be committed to this repository.
- Copyrighted translations (e.g. JW.org's _Ny Verden-Oversættelsen_) must **never** be added to git in any form. Always verify `.gitignore` excludes any translation under `jw.org`.

### Testing

- Before trusting a test that covers a bug fix, prove it fails when the fix is removed/broken, then confirm it passes when restored.

### Accessibility (WCAG 2.2 AA)

- Keyboard navigability, clear focus indicators (never remove focus outline without replacement), accessible labels, modal focus traps with Escape dismiss, color contrast compliance across light/dark themes, and support for `prefers-reduced-motion`.

### Versioning

- **Frontend revision:** `revision` counter in `frontend/package.json`.
- **Backend revision:** `BackendRevision` in `backend/Api/Program.fs`.
- **Release version:** `n.n.n` managed by `scripts/ci/load-image-version.sh`.
- Increment the respective revision counter when completing a feature.

---

## Common Development Commands (Taskfile)

```sh
# Backend
task dotnet:dev        # Run backend API (http://localhost:5162)
task dotnet:build      # Build backend
task dotnet:test       # Run backend unit tests (xUnit)
task dotnet:free-port  # Free backend API port

# Frontend
task frontend:dev      # Run frontend dev server (http://localhost:5173)
task frontend:build    # Type-check and build frontend
task frontend:test     # Run frontend unit tests (Vitest)
task frontend:test-e2e # Run E2E tests (Playwright)

# Docker
task docker:build:app  # Build images for host architecture
task docker:build:multi# Build multi-arch images
```
