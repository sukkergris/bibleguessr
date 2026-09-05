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

Note that the shared room is only half the problem. The underlying product
defect it exposes is described in BUGS/BUG.StaleGameOverEndsTheWrongGame.md
and should be fixed first — isolating the tests without fixing that would
hide a real bug rather than solve it.

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
