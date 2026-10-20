/** Tinyfish search: REST with a key, the hosted MCP tool without one. */
import { invalidResponse } from '../http.ts'
import { apiKeyHeader, getJson, type McpToolResult } from 'dsh-tool-web-enhanced-core/host'
import { toolRows } from './tool-rows.ts'
import { collect, type SourceFields } from '../sources.ts'
import { rowsAt, type AdapterFor } from './types.ts'

const fields = (row: Record<string, unknown>): SourceFields => ({ url: row.url, title: row.title, snippet: row.snippet, publishedAt: row.date })

export const tinyfish = {
  // The API has no count parameter; the web seam caps the result.
  request(input, endpoint, auth) {
    const query: Record<string, string> = { query: input.query, page: '0' }
    for (const [key, value] of Object.entries(input.options)) query[key] = String(value)
    return getJson(endpoint, query, apiKeyHeader(auth))
  },
  parse: (payload, _input) => collect(rowsAt(payload, 'results'), fields),
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
} satisfies AdapterFor<'tinyfish'>
