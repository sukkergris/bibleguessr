import { describe, expect, it } from 'vitest'
import { HOME, pathOf, routeFromPath, titleOf, urlOf, type Route } from './routes'

describe('routes', () => {
  it.each<[string, Route]>([
    ['/', { kind: 'home' }],
    ['/play/the-bible', { kind: 'singleplayer', gameType: 'the-bible' }],
    ['/play/books', { kind: 'singleplayer', gameType: 'books' }],
    ['/play/chapters', { kind: 'singleplayer', gameType: 'chapters' }],
    ['/multiplayer', { kind: 'multiplayer' }],
    ['/multiplayer/4821', { kind: 'multiplayer', roomCode: '4821' }],
    ['/social', { kind: 'social' }],
    ['/social/daily-quiz', { kind: 'daily-quiz' }],
    ['/watch/4821', { kind: 'watch', roomCode: '4821' }],
  ])('reads %s', (path, route) => {
    expect(routeFromPath(path)).toEqual(route)
    // …and every route writes back to the same path.
    expect(pathOf(route)).toBe(path)
  })

  it.each(['/social/', '//social', '/social//'])('ignores stray slashes in %s', (path) => {
    expect(routeFromPath(path)).toEqual({ kind: 'social' })
  })

  it.each([
    '/nowhere',
    '/play',
    '/play/genesis',
    '/play/books/extra',
    '/multiplayer/12 34',
    '/multiplayer/4821/extra',
    '/social/weekly-quiz',
    '/watch',
    '/watch/%E0%A4%A',
    '/Social',
  ])('does not recognize %s', (path) => {
    expect(routeFromPath(path)).toBeUndefined()
  })

  it('builds an absolute link on any origin', () => {
    expect(urlOf({ kind: 'daily-quiz' }, 'https://bibleguessr.example')).toBe(
      'https://bibleguessr.example/social/daily-quiz',
    )
    expect(urlOf(HOME, 'http://localhost:5173/')).toBe('http://localhost:5173/')
  })

  it.each<[Route, string]>([
    [{ kind: 'home' }, 'BibleGuessr'],
    [{ kind: 'singleplayer', gameType: 'books' }, 'Books — BibleGuessr'],
    [{ kind: 'multiplayer' }, 'Multiplayer — BibleGuessr'],
    [{ kind: 'multiplayer', roomCode: '4821' }, 'Room 4821 — BibleGuessr'],
    [{ kind: 'social' }, 'Social — BibleGuessr'],
    [{ kind: 'daily-quiz' }, 'Daily quiz — BibleGuessr'],
    [{ kind: 'watch', roomCode: '4821' }, 'Leaderboard for room 4821 — BibleGuessr'],
  ])('titles %j as %s', (route, title) => {
    expect(titleOf(route)).toBe(title)
  })
})
