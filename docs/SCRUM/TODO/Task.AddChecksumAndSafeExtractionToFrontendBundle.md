# Add a checksum and safe extraction to the frontend release bundle

`build/fsx/BundleFrontend.fsx` produces `bibleguessr-frontend-<version>.zip`
via `ZipFile.CreateFromDirectory(source, ...)`, zipping `frontend/dist/`
directly. Two things a consumer of the release asset would reasonably expect
are missing:

- **No checksum.** Nothing in `build/fsx/` or `scripts/` computes or emits
  one, so a downloader has no way to verify the archive wasn't corrupted or
  tampered with in transit.
- **No safe top-level directory.** The archive's entries sit at its root.
  `docs/web/frontend-release/index.html` documents this as a known,
  deliberate trade and requires `unzip -d <dest>` as the mitigation — but
  extracting into a directory that already contains a same-named file will
  silently overwrite it if that flag is ever omitted.

## Decision needed first

The format itself (`.zip` vs. the originally planned `.tar.gz`) was never
revisited as a deliberate choice — `.zip` is simply what got implemented.
Worth resolving explicitly, one way or the other, before or alongside this
work, since `BACKLOG/Feature.BuildFrontendAndPublishToGithubRelease.md`'s
Scope section and its acceptance criteria still specify `.tar.gz`.

## Requirements

- Emits a `sha256` checksum file alongside the archive.
- The archive extracts into a single top-level directory, so extracting it
  into a populated destination without an explicit destination flag cannot
  overwrite an existing file there.
- `docs/web/frontend-release/index.html` is updated: the `-d` requirement is
  either removed (if the top-level directory makes it unnecessary) or kept
  and supplemented with how to verify the checksum.

## Verification

Per the testing rule in `CLAUDE.md`:

1. Unpack the produced archive into a directory that already contains a
   file with the same name as one inside the archive; confirm nothing
   outside the archive's own top-level directory is touched.
2. Confirm the emitted checksum matches the archive, and that altering a
   single byte of the archive makes verification fail.

## Source

Acceptance criterion 4 in `BACKLOG/Feature.BuildFrontendAndPublishToGithubRelease.md`;
its "What remains" section.
