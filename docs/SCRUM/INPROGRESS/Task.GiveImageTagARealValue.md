# Give `IMAGE_TAG` a real value

`scripts/ci/load-image-version.sh` is a three-line stub that always prints
`0.0.1`. Every Docker image built — locally or in CI — carries that same
tag regardless of what changed. Every push to Docker Hub today overwrites
the same tag rather than publishing something identifiable and retrievable
later.

## Decision — manual edit, same mechanism as the two application versions

The original draft of this task proposed deriving the value automatically
from `github.sha` or `github.ref_name`. That was reconsidered: `IMAGE_TAG`
must follow the project's `n.n.n` form (e.g. `1.1.0`), matching
`frontend/package.json`'s `version` and `backend/Api/Program.fs`'s
`BackendVersion` — a git sha doesn't fit that shape, and a derived value
can't be chosen to match it either.

Instead, `load-image-version.sh` stays exactly as small as it is — its
`echo` line is hand-edited before each release, the same way
`frontend/package.json`'s `version` field is. No new file, no derivation
logic, no per-workflow source to choose between: Task's root `env:` block
already exports whatever the script returns to every `docker:*` task, so
one edit reaches both `ci.yml` and `main.yml` identically.

This means `IMAGE_TAG` bumps **every release, unconditionally** — unlike
the frontend/backend versions, which are conditional on what changed. Both
Docker images are rebuilt and republished on every tag push regardless, so
skipping this edit means the new images silently overwrite whatever tag the
script last returned.

## What's left

Only the mechanical part remains — no further design decision is needed:

- [ ] Change the literal in `scripts/ci/load-image-version.sh` away from
      `0.0.1` — either to the value that should ship with the next real
      release, or to something that visibly signals "edit me" (e.g. a
      placeholder or a comment above the `echo` line) if no release is
      imminent yet. This choice is the author's to make when actually
      cutting a release, not something to decide in the abstract here.
- [ ] Confirm the edit is included in `docs/web/frontend-release/index.html`'s
      "Cutting a release" `git add` line going forward — already updated to
      list `scripts/ci/load-image-version.sh` alongside the two application
      version files.

## Documentation — done

`docs/web/versioning/index.html` and `docs/web/frontend-release/index.html`
were both rewritten to describe this model rather than the sha-derivation
plan:

- The "Where the value comes from" and "On a real GitHub runner" sections in
  `versioning/index.html` no longer describe the script as a temporary stub
  awaiting a "meaningful, immutable source" — it now says plainly that its
  output *is* the mechanism.
- "Bumping a version" in the same page gained a fourth, unconditional
  bullet for `IMAGE_TAG`, and an `id="bumping"` anchor so other pages can
  link to it directly.
- "Cutting a release" in `frontend-release/index.html` now lists all three
  version files in its example commands, and distinguishes the two
  conditional application-version edits from the always-required
  `IMAGE_TAG` edit.

## Related, not required here

The backend image is currently built twice per release: once in `ci.yml`'s
`docker-build` job (verification only, discarded) and again in
`docker-publish` (published). A meaningful `IMAGE_TAG` makes it easier to
judge whether that duplicate build is worth removing — but removing it is a
separate decision, not a requirement of this task.

Also separate: making the backend's own build (a git sha, `BuildSha`, shown
in the Nerd Panel) visible alongside `BackendVersion`, so a given `n.n.n`
image tag can be traced back to the exact commit it came from. Discussed but
not committed to a task file yet — see the session that produced this
document if picking it up.

## Source

"What remains" in `DONE/Feature.BuildBackendAndPublishToDockerhub.md`.
