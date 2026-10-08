/**
 * The spectator board's shareable address — `#/watch/<room code>` — see
 * docs/web/congregation. A hash route, so it needs nothing from the web
 * server: whoever opens the link loads the app as usual and the app reads
 * the room code from the hash.
 */

const WATCH_ROUTE = /^#\/watch\/([A-Za-z0-9]{1,16})\/?$/
const WATCH_PREFIX = '#/watch/'

/** The room code a `location.hash` asks to watch, if it is a watch link. */
export function parseWatchRoute(hash: string): string | undefined {
  return WATCH_ROUTE.exec(hash)?.[1]
}

/** The link that opens the spectator board for `roomCode`, on the site at
 * `siteUrl` (see shared-ui/share-or-copy.ts's gameUrl). */
export function watchUrlFor(siteUrl: string, roomCode: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/${WATCH_PREFIX}${encodeURIComponent(roomCode)}`
}
