/** Normalization of untrusted search rows into DSH sources. */
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { sourceUrl } from 'dsh-tool-web-enhanced-core/shared'

const MAX_TITLE_LENGTH = 1000
/** Also the per-source text budget requested from services that return page text. */
export const MAX_SNIPPET_LENGTH = 4000

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

/** A calendar date or timestamp normalized to ISO 8601; free-form dates ("2 hours ago") are dropped. */
export function isoDate(value: unknown): string | undefined {
  const date = text(value)
  if (date === undefined || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u.test(date)) return undefined
  const time = Date.parse(date)
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined
}

/** Untrusted row fields; `url` is required for the row to count. */
export interface SourceFields {
  readonly url?: unknown
  readonly title?: unknown
  readonly snippet?: unknown
  readonly publishedAt?: unknown
}

type Source = { url: string; title?: string; snippet?: string; publishedAt?: string }

/**
 * Sources in arrival order. Rows without a public http(s) URL are dropped, and
 * a repeated URL only fills fields the first occurrence lacked.
 */
export class SourceList {
  private readonly byUrl = new Map<string, Source>()

  add(fields: SourceFields): void {
    const url = sourceUrl(fields.url)
    if (url === undefined) return
    const title = text(fields.title)?.slice(0, MAX_TITLE_LENGTH)
    const snippet = text(fields.snippet)?.slice(0, MAX_SNIPPET_LENGTH)
    const publishedAt = isoDate(fields.publishedAt)
    const source = this.byUrl.get(url.href) ?? { url: url.raw }
    if (source.title === undefined && title !== undefined) source.title = title
    if (source.snippet === undefined && snippet !== undefined) source.snippet = snippet
    if (source.publishedAt === undefined && publishedAt !== undefined) source.publishedAt = publishedAt
    this.byUrl.set(url.href, source)
  }

  get sources(): WebSearchSource[] {
    return [...this.byUrl.values()]
  }
}

/** Apply the same source boundary to native and adapter results, preserving truncation. */
export function normalizeResult(result: WebSearchResult): WebSearchResult {
  const list = new SourceList()
  for (const source of result.sources) list.add(source)
  return { ...result, sources: list.sources }
}

/** Map every object row through `fields`; other rows are dropped. */
export function collect(rows: readonly unknown[], fields: (row: Record<string, unknown>) => SourceFields): WebSearchSource[] {
  const list = new SourceList()
  for (const row of rows) if (isRecord(row)) list.add(fields(row))
  return list.sources
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

