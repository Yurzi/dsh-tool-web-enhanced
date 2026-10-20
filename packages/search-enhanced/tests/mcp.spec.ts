/** The bounded HTTP transport and the keyless MCP client. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADAPTER_WIRES } from '../src/search/adapters/index.ts'
import { TIMEOUT_MS, withDeadline } from '../src/search/http.ts'
import { callTool, type McpToolCall } from '../src/search/mcp.ts'

/** The error a promise rejects with. */
async function rejection(pending: Promise<unknown>): Promise<Error> {
  try {
    await pending
  } catch (error) {
    return error as Error
  }
  throw new Error('expected a rejection')
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('MCP client', () => {
  const json = (body: unknown, headers: Record<string, string> = {}) => Response.json(body, { headers })
  const rpc = (result: unknown, id = 2) => json({ jsonrpc: '2.0', id, result })
  const SOURCE = { url: 'https://example.com', title: 'Example', snippet: 'evidence' }
  const CALL: McpToolCall = { url: 'https://mcp.test/mcp', tool: 'search', arguments: { query: 'q' }, handshake: true }
  const call = (overrides: Partial<McpToolCall> = {}) => withDeadline(undefined, signal => callTool({ ...CALL, ...overrides }, signal, { label: 'Fixture', access: 'keyless' }))
  /** A server that keeps a session: initialize, the initialized notification, then `final` for tools/call. */
  const server = (final: () => Response = () => rpc({ structuredContent: { results: [SOURCE] } })) => stub(async (_url, init) => {
    const { method } = JSON.parse(init.body as string) as { method: string }
    if (method === 'initialize') return json({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }, { 'mcp-session-id': 'session-fixture' })
    if (method === 'notifications/initialized') return new Response(null, { status: 202 })
    return final()
  })
  const bodies = (fetch: ReturnType<typeof stub>) => fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string) as Record<string, unknown>)

  it('initializes a session, then calls the tool within it', async () => {
    const fetch = server()
    await expect(call()).resolves.toEqual({ structuredContent: { results: [SOURCE] } })
    expect(bodies(fetch).map(body => body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
    expect(bodies(fetch)[2]).toEqual({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search', arguments: { query: 'q' } } })
    const headers = fetch.mock.calls.map(([, init]) => new Headers(init.headers))
    expect(headers.map(h => h.get('mcp-session-id'))).toEqual([null, 'session-fixture', 'session-fixture'])
    expect(headers[2]!.get('mcp-protocol-version')).toBe('2025-03-26')
    for (const h of headers) for (const name of ['authorization', 'x-api-key', 'cookie']) expect(h.has(name)).toBe(false)
    expect(fetch.mock.calls.every(([url, init]) => url === CALL.url && init.redirect === 'error')).toBe(true)
  })

  it('calls a stateless server once', async () => {
    const fetch = stub(async () => rpc({ content: [] }, 1))
    await call({ handshake: false, headers: { 'x-tinyfish-access-mode': 'keyless' } })
    expect(bodies(fetch).map(body => body.method)).toEqual(['tools/call'])
    expect(new Headers(fetch.mock.calls[0]![1].headers).get('x-tinyfish-access-mode')).toBe('keyless')
  })

  it('reads the matching event from an SSE stream and stops reading there', async () => {
    const cancel = vi.fn()
    const events = ': ping\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\n'
      + 'data: {"jsonrpc":"2.0","id":99,"error":{"message":"other request"}}\r\n\r\n'
      + 'data: {"jsonrpc":"2.0",\r\ndata: "id":2,"result":{"structuredContent":{"web":[{"url":"https://example.com","title":"中文"}]}}}\r\n\r\n'
    const bytes = new TextEncoder().encode(events)
    // One byte per chunk splits multi-byte characters; the stream stays open after the answer.
    const body = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])) }, cancel })
    server(() => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    await expect(call()).resolves.toEqual({ structuredContent: { web: [{ url: 'https://example.com', title: '中文' }] } })
    expect(cancel).toHaveBeenCalled()
  })

  it('matches the response id inside a JSON batch', async () => {
    server(() => json([{ jsonrpc: '2.0', id: 99, result: {} }, { jsonrpc: '2.0', id: 2, result: { structuredContent: [SOURCE] } }]))
    await expect(call()).resolves.toEqual({ structuredContent: [SOURCE] })
  })

  it.each([
    ['a JSON-RPC error', () => json({ jsonrpc: '2.0', id: 2, error: { message: 'secret-provider-body' } }), 'WEB_PROVIDER_ERROR'],
    ['a tool error', () => rpc({ isError: true, content: [{ type: 'text', text: 'secret-provider-body' }] }), 'WEB_PROVIDER_ERROR'],
    ['no matching response', () => rpc({}, 99), 'WEB_PROVIDER_ERROR'],
    ['a body that is not JSON', () => new Response('secret-provider-body'), 'WEB_PROVIDER_ERROR'],
  ])('fails on %s without retrying or leaking it', async (_case, final, code) => {
    const fetch = server(final)
    const error = await rejection(call())
    expect(error).toMatchObject({ code })
    expect(error.message).not.toContain('secret')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('shares the overall deadline across initialization and the tool call', async () => {
    vi.useFakeTimers()
    const initialized = Promise.withResolvers<Response>()
    const toolStarted = Promise.withResolvers<void>()
    const fetch = stub(async (_url, init) => {
      const body = JSON.parse(init.body as string) as { method: string }
      if (body.method === 'initialize') return initialized.promise
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
      toolStarted.resolve()
      return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => { reject(new DOMException('cancelled', 'AbortError')) }, { once: true })
      })
    })
    const pending = expect(call()).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('timed out') })
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1)
    initialized.resolve(rpc({ protocolVersion: '2025-03-26' }, 1))
    await toolStarted.promise
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops at a failed initialization', async () => {
    const fetch = stub(async () => json({ jsonrpc: '2.0', id: 1, error: { message: 'secret' } }))
    await expect(call()).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe('keyless MCP results', () => {
  const exa = ADAPTER_WIRES.exa.keyless
  const tinyfish = ADAPTER_WIRES.tinyfish.keyless
  if (typeof exa !== 'object' || typeof tinyfish !== 'object') throw new Error('expected MCP routes')
  const textResult = (text: string) => ({ content: [{ type: 'text', text }] })

  it('reads Exa text blocks', () => {
    const text = 'Title: First\nURL: https://example.com/one\nPublished Date: 2025-01-01\nText: First paragraph\nsecond line\n\n---\n\n'
      + 'Title: Second\nURL: https://example.com/two\nHighlights:\n - Useful evidence'
    expect(exa.parse(textResult(text))).toEqual([
      { url: 'https://example.com/one', title: 'First', publishedAt: '2025-01-01T00:00:00.000Z', snippet: 'First paragraph\nsecond line' },
      { url: 'https://example.com/two', title: 'Second', snippet: '- Useful evidence' },
    ])
  })

  it.each([
    ['text length', ' '.repeat(512 * 1024)],
    ['line count', '\n '.repeat(10_000)],
  ])('rejects excessive Exa %s before parsing whitespace-heavy text', (_limit, padding) => {
    const value = 'Title: Untrusted\nURL: https://example.com\nText: evidence\n' + padding + '!'
    expect(() => exa.parse(textResult(value))).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('counts separators between empty Exa text parts toward the line budget', () => {
    const result = { content: [
      { type: 'text', text: 'No search results found.' },
      ...Array.from({ length: 5000 }, () => ({ type: 'text', text: '' })),
    ] }
    expect(() => exa.parse(result)).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('preserves non-separator suffixes and strips only a final Exa separator', () => {
    const prefix = 'Title: Example\nURL: https://example.com\nText: evidence'
    expect(exa.parse(textResult(prefix + '\n \n --- \n\t'))).toEqual([
      { url: 'https://example.com', title: 'Example', snippet: 'evidence' },
    ])
    expect(exa.parse(textResult(prefix + '\n \n --- \n!'))).toEqual([
      { url: 'https://example.com', title: 'Example', snippet: 'evidence\n \n --- \n!' },
    ])
  })

  it('reads JSON rows from structured content or text', () => {
    const rows = { results: [{ url: 'https://example.com', title: 'Example', snippet: 'evidence' }] }
    expect(tinyfish.parse(textResult(JSON.stringify(rows)))).toEqual(rows.results)
    expect(exa.parse({ structuredContent: rows })).toEqual(rows.results)
  })

  it('accepts an explicit empty result but never mistakes an unknown one for it', () => {
    expect(exa.parse(textResult('No search results found.'))).toEqual([])
    for (const route of [exa, tinyfish]) {
      expect(() => route.parse(textResult('unknown payload'))).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    }
  })
})
beforeEach(() => { vi.stubGlobal('__PLUGIN_VERSION__', '0.2.0') })

function stub(fetch: (url: string, init: RequestInit) => Promise<Response>) {
  const mock = vi.fn(fetch)
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('MCP through real Streamable HTTP', () => {
  it.each(['json', 'sse'] as const)('handshakes and receives a %s tool result', async format => {
    const calls: { body: Record<string, unknown>; session: string | string[] | undefined; protocol: string | string[] | undefined }[] = []
    const streamClosed = Promise.withResolvers<void>()
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      req.on('end', () => {
        const rpc = JSON.parse(body) as Record<string, unknown>
        calls.push({ body: rpc, session: req.headers['mcp-session-id'], protocol: req.headers['mcp-protocol-version'] })
        if (rpc.method === 'initialize') {
          res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'local-session' })
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }))
        } else if (rpc.method === 'notifications/initialized') {
          res.writeHead(202)
          res.end()
        } else {
          const result = { structuredContent: { results: [{ url: 'https://example.org', title: '中文' }] } }
          const message = JSON.stringify({ jsonrpc: '2.0', id: 2, result })
          if (format === 'json') {
            res.setHeader('content-type', 'application/json')
            res.end(message)
          } else {
            res.setHeader('content-type', 'text/event-stream')
            res.on('close', () => { streamClosed.resolve() })
            res.write(': heartbeat\r\n\r\ndata: ')
            res.write(message)
            res.write('\r\n\r\n')
          }
        }
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('expected TCP listener')
    try {
      const result = await withDeadline(undefined, signal => callTool({
        url: 'http://127.0.0.1:' + address.port + '/mcp', tool: 'search', arguments: { query: 'q' }, handshake: true,
      }, signal, { label: 'Fixture', access: 'keyless' }))
      expect(result).toEqual({ structuredContent: { results: [{ url: 'https://example.org', title: '中文' }] } })
      expect(calls.map(call => call.body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
      expect(calls.map(call => call.session)).toEqual([undefined, 'local-session', 'local-session'])
      expect(calls[2]!.protocol).toBe('2025-03-26')
      expect(calls[2]!.body.params).toEqual({ name: 'search', arguments: { query: 'q' } })
      if (format === 'sse') await streamClosed.promise
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => { if (error === undefined) resolve(); else reject(error) }))
    }
  })
})
