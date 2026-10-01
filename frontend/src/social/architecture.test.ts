// Social is a standalone part of the app (see docs/web/social): its code
// imports only from its own folder and the shared kernel — never from the
// game types, the multiplayer code or the app shell — so it can grow
// without getting tangled up in them.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SOCIAL_DIR = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = resolve(SOCIAL_DIR, '..')
const SHARED_KERNEL_DIR = join(SRC_DIR, 'shared-kernel')
const SOURCE_EXTENSION = '.ts'

const IMPORT_SPECIFIER = /(?:^|\s)(?:import|export)\s(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFilesUnder(path)
    return path.endsWith(SOURCE_EXTENSION) ? [path] : []
  })
}

function relativeImportsOf(file: string): string[] {
  return [...readFileSync(file, 'utf-8').matchAll(IMPORT_SPECIFIER)]
    .map((match) => match[1] ?? match[2])
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => resolve(dirname(file), specifier).replace(/\.ts$/, ''))
}

const isInside = (path: string, directory: string) => path === directory || path.startsWith(directory + sep)

describe('Social boundaries', () => {
  it('finds Social source files to check', () => {
    // Guards against the rule below passing vacuously.
    expect(sourceFilesUnder(SOCIAL_DIR).length).toBeGreaterThan(1)
  })

  it('Social imports only itself and the shared kernel', () => {
    const violations = sourceFilesUnder(SOCIAL_DIR).flatMap((file) =>
      relativeImportsOf(file)
        .filter((target) => !isInside(target, SOCIAL_DIR) && !isInside(target, SHARED_KERNEL_DIR))
        .map((target) => `${relative(SRC_DIR, file)} imports ${relative(SRC_DIR, target)}`),
    )
    expect(violations).toEqual([])
  })
})
