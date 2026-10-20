import { apiKeyHeader, isRecord, postJson, type McpToolResult } from 'dsh-tool-web-enhanced-core/host'
import { MAX_BODY_CHARS, reportedTarget, statusPage, type PageOutcome } from '../page.ts'
import type { FetchWireFor } from '../types.ts'

const MAX_TOOL_BLOCKS = 100
const MAX_TOOL_CHARS = 512 * 1024
const MAX_HEADER_CHARS = 8192

export const exa: FetchWireFor<'exa'> = {
  request(input, endpoint, auth) {
    return postJson(endpoint, apiKeyHeader(auth), {
      ...input.options,
      urls: [input.url],
      text: { maxCharacters: MAX_BODY_CHARS },
    })
  },
  parse(payload, input) {
    if (!isRecord(payload)) return { kind: 'failure', failure: 'invalid' }
    if (payload.statuses !== undefined) {
      if (!Array.isArray(payload.statuses)) return { kind: 'failure', failure: 'invalid' }
      const status: unknown = payload.statuses[0]
      if (status !== undefined && !isRecord(status)) return { kind: 'failure', failure: 'invalid' }
      if (isRecord(status) && status.status === 'error') {
        if (!isRecord(status.error)) return { kind: 'failure', failure: 'invalid' }
        const target = reportedTarget(status.error.httpStatusCode, input.url, input.url)
        if (target !== undefined) return { kind: 'page', page: statusPage(target) }
        const tag = status.error.tag
        const failure = tag === 'CRAWL_TIMEOUT' || tag === 'CRAWL_LIVECRAWL_TIMEOUT' ? 'timeout' : 'failed'
        return { kind: 'failure', failure }
      }
    }
    if (!Array.isArray(payload.results)) return { kind: 'failure', failure: 'invalid' }
    if (payload.results.length === 0) return { kind: 'failure', failure: 'empty' }
    const row: unknown = payload.results[0]
    if (!isRecord(row)) return { kind: 'failure', failure: 'invalid' }
    if (row.text === undefined || row.text === '') return { kind: 'failure', failure: 'empty' }
    if (typeof row.text !== 'string') return { kind: 'failure', failure: 'invalid' }
    // Exa does not report the final URL or a successful target status.
    return textPage(row.text)
  },
  keyless: {
    url: 'https://mcp.exa.ai/mcp',
    tool: 'web_fetch_exa',
    handshake: true,
    arguments: input => ({ urls: [input.url], maxCharacters: MAX_BODY_CHARS }),
    parse: parseTool,
  },
}

function textPage(content: string): PageOutcome {
  return { kind: 'page', page: { content, target: undefined, truncated: content.length >= MAX_BODY_CHARS } }
}

function parseTool(result: McpToolResult): PageOutcome {
  const meta = result['_meta']
  if (isRecord(meta) && meta['ai.exa/rateLimited'] === true) return { kind: 'failure', failure: 'rate-limited' }
  const content = result.content
  if (!Array.isArray(content) || content.length > MAX_TOOL_BLOCKS) return { kind: 'failure', failure: 'invalid' }
  const parts: string[] = []
  let characters = 0
  for (const part of content) {
    if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') return { kind: 'failure', failure: 'invalid' }
    const separator = parts.length === 0 ? 0 : 2
    characters += part.text.length + separator
    if (characters > MAX_TOOL_CHARS) return { kind: 'failure', failure: 'invalid' }
    parts.push(part.text)
  }
  const text = stripHeader(parts.join('\n\n'))
  if (text.length === 0 || text.startsWith('No content found')) return { kind: 'failure', failure: 'empty' }
  return textPage(text)
}

function stripHeader(text: string): string {
  const window = text.slice(0, MAX_HEADER_CHARS)
  let offset = 0
  while (offset < window.length) {
    const end = window.indexOf('\n', offset)
    if (end === -1) return text
    const line = window.slice(offset, end).replace(/\r$/u, '')
    if (line.trim() === '') return offset === 0 ? text : text.slice(end + 1)
    if (!line.startsWith('# ') && !line.startsWith('URL:') && !line.startsWith('Published:') && !line.startsWith('Author:')) return text
    offset = end + 1
  }
  return text
}
