import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { capabilityErrors, createMcpClient, createTransport, toolJson, toolTexts, type McpToolCall } from '../src/host/index.ts'

const TIMEOUT_MS = 90_000

function client() {
  const errors = capabilityErrors('fixture')
  const transport = createTransport(errors, {
    timeoutMs: TIMEOUT_MS,
    maxResponseBytes: 256 * 1024,
    messages: {
      timedOut: 'fixture timed out',
      unreachable: label => label + ' unreachable',
      invalidResponse: detail => 'fixture returned ' + detail,
      tooLarge: 'fixture response too large',
      brokenResponse: 'fixture response broke off',
    },
  })
  const mcp = createMcpClient(transport, errors, {
    clientInfo: { name: 'fixture-client', version: '1.2.3' },
    messages: { toolFailed: label => label + ' fixture tool failed', serverError: 'fixture server error' },
  })
  return { ...transport, ...mcp }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MCP SSE scan budget', () => {
  it('scans an unterminated event in linear work across many small chunks', async () => {
    const mcp = client()
    const chunk = new TextEncoder().encode(': unfinished event padding      ')
    const chunks = 4096
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < chunks; index++) controller.enqueue(chunk)
        controller.close()
      },
    })
    vi.stubGlobal('fetch', async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    // oxlint-disable-next-line typescript/unbound-method -- Forward the original String receiver without changing scanner behaviour.
    const charCodeAt = String.prototype.charCodeAt
    let scanned = 0
    // Count the line scanner's actual character inspections, not elapsed time.
    vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (this: string, index: number) {
      if (this.startsWith(': unfinished event padding')) scanned++
      return charCodeAt.call(this, index)
    })
    await expect(mcp.withDeadline(undefined, signal => mcp.callTool({
      url: 'https://mcp.test/mcp', tool: 'fixture', arguments: {}, handshake: false,
    }, signal, { label: 'Fixture', access: 'keyless' }))).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('no matching MCP response'),
    })
    expect(scanned).toBeGreaterThan(0)
    expect(scanned).toBeLessThanOrEqual(chunks * chunk.length)
  })
})

function statelessCall(handshake = false) {
  const mcp = client()
  return mcp.withDeadline(undefined, signal => mcp.callTool({
    url: 'https://mcp.test/mcp', tool: 'fixture', arguments: { query: 'q' }, handshake,
  }, signal, { label: 'Fixture', access: 'keyless' }))
}

describe('MCP stream framing and limits', () => {
  it.each(['\n\n', '\r\r', '\r\n\r\n'])('preserves %j event boundaries at every small chunk width', async delimiter => {
    const result = { content: [{ type: 'text', text: '中文' }] }
    const message = JSON.stringify({ jsonrpc: '2.0', id: 1, result })
    const events = ': heartbeat' + delimiter
      + 'data: {"jsonrpc":"2.0","method":"notifications/progress"}' + delimiter
      + 'data: ' + message + delimiter
      + 'data: private trailing invalid JSON' + delimiter
    const bytes = new TextEncoder().encode(events)
    for (const width of [1, 2, 3, 4, 7, bytes.length]) {
      let cancelled = false
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let offset = 0; offset < bytes.length; offset += width) controller.enqueue(bytes.slice(offset, offset + width))
        },
        cancel() { cancelled = true },
      })
      vi.stubGlobal('fetch', async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
      await expect(statelessCall()).resolves.toEqual(result)
      expect(cancelled).toBe(true)
    }
  })

  it.each(['\n\r\n', '\r\n\r', '\n\r'])('splits mixed %j line endings at every small chunk width', async delimiter => {
    const result = { content: [{ type: 'text', text: '中文' }] }
    const events = 'data: {"jsonrpc":"2.0","method":"notifications/progress"}' + delimiter
      + 'data: ' + JSON.stringify({ jsonrpc: '2.0', id: 1, result }) + delimiter
    const bytes = new TextEncoder().encode(events)
    for (const width of [1, 2, 3, 4, 7, bytes.length]) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let offset = 0; offset < bytes.length; offset += width) controller.enqueue(bytes.slice(offset, offset + width))
          controller.close()
        },
      })
      vi.stubGlobal('fetch', async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
      await expect(statelessCall()).resolves.toEqual(result)
    }
  })

  it('accepts a final matching event without a terminating delimiter', async () => {
    vi.stubGlobal('fetch', async () => new Response('data: {"jsonrpc":"2.0","id":1,"result":{"content":[]}}', {
      headers: { 'content-type': 'text/event-stream' },
    }))
    await expect(statelessCall()).resolves.toEqual({ content: [] })
  })

  it.each(['application/json', 'text/event-stream'])('enforces the transport byte limit for %s', async contentType => {
    for (const declared of [false, true]) {
      let cancelled = false
      const chunk = new Uint8Array(128 * 1024 + 1).fill(65)
      const body = new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(chunk) },
        cancel() { cancelled = true },
      })
      vi.stubGlobal('fetch', async () => new Response(body, {
        headers: { 'content-type': contentType, ...(declared ? { 'content-length': String(256 * 1024 + 1) } : {}) },
      }))
      await expect(statelessCall()).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'fixture: fixture response too large' })
      expect(cancelled).toBe(true)
    }
  })

  it.each([
    [{ jsonrpc: '2.0', id: 1, error: { message: 'private upstream detail' } }, 'fixture: fixture server error'],
    [{ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'private upstream detail' }] } }, 'fixture: Fixture fixture tool failed'],
  ])('uses caller supplied error messages without upstream details', async (response, message) => {
    vi.stubGlobal('fetch', async () => Response.json(response))
    await expect(statelessCall()).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message })
  })
})

describe('MCP caller contract through local HTTP', () => {
  it('sends caller clientInfo and keeps sessions within each call', async () => {
    const calls: { body: Record<string, unknown>; session: string | string[] | undefined }[] = []
    let sessions = 0
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      req.on('end', () => {
        const rpc = JSON.parse(body) as Record<string, unknown>
        calls.push({ body: rpc, session: req.headers['mcp-session-id'] })
        if (rpc.method === 'initialize') {
          sessions++
          res.setHeader('mcp-session-id', 'session-' + sessions)
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }))
        } else if (rpc.method === 'notifications/initialized') {
          res.writeHead(202)
          res.end()
        } else res.end(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [] } }))
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('expected TCP listener')
    try {
      const mcp = client()
      for (let invocation = 0; invocation < 2; invocation++) {
        await expect(mcp.withDeadline(undefined, signal => mcp.callTool({
          url: 'http://127.0.0.1:' + address.port, tool: 'fixture', arguments: {}, handshake: true,
        }, signal, { label: 'Fixture', access: 'keyless' }))).resolves.toEqual({ content: [] })
      }
      expect(calls.map(request => request.session)).toEqual([undefined, 'session-1', 'session-1', undefined, 'session-2', 'session-2'])
      expect(calls[0]!.body.params).toEqual({ protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture-client', version: '1.2.3' } })
      expect(calls[3]!.body.params).toEqual(calls[0]!.body.params)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => { if (error === undefined) resolve(); else reject(error) }))
    }
  })
})

describe('MCP content helpers', () => {
  it('extracts only text content and leaves structured content to its adapter', () => {
    expect(toolTexts({ content: [null, {}, { type: 'image', text: 'ignored' }, { type: 'text', text: 1 }, { type: 'text', text: 'first' }, { type: 'text', text: '' }], structuredContent: { value: 'ignored' } })).toEqual(['first', ''])
    expect(toolTexts({})).toEqual([])
  })

  it('distinguishes JSON values from prose', () => {
    for (const value of [null, [], {}, 'text', 1, true]) expect(toolJson(JSON.stringify(value))).toEqual({ kind: 'json', value })
    expect(toolJson('No search results found.')).toEqual({ kind: 'text' })
  })
})

/** The error a promise rejects with. */
async function rejection(pending: Promise<unknown>): Promise<Error> {
  try {
    await pending
  } catch (error) {
    return error as Error
  }
  throw new Error('expected a rejection')
}

function stub(fetch: (url: string, init: RequestInit) => Promise<Response>) {
  const mock = vi.fn(fetch)
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('MCP client', () => {
  const json = (body: unknown, headers: Record<string, string> = {}) => Response.json(body, { headers })
  const rpc = (result: unknown, id = 2) => json({ jsonrpc: '2.0', id, result })
  const SOURCE = { url: 'https://example.com', title: 'Example', snippet: 'evidence' }
  const CALL: McpToolCall = { url: 'https://mcp.test/mcp', tool: 'search', arguments: { query: 'q' }, handshake: true }
  const call = (overrides: Partial<McpToolCall> = {}) => {
    const mcp = client()
    return mcp.withDeadline(undefined, signal => mcp.callTool({ ...CALL, ...overrides }, signal, { label: 'Fixture', access: 'keyless' }))
  }
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
      const mcp = client()
      const result = await mcp.withDeadline(undefined, signal => mcp.callTool({
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
