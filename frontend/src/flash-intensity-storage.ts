// Whether the player has opted OUT of the safe flash-rate ceiling for the
// full-screen countdown blink (see docs/SCRUM/Featire.ScoreDuringMultiplayerGame.md
// and multiplayer-game.ts's _dangerAnimationSeconds) — a local, per-device
// preference, deliberately NOT part of ChallengeSettings (challenge-settings.ts):
// that interface is transmitted to the server as part of a play request, and
// this setting has nothing to do with round rules both players agree on — it
// only affects how fast THIS player's own screen flashes, so it stays local,
// same as player-name-storage.ts's remembered name.
//
// Defaults to false (safe) for anyone who has never touched the setting — see
// loadEpilepsyStressModeEnabled. The checkbox lives in challenge-settings.ts,
// labeled "Enter epilepsy-inducing stress mode"; when checked, the fastest
// point of the blink's acceleration ramp goes well past the ~3-flash/second
// WCAG photosensitivity guidance this feature otherwise stays under (see
// multiplayer-game.ts for the actual numbers and rationale) — an explicit,
// informed opt-in into that faster/less-safe rate, not a silent default.
const STORAGE_KEY = 'bibleguessr:epilepsyStressModeEnabled';

/** Reads whether the player has opted into the faster, less-safe flash rate.
 * Defaults to false (the safe ceiling) for anyone who has never set this,
 * including if localStorage itself is unavailable (private browsing, storage
 * disabled) — losing this preference should fail toward the SAFER behavior,
 * never toward the faster one. */
export function loadEpilepsyStressModeEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Remembers the player's choice for next time. A no-op (not an error) if
 * localStorage is unavailable — see loadEpilepsyStressModeEnabled's note on
 * failing toward the safer default in that case. */
export function saveEpilepsyStressModeEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Ignored — see function doc.
  }
}
