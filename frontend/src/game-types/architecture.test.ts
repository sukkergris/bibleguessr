// Enforces the game-type boundaries described in game-type-definition.ts
// and docs/web/game-types, by reading every source file's imports:
//
// 1. A game type (a folder here) imports only from its own folder, the
//    shared kernel, and the GameTypeDefinition contract — never from a
//    sibling game type or from the app shell.
// 2. The shared kernel imports only from itself.
// 3. Outside this folder, the app reaches game types only through
//    registry.ts.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const GAME_TYPES_DIR = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = resolve(GAME_TYPES_DIR, '..')
const SHARED_KERNEL_DIR = join(SRC_DIR, 'shared-kernel')
const CONTRACT_FILE = join(GAME_TYPES_DIR, 'game-type-definition')
const REGISTRY_FILE = join(GAME_TYPES_DIR, 'registry')
const SOURCE_EXTENSION = '.ts'

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

const gameTypeFolders = readdirSync(GAME_TYPES_DIR)
  .map((entry) => join(GAME_TYPES_DIR, entry))
  .filter((path) => statSync(path).isDirectory())

type Rule = (file: string, target: string) => boolean

function violations(files: string[], allowed: Rule): string[] {
  return files.flatMap((file) =>
    relativeImportsOf(file, readFileSync(file, 'utf-8'))
      .filter((target) => !allowed(file, target))
      .map((target) => `${relative(SRC_DIR, file)} imports ${relative(SRC_DIR, target)}`),
  )
}

describe('game-type boundaries', () => {
  it('finds the game types to check', () => {
    // Guards against every rule below passing vacuously.
    expect(gameTypeFolders.map((folder) => relative(GAME_TYPES_DIR, folder)).sort()).toEqual(
      expect.arrayContaining(['books', 'chapters', 'the-bible']),
    )
  })

  it.each(gameTypeFolders.map((folder) => [relative(GAME_TYPES_DIR, folder), folder]))(
    '%s imports only itself, the shared kernel and the contract',
    (_name, folder) => {
      const allowed: Rule = (_file, target) =>
        isInside(target, folder) || isInside(target, SHARED_KERNEL_DIR) || target === CONTRACT_FILE
      expect(violations(sourceFilesUnder(folder), allowed)).toEqual([])
    },
  )

  it('the shared kernel imports only itself', () => {
    const allowed: Rule = (_file, target) => isInside(target, SHARED_KERNEL_DIR)
    expect(violations(sourceFilesUnder(SHARED_KERNEL_DIR), allowed)).toEqual([])
  })

  it('the rest of the app reaches game types only through the registry', () => {
    const appFiles = sourceFilesUnder(SRC_DIR).filter((file) => !isInside(file, GAME_TYPES_DIR))
    const allowed: Rule = (_file, target) => !isInside(target, GAME_TYPES_DIR) || target === REGISTRY_FILE
    expect(violations(appFiles, allowed)).toEqual([])
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
