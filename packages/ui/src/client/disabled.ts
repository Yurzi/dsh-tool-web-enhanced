import { FETCH, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import type { PluginRowRef } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'

export interface WebConfigSnapshot {
  readonly searchProvider?: unknown
  readonly fetchProvider?: unknown
}

export interface DisabledCapabilitiesResult {
  readonly searchDisabled: boolean
  readonly fetchDisabled: boolean
  readonly allDisabled: boolean
}

/**
 * Pure function to check if either capability is configured to our enhanced provider
 * in the `web` row, but its plugin row is not currently served by the Host.
 */
export function checkDisabledCapabilities(params: {
  readonly searchServed: boolean
  readonly fetchServed: boolean
  readonly webConfig?: WebConfigSnapshot | undefined
}): DisabledCapabilitiesResult {
  const searchDisabled =
    params.webConfig?.searchProvider === SEARCH.providerId &&
    !params.searchServed

  const fetchDisabled =
    params.webConfig?.fetchProvider === FETCH.providerId &&
    !params.fetchServed

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
