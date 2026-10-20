/** The seam every search adapter implements; adding an adapter starts in `src/catalog.ts`. */
import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import type { AdapterKey, CATALOG, Freshness } from '../../catalog.ts'
import { searchError } from '../errors.ts'
import { invalidResponse, type HttpRequest } from '../http.ts'
import type { McpToolCall, McpToolResult } from '../mcp.ts'
import { isRecord } from '../sources.ts'

export interface SearchInput {
  readonly query: string
  readonly maxResults: number | undefined
  readonly freshness: Freshness
  /** Options already validated against the catalog rules for this access. */
  readonly options: Readonly<Record<string, unknown>>
}

export type Auth =
  | { readonly kind: 'keyless' }
  | { readonly kind: 'api-key'; readonly key: string }

/** A hosted MCP search tool serving anonymous requests. */
export interface McpRoute extends Omit<McpToolCall, 'arguments'> {
  arguments(input: SearchInput): Record<string, unknown>
  parse(result: McpToolResult): WebSearchSource[]
}

export interface Adapter {
  /** Build the REST request for a personal (or, with `keyless: 'rest'`, anonymous) search. */
  request(input: SearchInput, endpoint: string, auth: Auth): HttpRequest
  parse(payload: unknown, input: SearchInput): WebSearchSource[]
  /**
   * Anonymous route, present exactly when the catalog marks the adapter keyless:
   * `rest` sends `request` with keyless auth to the official endpoint.
   */
  readonly keyless?: 'rest' | McpRoute
}

/** A keyless catalog entry cannot compile without its anonymous route. */
export type AdapterFor<K extends AdapterKey> = typeof CATALOG[K]['access']['keyless'] extends true
  ? Adapter & Required<Pick<Adapter, 'keyless'>>
  : Adapter

export function postJson(url: string, headers: Readonly<Record<string, string>>, body: Readonly<Record<string, unknown>>): HttpRequest {
  return { url, method: 'POST', headers: { 'accept': 'application/json', 'content-type': 'application/json', ...headers }, body }
}

export function getJson(url: URL, headers: Readonly<Record<string, string>> = {}): HttpRequest {
  return { url: url.href, method: 'GET', headers: { accept: 'application/json', ...headers } }
}

export function bearer(auth: Auth): Record<string, string> {
  switch (auth.kind) {
    case 'keyless': return {}
    case 'api-key': return { authorization: `Bearer ${auth.key}` }
  }
}

export function apiKeyHeader(auth: Auth): Record<string, string> {
  return auth.kind === 'api-key' ? { 'x-api-key': auth.key } : {}
}

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
