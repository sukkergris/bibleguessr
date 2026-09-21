# Install and run `shellcheck`

`lib-bash/` carries `# shellcheck disable=...` directives throughout, but
`shellcheck` itself is absent from the devcontainer — `command -v shellcheck`
finds nothing. Bash is a first-class layer in this repository's pipeline
(per D1 in `BACKLOG/Feature.CI-CD-construction.md`: Task orchestrates, `.fsx`
holds decisions, bash handles the host), and is currently the only one of
the three that is unlinted. The existing disable comments have never had a
linter to justify them against.

`task ci:lint` already exists and runs `actionlint` over
`.github/workflows/` — verified directly, `0 errors` on both workflow
files. This task extends the same command to bash.

## Requirements

- A `scripts/programs/` installer adds `shellcheck` to the devcontainer,
  matching the pattern of the other installers already there (e.g.
  `scripts/programs/actionlint.arm.installer.sh`).
- `task ci:lint` runs `shellcheck` over `lib-bash/` and `scripts/`, in
  addition to the existing `actionlint` check.
- Every existing `# shellcheck disable=` directive is either justified (a
  comment explaining why the specific warning doesn't apply) or removed — a
  disable comment for a linter that never ran proves nothing about whether
  it's still needed.

## Source

Acceptance criterion 8 in `BACKLOG/Feature.CI-CD-construction.md`.
