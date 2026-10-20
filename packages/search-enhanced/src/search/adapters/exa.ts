/** Exa: REST search with bounded page text; keyless through the hosted MCP tool. */
import type { Freshness } from '../../catalog.ts'
import { invalidResponse } from '../http.ts'
import { toolRows, toolTexts, type McpToolResult } from '../mcp.ts'
import { collect, text, MAX_SNIPPET_LENGTH, type SourceFields } from '../sources.ts'
import { apiKeyHeader, count, postJson, rowsAt, type AdapterFor } from './types.ts'

const MAX_TOOL_TEXT_LENGTH = 512 * 1024
const MAX_TOOL_TEXT_LINES = 10_000

const MAX_AGE_HOURS: Record<Freshness, number | undefined> = { auto: undefined, fresh: 24, realtime: 0 }

export const exa: AdapterFor<'exa'> = {
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
  parse: payload => collect(rowsAt(payload, 'results'), row => ({
    url: row.url,
    title: row.title,
    snippet: row.text ?? joined(row.highlights),
    publishedAt: row.publishedDate,
  })),
  keyless: {
    url: 'https://mcp.exa.ai/mcp',
    tool: 'web_search_exa',
    handshake: true,
    arguments: input => ({ query: input.query, ...count('numResults', input.maxResults, 100) }),
    parse: parseTool,
  },
}

function parseTool(result: McpToolResult) {
  const toolText = boundedToolText(toolTexts(result))
  const structured = toolRows(result)
  const rows = structured ?? textRows(toolText)
  if (structured === undefined && rows.length === 0) throw invalidResponse('an unrecognized Exa tool result')
  return collect(rows, row => ({
    url: row.url,
    title: row.title,
    snippet: [row.text, row.snippet, joined(row.highlights)].map(text).find(value => value !== undefined),
    publishedAt: row.publishedDate ?? row.publishedAt,
  }))
}

/** Exa's text format: blocks of `Title:`, `URL:`, `Published Date:` and `Text:`/`Highlights:` lines. */
function textRows(value: string): SourceFields[] {
  return value.split(/(?=^Title:[ \t]*)/mu).flatMap(block => {
    const field = (name: string) => new RegExp(`^${name}:[ \\t]*(.*)$`, 'mu').exec(block)?.[1]?.trim()
    const url = field('URL')
    if (url === undefined || url === '') return []
    const snippet = /^(?:Text|Highlights):[ \t]*([\s\S]*)/mu.exec(block)?.[1]
    return [{ url, title: field('Title'), publishedAt: field('Published(?: Date)?'), snippet: snippet === undefined ? undefined : stripSeparator(snippet) }]
  })
}

function boundedToolText(parts: readonly string[]): string {
  let length = 0
  let lines = 1
  for (const [partIndex, part] of parts.entries()) {
    length += part.length + (partIndex === 0 ? 0 : 2)
    if (length > MAX_TOOL_TEXT_LENGTH) throw invalidResponse('excessive Exa tool text')
    lines += partIndex === 0 ? 0 : 2
    if (lines > MAX_TOOL_TEXT_LINES) throw invalidResponse('excessive Exa tool text lines')
    for (let index = 0; index < part.length; index++) {
      const character = part[index]
      if (character === '\r' && part[index + 1] === '\n') index++
      if (character === '\r' || character === '\n' || character === '\u2028' || character === '\u2029') lines++
      if (lines > MAX_TOOL_TEXT_LINES) throw invalidResponse('excessive Exa tool text lines')
    }
  }
  return parts.join('\n\n')
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
