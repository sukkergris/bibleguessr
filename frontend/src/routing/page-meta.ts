/**
 * What each address tells browsers and search engines about itself — the
 * page title, description, and whether it belongs in search results — see
 * docs/web/seo.
 */

import { GAME_TYPE_IDS, hintOf, nameOf } from '../game-types/registry'
import { HOME, urlOf, type Route } from './routes'

const SITE_NAME = 'BibleGuessr'

export interface PageMeta {
  title: string
  description: string
  /** Whether search engines may list the page. A room's pages exist only
   * as long as the room, so they are kept out. */
  indexable: boolean
}

const SITE_DESCRIPTION =
  'Guess where a Bible verse comes from: the book, the chapter and the verse. Play alone, live with friends, or take the daily quiz.'

/** Every page search engines should know about, in the order the sitemap
 * lists them: each address that doesn't name a room. */
export const INDEXABLE_ROUTES: readonly Route[] = [
  HOME,
  ...GAME_TYPE_IDS.map((gameType): Route => ({ kind: 'singleplayer', gameType })),
  { kind: 'multiplayer' },
  { kind: 'social' },
  { kind: 'daily-quiz' },
]

const titled = (screen: string) => `${screen} — ${SITE_NAME}`

export function pageMetaOf(route: Route): PageMeta {
  switch (route.kind) {
    case 'home':
      return { title: SITE_NAME, description: SITE_DESCRIPTION, indexable: true }
    case 'singleplayer':
      return {
        title: titled(nameOf(route.gameType)),
        description: `Play ${nameOf(route.gameType)} in ${SITE_NAME}, on your own: ${hintOf(route.gameType)}. Guess the book, chapter and verse of each Bible verse.`,
        indexable: true,
      }
    case 'multiplayer':
      return route.roomCode === undefined
        ? {
            title: titled('Multiplayer'),
            description:
              'Guess Bible verses live with friends: create a room, share its code, and play one-on-one or as a whole group.',
            indexable: true,
          }
        : { title: titled(`Room ${route.roomCode}`), description: SITE_DESCRIPTION, indexable: false }
    case 'social':
      return {
        title: titled('Social'),
        description: `Play ${SITE_NAME} with everyone else, starting with the daily quiz: the same five Bible verses for everyone, new every day.`,
        indexable: true,
      }
    case 'daily-quiz':
      return {
        title: titled('Daily quiz'),
        description:
          "Today's daily Bible quiz: five verses, the same for everyone. Guess the book, chapter and verse of each, then share your result.",
        indexable: true,
      }
    case 'watch':
      return {
        title: titled(`Leaderboard for room ${route.roomCode}`),
        description: SITE_DESCRIPTION,
        indexable: false,
      }
  }
}

/** The address search engines should treat as the page's own — always on
 * the public site (`siteUrl`, from the site configuration — see
 * docs/web/site-config), so a copy served from any other host points
 * there. */
export function canonicalUrlOf(route: Route, siteUrl: string): string {
  return urlOf(route, siteUrl)
}
