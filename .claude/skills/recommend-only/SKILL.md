---
name: recommend-only
description: Investigate and recommend an approach without writing any code or changing any file. Use when the user asks "how/where should I add X", "what's the best way to structure Y", "recommend an approach", "review my plan", or otherwise wants advice rather than an implementation. Produces a written recommendation grounded in the actual repository, and stops there.
allowed-tools: Read, Glob, Grep, Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(sed:-n *), Bash(ls:*), Bash(find:*), Bash(grep:*), Bash(rg:*), Bash(wc:*), Bash(tree:*), Bash(git log:*), Bash(git status:*), Bash(git diff:*), Bash(git show:*), Bash(git branch:*), Bash(dotnet --info), Bash(dotnet --version), Bash(node --version), Bash(npm --version), Bash(task --list-all)
---

# Recommend Only

Advice mode. Investigate the real repository, then give a recommendation the
user can act on. **Write nothing.** The deliverable is the recommendation
itself, not a scaffold, a stub, a starter file, or an "example to get you
going."

## The hard rule

Do not create, modify, move, or delete any file. Not in the project, not in
the scratchpad, not "just a draft," not "just to show what I mean." No
`dotnet new`, no `npm init`, no `mkdir`, no heredoc into a path, no
`git commit`, no installs.

The `allowed-tools` list above enforces this — it grants read-only tools
only. If you find yourself wanting a tool that isn't on that list, that is
the signal you have drifted out of advice mode. Stop and ask instead.

Code **in your reply** is fine and often necessary — a directory tree, a
config snippet, a signature, a few lines showing the shape of a thing. That
is illustration, and it lives in the message, not on disk.

## Workflow

1. **Read the repo before recommending.** A recommendation that ignores what
   is already there is worthless. Look at neighbouring directories, existing
   config, the build/task setup, naming and port conventions, CI, and
   `.gitignore`. Check whether the thing being proposed partly exists
   already.
2. **Check what the environment actually has** — SDK and runtime versions,
   installed tooling — rather than assuming. Version-dependent advice that is
   wrong for the installed toolchain is worse than no advice.
3. **Commit to one recommendation.** Lead with it. Do not lay out four
   options of equal weight and leave the choice hanging — that is work handed
   back to the user. Alternatives get a sentence each, where they genuinely
   compete.
4. **Say why**, tied to this repo's conventions, not to generic best
   practice. "Because `frontend/` is laid out this way" beats "because it is
   idiomatic."
5. **Name the consequences.** Integration points that will need touching,
   decisions that are expensive to reverse, things that will conflict with
   existing tooling.
6. **Flag what you are unsure about**, plainly. Do not paper over a gap in
   what you could verify from the repo.
7. **Offer to implement — as a question, at the end.** One line. Then stop
   and wait. An offer is not permission.

## Output shape

Fit the shape to the question; do not pad a small answer into a report.

- Lead with the recommendation in a sentence or two.
- The concrete shape of it — a tree, a table, a short snippet — where that is
  clearer than prose.
- Why it fits _this_ repository.
- What else has to change to make it work (wiring, CI, config, docs).
- Caveats and open questions.
- A closing one-line offer to implement.

Keep it proportionate. A question with a short answer gets a short answer.

## When the user says "go ahead"

Only an explicit instruction in a _later_ message — "do it", "implement it",
"yes, build it" — ends advice mode. Acknowledge it, then proceed as normal
outside this skill. Enthusiasm about the recommendation is not a go-ahead,
and neither is a follow-up question about it.

## Do not

- Do not write, scaffold, or stub anything on disk.
- Do not run installers, generators, formatters, or migrations.
- Do not commit, push, or branch.
- Do not treat "that sounds good" as approval to build.
- Do not recommend without reading the repo first.
- Do not hedge across every option instead of choosing one.
