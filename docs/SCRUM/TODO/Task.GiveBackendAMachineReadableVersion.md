# Give the backend a machine-readable version

`backend/Api/Program.fs:46` holds `let BackendVersion = "0.5.3"` as a bare
literal, served at `/api/version`. There is no `<Version>` property in
`backend/Api/BibleGuessr.Api.fsproj`, so nothing outside the running process
can read the backend's version the way `packageVersion()` in
`build/fsx/lib/Common.fsx` reads the frontend's from `package.json`. A
build script wanting the backend version today would have to parse F#
source directly.

`CLAUDE.md` requires bumping each application's version when a feature
changes it — the frontend side of that rule is enforceable and tested; the
backend side is currently enforced by memory alone, and there is no task to
automate either.

## Requirements

- `backend/Api/BibleGuessr.Api.fsproj` gains a `<Version>` property as the
  authoritative source.
- `Program.fs`'s `BackendVersion` derives from that property at build time
  rather than repeating the literal by hand.
- A `task release:version -- <frontend|backend> <major|minor|patch>` task,
  backed by an `.fsx` script, bumps the named application's version in its
  authoritative location (`package.json` for the frontend, the new
  `<Version>` property for the backend).
- The task refuses an unknown application name or an unknown bump level,
  rather than silently doing nothing or bumping the wrong thing.

## Source

Acceptance criterion 9 (D5) in `BACKLOG/Feature.CI-CD-construction.md`;
"The backend has no version" precondition in the same document.
