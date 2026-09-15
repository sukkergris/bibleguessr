# GitHub Actions in this repository

Notes on how the workflows here are built, run and cleaned up. Written while
setting up the first one, so it records the traps that were actually hit
rather than a general introduction.

## Layout

Workflow files live in `.github/workflows/`. The directory name is plural and
exact — GitHub silently ignores `.github/workflow/`, with no error and no
workflow. If a new workflow never appears in the Actions tab, check the
directory name first.

A workflow must be on the default branch before its **Run workflow** button
appears. Pushing it to a feature branch is not enough.

## Building a workflow in steps

Adding everything at once means debugging several things at the same time in a
CI log. Adding one piece at a time means each failure has one cause.

The order used for `main.yml`:

1. **Checkout and toolchain only.** Prove the runner can install Node, .NET and
   Task. No release, no upload.
2. **Run the real command** (`task release:bundle`) and attach the result with
   `actions/upload-artifact`. This makes the output downloadable from the run
   itself, so the artifact can be inspected without creating a release.
3. **Add the release step**, guarded by `if:` so manual runs skip it.
4. **Add the tag trigger** once the rest is green.

Keep `workflow_dispatch` in `on:` even after adding a tag trigger. It gives a
manual **Run workflow** button, so the workflow can be re-run without inventing
a tag — useful both while building it and later, when a run fails for a
transient reason.

## Running and watching

```sh
gh workflow list                  # workflows GitHub can see
gh workflow run main.yml          # start a workflow_dispatch run
gh run watch                      # follow the active run live in the terminal
gh run list --limit 5             # recent runs with status
gh run view <run-id> --log-failed # only the steps that failed
gh run view --web                 # open the run in a browser
gh run download <run-id>          # fetch the run's artifacts
```

`gh run watch` is the fastest feedback loop — no browser, and it prints each
step as it completes.

## Reading the step icons

| Icon                | Meaning                                    |
| ------------------- | ------------------------------------------ |
| Check               | Ran and succeeded                          |
| Circle with a slash | **Skipped** — an `if:` condition was false |
| Cross               | Ran and failed                             |

A skipped step is not a failure. `Create draft release` is skipped on every
manual run by design, because `github.ref` is then a branch rather than a tag.

## Releasing from a tag

The release step is guarded so it only runs for tag pushes:

```yaml
- name: Create draft release
  if: startsWith(github.ref, 'refs/tags/')
  run: gh release create "${{ github.ref_name }}" artifacts/*.zip --draft
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- `github.ref_name` is the tag without the `refs/tags/` prefix.
- `secrets.GITHUB_TOKEN` is provided automatically; nothing has to be created.
  If the step fails with a 403, add `permissions: contents: write` to the job.
- `--draft` keeps the release private to people with write access until it is
  published by hand. See decision D3 in
  `docs/SCRUM/BACKLOG/Feature.BuildFrontendAndPublishToGithubRelease.md`.

Without the `if:`, a manual run would call `gh release create main`, which
succeeds and creates a tag named `main`.

To trigger a real release:

```sh
git tag frontend-v0.8.3
git push origin frontend-v0.8.3
gh run watch
```

## Cleaning up a test release

Deleting the release does not delete the tag, and the tag exists in three
places — the release, the remote, and locally:

```sh
gh release delete frontend-v0.8.3 --yes --cleanup-tag  # release + remote tag
git tag -d frontend-v0.8.3                             # local tag
```

`--cleanup-tag` removes the remote tag along with the release. Without it, the
tag stays behind and a re-run of the same version fails or reuses the old
commit. The local tag is never touched by `gh` and has to be deleted
separately.

To remove only a tag, without a release attached:

```sh
git push origin :refs/tags/frontend-v0.8.3
git tag -d frontend-v0.8.3
```

## `name:` on a step

Two different keys share the name, which is easy to confuse:

```yaml
- name: Upload frontend bundle # the step's label in the log (optional)
  uses: actions/upload-artifact@v4
  with:
    name: frontend-zip # an input to that action
```

Directly on a step, `name:` is the label shown in the Actions UI. Omitting it
makes GitHub generate one from the command, which is fine for short commands
(`Run task release:bundle`) and unreadable for long ones containing `${{ }}`
expressions. That is the only reason the release step has an explicit name and
the others do not.

Under `with:`, `name:` means whatever the action defines — for
`upload-artifact` it is the artifact's own name.

## Traps hit while setting this up

**Case-sensitive paths.** Development happens in a devcontainer on a
case-insensitive macOS volume; the runner is case-sensitive Linux. A
`#load "lib/Rootloader.fsx"` referring to `lib/RootLoader.fsx` worked locally
and failed on the runner with `FS0078: Unable to find the file`. This class of
bug cannot be reproduced locally — every path in a `#load`, an import or a file
read has to match the filename exactly.

**`upload-artifact` wraps everything in a zip.** Uploading
`bibleguessr-frontend-0.8.3.zip` produces `frontend-zip.zip` containing it.
That is only true of this debugging step: `gh release create` uploads the file
directly, so a published release asset is not double-wrapped.

**Task's exit code 201** means a task it ran failed; the real error is further
up the log. Read the first failing line, not the last.

## Pinning

`runs-on: ubuntu-latest` moves when GitHub migrates the image, which can turn a
green workflow red on a morning when nothing changed. A release workflow pins
the runner version instead.

Avoid images marked **Public preview** — GitHub documents them as "as-is" and
outside the service level agreement.

Actions are pinned by major version (`@v4`). For stricter supply-chain
guarantees they can be pinned to a commit SHA, since a tag can be moved and a
SHA cannot. The same reasoning appears in `frontend/NPM.Security.Readme.md`.

## Known warnings

> Node.js 20 is deprecated. The following actions target Node.js 20 but are
> being forced to run on Node.js 24.

A warning, not an error — GitHub already runs them on Node 24. Newer majors of
all five actions target `node24` and clear it:

| Action                    | Node 20 | Targets node24 |
| ------------------------- | ------- | -------------- |
| `actions/checkout`        | v4      | v7             |
| `actions/setup-node`      | v4      | v7             |
| `actions/setup-dotnet`    | v4      | v6             |
| `actions/upload-artifact` | v4      | v7             |
| `arduino/setup-task`      | v2      | v3             |

Upgrade one change at a time and verify with a run — a major bump can carry
breaking changes beyond the Node version.

## Local testing

Workflows cannot meaningfully be run locally here. `act` needs to mount the
repository into a container, and Docker Desktop on the host does not share the
devcontainer's `/xyz` path. Even where it runs, `act` uses its own runner
images, handles the `setup-*` actions differently, and has no artifact server.

What _can_ be checked locally:

```sh
# the repository's own logic — the only part of the workflow that is ours
task release:bundle

# workflow syntax, via actionlint piped over stdin (avoids the mount problem)
cat .github/workflows/main.yml | docker run --rm -i rhysd/actionlint:latest -
```

Everything else is environment differences, which only a real run reveals.
