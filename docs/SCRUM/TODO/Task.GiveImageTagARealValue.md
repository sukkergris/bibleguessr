# Give `IMAGE_TAG` a real value

`scripts/ci/load-image-version.sh` is a three-line stub that always prints
`0.0.1`. Every Docker image built — locally or in CI — carries that same
tag regardless of what changed. Every push to Docker Hub today overwrites
the same tag rather than publishing something identifiable and retrievable
later.

The simplest fix is close at hand: `github.sha` is already available in
`.github/workflows/main.yml`'s `docker-publish` job and currently unused
elsewhere in the workflow. `github.ref_name` (which gives
`frontend-v0.8.3` on a tag push) is the more human-readable alternative on
a release specifically, at the cost of not applying to non-tag builds.

## Requirements

- `IMAGE_TAG` reflects the actual commit or release being built, not a
  constant.
- The chosen source works both for `main.yml` (tag-triggered) and `ci.yml`
  (every push to `main`, untagged) — or the two workflows are allowed to use
  different sources, and that choice is stated rather than left implicit.
- `docs/web/versioning/index.html` is updated to match — it currently
  documents the `load-image-version.sh` stub as the state of things, and
  should describe whatever real source is chosen.

## Related, not required here

The backend image is currently built twice per release: once in `ci.yml`'s
`docker-build` job (verification only, discarded) and again in
`docker-publish` (published). A meaningful `IMAGE_TAG` makes it easier to
judge whether that duplicate build is worth removing — but removing it is a
separate decision, not a requirement of this task.

## Source

"What remains" in `DONE/Feature.BuildBackendAndPublishToDockerhub.md`.
