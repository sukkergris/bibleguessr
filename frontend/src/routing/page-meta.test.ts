import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { INDEXABLE_ROUTES, SITE_URL, canonicalUrlOf, pageMetaOf } from './page-meta'
import { HOME, pathOf, routeFromPath, type Route } from './routes'

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const readFrontendFile = (path: string) => readFileSync(join(FRONTEND_DIR, path), 'utf-8')

/** Search engines cut descriptions off at roughly this length. */
const MAX_DESCRIPTION_LENGTH = 160

describe('page metadata', () => {
  it.each<[Route, string]>([
    [{ kind: 'home' }, 'BibleGuessr'],
    [{ kind: 'singleplayer', gameType: 'books' }, 'Books — BibleGuessr'],
    [{ kind: 'multiplayer' }, 'Multiplayer — BibleGuessr'],
    [{ kind: 'multiplayer', roomCode: '4821' }, 'Room 4821 — BibleGuessr'],
    [{ kind: 'social' }, 'Social — BibleGuessr'],
    [{ kind: 'daily-quiz' }, 'Daily quiz — BibleGuessr'],
    [{ kind: 'watch', roomCode: '4821' }, 'Leaderboard for room 4821 — BibleGuessr'],
  ])('titles %j as %s', (route, title) => {
    expect(pageMetaOf(route).title).toBe(title)
  })

  it('gives every page it lists a description of its own, short enough to show in full', () => {
    const descriptions = INDEXABLE_ROUTES.map((route) => pageMetaOf(route).description)

    for (const description of descriptions) {
      expect(description.length).toBeGreaterThan(0)
      expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH)
    }
    expect(new Set(descriptions).size).toBe(descriptions.length)
  })

  it('keeps per-room pages out of search results', () => {
    expect(pageMetaOf({ kind: 'multiplayer', roomCode: '4821' }).indexable).toBe(false)
    expect(pageMetaOf({ kind: 'watch', roomCode: '4821' }).indexable).toBe(false)
  })

  it('lists every page without a room code, each indexable and reachable at its own address', () => {
    expect(INDEXABLE_ROUTES.map(pathOf)).toEqual([
      '/',
      '/play/the-bible',
      '/play/books',
      '/play/chapters',
      '/multiplayer',
      '/social',
      '/social/daily-quiz',
    ])
    for (const route of INDEXABLE_ROUTES) {
      expect(pageMetaOf(route).indexable).toBe(true)
      expect(routeFromPath(pathOf(route))).toEqual(route)
    }
  })

  it('points canonical links at the public site', () => {
    expect(canonicalUrlOf({ kind: 'daily-quiz' })).toBe('https://bibleguessr.uk/social/daily-quiz')
    expect(canonicalUrlOf(HOME)).toBe('https://bibleguessr.uk/')
  })
})

// The static files search engines read can't import SITE_URL or the list
// of pages, so these keep them in step with the code.
describe('files for search engines', () => {
  it('sitemap.xml lists exactly the indexable pages', () => {
    const sitemap = readFrontendFile('public/sitemap.xml')
    const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])

    expect(listed).toEqual(INDEXABLE_ROUTES.map(canonicalUrlOf))
  })

  it('robots.txt points at the sitemap on the public site', () => {
    expect(readFrontendFile('public/robots.txt')).toMatch(new RegExp(`^Sitemap: ${SITE_URL}/sitemap\\.xml$`, 'm'))
  })

  it("index.html describes the front page, for readers that don't run the app", () => {
    const html = readFrontendFile('index.html')
    const description = pageMetaOf(HOME).description

    expect(html).toContain(`<meta name="description" content="${description}" />`)
    expect(html).toContain(`<meta property="og:description" content="${description}" />`)
  })
})
