import type { VerseSource } from '../shared-kernel/bible'

// What the bible-sources layer needs from the server, handed in by whoever
// hosts it (the app shell, or Social through it) — this layer never
// imports the app's own API client, so any area can use it (see
// src/architecture.test.ts). api.ts satisfies both parts.

/** A problem report about a Bible file that couldn't be used. */
export interface BibleFileReport {
  description: string
  fileName?: string
  errorMessage: string
}

export type SubmitBibleFileReport = (report: BibleFileReport) => Promise<unknown>

export interface ServerAccess {
  /** The server's own translations, as a VerseSource. */
  serverSource: VerseSource
  submitBibleFileReport: SubmitBibleFileReport
}
