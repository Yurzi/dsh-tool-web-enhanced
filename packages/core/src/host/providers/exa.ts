/** Exa search and contents protocols with independently bounded hosted MCP parsers. */
import type { Freshness } from '../../shared/search.ts'
import { apiKeyHeader, isRecord, postJson, type KeylessWire } from '../adapter.ts'
import { toolTexts, type McpToolResult } from '../mcp.ts'
import { MAX_BODY_CHARS, reportedTarget, statusPage, type FetchWire, type PageOutcome } from './fetch.ts'
import { count, mapRows, MAX_SNIPPET_LENGTH, rowsAt, text, type SearchFailure, type SearchOutcome, type SearchRow, type SearchWire } from './search.ts'
import { toolRows } from './tool-rows.ts'

const MCP_URL = 'https://mcp.exa.ai/mcp'

const MAX_TOOL_TEXT_LENGTH = 512 * 1024
const MAX_TOOL_TEXT_LINES = 10_000

const MAX_AGE_HOURS: Record<Freshness, number | undefined> = { auto: undefined, fresh: 24, realtime: 0 }

export const exaSearch: KeylessWire<SearchWire> = {
  request(input, endpoint, auth) {
    const maxAgeHours = MAX_AGE_HOURS[input.freshness]
    return postJson(endpoint, apiKeyHeader(auth), {
      ...input.options,
      query: input.query,
      ...count('numResults', input.maxResults, 100),
      // Bounded source text rather than a generated summary or highlights.
      contents: { text: { maxCharacters: MAX_SNIPPET_LENGTH }, ...(maxAgeHours === undefined ? {} : { maxAgeHours }) },
    })
  },
  parse(payload) {
    const rows = rowsAt(payload, 'results')
    if (rows.kind === 'failure') return rows
    return mapRows(rows.rows, row => ({
      url: row.url,
      title: row.title,
      snippet: row.text ?? joined(row.highlights),
      publishedAt: row.publishedDate,
    }))
  },
  keyless: {
    url: MCP_URL,
    tool: 'web_search_exa',
    handshake: true,
    arguments: input => ({ query: input.query, ...count('numResults', input.maxResults, 100) }),
    parse: parseSearchTool,
  },
}

function parseSearchTool(result: McpToolResult): SearchOutcome {
  const toolText = boundedToolText(toolTexts(result))
  if (toolText.kind === 'failure') return toolText
  const structured = toolRows(result)
  const rows = structured ?? textRows(toolText.value)
  if (structured === undefined && rows.length === 0) return { kind: 'failure', failure: 'invalid', reason: 'exa-tool' }
  return mapRows(rows, row => ({
    url: row.url,
    title: row.title,
    snippet: [row.text, row.snippet, joined(row.highlights)].map(text).find(value => value !== undefined),
    publishedAt: row.publishedDate ?? row.publishedAt,
  }))
}

/** Exa's text format: blocks of `Title:`, `URL:`, `Published Date:` and `Text:`/`Highlights:` lines. */
function textRows(value: string): SearchRow[] {
  return value.split(/(?=^Title:[ \t]*)/mu).flatMap(block => {
    const field = (name: string) => new RegExp(`^${name}:[ \\t]*(.*)$`, 'mu').exec(block)?.[1]?.trim()
    const url = field('URL')
    if (url === undefined || url === '') return []
    const snippet = /^(?:Text|Highlights):[ \t]*([\s\S]*)/mu.exec(block)?.[1]
    return [{ url, title: field('Title'), publishedAt: field('Published(?: Date)?'), snippet: snippet === undefined ? undefined : stripSeparator(snippet) }]
  })
}

function boundedToolText(parts: readonly string[]): { readonly kind: 'text'; readonly value: string } | SearchFailure {
  let length = 0
  let lines = 1
  for (const [partIndex, part] of parts.entries()) {
    length += part.length + (partIndex === 0 ? 0 : 2)
    if (length > MAX_TOOL_TEXT_LENGTH) return { kind: 'failure', failure: 'invalid', reason: 'exa-tool-size' }
    lines += partIndex === 0 ? 0 : 2
    if (lines > MAX_TOOL_TEXT_LINES) return { kind: 'failure', failure: 'invalid', reason: 'exa-tool-lines' }
    for (let index = 0; index < part.length; index++) {
      const character = part[index]
      if (character === '\r' && part[index + 1] === '\n') index++
      if (character === '\r' || character === '\n' || character === '\u2028' || character === '\u2029') lines++
      if (lines > MAX_TOOL_TEXT_LINES) return { kind: 'failure', failure: 'invalid', reason: 'exa-tool-lines' }
    }
  }
  return { kind: 'text', value: parts.join('\n\n') }
}

function stripSeparator(value: string): string {
  const end = value.trimEnd()
  if (!end.endsWith('---')) return value
  const prefix = end.slice(0, -3)
  const content = prefix.trimEnd()
  // Two linear suffix scans, not a new whitespace match starting at every newline.
  return prefix.slice(content.length).includes('\n') ? content : value
}

function joined(value: unknown): string | undefined {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string').join('\n') : undefined
}

const MAX_TOOL_BLOCKS = 100
const MAX_TOOL_CHARS = 512 * 1024
const MAX_HEADER_CHARS = 8192

export const exaFetch: KeylessWire<FetchWire> = {
  request(input, endpoint, auth) {
    return postJson(endpoint, apiKeyHeader(auth), {
      ...input.options,
      urls: [input.url],
      text: { maxCharacters: MAX_BODY_CHARS },
    })
  },
  parse(payload, input) {
    if (!isRecord(payload)) return { kind: 'failure', failure: 'invalid', detail: undefined }
    if (payload.statuses !== undefined) {
      if (!Array.isArray(payload.statuses)) return { kind: 'failure', failure: 'invalid', detail: undefined }
      const status: unknown = payload.statuses[0]
      if (status !== undefined && !isRecord(status)) return { kind: 'failure', failure: 'invalid', detail: undefined }
      if (isRecord(status) && status.status === 'error') {
        if (!isRecord(status.error)) return { kind: 'failure', failure: 'invalid', detail: undefined }
        const target = reportedTarget(status.error.httpStatusCode, input.url, input.url)
        if (target !== undefined) return { kind: 'page', page: statusPage(target) }
        const tag = status.error.tag
        const failure = tag === 'CRAWL_TIMEOUT' || tag === 'CRAWL_LIVECRAWL_TIMEOUT' ? 'timeout' : 'failed'
        const detail = [tag, status.error.message].filter(value => typeof value === 'string' && value.trim() !== '').join(': ') || undefined
        return { kind: 'failure', failure, detail }
      }
    }
    if (!Array.isArray(payload.results)) return { kind: 'failure', failure: 'invalid', detail: undefined }
    if (payload.results.length === 0) return { kind: 'failure', failure: 'empty', detail: undefined }
    const row: unknown = payload.results[0]
    if (!isRecord(row)) return { kind: 'failure', failure: 'invalid', detail: undefined }
    if (row.text === undefined || row.text === '') return { kind: 'failure', failure: 'empty', detail: undefined }
    if (typeof row.text !== 'string') return { kind: 'failure', failure: 'invalid', detail: undefined }
    // Exa does not report the final URL or a successful target status.
    return textPage(row.text)
  },
  keyless: {
    url: MCP_URL,
    tool: 'web_fetch_exa',
    handshake: true,
    arguments: input => ({ urls: [input.url], maxCharacters: MAX_BODY_CHARS }),
    parse: parseFetchTool,
  },
}

function textPage(content: string): PageOutcome {
  return { kind: 'page', page: { content, target: undefined, truncated: content.length >= MAX_BODY_CHARS } }
}

function parseFetchTool(result: McpToolResult): PageOutcome {
  const meta = result['_meta']
  if (isRecord(meta) && meta['ai.exa/rateLimited'] === true) {
    return { kind: 'failure', failure: 'rate-limited', detail: toolTexts(result).join('\n\n') || undefined }
  }
  const content = result.content
  if (!Array.isArray(content) || content.length > MAX_TOOL_BLOCKS) return { kind: 'failure', failure: 'invalid', detail: undefined }
  const parts: string[] = []
  let characters = 0
  for (const part of content) {
    if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') return { kind: 'failure', failure: 'invalid', detail: undefined }
    const separator = parts.length === 0 ? 0 : 2
    characters += part.text.length + separator
    if (characters > MAX_TOOL_CHARS) return { kind: 'failure', failure: 'invalid', detail: undefined }
    parts.push(part.text)
  }
  const body = stripFetchHeader(parts.join('\n\n'))
  if (body.length === 0 || body.startsWith('No content found')) return { kind: 'failure', failure: 'empty', detail: undefined }
  return textPage(body)
}

function stripFetchHeader(body: string): string {
  const window = body.slice(0, MAX_HEADER_CHARS)
  let offset = 0
  while (offset < window.length) {
    const end = window.indexOf('\n', offset)
    if (end === -1) return body
    const line = window.slice(offset, end).replace(/\r$/u, '')
    if (line.trim() === '') return offset === 0 ? body : body.slice(end + 1)
    if (!line.startsWith('# ') && !line.startsWith('URL:') && !line.startsWith('Published:') && !line.startsWith('Author:')) return body
    offset = end + 1
  }
  return body
}
