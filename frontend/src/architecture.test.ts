// The frontend's layer rules, checked by reading every source file's
// imports — see docs/web/game-types and docs/web/social.
//
//   shared-kernel/  the shared vocabulary (verses, guesses, scoring rules):
//                   imports only itself.
//   shared-ui/      UI components any area may use (verse card, guess
//                   form): imports only itself and the shared kernel.
//   bible-sources/  where verses come from — the server or the player's
//                   own file (parsing, caching, the picker): imports only
//                   itself, the shared kernel and shared UI. Server access is handed
//                   in (see bible-sources/server-access.ts).
//   game-types/X/   one game type: imports only itself, the shared kernel
//                   and the GameTypeDefinition contract. The rest of the
//                   app reaches game types only through registry.ts.
//   social/         a standalone area: imports only itself, the shared
//                   kernel, shared UI and bible sources.
//   congregation/   the group multiplayer mode: never imports the app's
//                   other screens (components/) or Social. Its spectator
//                   board — open to anyone with the link — can't even
//                   reach verse text: it imports no Bible source and no
//                   verse card (see docs/web/congregation).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC_DIR = dirname(fileURLToPath(import.meta.url))
const SHARED_KERNEL_DIR = join(SRC_DIR, 'shared-kernel')
const SHARED_UI_DIR = join(SRC_DIR, 'shared-ui')
const BIBLE_SOURCES_DIR = join(SRC_DIR, 'bible-sources')
const GAME_TYPES_DIR = join(SRC_DIR, 'game-types')
const SOCIAL_DIR = join(SRC_DIR, 'social')
const CONGREGATION_DIR = join(SRC_DIR, 'congregation')
const COMPONENTS_DIR = join(SRC_DIR, 'components')
const VERSE_CARD_FILE = join(SHARED_UI_DIR, 'verse-card')
const GUESS_FORM_FILE = join(SHARED_UI_DIR, 'guess-form')
const CONTRACT_FILE = join(GAME_TYPES_DIR, 'game-type-definition')
const REGISTRY_FILE = join(GAME_TYPES_DIR, 'registry')
const SOURCE_EXTENSION = '.ts'
/** Everything the spectator board is built from. */
const SPECTATOR_FILES = ['spectator-board', 'leaderboard-table', 'board-announcer'].map(
  (name) => join(CONGREGATION_DIR, `${name}${SOURCE_EXTENSION}`),
)

const IMPORT_SPECIFIER = /(?:^|\s)(?:import|export)\s(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFilesUnder(path)
    return path.endsWith(SOURCE_EXTENSION) ? [path] : []
  })
}

/** Every relative import of `source`, as an absolute path without extension. */
export function relativeImportsOf(file: string, source: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER)]
    .map((match) => match[1] ?? match[2])
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => resolve(dirname(file), specifier).replace(/\.ts$/, ''))
}

const isInside = (path: string, directory: string) => path === directory || path.startsWith(directory + sep)

type Rule = (target: string) => boolean

function violations(files: string[], allowed: Rule): string[] {
  return files.flatMap((file) =>
    relativeImportsOf(file, readFileSync(file, 'utf-8'))
      .filter((target) => !allowed(target))
      .map((target) => `${relative(SRC_DIR, file)} imports ${relative(SRC_DIR, target)}`),
  )
}

const gameTypeFolders = readdirSync(GAME_TYPES_DIR)
  .map((entry) => join(GAME_TYPES_DIR, entry))
  .filter((path) => statSync(path).isDirectory())

describe('layer boundaries', () => {
  it('finds the layers to check', () => {
    // Guards against every rule below passing vacuously.
    expect(sourceFilesUnder(SHARED_KERNEL_DIR).length).toBeGreaterThan(0)
    expect(sourceFilesUnder(SHARED_UI_DIR).length).toBeGreaterThan(0)
    expect(sourceFilesUnder(BIBLE_SOURCES_DIR).length).toBeGreaterThan(0)
    expect(sourceFilesUnder(SOCIAL_DIR).length).toBeGreaterThan(0)
    expect(sourceFilesUnder(CONGREGATION_DIR)).toEqual(expect.arrayContaining(SPECTATOR_FILES))
    expect(gameTypeFolders.map((folder) => relative(GAME_TYPES_DIR, folder)).sort()).toEqual(
      expect.arrayContaining(['books', 'chapters', 'the-bible']),
    )
  })

  it('the shared kernel imports only itself', () => {
    expect(violations(sourceFilesUnder(SHARED_KERNEL_DIR), (t) => isInside(t, SHARED_KERNEL_DIR))).toEqual([])
  })

  it('shared UI imports only itself and the shared kernel', () => {
    const allowed: Rule = (t) => isInside(t, SHARED_UI_DIR) || isInside(t, SHARED_KERNEL_DIR)
    expect(violations(sourceFilesUnder(SHARED_UI_DIR), allowed)).toEqual([])
  })

  it('bible sources import only themselves, the shared kernel and shared UI', () => {
    const allowed: Rule = (t) =>
      isInside(t, BIBLE_SOURCES_DIR) || isInside(t, SHARED_KERNEL_DIR) || isInside(t, SHARED_UI_DIR)
    expect(violations(sourceFilesUnder(BIBLE_SOURCES_DIR), allowed)).toEqual([])
  })

  it.each(gameTypeFolders.map((folder) => [relative(GAME_TYPES_DIR, folder), folder]))(
    'game type %s imports only itself, the shared kernel and the contract',
    (_name, folder) => {
      const allowed: Rule = (t) => isInside(t, folder) || isInside(t, SHARED_KERNEL_DIR) || t === CONTRACT_FILE
      expect(violations(sourceFilesUnder(folder), allowed)).toEqual([])
    },
  )

  it('the rest of the app reaches game types only through the registry', () => {
    const appFiles = sourceFilesUnder(SRC_DIR).filter((file) => !isInside(file, GAME_TYPES_DIR))
    const allowed: Rule = (t) => !isInside(t, GAME_TYPES_DIR) || t === REGISTRY_FILE
    expect(violations(appFiles, allowed)).toEqual([])
  })

  it('Social imports only itself, the shared kernel, shared UI and bible sources', () => {
    const allowed: Rule = (t) =>
      isInside(t, SOCIAL_DIR) ||
      isInside(t, SHARED_KERNEL_DIR) ||
      isInside(t, SHARED_UI_DIR) ||
      isInside(t, BIBLE_SOURCES_DIR)
    expect(violations(sourceFilesUnder(SOCIAL_DIR), allowed)).toEqual([])
  })

  it('the Congregation never imports the other screens or Social', () => {
    const allowed: Rule = (t) => !isInside(t, COMPONENTS_DIR) && !isInside(t, SOCIAL_DIR)
    expect(violations(sourceFilesUnder(CONGREGATION_DIR), allowed)).toEqual([])
  })

  it('the spectator board cannot reach verse text', () => {
    const allowed: Rule = (t) =>
      !isInside(t, BIBLE_SOURCES_DIR) &&
      t !== VERSE_CARD_FILE &&
      t !== GUESS_FORM_FILE &&
      (!isInside(t, CONGREGATION_DIR) || SPECTATOR_FILES.includes(t + SOURCE_EXTENSION))
    expect(violations(SPECTATOR_FILES, allowed)).toEqual([])
  })
})

describe('relativeImportsOf', () => {
  it('reads static, side-effect, re-export and dynamic imports, and skips packages', () => {
    const source = [
      "import { html } from 'lit'",
      "import type { A } from '../x'",
      "import './y'",
      "export { B } from './z.ts'",
      "const m = await import('../w')",
    ].join('\n')
    const file = join(GAME_TYPES_DIR, 'books', 'books.ts')
    expect(relativeImportsOf(file, source).map((target) => relative(GAME_TYPES_DIR, target))).toEqual([
      'x',
      join('books', 'y'),
      join('books', 'z'),
      'w',
    ])
  })
})
