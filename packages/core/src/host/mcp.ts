import type { CapabilityErrors } from './errors.ts'
import type { Transport, Upstream } from './transport.ts'
import { isRecord } from './adapter.ts'

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

export interface McpMessages {
  readonly toolFailed: (label: string) => string
  readonly serverError: string
}

export interface McpClient {
  callTool(call: McpToolCall, signal: AbortSignal, upstream: Upstream): Promise<McpToolResult>
}

/** Minimal Streamable HTTP client; session state never outlives one tools/call. */
export function createMcpClient(transport: Transport, errors: CapabilityErrors, spec: {
  readonly clientInfo: { readonly name: string; readonly version: string }
  readonly messages: McpMessages
}): McpClient {
  const PROTOCOL_VERSION = '2025-06-18'
  const { send, discard, readJson, readText, invalidResponse } = transport

  async function callTool(call: McpToolCall, signal: AbortSignal, upstream: Upstream): Promise<McpToolResult> {
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
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: spec.clientInfo },
      })
      const initialized = await readResult(response, id, signal, upstream)
      const sessionId = response.headers.get('mcp-session-id')
      session = {
        ...(sessionId === null ? {} : { 'mcp-session-id': sessionId }),
        'mcp-protocol-version': typeof initialized.protocolVersion === 'string' && initialized.protocolVersion.trim() !== '' ? initialized.protocolVersion.trim() : PROTOCOL_VERSION,
      }
      const notified = await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, session)
      await discard(notified, signal, upstream.onDiagnostic)
      id = 2
    }
    const response = await post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: call.tool, arguments: call.arguments } }, session)
    const result = await readResult(response, id, signal, upstream)
    if (result.isError === true) throw errors.error('WEB_PROVIDER_ERROR', spec.messages.toolFailed(upstream.label))
    return result
  }

  async function readResult(response: Response, id: number, signal: AbortSignal, upstream: Upstream): Promise<Record<string, unknown>> {
    if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
      const result = matching(await readJson(response, signal, upstream.onDiagnostic), id)
      if (result === undefined) throw invalidResponse('no matching MCP response')
      return result
    }
    const lineParts: string[] = []
    const lines: string[] = []
    let afterCR = false
    for await (const chunk of readText(response, signal, upstream.onDiagnostic)) {
      let start = 0
      // Each character is inspected once. A CR ends a line immediately; only its
      // optional following LF is skipped, including when split across chunks.
      for (let index = 0; index < chunk.length; index++) {
        const code = chunk.charCodeAt(index)
        if (afterCR && code === 10) {
          afterCR = false
          start = index + 1
          continue
        }
        afterCR = code === 13
        if (code !== 10 && code !== 13) continue
        lineParts.push(chunk.slice(start, index))
        const line = lineParts.join('')
        lineParts.length = 0
        start = index + 1
        if (line !== '') lines.push(line)
        else {
          const result = eventResult(lines.join('\n'), id)
          lines.length = 0
          if (result !== undefined) return result
        }
      }
      if (start < chunk.length) lineParts.push(chunk.slice(start))
    }
    if (lineParts.length > 0) lines.push(lineParts.join(''))
    const result = eventResult(lines.join('\n'), id)
    if (result === undefined) throw invalidResponse('no matching MCP response')
    return result
  }

  function eventResult(event: string, id: number): Record<string, unknown> | undefined {
    const data = event.split(/\r\n|\r|\n/u)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /u, ''))
      .join('\n')
    if (data === '' || data === '[DONE]') return undefined
    const message = toolJson(data)
    if (message.kind === 'text') throw invalidResponse('an MCP event that is not JSON')
    return matching(message.value, id)
  }

  function matching(value: unknown, id: number): Record<string, unknown> | undefined {
    const message = (Array.isArray(value) ? value : [value]).find(item => isRecord(item) && item.id === id)
    if (message === undefined) return undefined
    if (message.jsonrpc !== '2.0' || message.error !== undefined || !isRecord(message.result)) {
      throw errors.error('WEB_PROVIDER_ERROR', spec.messages.serverError)
    }
    return message.result
  }

  return { callTool }
}

export function toolTexts(result: McpToolResult): string[] {
  const content = Array.isArray(result.content) ? result.content : []
  return content.flatMap(part => isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])
}

type ParsedContent = { readonly kind: 'json'; readonly value: unknown } | { readonly kind: 'text' }

/** MCP text may be prose; only a JSON syntax error means it is not JSON. */
export function toolJson(value: string): ParsedContent {
  try {
    return { kind: 'json', value: JSON.parse(value) as unknown }
  } catch (error) {
    // MCP text blocks may be prose rather than JSON; only syntax errors mean prose.
    if (error instanceof SyntaxError) return { kind: 'text' }
    throw error
  }
}

