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
currently see `0.7.2` while the package claims `0.8.3`. No test asserts that the
two agree, which is how they drifted apart unnoticed.

The backend version lives separately, in `backend/Api/Program.fs:46`
(`BackendVersion = "0.5.3"`), and is exposed at `/api/version`.

Existing git tags are `v1.0.0` (3 Sep) and `v2.0.0` (5 Sep). They match none of
the component versions — they are whole-repository milestones from before the
two applications were versioned independently.

Resolved by decisions **D1** and **D2** below.

## Decisions

Settled during refinement. These were previously open questions; the feature is
now implementable without further input.

### D1 — `frontend/package.json` is the single source of truth

`frontend/package.json` holds the authoritative frontend version. The
`<meta name="application-version">` tag in `index.html` becomes **generated
output**, injected by Vite at build time (`transformIndexHtml`), not a
hand-maintained copy.

This was chosen over keeping both in sync by hand because it removes the cause
rather than guarding the symptom: once the tag is generated, `0.8.3` vs `0.7.2`
cannot happen again. There is one place to edit, and everything downstream
derives from it:

```
frontend/package.json  "version": "0.8.3"    <- the only place edited by hand
        |
        +-- vite build -> index.html meta tag -> Nerd tab shows 0.8.3
        +-- release:bundle -> bibleguessr-frontend-0.8.3.tar.gz
        +-- release:add-git-tag -> frontend-v0.8.3
```

The backend keeps its own version in `backend/Api/Program.fs` and is unaffected.

### D2 — Component-prefixed tags: `frontend-v<version>`

Release tags are prefixed with the component they release:

```
v1.0.0            <- existing repo milestone, left untouched
v2.0.0            <- existing repo milestone, left untouched
frontend-v0.8.3   <- this feature
backend-v0.5.3    <- when the backend is released
frontend-v0.8.4   <- next frontend release
```

The two applications version independently (`CLAUDE.md` requires bumping each
one only when it changes), so a single shared tag cannot express "only the
frontend changed". The existing unprefixed tags are kept as they are; they are
historical repo milestones and are not retrofitted.

A prefix was chosen over a slash namespace (`fe/v0.8.3`) because slashes in tag
names collide with branch-name patterns in some tooling.

### D3 — Releases are created as drafts

`gh release create --draft`. The release and its assets are reviewable before
anything is public, so a bad tarball can be replaced without anyone having
downloaded it. Publishing is a deliberate manual step.

### D4 — The tarball ships `LICENSE` and `NOTICE.md`

Alongside the build output, the archive includes:

- `LICENSE` — the project's MIT terms, so a recipient has them without having
  to find the repository.
- `NOTICE.md` — the provenance of the bundled Bible text. Not legally required
  for a public-domain work, but `NOTICE.md` itself states that provenance
  matters; shipping the attribution with the artifact is the consistent choice.

No generated deployment README: the documentation in `docs/web` covers how to
serve the bundle, and a second copy inside the tarball would be one more thing
to keep in sync.

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

### 2. A single authoritative frontend version (D1)

- [ ] Vite injects `frontend/package.json`'s version into the
      `<meta name="application-version">` tag at build time, via
      `transformIndexHtml` in `vite.config.ts`.
- [ ] The version is no longer hand-written in `frontend/index.html`; the
      current literal `0.7.2` is replaced by the injected value.
- [ ] The Nerd tab shows the injected version in both `vite dev` and a
      production build. `nerd-panel.ts:86` reads the meta tag and needs no
      change, but must keep working in both modes.
- [ ] A unit test asserts the served meta tag matches `package.json`. Without
      it nothing stops the next silent drift — the current `0.8.3` vs `0.7.2`
      gap exists precisely because no test covers this.
- [ ] The release tag, the tarball filename, and the displayed version all
      derive from `package.json`, so they cannot disagree.

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

- [ ] Reads the version from `frontend/package.json` (**D1**) and creates the
      tag `frontend-v<version>` (**D2**).
- [ ] The task's `desc` is corrected: it currently reads "Add tag to git from
      .env", which is wrong on two counts — `.env` is gitignored
      (`.gitignore:288`) and no root `.env` exists, and `build/.env` holds
      `IMAGE_TAG`, the _backend_ image tag. A gitignored, backend-scoped file
      must not be the source of a frontend release tag.
- [ ] Refuses to tag if the working tree is dirty.
- [ ] Refuses to overwrite an existing tag; re-running is either a safe no-op
      or a clear failure, never a silent force-push.

### 6. `task release:publish-to-github-release`

- [ ] Creates the GitHub release **as a draft** (**D3**) for the
      `frontend-v<version>` tag, and uploads both the tarball and the checksum
      file as assets. Publishing the draft stays a manual step.
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

## Refinement notes

The four questions this document originally left open are resolved in
**Decisions** above (D1–D4). No blocking unknowns remain; the criteria can be
worked through in order.

One consequence worth stating plainly: **D1 changes user-visible behaviour
before any release exists.** Injecting the version moves the Nerd tab from
`0.7.2` to `0.8.3` — a visible correction, not a regression, but the reason the
displayed number jumps should be recorded in the commit that does it.
