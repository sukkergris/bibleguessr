# Bug: Random Match Does Not Use the Expected Settings

When a player uses **Play someone random**, the selected game settings can
appear to be ignored when the player is matched with someone who was already
waiting.

## Observed behavior

The player chooses a round count, time limit, and verse restriction in the
multiplayer setup screen, then selects **Play someone random**. After a match
starts, the resulting game may use different values, such as a different
number of rounds, time limit, or restriction than the values visible in the
player's setup controls.

The issue is especially visible when two players enter matchmaking with
different settings: the player who joins an existing queue entry may see a
game configured from the other player's choices.

## Expected behavior

The product must define and consistently apply the matchmaking rule:

- If **Play someone random** means “join whoever is already waiting,” the
  waiting player's settings are authoritative and the UI must explain that
  the resulting game uses the existing match's settings.
- If each player expects their own settings to be used, the server must
  negotiate a deterministic policy before starting, such as requiring a
  compatible match or defining which values win.

Whichever policy is chosen, the accepted `GameSession` must use the same
`GameType`, round count, and time limit that the UI and matchmaking contract
promise. Once the session starts, those values must remain fixed for every
round.

## Reproduction

1. Open multiplayer setup in two browser contexts.
2. Choose clearly different settings for each player, for example:
  - Player A: 3 rounds and a short timed round.
  - Player B: 10 rounds and unlimited time.
3. Have Player A select **Play someone random** and wait for matchmaking.
4. Have Player B select **Play someone random**.
5. Compare each player's selected settings with the started game and the
  resulting number of rounds/deadlines.
6. Repeat with different verse restrictions to verify the selected game type
  is also handled consistently.

Record which player entered the queue first, which settings each player saw,
and which values the first `RoundStarted`/active session actually contains.

## Technical scope

- Verify the `ChallengeSettings` state is updated before
  `FindMatch`/`findMatch` is invoked.
- Verify the normalized time-limit value (`0`/`undefined` for unlimited and
  the minimum timed value) is transmitted correctly.
- Verify the matchmaking queue stores the selected `GameType`, round count,
  and time limit together with the waiting player.
- Verify the server's match-start policy is intentional and documented; the
  current implementation starts the game with the waiting player's settings.
- Verify the `RoundStarted` session, client display, round advancement, and
  deadline calculation all use the same authoritative values.
- Do not fix this by changing only the visible labels or local preference
  storage. The defect is at the boundary between matchmaking settings and the
  created game session.

## Acceptance criteria

- A random-match game's effective settings follow the documented matchmaking
  policy.
- The player is not shown settings that imply a different game than the one
  the server will create.
- Round count, time limit, and verse restriction are transmitted together and
  remain fixed in the active session.
- Unlimited time and the minimum valid timed value are normalized consistently
  before queueing and when creating the session.
- Single-player setup and direct player-to-player challenges retain their
  existing settings behavior.
- Automated tests cover both queue orders, conflicting settings, unlimited and
  timed rounds, verse restrictions, the emitted `RoundStarted` session, and
  the resulting number of rounds/deadlines.
