# Build the Frontend and Publish It to a GitHub Release

Produce a versioned, self-contained tarball of the production frontend build and
attach it to a GitHub release, so a deployment can be installed by downloading
one file instead of building from source.

The work is driven from `Taskfile.Release.yml`. Two of the tasks this feature
originally scoped (`release:add-git-tag`, `release:publish-to-github-release`)
were superseded during implementation by a simpler mechanism — see
**Decisions**, D5 below — so `Taskfile.Release.yml` now holds two tasks, not
four.

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

This has been corrected. `task --list-all` now succeeds and lists the release
tasks alongside the existing frontend, dotnet, and certs tasks — two tasks
today (`frontend`, `bundle`), not the four originally planned; see D5.

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
derives from it. This was the plan as originally written; D5 records how the
last of the three arrows below actually ended up wired:

```
frontend/package.json  "version": "0.8.3"    <- the only place edited by hand
        |
        +-- vite build -> index.html meta tag -> Nerd tab shows 0.8.3
        +-- release:bundle -> bibleguessr-frontend-0.8.3.zip
        +-- a manually pushed git tag -> frontend-v0.8.3 (see D5)
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

### D5 — Tagging and publishing moved into the release workflow, not `.fsx` scripts

The original plan was two more `.fsx` scripts, `AddGitTag.fsx` and
`PublishGitHubRelease.fsx`, each backing its own Task command. Neither was
written. Instead, `.github/workflows/main.yml`'s `bundle` job creates the
draft release inline, with a plain `gh release create "${{ github.ref_name }}"
artifacts/*.zip --draft` step gated on `startsWith(github.ref,
'refs/tags/')`. Tagging itself is not a Task command at all — a release is
started by pushing a `frontend-v<version>` tag by hand, which is what
triggers the workflow.

This was not a deliberate simplification decided up front; it is what
actually got built, and it is documented here so the acceptance criteria
below describe the real mechanism instead of the abandoned one. It means
none of D3's requirements (draft creation, idempotent retry, clear failure
when unauthenticated) currently have a local, Task-driven equivalent — they
only exist inside the GitHub Actions run. See **What remains**.

## Scope

In scope:

- Building the production frontend bundle.
- Packaging it as an archive, with a checksum.
- Tagging the release commit in git.
- Uploading the archive and checksum as GitHub release assets.

Out of scope:

- The backend. It is published to Docker Hub, covered by
  `Feature.BuildBackendAndPublishToDockerhub.md`.
- Any Bible translation data. See the licensing rules in `CLAUDE.md` — the
  archive contains build output only.

Superseded, not out of scope: the plan to keep CI out of this repository and
run every task by hand. `.github/workflows/main.yml` and `.github/workflows/ci.yml`
now exist and drive this exact release chain — see
`Feature.CI-CD-construction.md`. `main.yml`'s `bundle` job calls
`task release:bundle` rather than reimplementing the build, so the `task
release:*` commands remain the one description of how the frontend build is
produced and verified; only tagging and publishing moved out of Task and into
the workflow directly (D5, above).

## Acceptance criteria

### 1. `task` works again — done

- [x] `Taskfile.yml` includes `./Taskfile.Release.yml`, spelled correctly.
- [x] `task --list-all` succeeds and lists the release tasks — `frontend` and
      `bundle` today, not the four originally planned; see D5.

### 2. A single authoritative frontend version (D1) — done

- [x] Vite injects `frontend/package.json`'s version into the
      `<meta name="application-version">` tag at build time, via
      `transformIndexHtml` in `vite.config.ts`.
- [x] The version is no longer hand-written in `frontend/index.html`; it holds
      only the placeholder `0.0.0`, which never survives a build.
- [x] The Nerd tab shows the injected version in both `vite dev` and a
      production build — the plugin runs `transformIndexHtml` for both.
- [x] `frontend/src/app-version.test.ts` builds the frontend and asserts the
      served meta tag matches `package.json`, specifically to catch the drift
      this feature was written to fix.
- [x] The release tag, the archive filename, and the displayed version all
      derive from `package.json` (`packageVersion()` in `build/fsx/lib/Common.fsx`),
      so they cannot disagree.

### 3. `task release:frontend` (originally named `release:build-frontend`) — done

- [x] Runs the production build via the existing `frontend:test` and
      `frontend:build` tasks (`deps:` in `Taskfile.Release.yml`), rather than
      duplicating either invocation.
- [x] Fails loudly if the build fails — a fsi script exception is a non-zero
      exit, and Task stops the chain.
- [x] `build/fsx/VerifyFrontendArtifact.fsx` verifies the built artifact
      before anything downstream trusts it, distinguishing four failure
      modes: no `dist/index.html`, no meta tag, still the placeholder, and a
      version mismatch against a stale `dist/`.

The task ended up named `release:frontend`, not `release:build-frontend` as
originally specified — a naming drift worth knowing about, not a missing
feature.

### 4. `task release:bundle` — partially done

- [x] Produces `bibleguessr-frontend-<version>` from `frontend/dist/`, plus
      `LICENSE` and `NOTICE.md` from the repo root (D4).
- [x] Contains no source, no `node_modules`, no `.env` — only the production
      build output and the two license files.
- [x] Written to `artifacts/`, which is gitignored; a bundle never reaches a
      commit.
- [ ] **Format is `.zip`, not `.tar.gz`.** `build/fsx/BundleFrontend.fsx` uses
      `ZipFile.CreateFromDirectory`. Not necessarily wrong, but a deviation
      from what this criterion and the Scope section above specify, and
      nothing has revisited that choice explicitly.
- [ ] **No top-level directory.** The archive's entries sit at its root — the
      opposite of what this criterion requires. `docs/web/frontend-release/index.html`
      documents this as a known, deliberate trade (a predictable path for the
      image build) and requires `unzip -d <dest>` as the mitigation, but the
      "never able to overwrite a file in the directory it is unpacked into"
      guarantee this criterion asks for does not hold as shipped.
- [ ] **No checksum file.** Nothing in `build/fsx/` or `scripts/` computes or
      emits one; a consumer has no way to verify a download.

### 5. Tagging a release — done, by a different mechanism than originally specified (D5)

- [x] A tag matching `frontend-v<version>` (D2) triggers the release, per
      `.github/workflows/main.yml`'s `on: push: tags:`.
- [ ] ~~`task release:add-git-tag`~~ — does not exist; superseded by pushing
      the tag directly. See D5.
- [ ] Nothing refuses a dirty working tree or an existing tag before the
      workflow runs — the guard this criterion originally asked for has no
      equivalent today. A tag push that turns out to be wrong is fixed by
      deleting the tag and the draft release, not by a refusal up front.

### 6. Publishing to GitHub — done, by a different mechanism than originally specified (D5)

- [x] The release is created as a draft (D3) — `gh release create ... --draft`
      in `main.yml`'s `bundle` job.
- [x] Uses the `gh` CLI, as specified.
- [ ] ~~`task release:publish-to-github-release`~~ — does not exist;
      superseded by the inline workflow step. See D5.
- [ ] No local, Task-driven equivalent exists — publishing only happens
      inside a GitHub Actions run, not from a developer's own `gh auth`.
- [ ] Failure-when-unauthenticated and safe-retry-after-partial-upload are
      untested; they depend on `gh`'s own behavior inside the workflow step,
      which nothing here has exercised deliberately.

### 7. Documentation — mostly done

- [x] `docs/web/frontend-release/index.html` exists, in `docs/web`, as its
      own file, following `CLAUDE.md`'s placement rules.
- [ ] Cannot state how to verify a checksum, because none is produced (see
      criterion 4). Extraction safety is documented (the `-d` requirement),
      but only as a workaround for the missing top-level directory, not as
      the guarantee this criterion originally asked for.

### 8. Versioning — done

- [x] Per `CLAUDE.md`, the frontend version was incremented across this
      feature's work; `frontend/package.json` now reads `0.8.3`. The backend
      is untouched.

## What remains

- **No checksum.** `task release:bundle` produces an archive with nothing to
  verify it against. This is the one gap that blocks criterion 4 outright,
  independent of the `.zip` vs `.tar.gz` question.
- **No safe top-level directory.** The archive unpacks loose at its root.
  Living with this (via a documented, mandatory `unzip -d`) was an accepted
  trade, not a fix — the guarantee criterion 4 originally asked for still
  does not hold.
- **No dirty-tree or existing-tag guard before a release tag is pushed.**
  Criterion 5's safety checks have no equivalent in the mechanism that
  replaced `release:add-git-tag` (D5). A bad release today is corrected after
  the fact — delete the tag, delete the draft — not prevented before it.
- **No local publish path.** Criterion 6's `gh`-based publishing only runs
  inside the GitHub Actions workflow. A developer cannot reproduce or retry a
  publish from their own machine the way they can reproduce a build.
- **`.zip` vs `.tar.gz` was never revisited as a decision.** It is simply
  what got implemented. Worth a deliberate D6 one way or the other, since the
  Scope section and criterion 4 still specify the other format.

## Verification

Per the testing rules in `CLAUDE.md`, a test covering a fix must be proven to
catch the bug — break the fix, confirm the test fails, restore it, confirm it
passes. This is what was actually verified, and what still cannot be until
**What remains** is addressed:

1. **Version injection is proven, not assumed.** `app-version.test.ts` builds
   the frontend and checks the served meta tag against `package.json`; the
   comment in that file records that this exists because the two once
   disagreed silently. `VerifyFrontendArtifact.fsx` distinguishes four
   distinct failure modes rather than a single pass/fail.
2. **Round-trip the artifact.** Not yet done as a repeatable check. Manually
   confirmed the archive extracts loose at its root, which is why the
   deployment docs require `unzip -d <dest>` — but nothing automated proves
   an extraction into a populated directory stays safe.
3. **Verify the checksum.** Cannot be verified; none is produced. Blocked on
   criterion 4.
4. **Serve the unpacked build.** Not yet exercised as part of this feature's
   own verification.
5. **Prove the tagging/publishing guards fire.** Cannot be verified as
   originally scoped — the dirty-tree and existing-tag refusals this
   criterion asked for were never built (see D5, criterion 5).

## Refinement notes

The four questions this document originally left open are resolved in
**Decisions** above (D1–D4). A fifth decision, D5, was added after the fact
to record where implementation diverged from the plan — not a question that
was open, but one that turned out to have been silently re-answered.

One consequence worth stating plainly: **D1 changes user-visible behaviour
before any release exists.** Injecting the version moves the Nerd tab from
`0.7.2` to `0.8.3` — a visible correction, not a regression, but the reason the
displayed number jumps should be recorded in the commit that does it.
