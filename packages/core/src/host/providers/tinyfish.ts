/** Tinyfish REST search and fetch protocols, with hosted MCP search for keyless access. */
import { apiKeyHeader, getJson, isRecord, postJson, type KeylessWire } from '../adapter.ts'
import type { McpToolResult } from '../mcp.ts'
import { reportedTarget, statusPage, type FetchWire, type PageFailure } from './fetch.ts'
import { mapRows, rowsAt, type SearchRow, type SearchWire } from './search.ts'
import { toolRows } from './tool-rows.ts'

const searchFields = (row: Record<string, unknown>): SearchRow => ({ url: row.url, title: row.title, snippet: row.snippet, publishedAt: row.date })

export const tinyfishSearch: KeylessWire<SearchWire> = {
  // The API has no count parameter; the web seam caps the result.
  request(input, endpoint, auth) {
    const query: Record<string, string> = { query: input.query, page: '0' }
    for (const [key, value] of Object.entries(input.options)) query[key] = String(value)
    return getJson(endpoint, query, apiKeyHeader(auth))
  },
  parse(payload) {
    const rows = rowsAt(payload, 'results')
    return rows.kind === 'failure' ? rows : mapRows(rows.rows, searchFields)
  },
  keyless: {
    url: 'https://agent.tinyfish.ai/mcp',
    tool: 'search',
    handshake: false,
    headers: { 'x-tinyfish-access-mode': 'keyless' },
    arguments: input => ({ ...input.options, query: input.query }),
    parse(result: McpToolResult) {
      const rows = toolRows(result)
      if (rows === undefined) return { kind: 'failure', failure: 'invalid', reason: 'tinyfish-tool' }
      return mapRows(rows, searchFields)
    },
  },
}

export const tinyfishFetch: FetchWire = {
  request(input, endpoint, auth) {
    return postJson(endpoint, apiKeyHeader(auth), {
      ...input.options,
      urls: [input.url],
      format: 'markdown',
    })
  },
  parse(payload, input) {
    if (!isRecord(payload)) return { kind: 'failure', failure: 'invalid', detail: undefined }
    if (payload.errors !== undefined) {
      if (!Array.isArray(payload.errors)) return { kind: 'failure', failure: 'invalid', detail: undefined }
      if (payload.errors.length > 0) {
        const error: unknown = payload.errors[0]
        if (!isRecord(error)) return { kind: 'failure', failure: 'invalid', detail: undefined }
        const target = reportedTarget(error.status, input.url, input.url)
        if (target !== undefined) return { kind: 'page', page: statusPage(target) }
        const detail = [error.message, error.code, error.error].find((value): value is string => typeof value === 'string' && value.trim() !== '')
        return { kind: 'failure', failure: fetchFailure(error.error), detail }
      }
    }
    if (!Array.isArray(payload.results)) return { kind: 'failure', failure: 'invalid', detail: undefined }
    if (payload.results.length === 0) return { kind: 'failure', failure: 'empty', detail: undefined }
    const row: unknown = payload.results[0]
    if (!isRecord(row)) return { kind: 'failure', failure: 'invalid', detail: undefined }
    if (row.text === undefined || row.text === '') return { kind: 'failure', failure: 'empty', detail: undefined }
    if (typeof row.text !== 'string') return { kind: 'failure', failure: 'invalid', detail: undefined }
    // A successful fetch supplies a final URL but no target status: 200 is synthetic.
    return { kind: 'page', page: { content: row.text, target: reportedTarget(200, row.final_url, input.url), truncated: false } }
  },
}

function fetchFailure(error: unknown): PageFailure {
  switch (error) {
    case 'timeout': return 'timeout'
    case 'content_too_large': return 'too-large'
    case 'invalid_url':
    case 'invalid_redirect_url': return 'invalid-url'
    case 'empty_content': return 'empty'
    default: return 'failed'
  }
}
