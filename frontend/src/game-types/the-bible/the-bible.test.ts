import { describe, expect, it } from 'vitest'
import type { VerseSource } from '../../shared-kernel/bible'
import { theBible, WHOLE_BIBLE } from './the-bible'

const RUT_1_16 = {
  book: 'Rut',
  chapter: 1,
  verseNumber: 16,
  text: 'not used',
  translation: 'Test',
  reference: 'Rut 1:16',
}

const BOOKS = ['Genesis', 'Exodus']

describe('theBible', () => {
  it('is ready to play without any setup', () => {
    expect(theBible.defaultSelection).toBe(WHOLE_BIBLE)
    expect(theBible.renderSelector({ verseSource: {} as VerseSource, translation: undefined, selection: WHOLE_BIBLE, onChange: () => {} })).toBeUndefined()
  })

  it('draws from every verse and lets the player guess any book', () => {
    expect(theBible.verseRestriction(WHOLE_BIBLE)).toBeUndefined()
    expect(theBible.guessConstraint(WHOLE_BIBLE)).toEqual({ kind: 'any-book' })
  })

  it('travels as AllVerses and reads as "The Bible"', () => {
    const wire = theBible.toWire(WHOLE_BIBLE, BOOKS)
    expect(wire).toEqual({ Case: 'AllVerses' })
    expect(theBible.describeWire(wire, BOOKS)).toBe('The Bible')
    expect(theBible.guessConstraintForWire(wire, BOOKS)).toEqual({ kind: 'any-book' })
  })

  // Pinned down so giving this game type its own rule is a deliberate,
  // visible change — see registry.test.ts for the other types staying put.
  it('scores singleplayer guesses by the standard tiered rule', () => {
    const score = (guess: { book: string; chapter?: number; verseNumber?: number }) =>
      theBible.scoreGuess(WHOLE_BIBLE, RUT_1_16, guess)
    expect(score({ book: 'Ester' })).toBe(0)
    expect(score({ book: 'Rut' })).toBe(10)
    expect(score({ book: 'Rut', chapter: 1 })).toBe(110)
    expect(score({ book: 'Rut', chapter: 1, verseNumber: 16 })).toBe(1110)
  })
})
