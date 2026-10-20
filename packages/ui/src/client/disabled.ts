import { FETCH, SEARCH, WEB_FIELD, routeOf, type Route } from 'dsh-tool-web-enhanced-core/shared'
import type { CapabilityName } from 'dsh-tool-web-enhanced-core/client'
import type { PluginRowRef } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'

export interface WebConfigSnapshot {
  readonly [field: string]: unknown
  readonly searchProvider?: unknown
  readonly fetchProvider?: unknown
}

export interface DisabledCapabilitiesResult {
  readonly searchDisabled: boolean
  readonly fetchDisabled: boolean
  readonly allDisabled: boolean
}

const PROVIDER_ID = { search: SEARCH.providerId, fetch: FETCH.providerId } as const satisfies Record<CapabilityName, string>

/**
 * Where a capability routes: the fact its plugin registered, or, without a
 * running plugin to register one, what the `web` row settings say.
 */
export function routeFor(capability: CapabilityName, routes: ReadonlyMap<CapabilityName, Route>, webConfig: WebConfigSnapshot | undefined): Route {
  const registered = routes.get(capability)
  return registered === undefined ? routeOf(webConfig, WEB_FIELD[capability], null, PROVIDER_ID[capability]) : registered
}

/**
 * Check whether routing targets an enhanced provider whose plugin is not served.
 * Prefer Host-aware facts; an absent plugin can only be judged from the web settings.
 */
export function checkDisabledCapabilities(params: {
  readonly searchServed: boolean
  readonly fetchServed: boolean
  readonly webConfig?: WebConfigSnapshot | undefined
  readonly routes: ReadonlyMap<CapabilityName, Route>
}): DisabledCapabilitiesResult {
  const searchDisabled = routeFor('search', params.routes, params.webConfig).kind === 'this' && !params.searchServed
  const fetchDisabled = routeFor('fetch', params.routes, params.webConfig).kind === 'this' && !params.fetchServed

  const allDisabled = searchDisabled && fetchDisabled

  return {
    searchDisabled,
    fetchDisabled,
    allDisabled,
  }
}

/**
 * Pure function to check if a capability row is disabled in the bundle package rows.
 */
export function isCapabilityRowDisabled(params: {
  readonly rowId: string
  readonly rows: readonly PluginRowRef[]
}): boolean {
  const row = params.rows.find(r => r.rowId === params.rowId)
  return row !== undefined && !row.enabled
}
