# Contributing to BibleGuessr

Thank you for contributing to BibleGuessr. This guide covers the project conventions and the checks to run before opening a change.

## Project layout

- `backend/` contains the F# domain model, ASP.NET Core API, SignalR hub, and backend tests.
- `frontend/` contains the TypeScript and Lit web application, unit tests, and Playwright end-to-end tests.
- `bibles/` contains translation sources used by the backend and local test-data guidance.
- `docs/SCRUM/` contains feature, backlog, and bug descriptions.
- `docs/web/` contains HTML documentation for completed features. Each feature should have its own directory and page.

## Prerequisites

Install:

- .NET SDK
- Node.js and npm
- Task
- Playwright browser binaries for end-to-end tests

Run `task --list-all` to see the available project tasks.

## Local setup

Start the backend and frontend in separate terminals:

```sh
task dotnet:dev
task frontend:dev
```

The default local URLs are:

- Backend: `http://localhost:5162`
- Frontend: `http://localhost:5173`

For tests that send email, start the local Mailpit service and use the development SMTP configuration. Do not commit local credentials or `appsettings.Development.json` values.

### Bible test data

Some parser and end-to-end tests require Bible files. The repository does not provide copyrighted translations for redistribution. Provide your own legally obtained files locally, following [bibles/jw.org/README-BROTHER.md](bibles/jw.org/README-BROTHER.md) and the relevant test fixtures.

Keep private Bible files out of commits. Uploaded Bible text must remain in the player's browser and must never be sent to the server or other players. Only book number, chapter number, and verse number may cross the multiplayer boundary.

## Validation commands

Run the checks relevant to your change:

```sh
# Backend
task dotnet:build
task dotnet:test

# Frontend
task frontend:build
task frontend:test

# End-to-end tests, with both dev servers already running
task frontend:test-e2e
```

For a focused frontend check:

```sh
cd frontend
npm run build
npm test
npx playwright test e2e/<spec-file>.spec.ts -g "<test name>"
```

When fixing a bug, verify that the regression test fails against the broken behavior before restoring the fix, then verify that it passes with the fix applied.

## Implementation conventions

- Keep changes focused and consistent with nearby code.
- Prefer existing abstractions and native HTML semantics over new frameworks or helpers.
- Use explicit state models when they make transitions clearer.
- Use named configuration values instead of unexplained magic numbers or strings.
- Add comments only when they clarify non-obvious behavior.
- Do not commit generated build output, test reports, browser traces, local settings, credentials, or private Bible files.
- Do not change unrelated user worktree changes.

## Frontend and accessibility

Every interactive feature must be keyboard-operable and usable with screen readers. Provide persistent labels for controls, visible focus indicators, correct semantic states such as `aria-expanded` and `aria-invalid`, and intentional live-region announcements for errors and asynchronous states.

Dialogs must support the required dismissal behavior, trap focus while open, and restore focus to the trigger. Test light and dark themes, narrow screens, 200% zoom, and reduced-motion settings when the change affects UI.

## Documentation

Document each completed feature under `docs/web/<feature>/index.html` using the existing shared styles. Update the relevant Scrum document under `docs/SCRUM/` when requirements, implementation notes, or verification steps change. Keep documentation in English (US), including code comments and commit messages.

Keep the root `README.md` concise. Put detailed feature behavior in `docs/web` and development contribution guidance in this file.

## Versioning

When a feature is completed, update the version for every affected application:

- Frontend changes: update the frontend version in `frontend/package.json` and `frontend/index.html`.
- Backend changes: update the backend version in `backend/Api/Program.fs`.
- Cross-stack changes: update both.

## Pull requests

A useful pull request should include:

- A concise description of the user-visible or technical change.
- The relevant feature or bug reference.
- Tests run and any required local services or private fixtures.
- Screenshots or recordings for meaningful UI changes, including relevant viewport or theme details.
- Notes about compatibility, migration, security, or known test gaps.

Before requesting review, inspect `git diff`, confirm that private or generated files are absent, and run the narrowest relevant validation plus the broader suite when practical.
