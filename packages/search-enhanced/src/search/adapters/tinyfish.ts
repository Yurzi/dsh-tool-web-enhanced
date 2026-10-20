/** Tinyfish search: REST with a key, the hosted MCP tool without one. */
import { invalidResponse } from '../http.ts'
import { toolRows, type McpToolResult } from '../mcp.ts'
import { collect, type SourceFields } from '../sources.ts'
import { apiKeyHeader, getJson, rowsAt, type AdapterFor } from './types.ts'

const fields = (row: Record<string, unknown>): SourceFields => ({ url: row.url, title: row.title, snippet: row.snippet, publishedAt: row.date })

export const tinyfish: AdapterFor<'tinyfish'> = {
  // The API has no count parameter; the web seam caps the result.
  request(input, endpoint, auth) {
    const url = new URL(endpoint)
    url.searchParams.set('query', input.query)
    url.searchParams.set('page', '0')
    for (const [key, value] of Object.entries(input.options)) url.searchParams.set(key, String(value))
    return getJson(url, apiKeyHeader(auth))
  },
  parse: payload => collect(rowsAt(payload, 'results'), fields),
  keyless: {
    url: 'https://agent.tinyfish.ai/mcp',
    tool: 'search',
    handshake: false,
    headers: { 'x-tinyfish-access-mode': 'keyless' },
    arguments: input => ({ ...input.options, query: input.query }),
    parse(result: McpToolResult) {
      const rows = toolRows(result)
      if (rows === undefined) throw invalidResponse('an unrecognized Tinyfish tool result')
      return collect(rows, fields)
    },
  },
}
