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

`.github/workflows/main.yml` does not. It hand-rolls `gh release create` in
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

### `main.yml` bypasses the release tasks

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

## Scope

In scope:

- The two missing `.fsx` scripts (`AddGitTag`, `PublishGitHubRelease`).
- A `task ci` aggregate and a `docker:build` task.
- `Taskfile.CI.yml` with `act` and lint wrappers.
- `.actrc` and `scripts/ci/run-act.sh`.
- Rewriting `main.yml` to call `task release:publish`.
- Moving `Common.fsx` onto `RootLoader`.
- A backend version property, and `task release:version`.
- Documentation in `docs/web/build-pipeline/`, and correcting
  `docs/web/frontend-release/`.

Out of scope:

- Publishing the backend to Docker Hub. That is
  `Feature.BuildBackendAndPublishToDockerhub.md` — currently an empty file. This
  feature makes that work possible (backend version, `docker:build`) but does not
  do it.
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

### 1. The layering rule is real (D1)

- [ ] No `.github/workflows/` step does work directly; every step is
      `uses:` (checkout, setup) or `run: task <something>`.
- [ ] Every pipeline step can be run from a developer shell by typing a `task`
      command.

### 2. `build/fsx/AddGitTag.fsx`

- [ ] Reads the version from `frontend/package.json` and creates the tag
      `frontend-v<version>`, matching decision **D2** in
      `Feature.BuildFrontendAndPublishToGithubRelease.md`.
- [ ] Refuses to tag when the working tree is dirty, with a message saying which
      files are dirty.
- [ ] Refuses to overwrite an existing tag. Re-running is either a safe no-op or
      a clear failure — never a silent force.
- [ ] Resolves all paths through `RootLoader`, so it works from any CWD.

### 3. `build/fsx/PublishGitHubRelease.fsx`

- [ ] Creates the release as a **draft** (**D3** in the frontend release
      feature) for the `frontend-v<version>` tag, and uploads the artifact from
      `artifacts/`.
- [ ] Shells out to `gh` rather than calling the REST API (**D3**).
- [ ] Fails clearly and non-zero when `gh` is unauthenticated, rather than
      appearing to succeed.
- [ ] Safe to retry after a partial upload.

### 4. `Common.fsx` is CWD-independent

- [ ] `packageJsonPath` and `distIndexPath` resolve through
      `RootLoader.findRoot`, not relative strings.
- [ ] `task release:frontend` succeeds when invoked from a subdirectory.

### 5. `task ci` (D2)

- [ ] A `ci` task runs backend tests, frontend tests, frontend build, and the
      docker build.
- [ ] A `docker:build` task wraps
      `docker compose -f build/docker-compose.build.yml build`; `ci.yml` calls
      the task rather than the compose command.
- [ ] `ci.yml`'s three jobs each call a single task.
- [ ] `task ci` passes locally in the devcontainer.

### 6. `main.yml` uses the release tasks

- [ ] The inline `gh release create` step is replaced by
      `- run: task release:publish`.
- [ ] `permissions: contents: write` is retained and `GH_TOKEN` is passed
      through to the task.
- [ ] Nothing in `main.yml` does work that `task release:*` cannot do.

### 7. `act` (D4)

- [ ] `.actrc` pins the runner image and sets the container architecture.
- [ ] `scripts/ci/run-act.sh` sources `lib-bash/header.sh` and uses `log::*`,
      matching the other scripts in `scripts/`.
- [ ] The script passes a token through via `gh auth token`, and fails with a
      clear message when `gh` is not authenticated.
- [ ] `task ci:act` runs the workflow locally and reports the job graph.
- [ ] The documentation states plainly which jobs are expected to fail on arm64
      and why, so a failure there is not mistaken for a broken workflow.

### 8. Linting

- [ ] `task ci:lint` runs `actionlint` over `.github/workflows/`.
- [ ] `actionlint` passes on both workflow files.
- [ ] A `scripts/programs/` installer adds `shellcheck` to the devcontainer, and
      `task ci:lint` runs it over `lib-bash/` and `scripts/`.
- [ ] Existing `# shellcheck disable=` directives are either justified or
      removed — a disable comment for a linter that never ran proves nothing.

### 9. Backend version (D5)

- [ ] `backend/Api/*.csproj` gains a `<Version>` property, and
      `Program.fs`'s `BackendVersion` derives from it rather than repeating the
      literal.
- [ ] `task release:version -- <frontend|backend> <major|minor|patch>` bumps the
      named application's version in its authoritative location.
- [ ] The task refuses an unknown application name or bump level.

### 10. Documentation

- [ ] `docs/web/build-pipeline/index.html` documents the layering rule (**D1**),
      `task ci`, and the `act` workflow — HTML/JS/CSS, own folder, per
      `CLAUDE.md`.
- [ ] `docs/web/frontend-release/index.html` is corrected; it currently
      describes `release:tag` and `release:publish` as working.
- [ ] `README.md` gains `task ci`, `task ci:act`, `task ci:lint` in its task
      table, and stays minimal and developer-facing.

### 11. Versioning

- [ ] Per `CLAUDE.md`, both applications' versions are bumped — this feature
      touches the backend (version property) and the frontend (release chain).

## Verification

Per the testing rules in `CLAUDE.md`, a guard must be proven to fire. Break the
thing it protects, confirm it fails, restore it, confirm it passes. Applied
here:

1. **`AddGitTag` refuses a dirty tree.** Dirty a file, run it, confirm non-zero
   and no tag created. Clean, re-run, confirm the tag appears.
2. **`AddGitTag` refuses an existing tag.** Run it twice; confirm the second run
   does not move or replace the tag.
3. **`PublishGitHubRelease` fails unauthenticated.** Run with `gh` logged out,
   confirm a clear non-zero failure rather than a silent success.
4. **`Common.fsx` is CWD-independent.** Run `task release:frontend` from
   `frontend/` and from `/`; confirm identical results. Before the fix, confirm
   the subdirectory run fails — otherwise the change is untested.
5. **`task ci` catches a real break.** Introduce a failing backend test and a
   TypeScript error in turn; confirm `task ci` fails on each.
6. **`act` reports the job graph.** Confirm `task ci:act` reaches the point of
   scheduling jobs, and that `needs: [backend-test, frontend-test]` is honoured.

## Open questions

- **Docker-in-devcontainer under `act`.** `docker` works in the devcontainer,
  but it is unverified whether `act` can bind-mount the workspace through it. If
  not, the `docker-build` job cannot run under `act` at all — which is tolerable
  under **D4**, but should be stated rather than discovered.
- **Whether `AddGitTag.fsx` and `PublishGitHubRelease.fsx` ever existed.** Git
  history shows the tasks being added but never the scripts. If they were
  written and lost, recovering them may be cheaper than rewriting.
- **Whether `docker:build` belongs in a `Taskfile.Docker.yml` or in the root
  `Taskfile.yml`.** One task does not obviously justify a file; a Docker Hub
  publish feature would.
