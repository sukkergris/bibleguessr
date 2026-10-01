# CI/CD Construction

Consolidate the build, test, and release pipeline around Task, F# scripts
(`.fsx`), and bash, so that every step of real work can be run and proven on a
developer machine. GitHub Actions is reduced to a trigger and a credential
provider: a workflow step should never be more than `- run: task <something>`.

## Motivation

The pipeline is not missing — it is half-built and split between two
incompatible styles.

`Taskfile.Release.yml` orchestrates; `build/fsx/*.fsx` holds the logic with real
branching; `lib-bash/` handles host-level work. That layering emerged on its own
and it is the right one. `.github/workflows/ci.yml` already respects it — every
step is `run: task ...`.

`.github/workflows/release.yml` does not. It hand-rolls `gh release create` in
YAML, which is the one piece of release logic that cannot be run or tested
locally, and it duplicates what `PublishGitHubRelease.fsx` was meant to do.

The consequence is that "does the release work?" can only be answered by pushing
a tag and watching. This feature closes that gap.

## Preconditions

Defects in the current state that block the feature. Each has a corresponding
acceptance criterion below.

### Two release tasks invoke scripts that do not exist

`Taskfile.Release.yml` calls:

| Task               | Script                                 | On disk |
| ------------------ | -------------------------------------- | ------- |
| `release:frontend` | `build/fsx/VerifyFrontendArtifact.fsx` | yes     |
| `release:bundle`   | `build/fsx/BundleFrontend.fsx`         | yes     |
| `release:tag`      | `build/fsx/AddGitTag.fsx`              | **no**  |
| `release:publish`  | `build/fsx/PublishGitHubRelease.fsx`   | **no**  |

`task release:tag` and `task release:publish` therefore fail. Commit `9925c7b`
added the tasks; no later commit added the two scripts.

`docs/web/frontend-release/index.html` documents all four steps as if they work,
so the documentation is currently wrong.

### `release.yml` bypasses the release tasks

The workflow runs `task release:bundle`, then creates the GitHub release with an
inline `gh release create` step. The `release:publish` task — the thing that is
supposed to do exactly this — is never called.

### `Common.fsx` uses relative paths

`build/fsx/lib/Common.fsx` resolves `frontend/package.json` and
`frontend/dist/index.html` relative to the current working directory, while
`BundleFrontend.fsx` resolves paths through `RootLoader.findRoot`. The repository
has a `root-marker` file and both a `RootLoader.fsx` and a `root-loader.sh`
precisely so scripts do not depend on CWD. `Common.fsx` opts out of that, which
will break as soon as a script is invoked from anywhere but the repository root
— including from inside an `act` container.

### `actionlint` is installed but never run

`scripts/programs/actionlint.arm.installer.sh` installs it. Nothing calls it.

### `shellcheck` is not installed

`lib-bash/` carries `# shellcheck disable=...` directives throughout, but
`shellcheck` is absent from the devcontainer. Bash is a first-class layer here
and is currently the only unlinted one.

### The backend has no version

`CLAUDE.md` requires bumping each application's version when a feature changes
it. `frontend/package.json` holds `0.8.3`. The backend version lives in
`backend/Api/Program.fs` as a literal and has no build-time representation —
there is no `<Version>` property in `backend/Api/*.csproj`. Nothing can read the
backend version the way `packageVersion ()` reads the frontend's.

## Decisions

### D1 — Three layers, with a rule for choosing between them

| Layer  | Holds                                                                                | Example                       |
| ------ | ------------------------------------------------------------------------------------ | ----------------------------- |
| Task   | The verb. Ordering, dependencies, the name a developer types.                        | `task release:bundle`         |
| `.fsx` | The decision. Anything with branching, validation, or a non-trivial failure message. | `VerifyFrontendArtifact.fsx`  |
| bash   | The host. OS detection, installers, certificates, anything touching the machine.     | `scripts/certs/cert-issue.sh` |

This is a description of what the repository already does, promoted to a rule.
New pipeline work lands in whichever layer matches; none of it lands in YAML.

The test of the rule: if a step cannot be run by typing a `task` command on a
developer machine, it is in the wrong layer.

### D2 — `task ci` is the contract between local and GitHub

A single aggregate task runs everything CI runs:

```yaml
ci:
  desc: Everything CI runs — the same on your machine and on GitHub
  cmds:
    - task: dotnet:test
    - task: frontend:test
    - task: frontend:build
    - task: docker:build
```

`ci.yml` keeps its three parallel jobs for speed, but each job's work is a single
`task` call, and `task ci` runs the same set sequentially. The difference between
local and CI is then parallelism only — visible, and not a place logic can hide.

### D3 — `PublishGitHubRelease.fsx` shells out to `gh`

Rather than calling the GitHub REST API directly. `gh` is already installed
(2.100.0) and authenticates identically from a developer shell and from Actions
(`GH_TOKEN`). One code path, runnable in both places.

This is the point at which "independent of GitHub Actions" stops meaning
"independent of GitHub". Creating a release requires the real API. What matters
is that no logic is *locked inside* a workflow file.

### D4 — `act` validates workflow wiring, not the work

`act` runs on `linux/arm64` here, and `ci.yml` uses `actions/setup-dotnet@v4`,
which fetches x64 binaries under the standard runner images. Making the full job
matrix pass under `act` would require a custom runner image with the SDKs
preinstalled.

That effort is not worth it, because `task ci` already proves the work. `act` is
therefore scoped to answering a narrower question: *is the workflow file itself
correct* — triggers, job graph, `needs:` ordering, secret passthrough, artifact
upload. Jobs that cannot run on arm64 are expected to fail there and that is not
a regression.

Revisit if arm64 runner images improve.

### D5 — Version bumping becomes a task

`CLAUDE.md`'s versioning rule is currently enforced by memory alone. A
`task release:version -- frontend patch` backed by an `.fsx` script makes it
executable. This also forces the backend to acquire a machine-readable version,
which is a prerequisite for ever releasing it the way the frontend is released.

### D6 — What actually got built diverged from this plan

A separate, unplanned round of CI/CD work — publishing the backend to Docker
Hub — landed before most of this feature did, and it solved several problems
this document also names, by different means than the ones proposed above. It
is recorded here so the acceptance criteria below can be checked against
reality rather than against the plan:

- **Workflow duplication was solved with `workflow_call`, not named here at
  all.** `backend-test` and `frontend-build` were duplicated verbatim between
  `ci.yml` and `release.yml`. `ci.yml` gained an `on: workflow_call:` trigger,
  and `release.yml` now has a single `ci:` job with `uses: ./.github/workflows/ci.yml`
  in place of the two duplicated jobs. This addresses the same
  "does the release work only by pushing and watching" complaint from
  **Motivation**, for the test/build stage specifically, without touching
  `release:tag` or `release:publish`.
- **Docker Hub publishing exists now**, via `task docker:build:app` /
  `task docker:publish:app` (`Taskfile.Docker.yml`) and a `docker-publish` job
  in `release.yml`. This is `docker:build`, D2's third line, built — but as three
  service-specific tasks (`build:api`, `build:nginx`, `build:app`) under a
  `docker:` namespace, not the single `docker:build` task named in **Scope**
  and acceptance criterion 5.
- **Credentials load through `dotenv: ['.env']` in the root `Taskfile.yml`**,
  not through any mechanism this document anticipated. This was arrived at
  after a task that tried to `source .env` inside its own `cmds:` block,
  which cannot work — each `cmds:` entry is its own subshell, so anything
  sourced there is gone before the task's own next line runs. `dotenv:` is
  the one place in Task's process tree that can actually export into
  everything started afterward; it must live in the root taskfile, since Task
  refuses it in an included one.
- **`--secret-file`, not `--env-file`, is what gets real secrets to `act`.**
  `--env-file` only fills the environment; it never fills the `secrets.*`
  context that `uses:` steps like `docker/login-action` read. This was proven
  against a minimal probe workflow before being relied on:
  `--env-file` alone left `${{ secrets.X }}` empty in both a login step and a
  plain `run:` step; `--secret-file` filled it in both. `run-ci-workflow.sh`
  and `run-main-workflow.sh` now pass secrets this way.

None of this closes acceptance criteria 2, 3, 4, 6, or 9 below — the `.fsx`
scripts, `Common.fsx`'s path handling, and the backend version property are
untouched by it. See **What remains**.

## Scope

In scope:

- The two missing `.fsx` scripts (`AddGitTag`, `PublishGitHubRelease`).
- A `task ci` aggregate and a `docker:build` task.
- `Taskfile.CI.yml` with `act` and lint wrappers.
- `.actrc` and `scripts/ci/run-act.sh`.
- Rewriting `release.yml` to call `task release:publish`.
- Moving `Common.fsx` onto `RootLoader`.
- A backend version property, and `task release:version`.
- Documentation in `docs/web/build-pipeline/`, and correcting
  `docs/web/frontend-release/`.

Out of scope:

- Publishing the backend to Docker Hub. That was
  `Feature.BuildBackendAndPublishToDockerhub.md` — empty when this document
  was written, and since built and moved to `docs/SCRUM/DONE/`. It landed
  without waiting on this feature's `docker:build` or backend-version work
  (D6, above), rather than being made possible by them as originally
  planned.
- Deployment. Nothing here deploys anything; the pipeline ends at a draft
  release and a built image.
- Any Bible translation data. Per the licensing rules in `CLAUDE.md`, no
  `jw.org` path is touched by any of this.

## Proposed structure

```text
Taskfile.yml                 # + `ci` aggregate
Taskfile.CI.yml              # NEW — act wrappers, lint
Taskfile.Docker.yml          # NEW — docker:build (or fold into Taskfile.yml)
Taskfile.Release.yml         # + version task
build/fsx/
  AddGitTag.fsx              # NEW
  PublishGitHubRelease.fsx   # NEW
  SetVersion.fsx             # NEW
  BundleFrontend.fsx
  VerifyFrontendArtifact.fsx
  lib/Common.fsx             # + gitTag/ghRelease helpers, RootLoader-based paths
  lib/RootLoader.fsx
scripts/ci/
  run-act.sh                 # NEW — uses lib-bash/header.sh
.actrc                       # NEW
```

`.actrc`, pinning the image so local runs are reproducible:

```text
-P ubuntu-24.04=catthehacker/ubuntu:act-24.04
--container-architecture linux/arm64
--artifact-server-path /tmp/act-artifacts
```

The artifact path stays under `/tmp` so `.gitignore` needs no new entry.

## Acceptance criteria

### 1. The layering rule is real (D1) — one violation left

- [ ] One step still does work directly: `release.yml`'s `bundle` job runs
      `gh release create "${{ github.ref_name }}" artifacts/*.zip --draft`
      inline, rather than through a task. Every other step across both
      `ci.yml` and `release.yml` — verified by walking each job — is either
      `uses:` or `run: task <something>`, including the Docker Hub publish
      steps that did not exist when this document was written.
- [x] Every step that *is* task-based can be run from a developer shell the
      same way: `task dotnet:test`, `task frontend:test`, `task frontend:build`,
      `task docker:build:app`, `task docker:publish:app`, `task release:bundle`
      all run standalone.

### 2. `build/fsx/AddGitTag.fsx` — not built

- [ ] Does not exist on disk. A release still starts with a developer pushing
      a `frontend-v<version>` tag by hand; none of the four guarantees below
      have any equivalent today.
- [ ] Refuses to tag when the working tree is dirty, with a message saying which
      files are dirty.
- [ ] Refuses to overwrite an existing tag. Re-running is either a safe no-op or
      a clear failure — never a silent force.
- [ ] Resolves all paths through `RootLoader`, so it works from any CWD.

### 3. `build/fsx/PublishGitHubRelease.fsx` — not built

- [ ] Does not exist on disk. `release.yml`'s `bundle` job creates the draft
      release with a plain `gh release create ... --draft` step instead —
      this satisfies the *draft* requirement (D3) but only inside the
      workflow run, with none of the other three guarantees.
- [ ] Shells out to `gh` rather than calling the REST API (**D3**) — true of
      the inline step too, incidentally, but not because this script exists.
- [ ] Fails clearly and non-zero when `gh` is unauthenticated, rather than
      appearing to succeed. Untested either way.
- [ ] Safe to retry after a partial upload. Untested either way.

### 4. `Common.fsx` is CWD-independent — not built

- [ ] `packageJsonPath` and `distIndexPath` are still
      `Path.Combine("frontend", ...)` — relative strings, unchanged from the
      defect this criterion describes. `BundleFrontend.fsx` resolves through
      `RootLoader`; `Common.fsx`, used by `VerifyFrontendArtifact.fsx`, still
      does not.
- [ ] `task release:frontend` succeeds when invoked from a subdirectory.
      Untested; expected to fail given the above.

### 5. `task ci` (D2) — not built as specified; solved differently for one piece

- [ ] No aggregate `ci` task exists. `Taskfile.yml`'s `ci:` entry is a
      namespace include (`taskfile: ./Taskfile.CI.yml`), not a task — running
      `task ci` fails with "task not found", not with a passing pipeline.
- [ ] No bare `docker:build` task exists. Three service-scoped tasks do:
      `docker:build:api`, `docker:build:nginx`, `docker:build:app` — and
      `ci.yml`'s `docker-build` job calls `task docker:build:app`, so the
      "call the task, not the compose command" half of this line is met, just
      under a different name than specified.
- [x] `ci.yml`'s three jobs (`backend-test`, `frontend-build`, `docker-build`)
      each call a single task per meaningful step — verified by listing every
      step in the workflow.
- [ ] `task ci` passes locally in the devcontainer. Cannot pass; the task does
      not exist.

### 6. `release.yml` uses the release tasks — not built

- [ ] The inline `gh release create` step (`release.yml`, `bundle` job) is still
      inline; `task release:publish` does not exist to replace it with.
- [x] `permissions: contents: write` is retained on the `bundle` job, and
      `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` is passed to the `gh` step —
      true of the step as it exists today, independent of whether a task ever
      wraps it.
- [ ] Nothing in `release.yml` does work that `task release:*` cannot do. Not
      met: the draft-release creation is work `task release:*` cannot
      currently do, because no such task exists.

### 7. `act` (D4) — partially done

- [x] `.actrc` pins the runner image: `-P ubuntu-24.04=catthehacker/ubuntu:act-24.04`.
- [ ] Does not set `--container-architecture` or `--artifact-server-path`, both
      specified in **Proposed structure** above. Worth noting: `act` ran
      correctly without either during this work, which puts weight on
      revisiting whether they were actually needed rather than only on adding
      them.
- [ ] The scripts are named `run-ci-workflow.sh` and `run-main-workflow.sh`,
      not `run-act.sh` as specified — but both do source `lib-bash/header.sh`
      and use `log::*`, matching the rest of `scripts/`, which is the
      substance of this line even though the name differs.
- [ ] No `gh auth token` passthrough exists in either script.
- [x] `task ci:act-main` and `task ci:act-ci` run the respective workflow
      locally and reach job scheduling — used directly during this work,
      including running `docker-publish` under `act` end to end.
- [ ] Nothing states which jobs are expected to fail on arm64 and why.

### 8. Linting — half done

- [x] `task ci:lint` exists and runs `actionlint` over `.github/workflows/`.
- [x] `actionlint` passes on both workflow files — verified directly,
      `0 errors` on `ci.yml` and `release.yml`.
- [ ] `shellcheck` is not installed; no `scripts/programs/` installer for it
      exists, and `task ci:lint` does not run it over `lib-bash/` or
      `scripts/`.
- [ ] Existing `# shellcheck disable=` directives remain unexamined — the
      linter they reference has still never run.

### 9. Backend version (D5) — not built

- [ ] No `<Version>` property exists in `backend/Api/BibleGuessr.Api.fsproj`;
      `Program.fs`'s `BackendVersion = "0.5.3"` is still a bare literal.
- [ ] `task release:version` does not exist.
- [ ] N/A — the task to refuse invalid input does not exist.

### 10. Documentation — partially done

- [ ] `docs/web/build-pipeline/index.html` does not exist; the layering rule
      and `act` workflow are undocumented in `docs/web`.
- [x] `docs/web/frontend-release/index.html` was corrected — it no longer
      describes `release:tag` or `release:publish` as working; see the
      acceptance-criteria updates in
      `Feature.BuildFrontendAndPublishToGithubRelease.md`.
- [ ] `README.md`'s task table does not mention `ci:lint`, `ci:act-main`,
      `ci:act-ci`, `docker:build:app`, or `docker:publish:app`.

### 11. Versioning — not applicable yet

- [ ] Per `CLAUDE.md`, a version bump applies once a feature changes an
      application. Criterion 9 (the backend version property) is what would
      have given the backend something to bump here, and it was not built —
      so there is nothing to increment yet. The frontend's own version bump is
      tracked under `Feature.BuildFrontendAndPublishToGithubRelease.md`,
      separately from this feature's scope.

## What remains

- **`AddGitTag.fsx` and `PublishGitHubRelease.fsx` (criteria 2, 3).** Neither
  exists. A release today starts with a developer pushing a tag by hand and
  ends with an inline `gh release create` step; none of the dirty-tree,
  existing-tag, or unauthenticated-`gh` guards these scripts were meant to
  provide exist anywhere.
- **`Common.fsx`'s relative paths (criterion 4).** Still
  `Path.Combine("frontend", ...)`. Will break the moment
  `release:frontend`/`VerifyFrontendArtifact.fsx` is invoked from anywhere but
  the repo root, including from inside an `act` container — the exact failure
  mode this criterion was written to close.
- **No `task ci` aggregate, no bare `task docker:build` (criterion 5).** The
  Docker Hub work built `docker:build:api` / `:nginx` / `:app` instead — real
  and in use, but not the single name this criterion specifies, and there is
  still no one command that runs the whole local pipeline sequentially the
  way `ci.yml` runs it in parallel.
- **`release.yml`'s release step is still inline (criterion 6).** Directly
  downstream of criterion 3 not existing; there is no `task release:publish`
  to call instead.
- **`shellcheck` (criterion 8).** Not installed, not run, and the existing
  `# shellcheck disable=` comments in `lib-bash/` still reference a linter
  that has never executed against them.
- **Backend version property (criterion 9).** No `<Version>` in the `.fsproj`;
  `BackendVersion` in `Program.fs` is still a hand-edited literal with no
  build-time source, and no `task release:version` exists to bump it or the
  frontend's.
- **`docs/web/build-pipeline/` (criterion 10).** Does not exist. The layering
  rule (D1) and the `act` workflow have no developer-facing documentation
  anywhere; this document is currently the only place either is written down.
- **`act`'s arm64 caveats are undocumented (criterion 7).** Nothing states
  which jobs are expected to fail under `act` on this architecture, so a
  failure there still reads as a broken workflow rather than a known limit.

## Verification

Per the testing rules in `CLAUDE.md`, a guard must be proven to fire. Break the
thing it protects, confirm it fails, restore it, confirm it passes. Most of
this cannot be attempted yet, because the guards themselves were never built:

1. **`AddGitTag` refuses a dirty tree / an existing tag.** Cannot be
   verified — the script does not exist.
2. **`PublishGitHubRelease` fails unauthenticated.** Cannot be verified —
   the script does not exist. (The inline `gh release create` step's own
   unauthenticated behavior has not been deliberately exercised either.)
3. **`Common.fsx` is CWD-independent.** Cannot be verified as passing; can be
   verified as still broken — `release:frontend` invoked from a subdirectory
   is expected to fail today, matching the precondition this criterion
   describes.
4. **`task ci` catches a real break.** Cannot be verified — the task does not
   exist. What *was* verified: `act -W .github/workflows/main.yml -j ci` runs
   the reusable `ci.yml` and its `backend-test` / `frontend-build` jobs
   directly, so the underlying test/build steps are exercisable through
   `act`, just not yet through one local `task` command.
5. **`act` reports the job graph.** Verified, though against the tasks and
   job names that actually exist rather than the ones originally planned:
   `act -W .github/workflows/main.yml -l` was used to confirm `ci` →
   `docker-publish` and `ci` → `bundle` run in parallel, both depending only
   on `ci` rather than on each other — and `act -j ci` was run far enough to
   confirm `needs:` ordering inside the reusable workflow is honored.
6. **Secrets actually reach `act`.** Verified directly, and only after first
   getting it wrong: a probe workflow showed `--env-file` leaves
   `${{ secrets.X }}` empty in both a `docker/login-action` step and a plain
   `run:` step, while `--secret-file` fills it in both. This was not one of
   the criteria as originally written, but it was the actual blocker
   encountered while trying to satisfy criterion 7.

## Open questions

- **Docker-in-devcontainer under `act` — answered.** It works. `act -j ci`
  and `act -j docker-publish` (under `main.yml`) were both run directly in
  this devcontainer and reached real `docker build` / `docker push` steps
  against Docker Hub, including a login failure that was traced all the way
  to an incorrect credential rather than to any Docker-in-Docker limitation.
- **Whether `AddGitTag.fsx` and `PublishGitHubRelease.fsx` ever existed —
  still open.** Nothing in this round of work bears on it either way.
- **Whether `docker:build` belongs in a `Taskfile.Docker.yml` or the root
  `Taskfile.yml` — answered, provisionally.** It landed in
  `Taskfile.Docker.yml`, as three tasks rather than one, once the Docker Hub
  publish feature actually existed to justify the file. The single-task name
  from **Scope** and criterion 5 was not the one that got built; whether to
  rename `docker:build:app` to match, or to update this document instead,
  is unresolved.
