# Document the build pipeline in `docs/web`

`docs/web/build-pipeline/` does not exist. The layering rule (Task
orchestrates, `.fsx` holds decisions, bash handles the host — D1 in
`BACKLOG/Feature.CI-CD-construction.md`) and how to run the workflow locally
under `act` have no developer-facing documentation anywhere; that BACKLOG
document is currently the only place either is written down, and a BACKLOG
entry is not where a new contributor would think to look.

Two adjacent things exist and can be linked from the new page rather than
duplicated: `docs/web/frontend-release/index.html` (corrected during the
Docker Hub publishing work) and `docs/web/versioning/index.html` (which
already documents where `IMAGE_TAG`, the frontend version, and the backend
version each come from).

Also missing: nothing states which jobs are expected to fail under `act` on
an arm64 devcontainer and why (`actions/setup-dotnet@v4` fetches x64
binaries under standard runner images), so a failure there currently reads
as a broken workflow rather than a known, accepted limit.

## Requirements

- `docs/web/build-pipeline/index.html` exists, per `CLAUDE.md`'s rule for
  feature documentation (HTML/JS/CSS, own folder, own file).
- Documents the layering rule and gives the reasoning, not just the
  statement.
- Documents how to run the pipeline locally: `task ci` (once
  `Task.AddTaskCiAggregate.md` lands), and how to run the actual GitHub
  workflows locally via `act` — the existing `task ci:act-main` /
  `task ci:act-ci` commands, including the `--secret-file` vs. `--env-file`
  distinction that blocked secrets from reaching `act` during the Docker Hub
  work.
- States plainly which jobs are expected to fail under `act` on arm64 and
  why.
- `README.md`'s task table gains the CI-related task names that exist today
  and are currently undocumented there: `ci:lint`, `ci:act-main`,
  `ci:act-ci`, `docker:build:app`, `docker:publish:app`.

## Source

Acceptance criteria 7 and 10 in `BACKLOG/Feature.CI-CD-construction.md`.
