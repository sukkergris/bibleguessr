// site-config-loader ships no type declarations of its own — see
// https://github.com/sukkergris/site-config-loader for what each does.
declare module 'site-config-loader' {
  /** Reads `<basePath>/<baseFileName>.json` (default
   * /config/environmentVariables.json) and, outside production, the
   * current environment's `<baseFileName>.<environment>.json` on top. The
   * environment comes from `<meta name="environment-name">`, or else from
   * the host name. Never rejects: a base file it can't read is reported in
   * the result under `__baseLoaderMsg`. */
  export function loadEnvironmentVariables(basePath?: string, baseFileName?: string): Promise<Record<string, unknown>>
  export function getEnvironmentFromMetaTag(): string | null
  export function detectEnvironmentFromHostname(): string
}
