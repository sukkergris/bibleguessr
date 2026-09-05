# Isolate multiplayer tests from each other

Every end-to-end multiplayer test joins the same shared "World chat" room.
Tests therefore share state: a game left running by one test can still be
finishing while the next test starts, and its players can interfere with
players in another test.

This makes the suite unreliable in a way that wastes real time. Failures
appear and disappear between runs, they get worse under load, and they look
like product bugs when they are not. Several timing failures during recent
work were chased as regressions before the shared room turned out to be the
cause. It also hides genuine bugs: a real defect and a room-sharing artifact
produce the same symptom, so neither can be trusted without re-running.

Note that the shared room was only half the problem. The underlying product
defect it exposed is described in DONE/BUG.StaleGameOverEndsTheWrongGame.md,
and was deliberately fixed first — isolating the tests beforehand would have
hidden that bug rather than solved it.

## Resolution

Done for the room-sharing half. Each test now creates its own room and
brings its players into it by code, so no test can see another test's
players or leftover games. One deliberate exception remains: a single test
still uses World chat, because that is the room real players land in by
default and it would otherwise have no coverage at all. It is filtered by
its own player names so other occupants cannot affect it.

The suite now runs in parallel, which was not previously possible: 19 tests
in about 23 seconds with four workers, versus about 1.1 minutes serially,
and repeated runs pass cleanly both serially and in parallel.

The file split described below has NOT been done yet.

## Requirements

- Each test must run against its own room, so no test can be affected by
  players or games belonging to another test.
- A test must pass or fail on its own behaviour alone, whether it runs
  alone, alongside the whole suite, or repeatedly.
- Tests must not depend on being the only game in progress.

## Related clean-up

The same file has grown to roughly a thousand lines and eighteen tests,
with the two-player setup copied out by hand in every one of them, and a
large number of hand-tuned waits. Worth splitting by area and extracting
the shared setup once the isolation work above is done, so the waits can be
reasoned about in one place instead of eighteen.
