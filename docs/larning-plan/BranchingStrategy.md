# Branching strategy: when a solo repo still wants a branch

A short decision guide, not a stage-by-stage path — there is no "done" state
to reach here, just a call to make each time you sit down to work. Written
after reviewing this repo's own history: every commit so far has gone
straight to `main`, and that has mostly been fine. This records where it
stops being fine, and what to do instead.

## The starting fact

```sh
git log --oneline -5
git branch -a
```

As of writing: one branch (`main`), no merge commits anywhere in the log.
Every feature in this repo — the accessibility audit, the Docker Hub
publishing work, the CI/CD consolidation — was built as a straight sequence
of commits on `main`. Nothing about that was wrong. Squashing it in
hindsight would actually have thrown information away: commit `3f6512c`
aside (two unrelated changes in one message — a real, separate lesson, not
a branching one), the sequence reads as a clear trail of what happened in
what order.

## Why "solo repo, so no branch" is not quite the right rule

The usual reasons for a feature branch are about *other people*: hiding
messy history from reviewers, keeping broken work off a branch teammates
build on, gating a merge behind approval. None of those apply here — there
is one contributor, and no PR ever waits on anyone.

But `main` in this repo is not just a filesystem — it is a **trigger**.
Check what actually fires on it:

```sh
grep -A3 "^on:" .github/workflows/ci.yml
```

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
  workflow_call:
```

Every push to `main` runs the full test-and-build pipeline —
`backend-test`, `frontend-build`, `docker-build`. That is the real reason a
branch is still sometimes worth it: not to protect other people from your
commits, but to protect **your own signal**. A feature that touches several
files across a few commits (say: a Dockerfile `ARG`, a matching
`docker-compose.build.yml` change, an F# read of the resulting env var, a
frontend fetch to display it) will have intermediate commits that don't
build cleanly yet. Each one pushed straight to `main` is a red run — not
dangerous (`ci.yml` publishes nothing; only the tag-triggered `release.yml`
does), but it burns the one clear "is `main` currently healthy?" signal you
have, and after the third red run in a row from your own known-incomplete
work, you stop looking at it.

## Done when — the actual test

**Done when** you can look at the last few commits on `main` and each one,
on its own, either passes CI or is clearly not meant to be evaluated alone
(a docs-only change, a comment). If a stretch of commits on `main` is
currently red because you're mid-feature, that's the smell — not that you
used a branch, but that you didn't.

## What to actually do

A short-lived branch, **ordinary commits, no squash**, merged (not
rebased-and-squashed) back into `main` when the feature is coherent:

```sh
git checkout -b build-sha
# ...work, commit each real step as its own commit, same granularity
# this repo's history already shows...
git checkout main
git merge build-sha        # fast-forward if nothing else landed on main meanwhile
git branch -d build-sha
```

This keeps three things that squashing would lose:

- **`git bisect` resolution.** If something breaks three months from now,
  you want to land on "the commit that changed how nginx writes
  `build-sha.txt`," not "the commit that did five things."
- **The granular trail this repo already writes.** Every past feature here
  reads as a sequence of small, named steps. A branch changes *when* those
  steps become visible on `main`, not how they're written.
- **A quiet `main`.** No red runs from work-in-progress; the pipeline only
  ever reports on complete, intentional states.

## Trap — squash looks like tidiness but is a different tool

Squash-merge exists to collapse noise: abandoned experiments, "wip", "fix
typo", commits that only make sense as a sequence *to you, mid-debugging*,
not as history anyone benefits from later. That is a real and useful case —
just not this one. This repo's commits are already written as if someone
else will read them (they are: future-you, six months on, running `git
log -- build/Dockerfile.nginx`). Squashing a well-factored sequence into one
commit message optimizes for a problem you don't have, at the cost of the
detail you do want.

**The actual rule of thumb:** squash when the commits are noise you'd be
embarrassed to leave in history. Keep them, branch or not, when each one is
already a clean, true statement of what changed and why.

## Trap — a branch doesn't change what `ci.yml` protects you from

Working on a branch does not make `docker-build` run against it — `ci.yml`
triggers on `push: branches: [main]` only, not on arbitrary branches, and
`workflow_dispatch`/`workflow_call` are manual/programmatic, not automatic
per-push. A feature branch buys you a quiet `main`, not CI coverage while
you work. If you want the pipeline to actually run mid-feature, run it
yourself:

```sh
task ci                    # once Task.AddTaskCiAggregate.md lands — see docs/SCRUM/TODO/
# or, today, the individual pieces:
task dotnet:test
task frontend:test && task frontend:build
task docker:build:app
```

## Reference

| Topic | Where |
| --- | --- |
| What triggers on `main` | `.github/workflows/ci.yml` |
| What triggers on a tag | `.github/workflows/release.yml` |
| The release checklist (why some edits are unconditional) | `docs/web/cutting-a-release/index.html` |
| The commit that motivated this note | `3f6512c` — two unrelated changes in one message; worth avoiding regardless of branch or squash |
