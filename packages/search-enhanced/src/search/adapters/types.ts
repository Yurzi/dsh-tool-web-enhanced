import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { isRecord, type AdapterWire, type KeylessBound, type McpRoute as CoreMcpRoute } from 'dsh-tool-web-enhanced-core/host'
import type { AdapterKey, CATALOG, Freshness } from '../../catalog.ts'
import { searchError } from '../errors.ts'
import { invalidResponse } from '../http.ts'

export type { Auth } from 'dsh-tool-web-enhanced-core/host'

export interface SearchInput {
  readonly query: string
  readonly maxResults: number | undefined
  readonly freshness: Freshness
  /** Options already validated against the catalog rules for this access. */
  readonly options: Readonly<Record<string, unknown>>
}

export type Adapter = AdapterWire<SearchInput, WebSearchSource[]>
export type McpRoute = CoreMcpRoute<SearchInput, WebSearchSource[]>
export type AdapterFor<K extends AdapterKey> = KeylessBound<typeof CATALOG[K]['access'], Adapter>

/** `{ [field]: min(maxResults, cap) }`, or nothing when the request sets no bound. */
export function count(field: string, maxResults: number | undefined, cap: number): Record<string, number> {
  return maxResults === undefined ? {} : { [field]: Math.min(maxResults, cap) }
}

/** The row array at `key`, after rejecting API error envelopes. */
export function rowsAt(payload: unknown, key: string): readonly unknown[] {
  const root = envelope(payload)
  const rows = root[key]
  if (!Array.isArray(rows)) throw invalidResponse(`no "${key}" array`)
  return rows
}

export function envelope(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) throw invalidResponse('a body that is not a JSON object')
  if ((payload.error !== undefined && payload.error !== null) || payload.success === false) {
    throw searchError('WEB_PROVIDER_ERROR', 'the search service reported an API error; retry later or choose another search connection')
  }
  return payload
}
