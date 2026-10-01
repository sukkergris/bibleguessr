import { describe, expect, it } from 'vitest'
import type { VerseSource } from '../../shared-kernel/bible'
import { theBible, WHOLE_BIBLE } from './the-bible'

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
})
