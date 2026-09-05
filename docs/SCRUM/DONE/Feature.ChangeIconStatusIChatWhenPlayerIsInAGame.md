# Show Game Status in Chat

Make a player's in-game status visible in the chat roster so users understand
why they cannot challenge that player and can distinguish availability from
connection problems.

The status must be based on the player's stable ID and server game events, not
on the player's display name or on whether the current user happened to send
the play request.

## Roster behavior

- When a player enters an active multiplayer game, show an explicit status
  such as `(in a game)` beside their name in the roster.
- A player marked as in a game must not show an active challenge action. The
  UI should prevent the interaction before submission, while the server must
  remain authoritative and continue to reject invalid challenge requests.
- Keep the player visible in the roster unless another existing presence rule
  removes them; game status is not the same as offline status.
- The current user may remain visible as `(you)`, but the UI should avoid
  offering a challenge or ignore action against the current user.
- The status must be understandable without relying on an icon or color alone.
  Include readable text and, where an icon is used, provide an accessible
  label or hide the decorative icon from the accessibility tree.

## State transitions

- Mark both players busy when a matching `RoundStarted` event announces an
  active game in the room, regardless of whether the game belongs to the
  current user.
- Clear both players' busy status when the corresponding `GameOver` event is
  received.
- Match `GameOver` to the tracked game ID, not only to the pair of player IDs;
  a late event from an older game must not make players in a newer game appear
  available.
- Clear state when the user leaves the room or the room component is disposed.
- A disconnected player may be shown in an Offline section or with the
  existing connection status indicator; do not replace `(in a game)` with an
  ambiguous connection icon. If both facts are relevant, expose both through
  text or an accessible description.
- Handle event ordering and reconnect races deterministically. A roster
  update, `PlayerDisconnected`, `PlayerLeft`, `RoundStarted`, or `GameOver`
  event must not leave a stale busy state indefinitely or clear a newer game.

## Interaction with chat and play requests

- The roster status is informational, but it must agree with the existing
  challenge behavior: players in a game cannot be selected as challenge
  targets.
- A player becoming busy while the roster is being rendered must not create a
  clickable challenge action that can submit an invalid request.
- If the server rejects a request because the player became busy between the
  UI check and the request, show the existing error path without corrupting
  roster state.
- Chat messages remain available unless another feature, such as ignore, hides
  them; being in a game does not mute or remove a player from chat.
- Busy status must not affect server scoring, the active game session, or the
  player's ability to play with their current opponent.

## Accessibility and visual design

- Use text such as `(in a game)` in the player row and expose the same state to
  screen readers.
- A busy player row must not expose a misleading enabled challenge button.
- Preserve logical keyboard order and visible focus indicators for all
  remaining roster actions.
- Keep the status readable in light mode, dark mode, high contrast, at 200%
  zoom, and on narrow screens.
- Do not rely on color, opacity, a status dot, or strikethrough alone to convey
  that a player is unavailable.

## Acceptance criteria

- When a player starts a multiplayer game, both players are marked `(in a
game)` in the room roster once the active-game event is received.
- A player marked as in a game cannot be challenged from the roster.
- When that exact game ends, both players become challengeable again if they
  are otherwise present and eligible.
- A late `GameOver` from an earlier game cannot clear the status for a newer
  game involving the same players.
- Disconnect and leave events do not create an incorrect available/busy state.
- Chat remains usable while a player is in a game.
- The status is visible and understandable to keyboard and screen-reader users
  in light/dark mode and at increased zoom.
- Automated tests cover status appearance, challenge suppression, matching
  `GameOver` by game ID, stale-event handling, disconnect/leave behavior, and
  accessible status text.
