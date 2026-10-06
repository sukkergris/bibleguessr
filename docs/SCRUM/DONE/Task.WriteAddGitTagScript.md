# Write `build/fsx/AddGitTag.fsx`

A release today starts with a developer pushing a `v<release version>` tag
by hand. `Taskfile.Release.yml` was originally meant to have a
`release:tag` task backing that step, but the script it would call,
`AddGitTag.fsx`, was never written — `task release:tag` calls a file that
does not exist on disk. Nothing currently stops a dirty working tree from
being tagged, or an existing tag from being silently moved.

Depends on `Task.MakeReleaseFsxScriptsCwdIndependent.md` landing first, so
this script is built on `Common.fsx`'s corrected path handling rather than
copying the same relative-path mistake into a new file.

## Requirements

- Reads the release version from `scripts/ci/load-image-version.sh` and
  creates the tag `v<release version>`. This replaces D2 in
  `BACKLOG/Feature.BuildFrontendAndPublishToGithubRelease.md`
  (`frontend-v<version>` from `frontend/package.json`); see "The release
  version" in `docs/web/versioning/index.html`. The tag must still pass
  `scripts/ci/check-release-tag.sh`, which the release workflow runs first.
- Refuses to tag when the working tree is dirty, with a message naming which
  files are dirty.
- Refuses to overwrite an existing tag. Re-running is either a safe no-op or
  a clear, non-zero failure — never a silent force.
- Resolves all paths through `RootLoader`, so it works from any CWD.
- A `release:tag` task in `Taskfile.Release.yml` calls it.

## Verification

Per the testing rule in `CLAUDE.md`, each guard must be proven to fire:

1. Dirty a file, run it, confirm non-zero exit and no tag created. Clean the
   tree, re-run, confirm the tag appears.
2. Run it twice against the same version; confirm the second run does not
   move or replace the tag.

## Source

Acceptance criterion 2 in `BACKLOG/Feature.CI-CD-construction.md`; "no
dirty-tree or existing-tag guard" in `BACKLOG/Feature.BuildFrontendAndPublishToGithubRelease.md`'s
"What remains".

## Closed without implementation (2026-10-06)

Superseded by D5 in `BACKLOG/Feature.BuildFrontendAndPublishToGithubRelease.md`:
a release is started by pushing `v<release version>` by hand (see
`docs/web/cutting-a-release`), which has shipped v0.0.2–v0.0.6. The guards
this task wanted already exist elsewhere: git refuses to move an existing tag
without `-f`, and the release workflow's `check-tag` job refuses a tag that
doesn't match `scripts/ci/load-image-version.sh`. There is no `release:tag`
task pointing at a missing file.
