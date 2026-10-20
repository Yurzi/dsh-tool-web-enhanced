/**
 * Minimal MCP client for the hosted keyless search tools: one tools/call over
 * Streamable HTTP (JSON or SSE replies), with the initialize handshake when
 * the server keeps sessions. Session state never outlives one search.
 */
import { searchError } from './errors.ts'
import { discard, invalidResponse, readJson, readText, send, type Upstream } from './http.ts'
import { isRecord, text } from './sources.ts'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'

const PROTOCOL_VERSION = '2025-06-18'
const NO_RESULTS = /^No (?:search )?results (?:found|returned)/iu
const EVENT_END = /\r\n\r\n|\n\n|\r\r/u

export interface McpToolCall {
  readonly url: string
  readonly tool: string
  readonly arguments: Readonly<Record<string, unknown>>
  /** Whether the server requires `initialize` before `tools/call`. */
  readonly handshake: boolean
  readonly headers?: Readonly<Record<string, string>>
}

/** The `result` of a successful `tools/call`. */
export type McpToolResult = Readonly<Record<string, unknown>>

export async function callTool(call: McpToolCall, signal: AbortSignal, upstream: Upstream): Promise<McpToolResult> {
  const post = (body: object, session: Readonly<Record<string, string>> = {}) => send({
    url: call.url,
    method: 'POST',
    headers: { 'accept': 'application/json, text/event-stream', 'content-type': 'application/json', ...call.headers, ...session },
    body,
  }, signal, upstream)

  let session: Record<string, string> = {}
  let id = 1
  if (call.handshake) {
    const response = await post({
      jsonrpc: '2.0', id, method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: SEARCH.packageName, version: __PLUGIN_VERSION__ } },
    })
    const initialized = await readResult(response, id, signal, upstream)
    const sessionId = response.headers.get('mcp-session-id')
    session = {
      ...(sessionId === null ? {} : { 'mcp-session-id': sessionId }),
      'mcp-protocol-version': text(initialized.protocolVersion) ?? PROTOCOL_VERSION,
    }
    const notified = await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, session)
    await discard(notified, signal, upstream.onDiagnostic)
    id = 2
  }
  const response = await post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: call.tool, arguments: call.arguments } }, session)
  const result = await readResult(response, id, signal, upstream)
  if (result.isError === true) throw searchError('WEB_PROVIDER_ERROR', `${upstream.label} reported a search tool failure; retry later or choose another search connection`)
  return result
}

/**
 * Rows of a tool result: structured content, or JSON in a text part. An
 * explicit "no results" text is an empty list; an unrecognized result is undefined.
 */
export function toolRows(result: McpToolResult): readonly unknown[] | undefined {
  const structured = rowsOf(result.structuredContent)
  if (structured !== undefined) return structured
  let recognized = false
  const rows: unknown[] = []
  for (const part of toolTexts(result)) {
    const content = parseJson(part)
    const parsed = content.kind === 'json' ? rowsOf(content.value) : undefined
    if (parsed !== undefined) rows.push(...parsed)
    if (parsed !== undefined || NO_RESULTS.test(part.trim())) recognized = true
  }
  return recognized ? rows : undefined
}

export function toolTexts(result: McpToolResult): string[] {
  const content = Array.isArray(result.content) ? result.content : []
  return content.flatMap(part => isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])
}

function rowsOf(value: unknown): readonly unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (!isRecord(value)) return undefined
  const data = value.data
  for (const candidate of [value.results, value.web, isRecord(data) ? data.web : undefined, data]) {
    if (Array.isArray(candidate)) return candidate
  }
  return undefined
}

type ParsedContent = { readonly kind: 'json'; readonly value: unknown } | { readonly kind: 'text' }

function parseJson(value: string): ParsedContent {
  try {
    return { kind: 'json', value: JSON.parse(value) as unknown }
  } catch (error) {
    // MCP text blocks may be prose rather than JSON; only syntax errors mean prose.
    if (error instanceof SyntaxError) return { kind: 'text' }
    throw error
  }
}

/** Read the JSON-RPC response with `id` from a JSON or SSE body. */
async function readResult(response: Response, id: number, signal: AbortSignal, upstream: Upstream): Promise<Record<string, unknown>> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
    const result = matching(await readJson(response, signal, upstream.onDiagnostic), id)
    if (result === undefined) throw invalidResponse('no matching MCP response')
    return result
  }
  let buffer = ''
  for await (const chunk of readText(response, signal, upstream.onDiagnostic)) {
    buffer += chunk
    for (let end = EVENT_END.exec(buffer); end !== null; end = EVENT_END.exec(buffer)) {
      const result = eventResult(buffer.slice(0, end.index), id)
      buffer = buffer.slice(end.index + end[0].length)
      if (result !== undefined) return result
    }
  }
  const result = eventResult(buffer, id)
  if (result === undefined) throw invalidResponse('no matching MCP response')
  return result
}

function eventResult(event: string, id: number): Record<string, unknown> | undefined {
  const data = event.split(/\r\n|\r|\n/u)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).replace(/^ /u, ''))
    .join('\n')
  if (data === '' || data === '[DONE]') return undefined
  const message = parseJson(data)
  if (message.kind === 'text') throw invalidResponse('an MCP event that is not JSON')
  return matching(message.value, id)
}

/** The result of the message answering `id`, skipping notifications and other ids. */
function matching(value: unknown, id: number): Record<string, unknown> | undefined {
  const message = (Array.isArray(value) ? value : [value]).find(item => isRecord(item) && item.id === id)
  if (message === undefined) return undefined
  if (message.jsonrpc !== '2.0' || message.error !== undefined || !isRecord(message.result)) {
    throw searchError('WEB_PROVIDER_ERROR', 'the MCP search server returned an error; retry later or choose another search connection')
  }
  return message.result
}
