/** Normalization of untrusted search rows into DSH sources. */
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { sourceUrl } from 'dsh-tool-web-enhanced-core/shared'
import { MAX_SNIPPET_LENGTH, type SearchRow } from 'dsh-tool-web-enhanced-core/host'

const MAX_TITLE_LENGTH = 1000

/** A trimmed, non-empty string; anything else is absent. */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** A calendar date or timestamp normalized to ISO 8601; free-form dates ("2 hours ago") are dropped. */
export function isoDate(value: unknown): string | undefined {
  const date = text(value)
  if (date === undefined || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u.test(date)) return undefined
  const time = Date.parse(date)
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined
}

type Source = { url: string; title?: string; snippet?: string; publishedAt?: string }

/**
 * Sources in arrival order. Rows without a public http(s) URL are dropped, and
 * a repeated URL only fills fields the first occurrence lacked.
 */
export class SourceList {
  private readonly byUrl = new Map<string, Source>()

  add(fields: SearchRow): void {
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
