# Ignore Players

Users should be able to toggle an ignore control on another player and stop
seeing or interacting with that player immediately.

Ignoring a player must continue to work if they change their display name. The
display name is not the identity used by the ignore list.

## User experience

- Show a clearly recognizable ignore/mute icon next to each other player's
  name in the roster and other player lists.
- Use a native button with an accessible name such as `Ignore Alice` or
  `Stop ignoring Alice`; the icon alone is not sufficient.
- Toggling the control must be immediate and must not require a confirmation
  for the normal action.
- Show the current ignored state visually and expose it to assistive
  technology with `aria-pressed` or an equivalent state.
- Provide a discoverable way to review and unignore players, such as an
  `Ignored players` section in settings or the room view.
- If a user unignores a player while both are present, the player's newly
  received content may appear again; previously hidden content does not need
  to be reconstructed.

## What ignoring does

While a player is ignored, the local client must suppress that player's:

- Chat messages, including messages already held in the current in-memory
  chat history.
- Presence and roster entries, including online, offline, busy, and reconnect
  indicators.
- Play requests, challenge controls, and other invitations addressed from
  that player.
- Non-essential activity notifications attributed to that player.

Ignoring is a local viewing and interaction preference. It must not silently
remove the player from the room for other users, end an active game, alter
server scoring, or prevent the ignored player from playing with someone else.
If the product later permits an ignored player to be the current game
opponent, the active game UI must define that exception explicitly rather than
silently hiding game-critical state.

## Stable identity

- Ignore matching must use a stable player identity, never the display name.
- The identity must remain stable when the player changes their name and must
  be the same identity included on roster entries, chat messages, and play
  requests.
- Because the current application mints a fresh server `PlayerId` on every
  join and remembers only the display name locally, this feature requires an
  identity design before implementation. Preferred options are an
  authenticated account identity or a persistent, server-issued anonymous
  identity. A randomly generated browser-only value is insufficient if the
  same player is expected to remain ignored after reconnecting or changing
  names from another session.
- The stable identity must not be the player's email address, password, or
  another directly identifying personal field exposed to other players.
- The server must validate that a client may act only for its own identity;
  clients must not be able to claim another player's identity by editing a
  request.

## Persistence and privacy

- The ignored-player list should persist for the current user according to the
  chosen identity model, so returning to the application does not silently
  reveal previously ignored players.
- If the application has no account system, document the limitation clearly:
  an anonymous ignore list may be device/browser scoped and may be lost when
  site data is cleared or when the user changes devices.
- Store only the stable player identifiers and the minimum display metadata
  needed to render the ignored-player list. Do not store chat text, verse text,
  uploaded Bible content, credentials, or unrelated game data.
- Storage failures must not prevent joining or using chat; the UI should fall
  back to an in-memory ignore list for the current session.
- Ignore state should be private to the user unless a future moderation
  feature explicitly requires server-side sharing.

## Live updates and race handling

- Applying ignore must filter messages and roster data already in memory, not
  only events received after the toggle.
- Incoming messages, history snapshots, roster updates, reconnects, and play
  requests must all pass through the same ignore predicate.
- Renaming, leaving, reconnecting, and rejoining must not cause an ignored
  identity to reappear under a new name.
- Repeated toggle events and out-of-order SignalR updates must settle on one
  deterministic local state.
- Ignoring or unignoring must not mutate the server's authoritative player,
  room, or game state unless a separate server-side moderation feature is
  explicitly added.

## Accessibility

- Ignore controls must be keyboard reachable with visible focus indicators.
- The accessible label must include the target player's current name while
  the control's state is exposed independently through `aria-pressed` or
  equivalent text.
- State changes must be announced without relying on color alone.
- The ignored-player list must support keyboard unignore actions and clearly
  identify each stable identity by its latest known display name.
- Hidden messages must not leave empty, confusing, or invalid list structure
  for screen readers.

## Acceptance criteria

- A user can ignore a player with one clearly labelled icon-button action.
- The ignored player disappears from the local roster and their existing chat
  messages are hidden immediately.
- New chat messages, presence changes, play requests, and reconnect events
  from that identity remain hidden while ignored.
- Changing the ignored player's display name does not make that player visible
  again.
- Leaving and rejoining under the same stable identity preserves the ignore
  state according to the selected persistence model.
- A user can review ignored players and unignore one without reloading the
  page.
- Ignoring one player does not hide other players' content or affect server
  game state.
- Storage or connection failures do not prevent ordinary chat and roster use;
  the client fails closed for the current session where appropriate.
- Automated tests cover toggle state, existing and incoming message
  filtering, roster/history filtering, play-request filtering, rename and
  reconnect behavior, persistence, storage failure, accessibility labels, and
  unignore behavior.
