import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { siteConfigFrom } from './site-config'

const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'config')
const readConfig = (name: string): unknown => JSON.parse(readFileSync(join(CONFIG_DIR, name), 'utf-8'))

describe('site configuration', () => {
  it('accepts a site address and keeps just its origin', () => {
    expect(siteConfigFrom({ siteUrl: 'https://bibleguessr.uk/' })).toEqual({
      kind: 'valid',
      config: { siteUrl: 'https://bibleguessr.uk' },
    })
  })

  it.each([
    ['nothing', undefined],
    ['a list', ['https://bibleguessr.uk']],
    ['no siteUrl', { other: 1 }],
    ['a siteUrl that is not an address', { siteUrl: 'bibleguessr' }],
    ['a siteUrl that is not a web address', { siteUrl: 'ftp://bibleguessr.uk' }],
    ['a siteUrl with a path', { siteUrl: 'https://bibleguessr.uk/play' }],
    ["the loader's report of a missing file", { __baseLoaderMsg: { error: 'Base configuration file not found' } }],
  ])('rejects %s', (_name, raw) => {
    expect(siteConfigFrom(raw).kind).toBe('invalid')
  })

  it('ships a valid configuration for production', () => {
    expect(siteConfigFrom(readConfig('environmentVariables.json'))).toEqual({
      kind: 'valid',
      config: { siteUrl: 'https://bibleguessr.uk' },
    })
  })
})
