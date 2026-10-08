import { canonicalUrlOf, pageMetaOf } from './page-meta'
import type { Route } from './routes'

const DESCRIPTION = 'description'
const ROBOTS = 'robots'
const NOINDEX = 'noindex'
const CANONICAL = 'canonical'

function metaNamed(doc: Document, name: string): HTMLMetaElement {
  let meta = doc.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!meta) {
    meta = doc.createElement('meta')
    meta.name = name
    doc.head.append(meta)
  }
  return meta
}

/**
 * Writes `route`'s page metadata into the document's head — see
 * page-meta.ts and docs/web/seo: the title, the description, and either
 * a canonical link (a page search engines may list) or `noindex` (a
 * room's own pages). Keeps exactly one of each tag, as search engines
 * expect, however often the page changes.
 */
export function showPageMeta(route: Route, doc: Document = document) {
  const meta = pageMetaOf(route)
  doc.title = meta.title
  metaNamed(doc, DESCRIPTION).content = meta.description

  const canonical = doc.head.querySelector<HTMLLinkElement>(`link[rel="${CANONICAL}"]`)
  if (meta.indexable) {
    doc.head.querySelector(`meta[name="${ROBOTS}"]`)?.remove()
    const link = canonical ?? doc.head.appendChild(Object.assign(doc.createElement('link'), { rel: CANONICAL }))
    link.href = canonicalUrlOf(route)
  } else {
    canonical?.remove()
    metaNamed(doc, ROBOTS).content = NOINDEX
  }
}
