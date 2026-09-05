# Remember Round Count and Time Limit Choices

Remember each player's most recently selected round count and per-verse time
limit so returning to game setup does not require them to recreate the same
preferences every time.

## Goal

The round count and time limit are player preferences for creating a game. The
frontend should restore those preferences on the next visit to a setup screen,
while still allowing the player to change them before starting or challenging.

Persistence is local to the current browser and device. These values must not
be uploaded merely because they are remembered, and they must not be confused
with the settings of an already-created game.

## Scope

- Remember the selected number of rounds.
- Remember the selected time limit per verse.
- Restore both values when the relevant setup control is mounted again.
- Update the stored values as the player changes the controls.
- Keep the current controls, labels, ranges, and validation rules.
- Apply the remembered values independently to single-player and multiplayer
  setup where both controls are available.

## Defaults and validation

- Round count defaults to `5` when no valid saved value exists.
- Round count must remain between `3` and `10`, inclusive.
- Time limit defaults to unlimited when no valid saved value exists.
- Unlimited is represented by `0` in the UI/storage boundary and by the
  existing `undefined`/`Unlimited` domain values after conversion.
- A timed round may be selected from `2` through `60` seconds.
- The existing `1`-second slider position remains clamped to `2` seconds; it
  must never be persisted as a usable one-second round.
- Invalid, missing, malformed, or out-of-range stored values must be ignored
  and replaced with the appropriate defaults rather than breaking setup.

## Behavior

1. The player opens a setup screen.
2. The round-count and time-limit controls load the last valid local choices,
   or their defaults when no choices have been saved.
3. Moving either control immediately updates the visible value and stores the
   normalized choice.
4. Starting a single-player game uses the restored or newly selected round
   count.
5. Sending a multiplayer play request uses the restored or newly selected
   round count and time limit. The recipient sees the values carried by the
   request, not the sender's browser storage.
6. Once a game starts, its round count and time limit are fixed by the game
   session. Later changes to local preferences must not alter an active game.

## Storage requirements

- Use named, versionable storage keys under the application's existing
  `bibleguessr:` namespace.
- Store only the numeric preferences; do not store verse text, uploaded Bible
  content, player chat, or other game data as part of this feature.
- Reads and writes must tolerate unavailable or denied `localStorage` (for
  example, private browsing). In that case setup continues with in-memory
  defaults and the player can still use the controls normally.
- Corrupt storage must be recoverable without requiring the player to clear
  all site data.

## Accessibility

- Restored values must be reflected in the accessible value of each range
  control and its visible value label.
- The labels must continue to identify the controls as number of rounds and
  time per verse.
- A change made with keyboard controls must persist exactly like a pointer or
  touch change.

## Acceptance criteria

- A player changes the round count, leaves setup, returns, and sees the same
  valid round count restored.
- A player changes the time limit, leaves setup, returns, and sees the same
  valid time limit restored, including the unlimited choice.
- The remembered values survive a page reload in the same browser profile.
- Invalid stored values fall back to `5` rounds and unlimited time without a
  console-breaking exception or unusable control.
- Single-player starts with the selected round count.
- Multiplayer requests carry the selected round count and time limit to the
  server, and the active session uses those values for every round.
- Changing saved preferences after a game starts does not change that game's
  round count or deadline.
- Storage failure does not prevent setup, game start, or multiplayer
  challenge creation.
- Automated tests cover defaults, persistence, normalization, invalid data,
  storage failure, and both single-player and multiplayer consumers.
