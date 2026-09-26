# Write `build/fsx/PublishGitHubRelease.fsx`

`release.yml`'s `bundle` job creates the draft release with a plain
`gh release create "${{ github.ref_name }}" artifacts/*.zip --draft` step,
written directly in the workflow YAML. This is the one piece of release
logic that cannot currently be run or reproduced from a developer's own
shell — a `task release:publish` command does not exist, so testing a
release means pushing a tag and watching GitHub Actions.

The inline step satisfies the *draft* requirement (D3 in
`BACKLOG/Feature.BuildFrontendAndPublishToGithubRelease.md`) by accident of
what `gh release create --draft` does, but has no equivalent for the other
guarantees below, and its failure modes have never been deliberately
exercised.

## Requirements

- Creates the release as a **draft** for the `frontend-v<version>` tag, and
  uploads the artifact from `artifacts/`.
- Shells out to the `gh` CLI rather than calling the REST API directly —
  `gh` already authenticates identically from a developer shell and from
  Actions (`GH_TOKEN`), so one code path runs in both places.
- Fails clearly and non-zero when `gh` is unauthenticated, rather than
  appearing to succeed.
- Safe to retry after a partial upload (e.g. the release was created but the
  asset upload failed).
- A `release:publish` task in `Taskfile.Release.yml` calls it.
- `release.yml`'s `bundle` job is updated to call `task release:publish`
  instead of the inline `gh release create` step. `permissions: contents:
  write` stays on the job, and `GH_TOKEN` is passed through to the task.

## Verification

Per the testing rule in `CLAUDE.md`:

1. Run with `gh` logged out; confirm a clear non-zero failure rather than a
   silent success.
2. Simulate a partial upload (release created, asset missing) and confirm a
   re-run completes it rather than failing or duplicating the release.

## Source

Acceptance criterion 3 in `BACKLOG/Feature.CI-CD-construction.md`; "no
local publish path" in `BACKLOG/Feature.BuildFrontendAndPublishToGithubRelease.md`'s
"What remains".
