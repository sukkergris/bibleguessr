import type { BuildInfo } from '../api'

/** /api/build-info, as the nerd panel's "API image" section shows it. */
export type BuildInfoState =
  | { kind: 'loading' }
  | { kind: 'loaded'; info: BuildInfo }
  | { kind: 'failed'; reason: string }

/** A value the API wasn't given — e.g. the commit when it runs outside
 * an image (`task dotnet:dev`). */
export const NOT_SET = 'Not set'
export const LOADING = 'Loading…'
export const UNAVAILABLE = 'Unavailable'

/** The text one row of the section shows for `field`. */
export function buildInfoText(state: BuildInfoState, field: keyof BuildInfo): string {
  switch (state.kind) {
    case 'loading':
      return LOADING
    case 'failed':
      return UNAVAILABLE
    case 'loaded':
      return state.info[field] ?? NOT_SET
  }
}
