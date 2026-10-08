import { loadEnvironmentVariables } from 'site-config-loader'
import { siteConfigFrom, type SiteConfig } from './site-config'

let loading: Promise<SiteConfig | undefined> | undefined

/**
 * The site's configuration, read once — on first use — by
 * site-config-loader and shared from then on (see docs/web/site-config).
 *
 * Undefined when it can't be read or isn't valid: what depends on it does
 * without (a page simply gets no canonical link), and the problem is
 * logged, rather than the whole app failing over one setting.
 */
export function loadSiteConfig(): Promise<SiteConfig | undefined> {
  loading ??= loadEnvironmentVariables().then((raw) => {
    const result = siteConfigFrom(raw)
    if (result.kind === 'valid') return result.config
    console.error(`[site-config] ${result.problem}`)
    return undefined
  })
  return loading
}
