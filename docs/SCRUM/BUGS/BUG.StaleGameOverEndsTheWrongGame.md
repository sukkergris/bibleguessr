# A finished game can end a different, still-running game

Two players who finish a game, return to the lobby, and start a new game
together can have that new game ended for them without warning. The game
screen disappears mid-round and both players are shown the results screen
for a game they were no longer playing, with time still on the clock and
neither player having forfeited.

The cause is that the "game over" signal only identifies the two players
involved, not which game ended. When the same two people play again, a
late or leftover signal from their previous game still matches them, and
their current game is torn down as if it had just finished.

Observed while investigating unrelated test failures: a player was moved
to the results screen five seconds into a sixteen-second round, with
twelve seconds remaining and no forfeit sent by either side. It reproduces
roughly one run in three when the same two players start games in quick
succession.

This is very likely the cause of previously reported symptoms that could
not be reproduced on demand — games appearing to "get stuck", and forfeit
appearing not to work.

## Resolution

Fixed. Each game now carries its own identity, assigned when it starts and
unchanged for its lifetime. The end-of-game signal carries that identity,
and a client acts on it only when it matches the game it is currently
playing — anything else is ignored, including a signal that arrives before
a client knows which game it is in. The lobby's "already in a game"
tracking is matched the same way, so a stale signal cannot mark players
free while they are still playing.

## Requirements

- A game-over signal must only ever end the game it actually belongs to.
- A signal belonging to a game that has already finished must be ignored,
  no matter which players it names.
- Players must never be moved to the results screen while their current
  round is still running, unless the game genuinely ended.
- Starting a new game with the same opponent immediately after finishing
  one must be safe.
