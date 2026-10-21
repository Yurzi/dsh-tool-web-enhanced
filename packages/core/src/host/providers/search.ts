/**
 * The search side of the provider wires: what every search wire receives, and
 * the unnormalized outcome it parses into. Wires never word model-facing
 * errors; the search plugin maps outcomes to sources or WebErrors.
 */
import type { Freshness } from '../../shared/search.ts'
import { sourceUrl } from '../../shared/url.ts'
import { isRecord, type AdapterWire } from '../adapter.ts'
import { upstreamText } from '../transport.ts'

/** The per-source text budget requested from services that return page text; search caps snippets at the same length. */
export const MAX_SNIPPET_LENGTH = 4000

export interface SearchInput {
  readonly query: string
  readonly maxResults: number | undefined
  readonly freshness: Freshness
  /** Options already validated against the catalog rules for this access. */
  readonly options: Readonly<Record<string, unknown>>
}

/** Candidate source fields of one service row; the search plugin validates and normalizes them. */
export interface SearchRow {
  readonly url?: unknown
  readonly title?: unknown
  readonly snippet?: unknown
  readonly publishedAt?: unknown
}

/** Every malformed-response shape a search wire recognizes, as a closed set without upstream text. */
export type SearchInvalidReason =
  | 'not-object'
  | 'results-array'
  | 'data-array'
  | 'data-web-array'
  | 'exa-tool'
  | 'exa-tool-size'
  | 'exa-tool-lines'
  | 'tinyfish-tool'

export type SearchFailure =
  | { readonly kind: 'failure'; readonly failure: 'api'; readonly detail: string | undefined }
  | { readonly kind: 'failure'; readonly failure: 'invalid'; readonly reason: SearchInvalidReason }

export type SearchOutcome =
  | { readonly kind: 'rows'; readonly rows: readonly SearchRow[] }
  | SearchFailure

export type SearchWire = AdapterWire<SearchInput, SearchOutcome>

type EnvelopeOutcome =
  | { readonly kind: 'object'; readonly value: Record<string, unknown> }
  | SearchFailure

type RowsOutcome =
  | { readonly kind: 'rows'; readonly rows: readonly unknown[] }
  | SearchFailure

/** A request count bounded by the service limit, absent when not requested. */
export function count(field: string, maxResults: number | undefined, cap: number): Record<string, number> {
  return maxResults === undefined ? {} : { [field]: Math.min(maxResults, cap) }
}

/** A JSON object, unless it carries a non-null `error` or `success: false` (an API error). */
export function envelope(payload: unknown): EnvelopeOutcome {
  if (!isRecord(payload)) return { kind: 'failure', failure: 'invalid', reason: 'not-object' }
  if ((payload.error !== undefined && payload.error !== null) || payload.success === false) {
    const nested = isRecord(payload.error) ? payload.error.message : undefined
    let detail: string | undefined
    for (const candidate of [payload.error, nested, payload.message]) {
      if (typeof candidate !== 'string') continue
      detail = upstreamText(candidate)
      if (detail !== undefined) break
    }
    return { kind: 'failure', failure: 'api', detail }
  }
  return { kind: 'object', value: payload }
}

/** The row array at `key`, after rejecting API error envelopes. */
export function rowsAt(payload: unknown, key: 'results'): RowsOutcome {
  const root = envelope(payload)
  if (root.kind === 'failure') return root
  const rows = root.value[key]
  if (!Array.isArray(rows)) return { kind: 'failure', failure: 'invalid', reason: 'results-array' }
  return { kind: 'rows', rows }
}

/** Map object rows without applying the search plugin's source policy. */
export function mapRows(rows: readonly unknown[], fields: (row: Record<string, unknown>) => SearchRow): SearchOutcome {
  const mapped: SearchRow[] = []
  for (const row of rows) if (isRecord(row)) mapped.push(fields(row))
  return { kind: 'rows', rows: mapped }
}

/** A trimmed, non-empty string; anything else is absent. */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** First usable source URL, preserving the upstream's preference order. */
export function firstSourceUrl(values: readonly unknown[]): string | undefined {
  for (const value of values) {
    const url = sourceUrl(value)
    if (url !== undefined) return url.raw
  }
  return undefined
}

/** Up to five author names as `[Authors: …]`, for scholarly snippets. */
export function authors(value: unknown, name: (item: Record<string, unknown>) => unknown): string | undefined {
  const names = (Array.isArray(value) ? value : []).filter(isRecord).map(item => text(name(item))).filter(item => item !== undefined).slice(0, 5)
  return names.length === 0 ? undefined : `[Authors: ${names.join(', ')}]`
}

/** Join the present snippet parts with spaces. */
export function summary(parts: readonly (string | undefined)[]): string | undefined {
  const present = parts.filter(part => part !== undefined)
  return present.length === 0 ? undefined : present.join(' ')
}
