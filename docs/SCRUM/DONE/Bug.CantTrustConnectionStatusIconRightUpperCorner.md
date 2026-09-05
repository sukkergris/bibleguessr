# Bug: Delayed Connection Status Update

The connection-status indicator in the upper-right corner does not always
change promptly when the application's realtime connection is lost. During a
network interruption, the indicator can continue to show a healthy/connected
state even though SignalR messages are no longer reaching the browser.

This makes the indicator difficult to trust: the player cannot tell whether a
chat message, challenge, guess, or other action is delayed because of the
server, the browser's connection, or the application itself.

## Resolution

Measured before changing anything: the indicator took **15.2 seconds** to
react to a lost backend — exactly the HTTP polling interval. Going fully
offline in multiplayer was no faster, because the WebSocket stays apparently
open until keep-alive expires, so SignalR's own callbacks had not fired yet
either.

Three changes, in order of how much they mattered:

- The browser's `offline`/`online` events now prompt an immediate re-check.
  They are treated strictly as a hint that something changed, not as truth:
  `navigator.onLine` says nothing about whether this backend is reachable.
  This took reaction time from **15.2 seconds to about 1 millisecond**.
- Polling adapts: slow (15s) while healthy, fast (3s) while not, so recovery
  is noticed quickly without poking a working server.
- `reconnecting` is now distinct from `disconnected` in the connection state,
  and the indicator states its status in words — Connected, Reconnecting…,
  Disconnected, Server unreachable — rather than only as a colour. Realtime
  state is checked before HTTP, so a reachable server cannot mask a broken
  connection.

Covered by `frontend/e2e/connection-status.spec.ts`, verified by removing
both fixes and confirming all three tests fail.

## Current behavior

The indicator combines two different health signals:

- HTTP health is checked periodically, currently every 15 seconds.
- SignalR state is reported through `onreconnecting`, `onreconnected`, and
  `onclose` callbacks from the shared hub connection.

SignalR cannot always know about a silent network failure immediately. A
WebSocket may remain apparently open until transport or keep-alive timeouts
expire. However, once SignalR reports `reconnecting` or `close`, the UI should
reflect that transition immediately.

The current UI reduces the state to a green/red indicator and does not clearly
distinguish `connecting`, `reconnecting`, `disconnected`, HTTP-unhealthy, and
HTTP-healthy-but-realtime-unavailable states.

## Reproduction

1. Open the application and enter multiplayer so the SignalR connection is
   active.
2. Confirm the upper-right indicator shows a healthy state.
3. Disable the browser's network connection, stop the backend, or interrupt
   the WebSocket connection.
4. Observe the indicator immediately and during the next 30 seconds.
5. Open its details panel and compare the displayed HTTP and SignalR states.
6. Restore the connection and verify that the indicator changes back only when
  realtime connectivity has actually been restored.

Record which interruption method was used, the browser, the elapsed time until
the indicator changed, and whether the details panel showed HTTP and SignalR
states consistently.

## Expected behavior

- The UI changes to `Reconnecting…` as soon as SignalR reports that state.
- The UI changes to `Disconnected` when reconnect attempts are exhausted or
  the hub closes.
- The UI changes to `Connected` only after SignalR reports a successful
  reconnection, not merely because an HTTP health check succeeds.
- HTTP reachability and SignalR reachability remain visible as separate
  details; a healthy HTTP endpoint must not make a broken realtime connection
  appear healthy.
- The indicator's accessible name and details text describe the actual state;
  color and animation are supplementary only.
- Reconnection status changes do not reset the current game, chat, setup, or
  multiplayer state.
- Once the connection state is known, the UI update is immediate and does not
  wait for the next 15-second HTTP polling interval.

## Investigation scope

- Verify that the shared SignalR connection invokes the UI handler promptly
  from `onreconnecting`, `onreconnected`, and `onclose`.
- Measure the delay between the physical/network interruption, SignalR's
  transport detection, and the rendered indicator update.
- Determine whether SignalR keep-alive and server-timeout settings are too
  conservative for the product's expected feedback time.
- Consider an explicit `reconnecting` state rather than collapsing it into
  `disconnected`.
- Keep HTTP health polling separate from realtime connection state; changing
  the polling interval alone is not a complete fix.
- Treat `navigator.onLine` only as an early hint. It is not authoritative for
  backend reachability and must not replace SignalR state.
- Check that repeated mount/unmount cycles do not leave duplicate connection
  callbacks or stale UI updates.
- Respect reduced-motion settings for any disconnected pulse animation.

## Acceptance criteria

- When SignalR emits a reconnecting/disconnected transition, the indicator
  reflects it in the next UI update rather than waiting for HTTP polling.
- The indicator distinguishes connecting, reconnecting, connected, and
  disconnected states in accessible text.
- HTTP health and SignalR health are represented independently in the details
  panel.
- A healthy HTTP response cannot mask a failed realtime connection.
- A successful HTTP response or browser `online` event cannot falsely report
  SignalR as connected.
- Reconnection returns the indicator to connected only after the actual
  SignalR reconnection callback.
- Existing multiplayer/chat/game state remains intact during connection
  transitions.
- Automated tests cover callback propagation, state rendering, reconnect
  success/failure, HTTP/SignalR disagreement, callback cleanup, and accessible
  status text.
