// Each game type's scoring, spelled out once for both modes in
// scoring-scenarios/<game type>.json at the repo root — see
// docs/web/scoring. This file checks the singleplayer side through the
// registry (the frontend's composition point);
// backend/Tests/GameTypeScoringTests.fs checks the multiplayer side
// against the same files. Changing one game type's rule means changing its
// own definition and its own scenario file only.
//
// Read with node:fs rather than imported, so the type-check of a build
// that only has the frontend folder (see build/Dockerfile.nginx) doesn't
// need the files.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Guess, Verse, VerseSource } from '../shared-kernel/bible'
import type { GameType } from '../shared-kernel/game-type-wire'
import {
  GAME_TYPE_IDS,
  freshChoice,
  maxPointsOf,
  scoreGuessOf,
  toWire,
  type GameTypeChoice,
  type GameTypeId,
} from './registry'

const SCENARIOS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scoring-scenarios')
const SCENARIO_EXTENSION = '.json'

interface ScenarioSelection {
  /** The selection as the player's own setup holds it; null when nothing
   * is picked. */
  singleplayer: unknown
  /** The same game as sent to the server. */
  wire: GameType
  /** The most one verse can earn — the results screen's "out of". */
  maxPoints: number
}

interface ScenarioFile {
  gameType: GameTypeId
  booksInBibleOrder: string[]
  verse: { book: string; bookNumber: number; chapter: number; verseNumber: number }
  selections: Record<string, ScenarioSelection>
  cases: { selection: string; guess: Guess; points: { singleplayer: number; multiplayer: number }; why: string }[]
}

const scenarioFiles: ScenarioFile[] = readdirSync(SCENARIOS_DIR)
  .filter((name) => name.endsWith(SCENARIO_EXTENSION))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(SCENARIOS_DIR, name), 'utf-8')) as ScenarioFile)

function choiceOf(file: ScenarioFile, selection: ScenarioSelection): GameTypeChoice {
  return selection.singleplayer === null
    ? freshChoice(file.gameType)
    : ({ gameType: file.gameType, selection: selection.singleplayer } as GameTypeChoice)
}

function verseOf(file: ScenarioFile): Verse {
  const { book, chapter, verseNumber } = file.verse
  const reference = `${book} ${chapter}:${verseNumber}`
  return { book, chapter, verseNumber, text: '', translation: 'Scenario', reference }
}

function sourceOf(file: ScenarioFile): VerseSource {
  const unused = () => Promise.reject(new Error('not used by scoring scenarios'))
  return {
    getTranslations: () => Promise.resolve([]),
    getRandomVerse: unused,
    getBooks: () => Promise.resolve([...file.booksInBibleOrder].sort()),
    getBooksInBibleOrder: () => Promise.resolve(file.booksInBibleOrder),
    getChapters: () => Promise.resolve([]),
    getVerseNumbers: () => Promise.resolve([]),
    lookupVerse: unused,
  }
}

describe('scoring scenarios', () => {
  it('cover every game type, and name only game types that exist', () => {
    expect(scenarioFiles.map((file) => file.gameType)).toEqual([...GAME_TYPE_IDS].sort())
  })

  for (const file of scenarioFiles) {
    describe(file.gameType, () => {
      const verse = verseOf(file)
      const selections = Object.entries(file.selections)

      it.each(file.cases.map((scenario) => [`${scenario.selection}: ${scenario.why}`, scenario] as const))(
        'scores a singleplayer guess as its scenario says — %s',
        (_name, scenario) => {
          const choice = choiceOf(file, file.selections[scenario.selection])
          expect(scoreGuessOf(choice, verse, scenario.guess)).toBe(scenario.points.singleplayer)
        },
      )

      it.each(selections)('counts %s as worth at most its maxPoints a verse', (_name, selection) => {
        expect(maxPointsOf(choiceOf(file, selection))).toBe(selection.maxPoints)
      })

      // Ties the "out of" to the rule itself, so the two can't drift apart:
      // a perfect guess earns exactly the maximum, and no guess earns more.
      it.each(selections)('gives a perfect guess exactly the maximum in %s', (name, selection) => {
        const choice = choiceOf(file, selection)
        const perfect = { book: verse.book, chapter: verse.chapter, verseNumber: verse.verseNumber }
        expect(scoreGuessOf(choice, verse, perfect)).toBe(maxPointsOf(choice))
        for (const scenario of file.cases.filter((candidate) => candidate.selection === name)) {
          expect(scenario.points.singleplayer).toBeLessThanOrEqual(maxPointsOf(choice))
        }
      })

      // The singleplayer selection and the wire must describe the same
      // game, or the two modes' expectations would be about different
      // games. Nothing picked is never sent (the registry sends The
      // Bible), so the server only meets that wire from an outdated or
      // hand-made client — it is checked on the backend side only.
      it.each(selections.filter(([, selection]) => selection.singleplayer !== null))(
        'sends %s as its scenario wire',
        async (_name, selection) => {
          expect(await toWire(choiceOf(file, selection), sourceOf(file), undefined)).toEqual(selection.wire)
        },
      )
    })
  }
})
