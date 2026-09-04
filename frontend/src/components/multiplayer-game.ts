import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import {
  allowedBooksForGuessForm,
  allowedChaptersForGuessForm,
  bookNumberOfGuess,
  lockedBookForGuessForm,
} from '../game-type'
import {
  forfeitGame,
  onGameOver,
  onPlayerDisconnected,
  onRoundScored,
  onRoundStarted,
  submitGuess,
} from '../signalr-client'
import { loadEpilepsyStressModeEnabled } from '../flash-intensity-storage'
import { computeRemainingSeconds, deadlineOf, parseTimeSpanMs } from '../timer'
import type { GameOverReason, GameSession, GameType, Guess, Verse, VerseReference, VerseSource } from '../types'
import type { MultiplayerGameOverDetail, MultiplayerRoundSummary } from './multiplayer-results'
import './verse-card'
import './guess-form'

/** How often the local countdown re-renders — purely cosmetic, no network
 * traffic involved (see timer.ts's computeRemainingSeconds). 250ms rather
 * than 1000ms so the displayed number doesn't visibly "stick" for up to a
 * second before decrementing. */
const COUNTDOWN_TICK_MS = 250

/** How long a round's reveal ("+N points" / "Choked!") stays on screen
 * before the next round (or the results screen, for the final round) is
 * allowed to replace it — see _holdReveal. Without this, the server
 * broadcasts RoundScored and the next RoundStarted/GameOver back-to-back
 * with no gap (see GameHub.fs's resolveRound), so the reveal could
 * otherwise flash for well under 100ms in practice — long enough to be
 * technically correct but not long enough for a player to actually read
 * it. */
const REVEAL_HOLD_MS = 1500

/** How many seconds of "time is running out" the blink is meant to warn
 * about — the danger window's length (see _inFinalCountdown). */
const COUNTDOWN_DANGER_WINDOW_SECONDS = 7

/** A round whose own time limit is at or below this never blinks at all.
 * Set equal to the danger window itself: such a round would be entirely
 * "final countdown" from its very first instant, so it would blink start
 * to finish every round — which defeats the point (a warning that's
 * always on isn't a warning) and, because the between-rounds reveal only
 * holds for REVEAL_HOLD_MS, reads as one unbroken blink straight through
 * the score rather than a fresh warning per round. */
const MIN_BLINKABLE_ROUND_SECONDS = COUNTDOWN_DANGER_WINDOW_SECONDS

/** The blink's cycle length at the START of the danger window (7s
 * remaining) — one flash per second, a calm baseline to escalate from. */
const BLINK_CYCLE_SLOWEST_SECONDS = 1

/** The blink's cycle length at the very END (0s remaining) by default —
 * ~2.2 flashes/sec. Kept comfortably under the ~3-flash/second WCAG
 * photosensitivity guidance rather than right at its edge: an earlier
 * 0.34s (~2.9/sec) technically cleared the line but read as too harsh a
 * plunge in the final stretch. Do not lower past ~0.34s without
 * re-checking against that guidance. */
const BLINK_CYCLE_FASTEST_SECONDS_SAFE = 0.45

/** The end-of-window cycle length when the player has explicitly opted
 * into "Enter epilepsy-inducing stress mode" — 10 flashes/sec, well past
 * the WCAG guidance above. This is the whole point of that opt-in (a
 * deliberate, informed escape hatch of exactly the kind that guidance
 * describes), so it is deliberately NOT softened alongside the safe
 * value. */
const BLINK_CYCLE_FASTEST_SECONDS_STRESS = 0.1

/** Steepness of the exponential ramp between the slowest and fastest
 * cycle lengths — higher stays calm longer then drops harder at the very
 * end; lower spreads the acceleration more evenly across the window. */
const BLINK_RAMP_GROWTH = 12

/** One color per whole second remaining in the final-countdown window
 * (index 0 = 7s left, index 7 = 0s left), read by _dangerFlashColor and
 * pushed out as --countdown-danger-color (see bg-app.ts and index.css)
 * so each flash's color is pinned to the actual second being crossed,
 * not to a position in an independent, colors-agnostic animation loop.
 * Deliberately escalates hotter/more intense as the round runs out —
 * red -> orange -> a hotter orange -> deep crimson -> darker crimson ->
 * magenta -> hot pink -> a near-white-hot pink at the very end. */
const COUNTDOWN_DANGER_COLORS = [
  '#dc2626', // 7s left — red
  '#f97316', // 6s left — orange
  '#fb923c', // 5s left — hotter orange
  '#e11d48', // 4s left — deep crimson
  '#be123c', // 3s left — darker crimson
  '#db2777', // 2s left — magenta
  '#ec4899', // 1s left — hot pink
  '#f9a8d4', // 0s left — near-white-hot pink
] as const

/**
 * A live synced multiplayer round, from the moment a challenge is accepted
 * through the final round's result — owns everything moment-to-moment
 * (current round's verse, my own guess-locked-in state, the countdown,
 * the opponent's connection status, and the running scoreboard). Mounted
 * by bg-room-setup.ts in place of the game-type-select/chat-panel/
 * play-requests block while a game is active — see docs/SCRUM/Feature.RequestToStartMPGame.md
 * and docs/SCRUM/Feature.Time.md.
 *
 * <bg-verse-card>/<bg-guess-form> are reused verbatim — this component
 * only layers timer/opponent-status/scoreboard chrome around them, and
 * swaps the guess form out entirely (not just `disabled`) for a "locked
 * in" message once I've submitted.
 *
 * The server is authoritative for verse selection, scoring, and round
 * advancement — this component never computes points itself, only
 * displays what RoundStarted/RoundScored/GameOver report (see
 * types.ts's GameSession doc comment on why those are full snapshots, not
 * deltas).
 *
 * Each round's server state is a bare VerseReference (book/chapter/
 * verseNumber only — see types.ts's RoundState doc comment: the server
 * never sends verse TEXT, since two players in the same game may each be
 * reading a different translation/uploaded file, chosen before entering
 * the room — see bg-room-setup.ts's translation picker). This component
 * resolves that reference to displayable text itself, via `verseSource`
 * (this player's OWN chosen VerseSource), on every RoundStarted/RoundScored
 * — see _resolveVerse. If this player's source doesn't have the
 * referenced verse (a translation/file mismatch — rare, per
 * docs/SCRUM/Feature.RequestToStartMPGame.md, and deliberately not fixed
 * up), a small fallback message is shown for that round instead of text.
 *
 * Fires one event up to bg-room-setup.ts: `game-over:
 * CustomEvent<MultiplayerGameOverDetail>` once the server says the game
 * has ended (completed normally, or either player forfeited) — carries
 * enough to render <bg-multiplayer-results>. This is deliberately the
 * ONLY signal this component acts on to end itself — it does NOT react
 * to the opponent's PlayerLeft (see onPlayerDisconnected below, not
 * onPlayerLeft), because every server path that removes a player mid-game
 * (voluntary leave via GameHub.LeaveRoom, the stale-disconnect sweep,
 * same-name-rejoin replacement) always pairs PlayerLeft with
 * GameOver(Forfeited) — so GameOver alone is a complete, reliable signal,
 * and reacting to PlayerLeft too used to race it: PlayerLeft is
 * broadcast BEFORE GameOver in every one of those paths, so an earlier
 * version of this component that also handled PlayerLeft would silently
 * tear itself down (no results screen) a moment before GameOver arrived,
 * bouncing the remaining player back to the lobby with no summary at
 * all instead of the results screen they should have seen.
 */
@customElement('bg-multiplayer-game')
export class MultiplayerGame extends LitElement {
  @property({ attribute: false })
  myPlayerId = '';

  @property({ attribute: false })
  myPlayerName = '';

  @property({ attribute: false })
  opponentId = '';

  @property({ attribute: false })
  opponentName = '';

  @property({ attribute: false })
  translation?: string;

  /** This player's own chosen verse source — see bg-room-setup.ts's
   * pre-name translation/file picker. Used both by <bg-guess-form>'s
   * autocomplete AND to resolve each round's VerseReference to
   * displayable text (see _resolveVerse). */
  @property({ attribute: false })
  verseSource?: VerseSource;

  /** The most recent RoundStarted session bg-room-setup.ts had already
   * seen for this game by the time this component mounted, if any — see
   * that component's own doc comment on why it captures RoundStarted
   * itself rather than leaving it solely to this component's own
   * subscription below. AcceptPlayRequest's RoundStarted broadcast can
   * arrive before this element even exists (it's created by the very
   * re-render that PlayRequestAccepted, sent moments earlier, triggers),
   * and hub.on has no replay for a listener that subscribes after the
   * fact — so relying only on onRoundStarted here would occasionally
   * miss the game's first round entirely, leaving the player stuck on
   * "Waiting for the first verse…" forever. connectedCallback applies
   * this the same way a live onRoundStarted event would, before
   * subscribing to future ones. */
  @property({ attribute: false })
  initialSession?: GameSession;

  @state()
  private session?: GameSession;

  /** The current round's verse, resolved from its VerseReference against
   * `verseSource` — undefined while resolving or before a round has
   * started. See _resolveVerse. */
  @state()
  private resolvedVerse?: Verse;

  /** Set when `verseSource` couldn't resolve the current round's
   * VerseReference (a translation/file mismatch — see the class doc
   * comment) — shown in place of the verse card's text for this round. */
  @state()
  private verseResolutionError?: string;

  @state()
  private myGuess?: Guess;

  /** The guess form's book restriction, resolved from `session.gameType`
   * (which carries book NUMBERS — see types.ts's GameType doc comment)
   * against MY OWN verseSource — see _resolveGuessFormRestriction. Kept
   * as one object (rather than three separate @state fields) so a single
   * resolution pass updates all three together, avoiding a render with
   * only some of them updated. */
  @state()
  private guessFormRestriction: {
    allowedBooks?: string[];
    lockedBook?: string;
    allowedChapters?: number[];
  } = {};

  @state()
  private opponentConnectionState: 'connected' | 'disconnected' = 'connected';

  /** This game's round-by-round history, accumulated locally as
   * RoundScored events arrive — see multiplayer-results.ts's doc comment
   * on why the server itself doesn't send this. */
  @state()
  private rounds: MultiplayerRoundSummary[] = [];

  // Ticked locally to redraw the countdown — see COUNTDOWN_TICK_MS. Not
  // itself meaningful state beyond "cause a re-render"; computeRemainingSeconds
  // reads it fresh each render.
  @state()
  private _now = Date.now();

  @state()
  private forfeitDialogOpen = false;

  @state()
  private forfeiting = false;

  @state()
  private forfeitError?: string;

  private forfeitTrigger?: HTMLButtonElement;

  private _unsubscribeRoundStarted?: () => void;
  private _unsubscribeRoundScored?: () => void;
  private _unsubscribeGameOver?: () => void;
  private _unsubscribePlayerDisconnected?: () => void;
  private _tickHandle?: ReturnType<typeof setInterval>;

  // Bookkeeping for countdown-danger-changed's edge/dwell detection (see
  // updated() below) — deliberately a plain field, not @state, since
  // writing it must never itself trigger another re-render.
  private _wasActive = false;

  // When the CURRENT reveal is allowed to be replaced by a queued-up
  // RoundStarted/GameOver — see _holdReveal, set the instant a
  // RoundScored is applied (REVEAL_HOLD_MS in the future). undefined
  // whenever there's no reveal currently showing (e.g. mid-round).
  private _revealHoldUntil?: number;
  // A RoundStarted/GameOver that arrived before _revealHoldUntil passed —
  // applied once the hold expires (see _holdReveal). At most one of
  // these is ever buffered at a time: the round that's ending has, by
  // construction, only one "next thing" (either the next round or the
  // game ending), never both.
  private _pendingAfterReveal?:
    | { kind: 'roundStarted'; session: GameSession }
    | {
        kind: 'gameOver';
        scores: Record<string, number>;
        playerA: string;
        playerB: string;
        reason: GameOverReason;
      };
  private _revealHoldTimeout?: ReturnType<typeof setTimeout>;

  connectedCallback() {
    super.connectedCallback();

    // Apply whatever RoundStarted session bg-room-setup.ts had already
    // captured for this game before this element even mounted — see
    // initialSession's own doc comment for why this is necessary rather
    // than just relying on the onRoundStarted subscription below. Must
    // run BEFORE that subscription starts, using the same
    // _applyRoundStarted logic a live event would, so this is exactly as
    // if that first RoundStarted had been received live.
    if (this.initialSession && this._isMySession(this.initialSession)) {
      this._applyRoundStarted(this.initialSession);
    }

    // Every game event is broadcast to the WHOLE room, not routed to just
    // the two players involved (see GameHub.fs's targeting doc comment —
    // same tradeoff as PlayRequestReceived) — a room can have more than
    // one game running concurrently (e.g. World chat), so every handler
    // below must filter to sessions/scores that actually name MY
    // opponent, exactly the way bg-room-setup.ts already filters
    // PlayRequestReceived/Accepted by player id.
    this._unsubscribeRoundStarted = onRoundStarted((session) => {
      if (!this._isMySession(session)) return;
      // If a reveal is still being held on screen (see _holdReveal),
      // this round hasn't actually been "seen" yet — queue it rather
      // than replacing the reveal early.
      if (this._revealHoldUntil !== undefined) {
        this._pendingAfterReveal = { kind: 'roundStarted', session };
        return;
      }
      this._applyRoundStarted(session);
    });
    this._unsubscribeRoundScored = onRoundScored((session) => {
      if (!this._isMySession(session)) return;
      this.session = session;
      this._recordRoundResult(session);
      this._resolveCurrentVerse();
      this._holdReveal();
    });
    this._unsubscribeGameOver = onGameOver(
      (scores, playerA, playerB, reason) => {
        if (!this._isMyGame(playerA, playerB)) return;
        // A Forfeited end (opponent left/disconnected) cuts through
        // immediately, even mid-hold — the game is already over for a
        // reason unrelated to this round's own reveal, so continuing to
        // show "+N points"/"Choked!" for a few more moments would be
        // actively misleading, not a nice-to-have pause. Only a normal
        // Completed ending respects the hold, so the FINAL round's own
        // reveal gets the same readable pause as every other round before
        // the results screen replaces it.
        if (
          reason.Case === 'Completed' &&
          this._revealHoldUntil !== undefined
        ) {
          this._pendingAfterReveal = {
            kind: 'gameOver',
            scores,
            playerA,
            playerB,
            reason,
          };
          return;
        }
        this._onGameOver(scores, playerA, playerB, reason);
      }
    );
    this._unsubscribePlayerDisconnected = onPlayerDisconnected((playerId) => {
      if (playerId === this.opponentId)
        this.opponentConnectionState = 'disconnected';
    });

    this._tickHandle = setInterval(() => {
      this._now = Date.now();
    }, COUNTDOWN_TICK_MS);
  }

  // Starts (or restarts) the reveal's minimum on-screen hold — see
  // REVEAL_HOLD_MS. Called the instant a RoundScored is applied, so the
  // reveal itself always appears immediately; only whatever comes AFTER
  // it (the next RoundStarted, or a Completed GameOver) is what actually
  // waits.
  private _holdReveal() {
    this._revealHoldUntil = Date.now() + REVEAL_HOLD_MS;
    if (this._revealHoldTimeout !== undefined)
      clearTimeout(this._revealHoldTimeout);
    this._revealHoldTimeout = setTimeout(() => {
      this._revealHoldUntil = undefined;
      this._revealHoldTimeout = undefined;
      const pending = this._pendingAfterReveal;
      this._pendingAfterReveal = undefined;
      if (!pending) return;
      if (pending.kind === 'roundStarted')
        this._applyRoundStarted(pending.session);
      else
        this._onGameOver(
          pending.scores,
          pending.playerA,
          pending.playerB,
          pending.reason
        );
    }, REVEAL_HOLD_MS);
  }

  disconnectedCallback() {
    this._unsubscribeRoundStarted?.();
    this._unsubscribeRoundScored?.();
    this._unsubscribeGameOver?.();
    this._unsubscribePlayerDisconnected?.();
    if (this._tickHandle !== undefined) clearInterval(this._tickHandle);
    if (this._revealHoldTimeout !== undefined)
      clearTimeout(this._revealHoldTimeout);
    // If this element unmounts (forfeit, opponent leaves, game-over)
    // while the blink was active, tell bg-app.ts it's over — otherwise
    // the class/property would linger on document.body forever, since
    // nothing else would ever fire the "leaving" edge for us.
    this._stopCountdownDanger();
    super.disconnectedCallback();
  }

  /** Fires the countdown-danger "leaving" edge, if the blink was running.
   * Needed in two places, not just disconnectedCallback: a Forfeited
   * GameOver ends the game MID-ROUND, with the countdown still live and
   * the round still InProgress (so _revealed is false and updated()
   * keeps reporting active:true) — and the results screen can be
   * showing before this element is actually unmounted, so waiting for
   * disconnectedCallback leaves the whole screen blinking over the
   * results. A Completed ending doesn't hit this (the round is already
   * Scored, so updated() reported active:false on its own), which is
   * exactly why the bug only ever showed up on forfeit. */
  private _stopCountdownDanger() {
    if (!this._wasActive) return;
    this._wasActive = false;
    this.dispatchEvent(
      new CustomEvent('countdown-danger-changed', {
        detail: { active: false },
        bubbles: true,
        composed: true,
      })
    );
  }

  // Reports the countdown-danger state to bg-app.ts (see that
  // component's _onCountdownDangerChanged, and index.css's
  // .countdown-danger/--countdown-danger-speed) every tick for the whole
  // 7-second window — not just on entry/exit — since the acceleration
  // value itself needs to keep reaching bg-app.ts throughout, not just
  // once at the start. Sends nothing once `active` returns to false and
  // stays there, so a finished game/round doesn't keep firing empty
  // events forever.
  protected updated() {
    const active = this._inFinalCountdown;
    if (!active && !this._wasActive) return;
    this.dispatchEvent(
      new CustomEvent('countdown-danger-changed', {
        detail: {
          active,
          animationSeconds: this._dangerAnimationSeconds,
          flashColor: this._dangerFlashColor,
          flashShape: this._dangerFlashShape,
        },
        bubbles: true,
        composed: true,
      })
    );
    this._wasActive = active;
  }

  // Applies a RoundStarted session — shared by connectedCallback's
  // initialSession catch-up and the live onRoundStarted subscription, so
  // both go through identical logic (see initialSession's doc comment).
  // Caller is responsible for the _isMySession filter check.
  private _applyRoundStarted(session: GameSession) {
    const isFirstRound = !this.session;
    this.session = session;
    this.myGuess = undefined;
    this._resolveCurrentVerse();
    // gameType is fixed for the whole game (see types.ts's GameSession),
    // so this only needs resolving once, on the first round.
    if (isFirstRound) this._resolveGuessFormRestriction(session.gameType);
  }

  // Whether `session`/`(playerA, playerB)` belongs to MY game with
  // opponentId — see the room-wide-broadcast filtering note in
  // connectedCallback above. Order-independent since either player could
  // be PlayerA or PlayerB depending on who was the challenger.
  private _isMySession(session: GameSession): boolean {
    return this._isMyGame(session.playerA, session.playerB);
  }

  private _isMyGame(playerA: string, playerB: string): boolean {
    const pair = new Set([playerA, playerB]);
    return pair.has(this.myPlayerId) && pair.has(this.opponentId);
  }

  // Appends this round's outcome (my points / opponent's points) to the
  // local history, mirroring bg-app.ts's `rounds` accumulation pattern —
  // the server itself has no round-history endpoint (see
  // backend/Domain/Game.fs's GameSession.GuessesThisRound doc comment),
  // so this is the only place that history is ever assembled.
  private _recordRoundResult(session: GameSession) {
    if (session.round.Case !== 'Scored') return;
    const [verse, results] = session.round.Fields;

    const pointsFor = (playerId: string) =>
      results.find((r) => r.playerId === playerId)?.pointsAwarded ?? 0;

    this.rounds = [
      ...this.rounds,
      {
        verse,
        myPoints: pointsFor(this.myPlayerId),
        opponentPoints: pointsFor(this.opponentId),
      },
    ];
  }

  private _onGameOver(
    scores: Record<string, number>,
    playerA: string,
    playerB: string,
    reason: GameOverReason
  ) {
    void playerA;
    void playerB;
    const myScore = scores[this.myPlayerId] ?? 0;
    const opponentScore = scores[this.opponentId] ?? 0;

    const detail: MultiplayerGameOverDetail = {
      myPlayerName: this.myPlayerName,
      opponentName: this.opponentName,
      myScore,
      opponentScore,
      reason:
        reason.Case === 'Completed'
          ? { kind: 'completed' }
          : {
              kind: 'forfeited',
              winnerIsMe:
                reason.Fields[0] === undefined
                  ? undefined
                  : reason.Fields[0] === this.myPlayerId,
            },
      rounds: this.rounds,
    };

    // Before handing off to the results screen — see
    // _stopCountdownDanger's doc comment on why a Forfeited ending needs
    // this explicitly rather than relying on disconnectedCallback.
    this._stopCountdownDanger();

    this.dispatchEvent(
      new CustomEvent<MultiplayerGameOverDetail>('game-over', {
        detail,
        bubbles: true,
        composed: true,
      })
    );
  }

  // The current round's bare reference (book/chapter/verseNumber only —
  // see the class doc comment) as sent by the server. `resolvedVerse` is
  // what actually has text to display, resolved from this against
  // `verseSource` — see _resolveCurrentVerse.
  private get _currentReference(): VerseReference | undefined {
    if (!this.session) return undefined;
    return this.session.round.Case === 'InProgress' ||
      this.session.round.Case === 'Scored'
      ? this.session.round.Fields[0]
      : undefined;
  }

  // Resolves _currentReference to a displayable Verse against THIS
  // player's own verseSource — never the server, and never anything sent
  // by the opponent (see the class doc comment). Called after every
  // RoundStarted/RoundScored, since each carries a new/updated reference.
  private _resolveCurrentVerse() {
    const reference = this._currentReference;
    this.resolvedVerse = undefined;
    this.verseResolutionError = undefined;

    if (!reference || !this.verseSource) return;

    // Guard against a stale response landing after a later round has
    // already started (e.g. a slow lookup for round 1 resolving after
    // round 2's reference already replaced it) — only apply the result if
    // the reference it was resolved for is still the current one.
    const requestedFor = reference;

    this.verseSource
      .lookupVerse(reference, this.translation)
      .then((verse) => {
        if (this._currentReference !== requestedFor) return;
        this.resolvedVerse = verse;
      })
      .catch((err) => {
        if (this._currentReference !== requestedFor) return;
        console.error(
          '[bg-multiplayer-game] failed to resolve verse reference',
          err
        );
        this.verseResolutionError =
          err instanceof Error
            ? err.message
            : "This verse isn't available in your chosen translation/file.";
      });
  }

  // Resolves the guess form's book/chapter restriction from `gameType`
  // (which carries book NUMBERS — see types.ts's GameType doc comment)
  // against MY OWN verseSource, so the guess form shows MY OWN spelling
  // for whatever books/chapters the challenger restricted the game to —
  // see game-type.ts's allowedBooksForGuessForm/lockedBookForGuessForm.
  private _resolveGuessFormRestriction(gameType: GameType) {
    if (!this.verseSource) return;
    const verseSource = this.verseSource;

    Promise.all([
      allowedBooksForGuessForm(gameType, verseSource, this.translation),
      lockedBookForGuessForm(gameType, verseSource, this.translation),
    ]).then(([allowedBooks, lockedBook]) => {
      this.guessFormRestriction = {
        allowedBooks,
        lockedBook,
        allowedChapters: allowedChaptersForGuessForm(gameType),
      };
    });
  }

  private get _revealed() {
    return this.session?.round.Case === 'Scored';
  }

  private get _deadline(): string | undefined {
    if (!this.session) return undefined;
    return deadlineOf(this.session.roundStartedAt, this.session.roundTimeLimit);
  }

  // A round whose own time limit is too short for "final 7 seconds" to
  // mean anything (the whole round IS the final 7 seconds, or shorter) —
  // see _inFinalCountdown below, which skips the blink entirely for it,
  // rather than have it start blinking the instant the round begins,
  // every round. `Unlimited` rounds already never enter the danger
  // window at all (computeRemainingSeconds returns undefined for them),
  // so this only matters for a short LimitedTo value.
  private get _roundTimeLimitSeconds(): number | undefined {
    if (!this.session || this.session.roundTimeLimit.Case !== 'LimitedTo')
      return undefined;
    return parseTimeSpanMs(this.session.roundTimeLimit.Fields[0]) / 1000;
  }

  // See docs/SCRUM/Featire.ScoreDuringMultiplayerGame.md — the final 7
  // seconds of a round's countdown should blink the whole screen (see
  // updated() below, which turns this into a countdown-danger-changed
  // custom event bg-app.ts listens for). `_revealed` folded in directly
  // (not left to a separate cleanup step) so a round that resolves
  // exactly inside this window can't leave the blink stuck on — a scored
  // round has no countdown to be urgent about.
  private get _inFinalCountdown(): boolean {
    const limitSeconds = this._roundTimeLimitSeconds;
    if (
      limitSeconds !== undefined &&
      limitSeconds <= MIN_BLINKABLE_ROUND_SECONDS
    )
      return false;
    const remaining = computeRemainingSeconds(this._deadline, this._now);
    return (
      remaining !== undefined &&
      remaining > 0 &&
      remaining <= 7 &&
      !this._revealed
    );
  }

  // "Increasing intensity" = the flash genuinely accelerates, not a
  // single step-change — this is the animation-cycle duration in
  // seconds, recomputed every 250ms tick alongside the countdown number
  // itself, and pushed out via a CSS custom property (--countdown-danger-speed,
  // set by bg-app.ts — see index.css) rather than driven by a continuous
  // JS animation loop or a CSS-only step-function.
  private get _dangerAnimationSeconds(): number | undefined {
    const limitSeconds = this._roundTimeLimitSeconds;
    if (
      limitSeconds !== undefined &&
      limitSeconds <= MIN_BLINKABLE_ROUND_SECONDS
    )
      return undefined;
    const remaining = computeRemainingSeconds(this._deadline, this._now);
    if (
      remaining === undefined ||
      remaining <= 0 ||
      remaining > 7 ||
      this._revealed
    )
      return undefined;
    // 7s remaining -> BLINK_CYCLE_SLOWEST_SECONDS (1 flash/sec). 0s
    // remaining -> whichever "fastest" the player's own local "Enter
    // epilepsy-inducing stress mode" checkbox selects
    // (challenge-settings.ts, flash-intensity-storage.ts).
    //
    // The ramp itself is exponential, not linear: most of the 7-second
    // window barely accelerates, then it compounds sharply in roughly
    // the last second or two. `growth ** progress` (growth=12, exponent
    // = progress) IS the exponential term — that's b^x, the textbook
    // definition. It isn't used raw because b^x at progress=0 equals 1,
    // not 0, so subtracting 1 and dividing by (growth - 1) is just an
    // affine rescale of that same curve's output down to exactly [0, 1]
    // (compare growth**0.5=3.46 vs the rescaled 0.5 -> 0.224 — same
    // shape, different vertical scale) so it can drive the slowest..fastest
    // interpolation below cleanly. The rescale changes no curvature, only
    // the range — it's still exponential, not polynomial/eased.
    const slowest = BLINK_CYCLE_SLOWEST_SECONDS;
    const fastest = loadEpilepsyStressModeEnabled()
      ? BLINK_CYCLE_FASTEST_SECONDS_STRESS
      : BLINK_CYCLE_FASTEST_SECONDS_SAFE;
    const growth = BLINK_RAMP_GROWTH;
    const progress = 1 - remaining / 7;
    const eased = (growth ** progress - 1) / (growth - 1);
    return Math.round((slowest - (slowest - fastest) * eased) * 100) / 100;
  }

  // Which COUNTDOWN_DANGER_COLORS entry is "live" right now — pinned to
  // the actual whole second being crossed (7s remaining -> index 0, 0s
  // remaining -> index 7), not to a position in an independent animation
  // loop. Math.ceil (not Math.floor/round) so the flash for "Ns left"
  // starts the instant N.999...->N.000 is crossed, matching how the
  // visible countdown number itself changes (see _renderCountdown's use
  // of the same remaining value) — Math.floor would instead switch a
  // full second earlier than the number does.
  private get _dangerFlashColor(): string | undefined {
    const limitSeconds = this._roundTimeLimitSeconds;
    if (
      limitSeconds !== undefined &&
      limitSeconds <= MIN_BLINKABLE_ROUND_SECONDS
    )
      return undefined;
    const remaining = computeRemainingSeconds(this._deadline, this._now);
    if (
      remaining === undefined ||
      remaining <= 0 ||
      remaining > 7 ||
      this._revealed
    )
      return undefined;
    const secondsLeft = Math.min(7, Math.ceil(remaining));
    return COUNTDOWN_DANGER_COLORS[7 - secondsLeft];
  }

  // Which of index.css's 4 countdown-blink-* keyframe blocks is "live"
  // right now — each is a fixed shape with a different on-duration
  // percentage (15% down to 4%), and this picks between them via
  // animation-name (see --countdown-danger-blink-name, set by
  // bg-app.ts). This exists because a single keyframe block CANNOT have
  // its own on/off percentages driven by a CSS custom property at all —
  // keyframe offsets (the "1%"/"15%" selectors) are read at parse time,
  // never re-evaluated from var() (confirmed directly: a --steps custom
  // property plugged into steps(var(--steps)) DOES resolve correctly,
  // proving animation-name/timing-function values genuinely can use
  // var() — but keyframe OFFSETS specifically cannot, which is the actual
  // fixed point this getter works around). Without this, a fixed 14-point
  // on-window (the previous single-keyframe design) shrinks in absolute
  // time at exactly the same rate as the cycle itself, so the flash never
  // gets proportionally SHARPER as danger increases — every cycle looks
  // like "same shape, just faster", which read as merely annoying rather
  // than escalating/stressful. Discretizing into a few named tiers gets
  // most of the real effect (the flash visibly gets punchier as the
  // round runs out) without needing a genuinely continuous percentage,
  // which CSS's static keyframe offsets don't allow at all.
  private get _dangerFlashShape(): string | undefined {
    const limitSeconds = this._roundTimeLimitSeconds;
    if (
      limitSeconds !== undefined &&
      limitSeconds <= MIN_BLINKABLE_ROUND_SECONDS
    )
      return undefined;
    const remaining = computeRemainingSeconds(this._deadline, this._now);
    if (
      remaining === undefined ||
      remaining <= 0 ||
      remaining > 7 ||
      this._revealed
    )
      return undefined;
    if (remaining > 5) return 'countdown-blink-wide';
    if (remaining > 3) return 'countdown-blink-medium';
    if (remaining > 1) return 'countdown-blink-narrow';
    return 'countdown-blink-sharp';
  }

  render() {
    // The header (scoreboard/countdown) renders unconditionally, even
    // before the first RoundStarted has landed — the score is trivially
    // 0-0 at that point, but the spec asks for the score to be visible
    // "throughout the game", and this component only mounts once a game
    // has actually started (see bg-room-setup.ts's activeGameOpponent),
    // so this loading window IS part of "the game" from the player's
    // perspective. Only the round-specific body (verse/guess form/reveal)
    // needs session data to render anything meaningful.
    const myScore = this.session?.scores[this.myPlayerId] ?? 0;
    const opponentScore = this.session
      ? (this.session.scores[this.opponentId] ?? 0)
      : 0;

    return html`
      <header class="mp-header">
        <div class="scoreboard">
          <span class="me">${this.myPlayerName}: ${myScore}</span>
          ${this.session
            ? html`
                <span class="round-label">
                  Round ${this.session.roundIndex + 1} /
                  ${this.session.roundCount}
                </span>
              `
            : null}
          <span class="opponent ${this.opponentConnectionState}">
            ${this.opponentName}: ${opponentScore}
          </span>
        </div>
        ${this._renderCountdown()}
      </header>

      ${this.opponentConnectionState === 'disconnected'
        ? html`
            <div class="opponent-status" role="status">
              <strong>${this.opponentName}'s connection dropped.</strong>
              Waiting to see if they reconnect — the game will end automatically
              if they don't come back.
            </div>
          `
        : null}
      ${this.session
        ? this._renderRoundBody()
        : html`
            <p class="loading">Waiting for the first verse…</p>
          `}

      <button type="button" class="secondary" @click=${this._openForfeitDialog}>
        Forfeit
      </button>
      ${this.forfeitDialogOpen ? this._renderForfeitDialog() : null}
    `;
  }

  // The verse card + guess-form/locked-in/reveal area — split out of
  // render() because a failed verse resolution replaces this WHOLE block
  // with an error message rather than just hiding the verse text: showing
  // a guessable form for a round I can't even see the verse of would be
  // actively misleading (this is the fix for the real bug where a player
  // with a translation/file mismatch saw the guess form fully interactive
  // next to an unrelated error banner). The round still resolves normally
  // via the opponent's guess or the timer even when I can't participate.
  private _renderRoundBody() {
    if (this.verseResolutionError) {
      return html`
        <p class="verse-error">
          ${this.verseResolutionError} You can't guess this round, but it'll
          still resolve once ${this.opponentName}
          guesses${this._deadline ? ' or the timer runs out' : ''}.
        </p>
      `;
    }

    return html`
      <bg-verse-card
        .verse=${this.resolvedVerse}
        .revealed=${this._revealed}
      ></bg-verse-card>

      ${this._revealed
        ? this._renderRoundReveal()
        : this.myGuess
          ? html`
              <p class="locked-in">
                Guess locked in — waiting for ${this.opponentName}…
              </p>
            `
          : html`
              <bg-guess-form
                .disabled=${!this.resolvedVerse}
                .translation=${this.translation}
                .verseSource=${this.verseSource}
                .allowedBooks=${this.guessFormRestriction.allowedBooks}
                .lockedBook=${this.guessFormRestriction.lockedBook}
                .allowedChapters=${this.guessFormRestriction.allowedChapters}
                @guess-submitted=${this._onGuessSubmitted}
              ></bg-guess-form>
            `}
    `;
  }

  private _renderCountdown() {
    const remaining = computeRemainingSeconds(this._deadline, this._now);
    if (remaining === undefined)
      return html`
        <span class="timer timer-infinite" title="No time limit">∞</span>
      `;
    return html`
      <span class="timer ${remaining <= 5 ? 'urgent' : ''}">${remaining}s</span>
    `;
  }

  private _renderRoundReveal() {
    if (this.session?.round.Case !== 'Scored') return null;
    const [, results] = this.session.round.Fields;
    const myResult = results.find((r) => r.playerId === this.myPlayerId);
    const opponentResult = results.find((r) => r.playerId === this.opponentId);

    return html`
      <div class="reveal">
        <p class="reveal-line">
          You: ${myResult ? `+${myResult.pointsAwarded} points` : 'Choked!'}
        </p>
        <p class="reveal-line">
          ${this.opponentName}:
          ${opponentResult
            ? `+${opponentResult.pointsAwarded} points`
            : 'Choked!'}
        </p>
      </div>
    `;
  }

  // Resolves MY OWN book number for the guessed book (see
  // game-type.ts's bookNumberOfGuess) before submitting — this is what
  // lets the server score the guess by number instead of name (see
  // Guess.bookNumber's doc comment), fixing the bug where a correct
  // guess against a differently-spelled book would score as wrong.
  private _onGuessSubmitted(event: CustomEvent<Guess>) {
    this.myGuess = event.detail;

    const resolveBookNumber = this.verseSource
      ? bookNumberOfGuess(event.detail.book, this.verseSource, this.translation)
      : Promise.resolve(undefined);

    resolveBookNumber
      .then((bookNumber) => submitGuess({ ...event.detail, bookNumber }))
      .catch((err) => {
        console.error('[bg-multiplayer-game] failed to submit guess', err);
      });
  }

  private _renderForfeitDialog() {
    return html`
      <div class="dialog-backdrop" @click=${this._onDialogBackdropClick}>
        <section
          class="forfeit-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="forfeit-title"
          aria-describedby="forfeit-description"
          @click=${(event: Event) => event.stopPropagation()}
          @keydown=${this._onForfeitDialogKeydown}
        >
          <h2 id="forfeit-title">Forfeit game?</h2>
          <p id="forfeit-description">
            Leave your game with ${this.opponentName}? This will end the game
            for you.
          </p>
          ${this.forfeitError
            ? html`
                <p class="forfeit-error" role="alert">${this.forfeitError}</p>
              `
            : null}
          <div class="dialog-actions">
            <button
              type="button"
              class="secondary"
              data-forfeit-cancel
              @click=${this._closeForfeitDialog}
              ?disabled=${this.forfeiting}
            >
              Cancel
            </button>
            <button
              type="button"
              class="danger"
              @click=${this._confirmForfeit}
              ?disabled=${this.forfeiting}
            >
              ${this.forfeiting ? 'Forfeiting…' : 'Forfeit'}
            </button>
          </div>
        </section>
      </div>
    `;
  }

  private async _openForfeitDialog(event: Event) {
    this.forfeitTrigger = event.currentTarget as HTMLButtonElement;
    this.forfeitError = undefined;
    this.forfeitDialogOpen = true;
    await this.updateComplete;
    this.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-forfeit-cancel]')
      ?.focus();
  }

  private _closeForfeitDialog() {
    if (this.forfeiting) return;

    const trigger = this.forfeitTrigger;
    this.forfeitDialogOpen = false;
    this.forfeitError = undefined;
    this.forfeitTrigger = undefined;
    if (trigger?.isConnected) trigger.focus();
  }

  private _onDialogBackdropClick(event: Event) {
    if (event.target === event.currentTarget) this._closeForfeitDialog();
  }

  private _onForfeitDialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this._closeForfeitDialog();
      return;
    }

    if (event.key !== 'Tab') return;

    const dialog = event.currentTarget as HTMLElement;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = (dialog.getRootNode() as ShadowRoot).activeElement;
    if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // Calls the server to forfeit — deliberately does NOT fire game-ended
  // itself. The server's GameOver broadcast (see onGameOver above) reaches
  // both players, me included, the same way a normal completion does, so
  // my own results screen appears via that one shared path rather than a
  // separate local teardown racing the server round-trip.
  private _confirmForfeit() {
    this.forfeiting = true;
    this.forfeitError = undefined;
    forfeitGame().catch((err) => {
      console.error('[bg-multiplayer-game] failed to forfeit game', err);
      this.forfeiting = false;
      this.forfeitError = 'Forfeiting the game failed. Please try again.';
    });
  }

  static styles = css`
    :host {
      display: block;
    }

    .loading {
      opacity: 0.7;
    }

    .mp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .scoreboard {
      display: flex;
      gap: 1rem;
      font-size: 0.9rem;
      font-weight: 600;
    }

    .opponent.disconnected {
      opacity: 0.6;
      text-decoration: line-through;
    }

    .round-label {
      opacity: 0.7;
      font-weight: 400;
    }

    .timer {
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      font-size: 1.1rem;
      opacity: 0.8;
    }

    .timer.urgent {
      color: #d33;
    }

    .timer-infinite {
      opacity: 0.5;
    }

    .opponent-status {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      font-size: 0.9rem;
      color: #922;
      background: rgba(221, 51, 51, 0.1);
      border: 1px solid rgba(221, 51, 51, 0.35);
      border-radius: 8px;
      padding: 0.65rem 0.85rem;
      margin: 0 0 0.75rem;
    }

    .opponent-status strong {
      font-size: 0.95rem;
    }

    .verse-error {
      padding: 2rem;
      border-radius: 12px;
      background: rgba(221, 51, 51, 0.08);
      color: #d33;
      font-size: 0.9rem;
    }

    .locked-in {
      margin: 1rem 0;
      opacity: 0.8;
    }

    .reveal {
      margin: 1rem 0;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      background: rgba(170, 59, 255, 0.08);
    }

    .reveal-line {
      margin: 0.2rem 0;
      font-weight: 600;
    }

    button.secondary {
      margin-top: 1rem;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: 1px solid #d33;
      background: transparent;
      color: #d33;
      font-size: 0.85rem;
      cursor: pointer;
    }

    .dialog-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10;
      display: grid;
      place-items: center;
      padding: 1rem;
      background: rgba(0, 0, 0, 0.45);
    }

    .forfeit-dialog {
      width: min(24rem, 100%);
      padding: 1.25rem;
      border-radius: 12px;
      background: white;
      color: #201a24;
      box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.25);
    }

    .forfeit-dialog h2 {
      margin: 0;
      font-size: 1.1rem;
    }

    .forfeit-dialog p {
      margin: 0.75rem 0 1rem;
    }

    .forfeit-error {
      color: #b42318;
      font-weight: 600;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.6rem;
    }

    .dialog-actions button {
      margin-top: 0;
    }

    .dialog-actions .danger {
      padding: 0.5rem 1rem;
      border: 1px solid #b42318;
      border-radius: 8px;
      background: #b42318;
      color: white;
      cursor: pointer;
    }

    @media (prefers-color-scheme: dark) {
      .forfeit-dialog {
        background: #1f1b24;
        color: #f5f3f7;
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'bg-multiplayer-game': MultiplayerGame
  }
}
