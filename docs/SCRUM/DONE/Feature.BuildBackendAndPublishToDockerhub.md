# Build the Backend and Publish It to Docker Hub

Build the backend as a Docker image and publish it to Docker Hub on a frontend
release tag, alongside the existing tarball release described in
`Feature.BuildFrontendAndPublishToGithubRelease.md`.

## Motivation

The frontend ships as a downloadable artifact; the backend has no equivalent.
`build/Dockerfile.api` already exists and builds correctly, but nothing runs
it on a release and nothing pushes the result anywhere. Without a published
image, deploying the backend means building from source on the target
machine.

## Decisions

### The nginx image is published too

`build/Dockerfile.nginx` builds the frontend from source and serves it
through nginx; it does not consume the release tarball
(`Feature.BuildFrontendAndPublishToGithubRelease.md`'s artifact is a separate
deployment path, not an input to this image). Both images are defined in one
compose file, `build/docker-compose.build.yml`, and are built and pushed
together rather than as two independently versioned features.

### One image tag for both images, one Docker Hub account

Both services are tagged `${DOCKER_USERNAME}/bibleguessr-<service>:${IMAGE_TAG}`.
`DOCKER_USERNAME` is a repository **variable** (`vars.DOCKER_USERNAME`), not a
secret — a Docker Hub username is not sensitive, and keeping it as a variable
makes it visible in the GitHub UI instead of write-only. The push credential
is a Docker Hub access token, held as the secret
`DOCKERHUB_ACCESSTOKEN_RW`, scoped to Read & Write.

### `IMAGE_TAG` is a deployment coordinate, not an application version

The frontend and backend keep independent application versions
(`frontend/package.json`, `backend/Api/Program.fs`'s `BackendVersion`
literal). `IMAGE_TAG` tags the pair of images built from one commit; it does
not attempt to express either application's version. See
`docs/web/versioning/index.html` for the full picture of how the three
numbers relate.

### Credentials load through Task, not through a per-task `env:` block

`Taskfile.yml` declares `dotenv: ['.env']` at the root. A local `.env`
supplies `DOCKER_USERNAME` for a developer running the build by hand; in
CI, the repository variable of the same name takes precedence because Task
never overwrites a variable that is already set in the environment. This
was chosen over a `load:env` task that sources `.env` inside a task's own
`cmds:` block, which cannot work — each `cmds:` entry runs in its own
subshell, so anything sourced there is gone before the next line runs, let
alone the next task. `dotenv:` is the one place in the process tree from
which Task can actually export into everything it starts.

## Scope

In scope:

- Building both service images from `build/docker-compose.build.yml`.
- Publishing both to Docker Hub under one `IMAGE_TAG` per build.
- Running this as part of the existing frontend-release workflow
  (`.github/workflows/main.yml`), triggered by a `frontend-v*` tag.
- A local Task path that builds and (optionally) publishes without CI.

Out of scope:

- A real, unique value for `IMAGE_TAG`. `scripts/ci/load-image-version.sh` is
  a three-line stub that always prints `0.0.1`; every image built today
  carries that tag regardless of source changes. Giving it a real source
  (the release tag, the commit SHA, or a build number) is follow-up work —
  see **What remains** below.
- A backend application version exposed at build time
  (`backend/Api/*.fsproj` has no `<Version>` property). Tracked separately
  in `Feature.CI-CD-construction.md`.
- Any change to how the frontend tarball is produced or released.

## Acceptance criteria

### 1. Both images build from one compose file

- [x] `build/docker-compose.build.yml` defines `api` and `nginx` services,
      each with its own Dockerfile and image name.
- [x] `${DOCKER_USERNAME:?}` and `${IMAGE_TAG:?}` fail the build loudly when
      either is unset, rather than producing an image with an empty tag.

### 2. A local Task path

- [x] `task docker:build:app` builds both images.
- [x] `task docker:build:api` / `task docker:build:nginx` build one service
      at a time.
- [x] `task docker:publish:app` pushes both images.
- [x] Running any of these locally picks up `DOCKER_USERNAME` from a
      gitignored root `.env` via `dotenv:`, with no per-developer setup
      beyond creating that file.

### 3. CI builds and publishes on a frontend release tag

- [x] `.github/workflows/main.yml`'s `docker-publish` job runs on every
      `frontend-v*` tag push, gated behind the existing `ci` job (backend
      tests, frontend tests, frontend build) via `needs: [ci]`.
- [x] The job authenticates with `docker/login-action@v3` using
      `vars.DOCKER_USERNAME` and `secrets.DOCKERHUB_ACCESSTOKEN_RW`.
- [x] The job installs Task (`arduino/setup-task@v2`) before calling any
      `task` command — a bare GitHub runner has Docker but not Task, and the
      job fails with `command not found` otherwise.
- [x] `docker-publish` and the frontend `bundle` job both depend only on
      `ci`, not on each other, so they run in parallel rather than one
      waiting on the other's unrelated work.

### 4. `act` can run and verify the same job locally

- [x] `task ci:act-main` runs `main.yml`, including `docker-publish`, under
      `act`.
- [x] Secrets reach `act` through `--secret-file .secrets` — not
      `--env-file`, which fills the environment but never the `secrets.*`
      context that `docker/login-action` and other `uses:` steps read.
      `--secret-file` was proven against a minimal probe workflow before
      relying on it: `--env-file` alone produced an empty
      `${{ secrets.X }}`, `--secret-file` filled it correctly in both the
      login step and a plain `run:` step.
- [x] `.secrets` (the local credential file, holding the real Docker Hub
      token) is excluded from git via `.gitignore`.

## What remains

- **`IMAGE_TAG` is not yet meaningful.** `load-image-version.sh` always
  returns `0.0.1`; every push overwrites the same tag on Docker Hub. Giving
  it a real value — most simply `github.sha`, already available and unused
  elsewhere in the workflow, or `github.ref_name` on a tag push — is the
  next piece of follow-up work and should land before this is relied on for
  anything beyond local testing.
- **The backend image is built twice per release.** Once in `ci.yml`'s
  `docker-build` job (verification only, not published) and again in
  `docker-publish` (published). Not a defect introduced here — it predates
  this feature — but worth resolving together with the `IMAGE_TAG` fix,
  since a meaningful tag makes the duplicate build easier to justify or
  remove.

## Verification

- `task docker:build:app` and `task docker:publish:app` were run directly;
  `docker compose ... config --images` was used to confirm both
  `DOCKER_USERNAME` and `IMAGE_TAG` interpolate correctly with values
  supplied only through `dotenv:` and the Task root `env:` block, with no
  `.env` present (simulating a CI runner) and with one (simulating local
  use).
- The `docker/login-action` failure mode was reproduced and diagnosed before
  being fixed: `--env-file` alone gives `Username and password required`;
  with credentials present but wrong, Docker Hub itself returns
  `unauthorized: incorrect username or password` — confirmed against a real
  `docker login` outside of `act`, which distinguished a bad credential from
  a credential that authenticates but fails only to save locally (the
  devcontainer's missing `credsStore` helper, unrelated to `act` or to this
  feature).
- `act -W .github/workflows/main.yml -l` was used to confirm the job graph
  (`ci` → `docker-publish`, `ci` → `bundle`, run in parallel) before trusting
  a real tag push.

## Versioning

This feature adds no application code and changes no runtime behavior of
either the frontend or the backend; it only wires up how the existing
backend Docker image is built and published. Per `CLAUDE.md`, no version
bump applies.
