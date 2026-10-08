/**
 * The settings that differ between deployments of the app — read at startup
 * from /config/environmentVariables.json, plus the current environment's own
 * environmentVariables.<environment>.json (see docs/web/site-config).
 *
 * This module only checks what was read; nothing else in the app reads the
 * raw JSON.
 */

export interface SiteConfig {
  /** The site's public address — what canonical links point at (see
   * docs/web/seo). Just an origin, no path. */
  siteUrl: string
}

export type SiteConfigResult = { kind: 'valid'; config: SiteConfig } | { kind: 'invalid'; problem: string }

const invalid = (problem: string): SiteConfigResult => ({ kind: 'invalid', problem })

/** What the loader reports, in place of settings, when it couldn't read the
 * base file. */
const LOADER_ERROR_KEY = '__baseLoaderMsg'

/** Checks the merged configuration, as read from the config files. */
export function siteConfigFrom(raw: unknown): SiteConfigResult {
  if (typeof raw !== 'object' || raw === null) return invalid('The configuration is not a JSON object.')
  const settings = raw as Record<string, unknown>

  const loaderError = settings[LOADER_ERROR_KEY] as { error?: unknown } | undefined
  if (loaderError) return invalid(`The configuration couldn't be read: ${String(loaderError.error)}`)

  const { siteUrl } = settings
  if (typeof siteUrl !== 'string') return invalid('siteUrl is missing.')

  let url: URL
  try {
    url = new URL(siteUrl)
  } catch {
    return invalid(`siteUrl "${siteUrl}" is not an address.`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return invalid(`siteUrl "${siteUrl}" is not a web address.`)
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return invalid(`siteUrl "${siteUrl}" must be just the site's address, with no path.`)
  }

  return { kind: 'valid', config: { siteUrl: url.origin } }
}
