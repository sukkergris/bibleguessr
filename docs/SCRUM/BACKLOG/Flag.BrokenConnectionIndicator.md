# Flag: the connection indicator is better, not trustworthy

The indicator was fixed (see `DONE/Bug.CantTrustConnectionStatusIconRightUpperCorner.md`)
and now reacts in about a millisecond instead of 15.2 seconds. That fix is
real, but it works for one specific reason — the browser fires an
`offline` event — and that reason does not cover every way a connection
breaks.

This file records what is still weak, so the improvement is not mistaken
for the problem being solved. None of it is urgent; all of it is honest.

## What the fast path actually depends on

The near-instant reaction comes from `navigator.onLine` changing, which
happens when the *machine* loses its network. It does not happen when:

- the backend stops responding while the network stays up (a crashed or
  hung server, a proxy dropping traffic, a container restarting);
- a firewall or captive portal silently blackholes requests;
- the connection degrades rather than dies.

In all of those the indicator falls back to polling, which means up to 15
seconds of showing a healthy dot while nothing works. That is the same
failure the original bug described, in a narrower set of circumstances.

## Recommendations, in the order I would do them

### 1. Treat a failed request anywhere as a signal

Today only the indicator's own health check can discover that the backend
is unreachable. Every other request — loading a verse, sending a chat
message, submitting a guess — already knows when it fails, and throws that
knowledge away.

Feeding those failures back would make the indicator react to the thing
the player actually noticed, at the moment they noticed it, with no
polling involved. This is the single change that would most improve
trustworthiness.

### 2. Track realtime state outside the multiplayer room

SignalR is only tracked while in a room, so everywhere else the dot
reflects HTTP alone. That is defensible — there is no hub connection to be
broken — but it means the indicator means different things on different
screens, which is exactly the kind of inconsistency that makes an
indicator hard to trust.

The second half of this is done: the row is now greyed out and reads "not
used on this screen" rather than rendering green (see
`DONE/Task.GreyOutInactiveConnectionRow.md`). What remains is the
underlying inconsistency — either track realtime wherever a connection
exists, or accept that the dot means different things on different
screens and make sure that is always obvious.

### 3. Reconsider the SignalR keep-alive settings

The measured 15-second detection floor for a silent failure is largely the
hub's own timeout. If faster detection matters, that is the setting to
change — but it costs traffic on every idle connection, so it is a real
trade-off rather than an oversight. Worth measuring before changing.

### 4. Distinguish "degraded" from "broken"

The dot has two states. A slow but working backend, a reconnecting hub,
and a completely dead server are meaningfully different situations that
currently collapse into one red dot plus a status word. The status text
already carries more nuance than the colour does; the visual could follow.

## What I would not do

- **Do not simply shorten the healthy polling interval.** It treats the
  symptom, adds constant traffic, and still leaves a window. The original
  bug report says this explicitly and it is right.
- **Do not report `navigator.onLine` as connection state.** It answers a
  different question — whether the machine has a network, not whether this
  backend is reachable — and using it as truth would produce confident
  wrong answers in both directions.

## Testing note

`frontend/e2e/connection-status.spec.ts` covers the paths that exist, and
was verified by removing the fixes and confirming failure. It cannot
reproduce a silent failure with the network up, which is precisely the
case left uncovered. Anyone working on the recommendations above should
expect to need a fake backend that accepts connections and never
responds, rather than Playwright's offline mode.
