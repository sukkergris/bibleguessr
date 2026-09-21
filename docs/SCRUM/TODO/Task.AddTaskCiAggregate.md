# Add a `task ci` aggregate

`Taskfile.yml`'s `ci:` entry is a namespace include
(`taskfile: ./Taskfile.CI.yml`), not a task — running `task ci` fails with
"task not found", not with a passing pipeline. There is no single local
command that runs backend tests, frontend tests, frontend build, and the
Docker build in sequence, the way `ci.yml` runs the equivalent jobs in
parallel on GitHub. Answering "does the whole pipeline pass?" locally means
running four separate commands and checking each one yourself.

A related naming gap: the plan called for one `docker:build` task; what got
built during the (separate, since-completed) Docker Hub publishing work is
three service-scoped tasks — `docker:build:api`, `docker:build:nginx`,
`docker:build:app` — under a `docker:` namespace in `Taskfile.Docker.yml`.
They work and are in real use; only the single unified name from the
original plan doesn't exist.

## Requirements

- A task (proposed name: `ci`, in the root `Taskfile.yml` or a suitably
  named task inside the existing `Taskfile.CI.yml` include — pick a name
  that doesn't collide with the `ci:` namespace) runs, in order: backend
  tests, frontend tests, frontend build, and a Docker build.
- It calls `task docker:build:app` (or equivalent) rather than reimplementing
  the Docker Hub work's tasks.
- `task ci` (or whatever it ends up named) passes locally in the
  devcontainer.
- Decide, explicitly, whether `docker:build:app` should be renamed to match
  a single `docker:build` convention, or whether this document and any
  other place that assumed a single-task name should be updated instead —
  both are live options; leaving it undecided is what caused the mismatch.

## Verification

Per the testing rule in `CLAUDE.md`: introduce a failing backend test and,
separately, a TypeScript error; confirm the aggregate task fails on each
rather than silently passing.

## Source

Acceptance criterion 5 (D2) in `BACKLOG/Feature.CI-CD-construction.md`.
