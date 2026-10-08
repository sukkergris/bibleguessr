import { describe, expect, it } from 'vitest'
import { parseWatchRoute, watchUrlFor } from './watch-route'

describe('watch route', () => {
  it.each([
    ['#/watch/1234', '1234'],
    ['#/watch/1234/', '1234'],
    ['', undefined],
    ['#/watch/', undefined],
    ['#/play/1234', undefined],
    ['#/watch/12 34', undefined],
  ])('reads %j as %j', (hash, code) => {
    expect(parseWatchRoute(hash)).toBe(code)
  })

  it('builds a link that reads back as the same room', () => {
    const url = watchUrlFor('https://bibleguessr.example/', '4821')

    expect(url).toBe('https://bibleguessr.example/#/watch/4821')
    expect(parseWatchRoute(new URL(url).hash)).toBe('4821')
  })
})
