# Write `build/fsx/AddGitTag.fsx`

A release today starts with a developer pushing a `frontend-v<version>` tag
by hand. `Taskfile.Release.yml` was originally meant to have a
`release:tag` task backing that step, but the script it would call,
`AddGitTag.fsx`, was never written — `task release:tag` calls a file that
does not exist on disk. Nothing currently stops a dirty working tree from
being tagged, or an existing tag from being silently moved.

Depends on `Task.MakeReleaseFsxScriptsCwdIndependent.md` landing first, so
this script is built on `Common.fsx`'s corrected path handling rather than
copying the same relative-path mistake into a new file.

## Requirements

- Reads the version from `frontend/package.json` (the single source of
  truth, per D1 in `BACKLOG/Feature.BuildFrontendAndPublishToGithubRelease.md`)
  and creates the tag `frontend-v<version>` (D2, same document).
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
