# Connection Panel Refinements

Refinements to the connection-status details panel: name the endpoint,
show when the next check happens, surface the browser's own connectivity,
tidy the layout — and, arising from the review of that work, collapse the
panel onto one explicit state model with exactly two colours.

## What changed

### The endpoint is named, not the tier

The row read `Backend (http://localhost:5162)`. "Backend" is a vague word
for a row reporting one specific endpoint, so it now reads
`/api/healthz` with the base URL underneath — the URL being the useful
part when the problem is a port-forwarding gap rather than a dead server.

The endpoint itself was renamed `/api/health` → `/api/healthz`.
`/api/health` still responds, so anything already polling it keeps
working; both paths share one handler rather than being maintained
separately.

### The countdown to the next check

A latency figure with no indication of its age is hard to act on: "OK ·
36ms" could have been measured a moment ago or fourteen seconds ago. The
row now carries a visible countdown, ticking every second, reflecting
whichever interval is actually in force (15s healthy, 3s not).

It sits inside the health-check row, ahead of the value, because it counts
down to *that* check — under the panel it floated free of what it
described. Placing it before the value keeps the result as the rightmost
thing the eye lands on.

It is `aria-hidden`. A countdown that speaks once a second is worse than
no countdown, and the row's own value already carries the state.

### The browser's own connectivity, as its own row

The panel already listened for `online`/`offline` to trigger an immediate
re-check, but never showed what the browser had told it. A player whose
own network had dropped therefore saw **"Server unreachable"** — pointing
the blame at a server that was very likely fine.

There is now a **This device** row reflecting `navigator.onLine`, and when
the device reports offline the dot says **"No network on this device"**
rather than blaming the server. A hint below spells out that the server
has not been reached *because of this*, and may be perfectly healthy.

`navigator.onLine` is still treated as a hint and never as proof: it
answers whether the machine has a network, not whether this backend is
reachable, and it never substitutes for the health check.

### One state model instead of six getters

The panel had accumulated `_isHealthy`, `_statusText`, `_realtimeApplies`,
`_realtimeTone`, `_realtimeText`, `_httpTone` and `_httpText` — separate
getters that each re-derived the same underlying state and had to be kept
in agreement by hand.

They were not in agreement. `_isHealthy` considered HTTP and SignalR only,
so once the device row existed, **a machine with no network showed a green
dot directly above a row reading "offline"**.

Each row is now one explicit `ConnectionRow` object carrying its own `ok`
flag, its label, its value and the summary the dot shows when that row is
the reason. The dot is derived from those same objects — red when *any* row
is red — so the panel and the dot cannot drift apart. The bug did not need
a separate fix; it stopped being expressible.

The status text falls out of the same list: the first failing row names the
problem, so the dot reports the most specific thing it knows rather than a
generic failure.

### Two colours, and no more

Red means something is wrong. Green means nothing is wrong. That is the
whole vocabulary.

This reverses the grey "not applicable" state added for the realtime row
in `Task.GreyOutInactiveConnectionRow.md`. The reasoning there was sound —
a green row for a check that never ran implies something was verified —
but the fix aimed at the wrong target. Where no hub connection exists,
*nothing is broken*, which is what green means; what needed fixing was the
wording, and "not used on this screen" already does that job. A third
colour asks the reader to learn a vocabulary in a panel they opened
precisely because they wanted a quick answer.

The `checking` grey went the same way for the same reason.

### Layout

Rows are a `<dl>` with hairline separators — enough structure for the eye
to find a row without the panel becoming a table. The endpoint's host sits
under its name rather than beside it, so a long URL does not wrap
mid-row and push the value column out of alignment.

A failing row is marked by a left rule and colour together, so state is
never carried by hue alone.

Two hard-coded colours were fixed while in the file: the panel border
(`#ddd`) and the hint's top border (`#eee`), both of which stayed light in
dark mode — the same class of miss as the white backgrounds fixed during
the dark-mode migration.

## Verification

`frontend/e2e/connection-status.spec.ts`, 9 tests. Full suite: 112 passed.

The red-propagation test took three attempts to make real, which is worth
recording because the first two looked fine:

1. Asserting "a row is red and the dot is red" after going offline
   **passed with the fix removed** — Playwright's `setOffline` fails the
   in-flight `fetch` immediately, so the health check reddens the dot on
   its own. The device row's contribution was invisible.
2. Sampling every 25ms through the transition, expecting to catch a window
   where the row was red before the dot, **also passed with the fix
   removed** — measurement showed both rows turning red inside the *same*
   25ms sample. There was no window to catch.
3. Faking `navigator.onLine` alone, leaving the server genuinely
   reachable, isolates the rule: exactly one row red, health check green,
   dot must be red. This one **fails with the fix removed** (`Expected
   substring: "bad" / Received: "dot ok"`).

The test also asserts that precisely one row is red, so it cannot pass by
the health check happening to fail, and the countdown test asserts the
value *decreases* rather than merely being present.

Both `/api/healthz` and `/api/health` were confirmed returning 200 against
a running backend, so the rename did not break existing probes.

## Related

`BACKLOG/Flag.BrokenConnectionIndicator.md` is updated: recommendation 2's
first half is described accurately for the current design, and
recommendation 4 ("distinguish degraded from broken") is withdrawn — it
asked for a third visual state, which the two-colour decision rules out.
The nuance it wanted stays in the text, where a screen reader gets it too.

The underlying inconsistency that recommendation 2 names — realtime being
tracked only inside the multiplayer room — is unchanged by this work.
