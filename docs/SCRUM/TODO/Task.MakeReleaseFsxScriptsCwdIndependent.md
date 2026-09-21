# Make the release `.fsx` scripts CWD-independent

`build/fsx/lib/Common.fsx` resolves `packageJsonPath` and `distIndexPath` as
relative strings — `Path.Combine("frontend", "package.json")` — rather than
through `RootLoader.findRoot`, which `BundleFrontend.fsx` already uses. The
repository has a `root-marker` file and both `RootLoader.fsx` and
`root-loader.sh` precisely so scripts do not depend on the caller's current
directory.

This will break the moment `release:frontend` (and therefore
`VerifyFrontendArtifact.fsx`, which uses `Common.fsx`) is invoked from
anywhere but the repository root — including from inside an `act` container,
where the working directory is not guaranteed to match a developer's local
checkout.

It is a small, self-contained fix and a prerequisite worth doing first: any
new script that reads `frontend/package.json` or `frontend/dist/index.html`
(see `Task.WriteAddGitTagScript.md`) should be built on the corrected
`Common.fsx`, not on a second copy of the same relative-path mistake.

## Requirements

- `packageJsonPath` and `distIndexPath` in `Common.fsx` resolve through
  `RootLoader.findRoot`, not relative strings.
- `task release:frontend` succeeds when invoked from a subdirectory (e.g.
  `frontend/`) and from outside the repository entirely, not only from the
  repo root.
- Before the fix, confirm the subdirectory run actually fails — otherwise
  the fix is unverified, per the testing rule in `CLAUDE.md`.

## Source

Acceptance criterion 4 in `BACKLOG/Feature.CI-CD-construction.md`.
