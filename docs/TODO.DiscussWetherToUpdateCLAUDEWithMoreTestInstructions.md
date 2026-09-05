# Discuss: should CLAUDE.md carry more testing instructions?

`CLAUDE.md` now has one testing rule — prove a test fails without the fix
before trusting it. Three further candidates came out of the same two days
of work and were deliberately left out for now. This note records them, and
the reasoning, so the decision can be revisited without re-deriving it.

The general principle behind leaving them out: a short `CLAUDE.md` gets
followed, a long one gets skimmed. Each of these should earn its place by
recurring, rather than being added pre-emptively.

## Candidate 1 — run the full suite before calling something done

A feature is not finished until the backend tests, the frontend unit tests
and the end-to-end tests all pass. Not just the tests written for the new
work.

**Evidence.** The custom forfeit confirmation dialog replaced the browser's
native confirmation popup. Three existing end-to-end tests drove forfeiting
by auto-accepting that native popup, so they silently stopped working and
hung until they timed out. The feature's own new test passed, so the
breakage was not noticed until later.

**Argument against including it.** This is arguably a continuous-integration
concern rather than a coding instruction — better enforced by a pipeline
that simply runs everything than by a rule a person has to remember. If the
project gains CI, this becomes redundant.

## Candidate 2 — test at the level where the rule actually lives

Prefer a unit test of a pure function over an end-to-end test that cannot
realistically reach the state in question. Where the logic is trapped inside
a UI component with no test harness, extracting it is usually the better
design as well as the thing that makes it testable.

**Evidence.** Two bugs this week could only be triggered end-to-end by
waiting out a real two-minute reconnect grace period. Both were resolved by
lifting the decision into a small pure module — one deciding whether an
end-of-game message belongs to the game being played, one deciding when a
forfeit has waited long enough — each then tested directly.

**Argument against including it.** The codebase already leans this way (the
backend deliberately keeps logic in pure domain functions with thin hub
wrappers), and `docs/web/testing` already explains that the stale-player
sweep is covered by unit tests rather than end-to-end precisely because the
wait would be impractical. Writing it down may be restating existing
practice.

## Candidate 3 — do not assert on transient UI

Avoid waiting on something short-lived as a stand-in for the state actually
under test. Assert on the durable thing instead.

**Evidence.** Several end-to-end tests waited for a round result that is
deliberately only shown for a second and a half, purely as a way of knowing
the round had ended. Under load the check arrived after it had gone, so the
tests failed for reasons unrelated to what they were testing. Rewriting them
to assert on longer-lived state fixed it.

**Argument against including it.** This is specific to one end-to-end spec
file, and the planned work to give each test its own room
(`SCRUM/Task.IsolateMultiplayerTestsFromEachOther.md`) will rewrite much of
it anyway. Worth revisiting after that lands, when it will be clearer
whether the problem was the assertions or the shared room.

## Suggested trigger for revisiting

Add one of these only when the problem it describes actually happens again.
A recurrence is the evidence that the rule is needed; anticipation is not.
