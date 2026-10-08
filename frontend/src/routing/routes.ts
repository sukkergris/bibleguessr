/**
 * The app's addresses: one path per screen a link can lead to — see
 * docs/web/url-routing. The one place that turns a path into a screen and
 * back, so a shared link, the address bar and the Back button all agree.
 *
 * Real paths, not `#` fragments: the web server must answer every path it
 * doesn't know with index.html (Vite's dev server does; for nginx see
 * docs/web/url-routing).
 */

import { GAME_TYPE_IDS, type GameTypeId } from '../game-types/registry'

export type Route =
  | { kind: 'home' }
  /** A singleplayer game type's setup screen. */
  | { kind: 'singleplayer'; gameType: GameTypeId }
  /** Create or join a room — with a room code, the join screen with that
   * code filled in, and the address while you're in that room. */
  | { kind: 'multiplayer'; roomCode?: string }
  | { kind: 'social' }
  | { kind: 'daily-quiz' }
  /** A room's Congregation spectator board — see docs/web/congregation. */
  | { kind: 'watch'; roomCode: string }
  | { kind: 'about' }

export const HOME: Route = { kind: 'home' }

const PLAY = 'play'
const MULTIPLAYER = 'multiplayer'
const SOCIAL = 'social'
const DAILY_QUIZ = 'daily-quiz'
const WATCH = 'watch'
const ABOUT = 'about'

/** A room code as it may appear in an address: rooms use four digits
 * today, so this only has to keep out anything that isn't a plain code. */
const ROOM_CODE = /^[A-Za-z0-9]{1,16}$/

const isGameTypeId = (segment: string): segment is GameTypeId => (GAME_TYPE_IDS as readonly string[]).includes(segment)

function segmentsOf(pathname: string): string[] | undefined {
  try {
    return pathname
      .split('/')
      .filter((segment) => segment !== '')
      .map(decodeURIComponent)
  } catch {
    // A malformed escape, e.g. a truncated "%E0%A4%A".
    return undefined
  }
}

/** The screen `pathname` leads to, or undefined for a path the app
 * doesn't know. */
export function routeFromPath(pathname: string): Route | undefined {
  const segments = segmentsOf(pathname)
  if (!segments) return undefined
  const [first, second, ...rest] = segments
  if (rest.length > 0) return undefined

  switch (first) {
    case undefined:
      return HOME
    case PLAY:
      return second !== undefined && isGameTypeId(second) ? { kind: 'singleplayer', gameType: second } : undefined
    case MULTIPLAYER:
      if (second === undefined) return { kind: 'multiplayer' }
      return ROOM_CODE.test(second) ? { kind: 'multiplayer', roomCode: second } : undefined
    case SOCIAL:
      if (second === undefined) return { kind: 'social' }
      return second === DAILY_QUIZ ? { kind: 'daily-quiz' } : undefined
    case WATCH:
      return second !== undefined && ROOM_CODE.test(second) ? { kind: 'watch', roomCode: second } : undefined
    case ABOUT:
      return second === undefined ? { kind: 'about' } : undefined
    default:
      return undefined
  }
}

/** The path that leads to `route` — the inverse of routeFromPath. */
export function pathOf(route: Route): string {
  switch (route.kind) {
    case 'home':
      return '/'
    case 'singleplayer':
      return `/${PLAY}/${route.gameType}`
    case 'multiplayer':
      return route.roomCode === undefined
        ? `/${MULTIPLAYER}`
        : `/${MULTIPLAYER}/${encodeURIComponent(route.roomCode)}`
    case 'social':
      return `/${SOCIAL}`
    case 'daily-quiz':
      return `/${SOCIAL}/${DAILY_QUIZ}`
    case 'watch':
      return `/${WATCH}/${encodeURIComponent(route.roomCode)}`
    case 'about':
      return `/${ABOUT}`
  }
}

/** The full link to `route` on the site at `origin` (e.g.
 * window.location.origin) — what a shared result or invite points at. */
export function urlOf(route: Route, origin: string): string {
  return `${origin.replace(/\/+$/, '')}${pathOf(route)}`
}
