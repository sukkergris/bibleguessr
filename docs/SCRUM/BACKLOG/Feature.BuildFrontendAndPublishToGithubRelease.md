# Build the Frontend and Publish It to a GitHub Release

Produce a versioned, self-contained tarball of the production frontend build and
attach it to a GitHub release, so a deployment can be installed by downloading
one file instead of building from source.

The work is driven from `Taskfile.Release.yml`, whose four tasks are currently
placeholders (`TODO`). This feature fills them in.

## Motivation

The frontend is a static bundle: Vite compiles it to `frontend/dist/`, which is
gitignored and therefore reproducible only by whoever has a working toolchain.
A release asset turns that build into a fixed artifact — a specific version of
the site, byte-for-byte, retrievable later.

This mirrors how the repository already consumes release assets. See
`scripts/programs/task.arm.installer.sh`, which downloads and unpacks
`task_linux_arm64.tar.gz` from the Task project's release page.

## Preconditions

These are defects in the current state that block or undermine the feature.
They are listed as separate acceptance criteria below.

### The Taskfile include was misspelled — fixed

`Taskfile.yml` included `./Taksfile.Relsease.yml`, but the file on disk is
`Taskfile.Release.yml`. Two transposed letters, which broke far more than the
release tasks — `task --list-all` failed outright, making every task in the
repository unreachable:

```sh
task: No Taskfile found at "/xyz/Taksfile.Relsease.yml"
```

This has been corrected. `task --list-all` now succeeds and lists all four
release tasks alongside the existing frontend, dotnet, and certs tasks.

### The frontend version is ambiguous

Three version values exist and disagree:

| Source                                                      | Value   | Role                       |
| ----------------------------------------------------------- | ------- | -------------------------- |
| `frontend/package.json`                                     | `0.8.3` | npm package metadata       |
| `frontend/index.html` (`<meta name="application-version">`) | `0.7.2` | what the Nerd tab displays |
| `build/.env` (`IMAGE_TAG`)                                  | `0.0.0` | backend container tag      |

`frontend/src/components/nerd-panel.ts:86` reads the meta tag, so users
currently see `0.7.2` while the package claims `0.8.3`. A release cannot be
labelled correctly until one of these is designated authoritative. Note the
backend version lives separately, in `backend/Api/Program.fs:46`
(`BackendVersion = "0.5.3"`), and is exposed at `/api/version`.

Existing git tags are `v1.0.0` and `v2.0.0`, which match none of the above.
The tagging scheme therefore also needs a decision, not just an implementation.

## Scope

In scope:

- Building the production frontend bundle.
- Packaging it as a `.tar.gz` tarball with a checksum.
- Tagging the release commit in git.
- Uploading the tarball and checksum as GitHub release assets.

Out of scope:

- The backend. It is published to Docker Hub, covered by
  `Feature.BuildBackendAndPublishToDockerhub.md`.
- Automated CI. The repository has no `.github/workflows/`, and this feature
  does not add one; the tasks are run locally. Moving them into CI later should
  require no change to the tasks themselves.
- Any Bible translation data. See the licensing rules in `CLAUDE.md` — the
  tarball contains build output only.

## Acceptance criteria

### 1. `task` works again — done

- [x] `Taskfile.yml` includes `./Taskfile.Release.yml`, spelled correctly.
- [x] `task --list-all` succeeds and lists the four release tasks.

### 2. A single authoritative frontend version

- [ ] One source of truth for the frontend version is chosen and documented.
- [ ] `frontend/package.json` and the `<meta name="application-version">` tag
      in `frontend/index.html` agree.
- [ ] The Nerd tab shows that same version.
- [ ] The release tag, the tarball filename, and the displayed version are
      derived from that one value, so they cannot drift apart.
- [ ] The tag naming scheme is documented, including how a frontend-only
      release is distinguished from a backend release now that both are
      versioned independently.

### 3. `task release:build-frontend`

- [ ] Runs the production build, reusing `frontend:build` rather than
      duplicating the `npm run build` invocation. Note that script is
      `tsc && vite build`, so a type error fails the release.
- [ ] Fails loudly if the build fails; no stale `dist/` is ever packaged.
- [ ] The build is verified before packaging: unit tests
      (`task frontend:test`) must pass.

### 4. `task release:bundle`

- [ ] Produces `bibleguessr-frontend-<version>.tar.gz` from `frontend/dist/`.
- [ ] The archive unpacks into a **single top-level directory**, not loose
      files in the current directory. This is deliberate: the Task tarball
      consumed by `scripts/programs/task.arm.installer.sh` unpacks loose, which
      is why that script has to `rm -rf ... README.md LICENSE` afterwards to
      clean up. Extracting our own asset must never be able to overwrite a
      file in the directory it is unpacked into.
- [ ] Emits a `sha256` checksum file alongside the tarball, so a consumer can
      verify the download the way `task_checksums.txt` allows.
- [ ] The tarball contains no source, no `node_modules`, no `.env`, and no
      Bible text beyond what the production build legitimately bundles.
- [ ] Build artifacts are written somewhere gitignored and are never committed.

### 5. `task release:add-git-tag`

- [ ] Reads the version as decided in criterion 2. The task's current
      description says "from .env" — note `.env` is gitignored (`.gitignore:288`)
      and no root `.env` exists; `build/.env` holds `IMAGE_TAG`, which is the
      _backend_ image tag. Using a gitignored, backend-scoped file as the source
      of a frontend release tag is a trap and should be reconsidered as part of
      criterion 2.
- [ ] Refuses to tag if the working tree is dirty.
- [ ] Refuses to overwrite an existing tag; re-running is either a safe no-op
      or a clear failure, never a silent force-push.

### 6. `task release:publish-to-github-release`

- [ ] Creates the GitHub release for the tag and uploads both the tarball and
      the checksum file as assets.
- [ ] Uses the `gh` CLI (already available in this environment).
- [ ] Fails clearly when not authenticated, rather than appearing to succeed.
- [ ] Is idempotent enough to be safe to retry after a partial upload.

### 7. Documentation

- [ ] The release procedure is documented per the rules in `CLAUDE.md`:
      feature documentation goes in `docs/web` (HTML/JS/CSS, own folder,
      own file), with `README.md` kept minimal and developer-facing.
- [ ] The documentation states how to verify a downloaded asset's checksum
      and how to extract it safely.

### 8. Versioning

- [ ] Per `CLAUDE.md`, the frontend version is incremented for this feature.
      The backend is untouched, so its version stays at `0.5.3`.

## Verification

Per the testing rules in `CLAUDE.md`, a test covering a fix must be proven to
catch the bug — break the fix, confirm the test fails, restore it, confirm it
passes. Applied here:

1. **Round-trip the artifact.** Unpack the produced tarball into a directory
   that already contains a file named like one in the archive, and confirm
   nothing outside the archive's own top-level directory is touched.
2. **Verify the checksum.** Confirm the emitted checksum matches the tarball,
   and confirm that altering a single byte makes verification fail.
3. **Serve the unpacked build.** The extracted bundle must load and run, not
   merely exist.
4. **Prove the guards fire.** Confirm `add-git-tag` actually refuses a dirty
   tree and an existing tag, rather than assuming the checks work.

## Open questions

These need a decision before implementation starts:

1. Which version source is authoritative — `package.json`, the meta tag, or a
   new dedicated file?
2. How are frontend and backend releases distinguished in the tag namespace,
   given they version independently (`0.8.3` vs `0.5.3`) and the existing tags
   (`v1.0.0`, `v2.0.0`) match neither?
3. Should the release be published as a draft for review before going public?
4. Should `bundle` include `NOTICE.md` and `LICENSE` in the tarball? The
   bundled Bible text is public domain but its provenance is recorded in
   `NOTICE.md`, and shipping the attribution alongside the build is the more
   respectful default even where it is not legally required.
