import { describe, expect, it } from 'vitest'
import {
  fileToRestore,
  parseBibleChoice,
  serializeBibleChoice,
  translationToPreselect,
  type BibleChoice,
} from './bible-choice-storage'

// Stored values are untrusted: they can be hand-edited, left over from an
// older version, or corrupt. None of that may break a setup screen — see
// docs/SCRUM/DONE/Feature.RememberBibleChoiceAcrossGameTypes.md.

const SERVER: BibleChoice = { kind: 'server', translation: 'bibelen-dk (1931/1907)' }
const FILE: BibleChoice = { kind: 'file', fingerprint: 'My Bible.epub:1234:1700000000000' }

describe('parseBibleChoice', () => {
  it('reads back what was stored', () => {
    expect(parseBibleChoice(serializeBibleChoice(SERVER))).toEqual(SERVER)
    expect(parseBibleChoice(serializeBibleChoice(FILE))).toEqual(FILE)
  })

  it('has no choice when nothing is stored', () => {
    expect(parseBibleChoice(null)).toBeUndefined()
    expect(parseBibleChoice('')).toBeUndefined()
  })

  it('has no choice for anything that is not JSON', () => {
    expect(parseBibleChoice('bibelen-dk')).toBeUndefined()
    expect(parseBibleChoice('{"kind":')).toBeUndefined()
  })

  it('has no choice for JSON of the wrong shape', () => {
    expect(parseBibleChoice('null')).toBeUndefined()
    expect(parseBibleChoice('42')).toBeUndefined()
    expect(parseBibleChoice('[]')).toBeUndefined()
    expect(parseBibleChoice('{}')).toBeUndefined()
    expect(parseBibleChoice('{"kind":"cloud","translation":"x"}')).toBeUndefined()
    expect(parseBibleChoice('{"kind":"server"}')).toBeUndefined()
    expect(parseBibleChoice('{"kind":"server","translation":7}')).toBeUndefined()
    expect(parseBibleChoice('{"kind":"server","translation":"  "}')).toBeUndefined()
    expect(parseBibleChoice('{"kind":"file","translation":"x"}')).toBeUndefined()
    expect(parseBibleChoice('{"kind":"file","fingerprint":""}')).toBeUndefined()
  })

  it('keeps only the choice itself, never anything stored alongside it', () => {
    expect(parseBibleChoice('{"kind":"file","fingerprint":"a.epub:1:2","verses":["text"]}')).toEqual({
      kind: 'file',
      fingerprint: 'a.epub:1:2',
    })
  })
})

describe('translationToPreselect', () => {
  const TRANSLATIONS = ['first', 'bibelen-dk (1931/1907)']

  it('keeps a remembered translation the server still offers', () => {
    expect(translationToPreselect(SERVER, TRANSLATIONS)).toBe('bibelen-dk (1931/1907)')
  })

  it('falls back to the first translation when nothing is remembered', () => {
    expect(translationToPreselect(undefined, TRANSLATIONS)).toBe('first')
  })

  it('falls back to the first translation when the remembered one is no longer offered', () => {
    expect(translationToPreselect({ kind: 'server', translation: 'gone' }, TRANSLATIONS)).toBe('first')
  })

  it('falls back to the first translation when a file is remembered', () => {
    expect(translationToPreselect(FILE, TRANSLATIONS)).toBe('first')
  })

  it('has nothing to preselect when the server offers nothing', () => {
    expect(translationToPreselect(SERVER, [])).toBeUndefined()
  })
})

describe('fileToRestore', () => {
  const CACHED = ['other.zip:1:2', 'My Bible.epub:1234:1700000000000']

  it('restores a remembered file that is still cached', () => {
    expect(fileToRestore(FILE, CACHED)).toBe('My Bible.epub:1234:1700000000000')
  })

  it('restores nothing when the remembered file is no longer cached', () => {
    expect(fileToRestore(FILE, ['other.zip:1:2'])).toBeUndefined()
  })

  it('restores nothing when a server translation or nothing is remembered', () => {
    expect(fileToRestore(SERVER, CACHED)).toBeUndefined()
    expect(fileToRestore(undefined, CACHED)).toBeUndefined()
  })
})
