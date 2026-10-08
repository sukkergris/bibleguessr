import type { ReactiveController, ReactiveControllerHost } from 'lit'
import { loadSiteConfig } from '../site-config/load-site-config'
import { showPageMeta } from './page-head'
import { HOME, pathOf, routeFromPath, type Route } from './routes'

/** The main mouse button — anything else (middle-click, …) keeps the
 * browser's own behavior, such as opening a new tab. */
const PRIMARY_BUTTON = 0

/**
 * Keeps the app shell's current screen and the address bar in step — see
 * docs/web/url-routing.
 *
 * - On load, the address decides the first screen; an unknown address
 *   shows the home screen and is corrected to `/`.
 * - `navigate()` is how the app moves between screens: it adds a history
 *   entry, so Back and Forward work.
 * - Back and Forward (popstate) move the app to whatever screen the
 *   address now names.
 * - A click on an ordinary link to one of the app's own addresses is
 *   handled in the page instead of reloading it.
 *
 * Every change also sets the page's title, description and search-engine
 * tags (see page-head.ts). The canonical link waits for the site
 * configuration, which loads alongside the first screen rather than
 * holding it up.
 */
export class NavigationController implements ReactiveController {
  route: Route

  private readonly host: ReactiveControllerHost

  /** The site's public address, once the site configuration has loaded. */
  private siteUrl?: string

  constructor(host: ReactiveControllerHost) {
    this.host = host
    const route = routeFromPath(window.location.pathname)
    this.route = route ?? HOME
    if (!route) window.history.replaceState(null, '', pathOf(HOME))
    showPageMeta(this.route, this.siteUrl)
    host.addController(this)

    void loadSiteConfig().then((config) => {
      this.siteUrl = config?.siteUrl
      showPageMeta(this.route, this.siteUrl)
    })
  }

  hostConnected() {
    window.addEventListener('popstate', this.onPopState)
    document.addEventListener('click', this.onClick)
  }

  hostDisconnected() {
    window.removeEventListener('popstate', this.onPopState)
    document.removeEventListener('click', this.onClick)
  }

  /** Shows `route`, adding a history entry unless the address already
   * names it. */
  navigate(route: Route) {
    const path = pathOf(route)
    if (path !== window.location.pathname) window.history.pushState(null, '', path)
    this.show(route)
  }

  private show(route: Route) {
    this.route = route
    showPageMeta(route, this.siteUrl)
    this.host.requestUpdate()
  }

  private onPopState = () => {
    this.show(routeFromPath(window.location.pathname) ?? HOME)
  }

  private onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== PRIMARY_BUTTON) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    // composedPath reaches into the components' (open) shadow roots, where
    // nearly every link in this app lives.
    const anchor = event.composedPath().find((target): target is HTMLAnchorElement => target instanceof HTMLAnchorElement)
    if (!anchor || anchor.target !== '' || anchor.hasAttribute('download')) return

    const url = new URL(anchor.href)
    if (url.origin !== window.location.origin) return
    const route = routeFromPath(url.pathname)
    if (!route) return

    event.preventDefault()
    this.navigate(route)
  }
}
