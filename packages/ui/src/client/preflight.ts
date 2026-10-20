import { FETCH, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'

export const NATIVE_SEARCH_PROVIDERS: readonly string[] = [
  'deepseek-official',
  'deepseek-search-api',
]
export const NATIVE_FETCH_PROVIDERS: readonly string[] = [
  'http',
  'deepseek-fetch-api',
]
export const NATIVE_SEARCH_ROW = 'web-search-deepseek'

export type PreflightIssueKind =
  | 'user-override'
  | 'legacy-remnant'
  | 'native-search-conflict'

export type PreflightIssue =
  | {
      readonly kind: 'user-override'
      readonly field: 'searchProvider' | 'fetchProvider'
      readonly value: string
    }
  | {
      readonly kind: 'legacy-remnant'
      readonly field: 'searchProvider' | 'fetchProvider'
      readonly value: string
    }
  | {
      readonly kind: 'native-search-conflict'
      readonly rowId: string
    }

export interface UpgradePreflightResult {
  readonly issues: readonly PreflightIssue[]
  readonly fieldsToUnset: readonly ('searchProvider' | 'fetchProvider')[]
}

/**
 * Pure function to inspect settings and determine upgrade preflight issues (§11).
 */
export function checkUpgradePreflight(params: {
  readonly user?: unknown
  readonly nativeSearchServed: boolean
}): UpgradePreflightResult {
  const issues: PreflightIssue[] = []
  const fieldsToUnset: ('searchProvider' | 'fetchProvider')[] = []

  const user =
    typeof params.user === 'object' && params.user !== null
      ? (params.user as Record<string, unknown>)
      : undefined

  if (user !== undefined) {
    if ('searchProvider' in user && typeof user.searchProvider === 'string') {
      const val = user.searchProvider
      if (val !== SEARCH.providerId) {
        fieldsToUnset.push('searchProvider')
        if (NATIVE_SEARCH_PROVIDERS.includes(val)) {
          issues.push({
            kind: 'user-override',
            field: 'searchProvider',
            value: val,
          })
        } else {
          issues.push({
            kind: 'legacy-remnant',
            field: 'searchProvider',
            value: val,
          })
        }
      }
    }

    if ('fetchProvider' in user && typeof user.fetchProvider === 'string') {
      const val = user.fetchProvider
      if (val !== FETCH.providerId) {
        fieldsToUnset.push('fetchProvider')
        if (NATIVE_FETCH_PROVIDERS.includes(val)) {
          issues.push({
            kind: 'user-override',
            field: 'fetchProvider',
            value: val,
          })
        } else {
          issues.push({
            kind: 'legacy-remnant',
            field: 'fetchProvider',
            value: val,
          })
        }
      }
    }
  }

  if (params.nativeSearchServed) {
    issues.push({
      kind: 'native-search-conflict',
      rowId: NATIVE_SEARCH_ROW,
    })
  }

  return {
    issues,
    fieldsToUnset,
  }
}

/**
 * Generate SettingsPathOpView array for resetting user-tier overrides on web row.
 */
export function buildUnsetOps(
  fields: readonly ('searchProvider' | 'fetchProvider')[],
): SettingsPathOpView[] {
  return fields.map(field => ({
    op: 'unset',
    path: [field],
  }))
}
