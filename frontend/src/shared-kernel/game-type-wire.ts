// The game-type wire format shared with the backend. Part of the shared
// kernel because it crosses the client/server boundary: each game type
// (see ../game-types) owns the meaning of its own case, but the shape
// itself is a contract both sides must agree on.

/**
 * Which verses a challenged game will draw from — chosen by the challenger
 * before sending the request, so the challenged player can see what
 * they're being invited to. See docs/SCRUM/Feature.RequestToStartMPGame.md
 * and backend/Domain/GameTypes/GameType.fs, which this mirrors.
 *
 * Books/Chapters are keyed by book NUMBER (see book-numbers.ts), not
 * name — the challenger picks books from their OWN VerseSource in
 * its game type's toWire (see ../game-types/registry.ts — it resolves each
 * picked name to a number via their own getBooksInBibleOrder), and the server
 * matches those numbers against its own pool's own numbering (see
 * backend's Verse.matchesRestrictionByNumber) rather than by name, so a
 * challenger's "Dommer" and the server's "Dommerne" — the same book,
 * spelled differently — still match correctly.
 */
export type GameType =
  | { Case: 'AllVerses' }
  | { Case: 'Books'; Fields: [number[]] }
  | { Case: 'Chapters'; Fields: [Record<number, number[]>] }

