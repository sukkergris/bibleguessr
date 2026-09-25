# Ship the Bible with the API Image and Unpack It on First Run

Bundle `bibles/bibelen-dk/src/Bibelen Files.zip` in the API Docker image, and
on first startup unpack it to a data folder (a Docker volume in production, a
local folder in development). The API then loads its verses from that folder.

## Motivation

The published `bibleguessr-api` image contains no Bible data.
`build/Dockerfile.api` copies only `backend/Api/` and `backend/Domain/`, and
`dotnet publish` does not include `bibles/`. In production, `webapi.env` points
`Verses__Directory` at `/app/bibles/bibelen-dk/src`, which does not exist in
the container. The API starts, logs `Verses loaded: 0`, and
`/api/translations` returns `[]`. The game is unplayable, and nothing fails
loudly.

The Danish 1933 translation is public domain (see `NOTICE.md`), so it can be
redistributed inside the image.

## Desired behavior

1. The image ships the archive at a fixed path, e.g.
   `/app/bibles/bibelen-dk/src/Bibelen Files.zip`.
2. On startup, before verses are loaded, the API checks the data folder:
   - **Empty or missing:** unpack the archive into it.
   - **Already unpacked from the same archive:** do nothing.
   - **Unpacked from a different archive** (e.g. a newer image shipped an
     updated zip): unpack again, replacing the old contents.
3. The API loads verses from the unpacked folder.
4. If the folder is still empty after this, or 0 verses load, the API logs
   an error and the health endpoint reports it. It must not look healthy
   while serving an empty game.

## Decisions and constraints

- **Unpacking is idempotent.** Record which archive was unpacked, e.g. a
  marker file holding the zip's SHA-256. Compare against the marker, not
  "the folder is non-empty", so an image upgrade picks up a changed archive.
- **Unpacking is atomic.** Extract to a temp folder next to the target, then
  swap it in. A crash mid-extraction must not leave a half-populated folder
  that the next start treats as complete.
- **Guard against zip-slip.** Reject entries whose resolved path escapes the
  target folder.
- **Configuration, not hardcoded paths** (per `CLAUDE.md`). For example:
  - `Verses:ArchivePath`: where the shipped zip lives in the image
  - `Verses:DataDirectory`: where it is unpacked (the volume mount point)

  Set production defaults in the Dockerfile's `ENV`, so the image works
  without `webapi.env`. Keep a working default for `dotnet run` in
  development (a gitignored local folder, e.g.
  `bibles/bibelen-dk/Bibelen Files/`, which is already gitignored).
- **Volume permissions.** The container runs as the non-root `apiuser`.
  Create the mount point in the image and `chown` it to `apiuser`, so a
  fresh named volume inherits that ownership. Document that a bind mount
  must be writable by the container's UID.
- **Only the bundled public-domain archive is unpacked.** Copy the specific
  archive (`bibles/bibelen-dk/src/`) into the image, never `bibles/` as a
  whole. Add `bibles/jw.org` to `.dockerignore` as a second guard. See
  "Bible translation licensing" in `CLAUDE.md`.
- **The domain stays unaware of this.** Unpacking is an infrastructure
  concern at startup, next to `BibelenDkLoader`. The domain keeps receiving
  a `Verse list`.

## Scope

In scope:

- Copy the archive into `build/Dockerfile.api`, with a writable,
  `apiuser`-owned data directory declared as a `VOLUME`.
- A startup step that unpacks idempotently and atomically, with a marker.
- A loader that reads the unpacked `*.html` files. `BibelenDkLoader`
  already parses chapter pages; it needs a directory-of-HTML entry point
  next to `loadFromZip`.
- A health signal and error log when no verses load.
- A volume for the data directory in the production compose file
  (`bibelguessr-server/docker-compose.yml`), and removal of the stale
  `Verses__Directory` from `webapi.env`, or an update to match.

Out of scope:

- Additional translations, or loading several archives.
- Uploading or replacing Bible files at runtime. "Bring your own file"
  stays client-side only (see "Data security" in `CLAUDE.md`).

## Acceptance criteria

- A freshly pulled image, started with an empty volume, logs a non-zero
  `Verses loaded:` count, and `/api/translations` returns the bibelen-dk
  translation.
- A second start with the same volume does not unpack again (visible in the
  log).
- Replacing the archive with a different one causes a re-unpack on the next
  start.
- An interrupted unpack (simulated in a test) is redone on the next start.
- A zip entry like `../evil.html` is rejected, and nothing is written
  outside the data folder.
- With no archive and an empty data folder, the API logs an error, and the
  health endpoint reports the problem.

## Tests (TDD)

- Unit tests for the unpack decision (empty / same marker / different
  marker / partial temp folder left behind), using a temp directory.
- A zip-slip test with a crafted archive.
- A loader test for the unpacked-directory entry point, reusing the fixtures
  from `BibelenDkLoaderTests.fs`.
- Per `CLAUDE.md`: confirm that each bug-guarding test fails with its guard
  removed.

## Open question

`BibelenDkLoader.loadFromDirectory` can already read the zip directly,
without unpacking. The only change strictly needed to fix the empty
production API is to copy the zip into the image. Unpacking to a volume adds
startup logic, state and permissions to maintain. Confirm the reason for
unpacking before implementation, for example:

- letting operators inspect or patch the files on the server, or
- preparing for more translations dropped into the volume.

If neither applies, consider shipping the one-line Dockerfile fix first, as a
bug, and keep this feature for when unpacking is actually needed.

## Definition of done

- Backend version bumped (`BackendVersion` in `backend/Api/Program.fs`).
- Feature documented under `docs/web/` (image layout, the volume, and the
  configuration keys).
- `README.md` mentions the data volume if it affects local setup.
