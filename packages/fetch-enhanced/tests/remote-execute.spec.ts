import type { IncomingHttpHeaders } from 'node:http'
import { WebError } from '@deepseek-ai/dsh-web'
import { bearer, postJson, runAdapter, type AdapterTarget } from 'dsh-tool-web-enhanced-core/host'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRemoteBackend } from '../src/remote/execute.ts'
import { fetchErrors } from '../src/remote/errors.ts'
import { MAX_RESPONSE_BYTES, TIMEOUT_MS, mcp, transport } from '../src/remote/http.ts'
import { fetchResult, MAX_BODY_CHARS, type Page } from '../src/remote/page.ts'
import type { FetchWire } from '../src/remote/types.ts'
import { resolveSettings } from '../src/settings/resolve.ts'
import { json, readJson, serve } from './fixtures/http.ts'
import { expectPage } from './fixtures/page.ts'

const page: Page = { content: 'wire evidence', target: undefined, truncated: false }
const wire: FetchWire = {
  keyless: 'rest',
  request: (input, endpoint, auth) => postJson(endpoint, bearer(auth), { url: input.url, ...input.options }),
  parse: () => ({ kind: 'page', page }),
}
const input = { url: 'http://localhost/private?token=raw#fragment', options: {} }
const keyless = (endpoint: string): AdapterTarget => ({ access: 'keyless', label: 'Test fetch', endpoint })
const keyed = (endpoint: string): AdapterTarget => ({ access: 'api-key', label: 'Test fetch', endpoint, credentialRef: 'TEST_KEY' })
const io = (credential: (ref: string) => Promise<string | undefined>) => ({
  errors: fetchErrors, transport, mcp, credential,
  credentialMissing: (ref: string) => 'missing fetch key ' + ref,
  credentialInvalid: (ref: string) => 'malformed fetch key ' + ref,
})

function mcpRequest(endpoint: string, handshake = false): FetchWire {
  return { ...wire, keyless: { url: endpoint, tool: 'test_fetch', handshake, arguments: () => ({}), parse: () => ({ kind: 'page', page }) } }
}

function connection(endpoint: string) {
  const settings = resolveSettings({ connections: { 'custom:test': { kind: 'adapter', adapter: 'firecrawl', label: 'Test fetch', credentialRef: 'TEST_KEY', endpoint, trustedEndpoint: true } } })
  const value = settings.connections.get('custom:test')!
  if (value.kind !== 'adapter') throw new Error('expected an adapter')
  return value
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('fetch remote execution and bounded transport', () => {
  it('runs a keyless test wire without reading credentials or sending a key', async () => {
    let reads = 0
    const requests: Array<{ headers: Record<string, unknown>; body: Record<string, unknown> }> = []
    const endpoint = await serve((request, response) => {
      void readJson(request).then(body => { requests.push({ headers: request.headers, body }); json(response, {}) })
    })
    const result = await runAdapter(io(async () => { reads += 1; return 'never-send-this-key' }), wire, keyless(endpoint), input, undefined)
    expect(fetchResult(expectPage(result), input)).toMatchObject({ url: input.url, body: { kind: 'text', content: page.content }, statusCode: 200 })
    expect(reads).toBe(0)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.body).toEqual({ url: input.url })
    expect(requests[0]!.headers).not.toHaveProperty('authorization')
    expect(requests[0]!.headers).not.toHaveProperty('x-api-key')
    expect(JSON.stringify(requests)).not.toContain('never-send-this-key')
  })

  it.each([undefined, '', '   '])('fails before any request when the key is missing: %j', async key => {
    let requests = 0
    const endpoint = await serve((_request, response) => { requests += 1; json(response, {}) })
    const backend = createRemoteBackend(connection(endpoint), { credential: async () => key })
    expect(backend.available()).toBe(true)
    await expect(backend.fetch(input)).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    expect(requests).toBe(0)
  })

  it('trims API keys and uses the configured endpoint and options', async () => {
    const requests: Array<{ authorization: string | undefined; body: Record<string, unknown> }> = []
    const endpoint = await serve((request, response) => {
      void readJson(request).then(body => { requests.push({ authorization: request.headers.authorization, body }); json(response, { success: true, data: { markdown: 'remote evidence' } }) })
    })
    const backend = createRemoteBackend({ ...connection(endpoint), options: { storeInCache: false } }, { credential: async ref => { expect(ref).toBe('TEST_KEY'); return '  secret  ' } })
    await expect(backend.fetch(input)).resolves.toMatchObject({ url: input.url, statusCode: 200, body: { kind: 'text', content: 'remote evidence' } })
    expect(requests).toEqual([{ authorization: 'Bearer secret', body: { url: input.url, formats: ['markdown'], storeInCache: false } }])
  })

  it.each([
    ['exa', { results: [], statuses: [{ status: 'error', error: { tag: 'UNKNOWN' } }] }],
    ['firecrawl', { success: false }],
    ['tavily', { results: [], failed_results: [{ error: 'private detail' }] }],
    ['tinyfish', { errors: [{ error: 'bot_blocked' }] }],
  ] as const)('uses the custom connection label for a %s page failure', async (adapter, payload) => {
    const endpoint = await serve((_request, response) => { json(response, payload) })
    const backend = createRemoteBackend({ ...connection(endpoint), adapter, label: 'Team ' + adapter }, { credential: async () => 'secret' })
    await expect(backend.fetch(input)).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('Team ' + adapter) })
  })

  it.each([
    ['exa', { results: [{ text: 'body' }] }, { urls: ['wrong'], text: false }, { urls: [input.url], text: { maxCharacters: 100_000 } }],
    ['firecrawl', { success: true, data: { markdown: 'body' } }, { url: 'wrong', formats: ['html'] }, { url: input.url, formats: ['markdown'] }],
    ['tavily', { results: [{ raw_content: 'body' }] }, { urls: ['wrong'], include_images: true }, { urls: [input.url], include_images: false }],
    ['tinyfish', { results: [{ text: 'body' }] }, { urls: ['wrong'], format: 'html' }, { urls: [input.url], format: 'markdown' }],
  ] as const)('keeps fixed %s request fields authoritative over options', async (adapter, payload, options, expected) => {
    const bodies: Record<string, unknown>[] = []
    const endpoint = await serve((request, response) => {
      void readJson(request).then(body => { bodies.push(body); json(response, payload) })
    })
    const backend = createRemoteBackend({ ...connection(endpoint), adapter, options }, { credential: async () => 'secret' })
    await expect(backend.fetch(input)).resolves.toMatchObject({ body: { content: 'body' } })
    expect(bodies).toEqual([expected])
  })

  it.each(['api-key', 'keyless-rest', 'keyless-mcp'] as const)('rejects %s API redirects without visiting the target or retrying', async access => {
    let targetVisits = 0
    let apiVisits = 0
    const target = await serve((_request, response) => { targetVisits += 1; json(response, {}) })
    const endpoint = await serve((_request, response) => { apiVisits += 1; response.writeHead(302, { location: target }); response.end() })
    const requestWire: FetchWire = access === 'keyless-mcp'
      ? { ...wire, keyless: { url: endpoint, tool: 'test_fetch', handshake: false, arguments: () => ({}), parse: () => ({ kind: 'page', page }) } }
      : wire
    const targetConnection = access === 'api-key' ? keyed(endpoint) : keyless(endpoint)
    const pending = runAdapter(io(async () => 'secret'), requestWire, targetConnection, input, undefined)
    await expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('refused redirect') })
    await expect(pending).rejects.not.toThrow(/secret|127\.0\.0\.1/u)
    expect(apiVisits).toBe(1)
    expect(targetVisits).toBe(0)
  })

  it('enforces the 120 second overall deadline while a local response is pending', async () => {
    const arrived = Promise.withResolvers<void>()
    const endpoint = await serve(() => { arrived.resolve() })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = runAdapter(io(async () => 'secret'), wire, keyed(endpoint), input, undefined)
    const failure = expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('fetch timed out after 120 s') })
    await arrived.promise
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    await failure
  })

  it.each([
    { route: 'rest', mode: 'content-length' }, { route: 'rest', mode: 'stream' },
    { route: 'mcp', mode: 'content-length' }, { route: 'mcp', mode: 'stream' },
  ] as const)('enforces the $route response byte budget via $mode before parsing a text field', async ({ route, mode }) => {
    const endpoint = await serve((_request, response) => {
      response.setHeader('content-type', 'application/json')
      if (mode === 'content-length') response.setHeader('content-length', MAX_RESPONSE_BYTES + 1)
      else response.write('{"results":[{"text":"')
      response.end('x'.repeat(MAX_RESPONSE_BYTES + 1) + '"}]}')
    })
    const requestWire = route === 'rest' ? wire : mcpRequest(endpoint)
    const pending = runAdapter(io(async () => 'secret'), requestWire, keyless(endpoint), input, undefined)
    await expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('fetch response exceeds 5 MB') })
  })

  it('cancels an in-flight request and never sends an already-cancelled request', async () => {
    let requests = 0
    const arrived = Promise.withResolvers<void>()
    const endpoint = await serve(() => { requests += 1; arrived.resolve() })
    const backend = createRemoteBackend(connection(endpoint), { credential: async () => 'secret' })
    const controller = new AbortController()
    const failure = expect(backend.fetch(input, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    await arrived.promise
    controller.abort()
    await failure
    await expect(backend.fetch(input, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(requests).toBe(1)
  })


  it.each(['rest', 'mcp'] as const)('counts streamed UTF-8 bytes rather than characters for %s', async route => {
    const content = '界'.repeat(Math.floor(MAX_RESPONSE_BYTES / 3) + 1)
    expect(content.length).toBeLessThan(MAX_RESPONSE_BYTES)
    const endpoint = await serve((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.write('{"text":"')
      response.end(content + '"}')
    })
    const requestWire = route === 'rest' ? wire : mcpRequest(endpoint)
    await expect(runAdapter(io(async () => 'secret'), requestWire, keyless(endpoint), input, undefined)).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('fetch response exceeds 5 MB'),
    })
  })

  it.each(['rest', 'mcp'] as const)('rejects excessive %s HTTP headers with a fixed network error', async route => {
    const endpoint = await serve((_request, response) => {
      response.setHeader('x-private-upstream', 'PRIVATE_UPSTREAM'.repeat(5000))
      response.end('{}')
    })
    const requestWire = route === 'rest' ? wire : mcpRequest(endpoint)
    const pending = runAdapter(io(async () => 'secret'), requestWire, keyless(endpoint), input, undefined)
    await expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('Test fetch could not be reached') })
    await expect(pending).rejects.not.toThrow(/PRIVATE_UPSTREAM|127\.0\.0\.1|secret/u)
  })

  it.each(['rest', 'mcp'] as const)('reports malformed %s JSON without exposing its body', async route => {
    const endpoint = await serve((_request, response) => { response.end('{PRIVATE_UPSTREAM') })
    const requestWire = route === 'rest' ? wire : mcpRequest(endpoint)
    const pending = runAdapter(io(async () => 'secret'), requestWire, keyless(endpoint), input, undefined)
    await expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('a body that is not JSON') })
    await expect(pending).rejects.not.toThrow('PRIVATE_UPSTREAM')
  })

  it.each(['rest', 'mcp'] as const)('sanitizes %s service failures without retry or credential fallback', async route => {
    for (const access of ['keyless', 'api-key'] as const) {
      for (const status of [401, 403, 404, 408, 429, 500, 503]) {
        let visits = 0
        let reads = 0
        const endpoint = await serve((_request, response) => {
          visits++
          response.writeHead(status)
          response.end('PRIVATE_UPSTREAM secret')
        })
        const requestWire = route === 'rest' ? wire : mcpRequest(endpoint)
        const targetConnection = access === 'keyless' ? keyless(endpoint) : keyed(endpoint)
        const pending = runAdapter(io(async () => { reads++; return 'secret' }), requestWire, targetConnection, input, undefined)
        await expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('Test fetch') })
        await expect(pending).rejects.not.toThrow(/PRIVATE_UPSTREAM|secret|127\.0\.0\.1/u)
        expect(visits).toBe(1)
        expect(reads).toBe(access === 'keyless' ? 0 : 1)
      }
    }
  })

  it.each([
    { phase: 'rest', mode: 'cancel' }, { phase: 'rest', mode: 'deadline' },
    { phase: 'initialize', mode: 'cancel' }, { phase: 'initialize', mode: 'deadline' },
    { phase: 'tools/call', mode: 'cancel' }, { phase: 'tools/call', mode: 'deadline' },
  ] as const)('stops a stalled $phase body on $mode using the real fetch deadline', async ({ phase, mode }) => {
    const received = Promise.withResolvers<void>()
    const closed = Promise.withResolvers<void>()
    let requests = 0
    let reads = 0
    const endpoint = await serve((request, response) => {
      void readJson(request).then(body => {
        requests++
        if (phase === 'rest' || body.method === phase) {
          response.on('close', () => { closed.resolve() })
          response.writeHead(200, { 'content-type': 'application/json' })
          response.write('{')
          received.resolve()
        } else if (body.method === 'initialize') {
          json(response, { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } })
        } else {
          response.writeHead(202)
          response.end()
        }
      })
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const controller = new AbortController()
    const requestWire = phase === 'rest' ? wire : mcpRequest(endpoint, true)
    const pending = runAdapter(io(async () => { reads++; return 'secret' }), requestWire, keyless(endpoint), input, controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({
      code: mode === 'cancel' ? 'WEB_ABORTED' : 'WEB_PROVIDER_ERROR',
      message: expect.stringContaining(mode === 'cancel' ? 'aborted' : 'fetch timed out after 120 s'),
    })
    await received.promise
    if (mode === 'cancel') controller.abort('PRIVATE_UPSTREAM')
    else await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    await rejected
    await expect(pending).rejects.not.toThrow('PRIVATE_UPSTREAM')
    vi.useRealTimers()
    await closed.promise
    expect(reads).toBe(0)
    expect(requests).toBe(phase === 'tools/call' ? 3 : 1)
  })

  it('logs unknown failures and rewrites them to a fixed, secret-free WebError', async () => {
    const privateError = new Error('upstream secret https://private.test')
    const diagnostics: unknown[] = []
    const backend = createRemoteBackend(connection('http://127.0.0.1:9'), { credential: async () => { throw privateError }, onDiagnostic: error => { diagnostics.push(error) } })
    await expect(backend.fetch(input)).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'dsh-web-fetch-enhanced: fetch failed; check the connection settings or choose another connection' })
    expect(diagnostics).toEqual([privateError])
  })

  it('preserves contract errors but gives caller cancellation precedence', async () => {
    const error = new WebError('WEB_PROVIDER_ERROR', 'safe contract error')
    const backend = createRemoteBackend(connection('http://127.0.0.1:9'), { credential: async () => { throw error } })
    await expect(backend.fetch(input)).rejects.toBe(error)
    const controller = new AbortController()
    const cancelled = createRemoteBackend(connection('http://127.0.0.1:9'), { credential: async () => { controller.abort(); throw error } })
    await expect(cancelled.fetch(input, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it.each(['tool', 'server'])('uses fetch-specific public wording for a %s MCP failure', async failure => {
    const endpoint = await serve((request, response) => {
      void readJson(request).then(body => {
        json(response, failure === 'tool'
          ? { jsonrpc: '2.0', id: body.id, result: { isError: true, content: [{ type: 'text', text: 'PRIVATE_UPSTREAM_ERROR' }] } }
          : { jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'PRIVATE_UPSTREAM_ERROR' } })
      })
    })
    const mcpWire: FetchWire = { ...wire, keyless: { url: endpoint, tool: 'test_fetch', handshake: false, arguments: value => ({ urls: [value.url] }), parse: () => ({ kind: 'page', page }) } }
    const pending = runAdapter(io(async () => 'secret'), mcpWire, keyless(endpoint), input, undefined)
    await expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining(failure === 'tool' ? 'could not read the page' : 'MCP fetch server returned an error') })
    await expect(pending).rejects.not.toThrow('PRIVATE_UPSTREAM_ERROR')
  })

  it.each(['json', 'sse', 'rate-limited'] as const)('executes Exa keyless MCP through its catalog URL with a %s result', async resultKind => {
    const requests: Array<{ url: string | undefined; headers: IncomingHttpHeaders; body: Record<string, unknown> }> = []
    const endpoint = await serve((request, response) => {
      void readJson(request).then(body => {
        requests.push({ url: request.url, headers: request.headers, body })
        if (body.method === 'initialize') {
          response.setHeader('mcp-session-id', 'exa-fixture-session')
          json(response, { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } })
        } else if (body.method === 'notifications/initialized') {
          response.writeHead(202)
          response.end()
        } else {
          const result = resultKind === 'rate-limited'
            ? { content: [{ type: 'text', text: 'PRIVATE_UPSTREAM' }], _meta: { 'ai.exa/rateLimited': true } }
            : { content: [{ type: 'text', text: '# Service title\nURL: https://ignored.example/\n\nExa page evidence' }] }
          const payload = { jsonrpc: '2.0', id: body.id, result }
          if (resultKind === 'sse') {
            response.setHeader('content-type', 'text/event-stream')
            response.end(': heartbeat\r\n\r\ndata: ' + JSON.stringify(payload) + '\r\n\r\n')
          } else json(response, payload)
        }
      })
    })
    const nativeFetch = globalThis.fetch
    const destinations: string[] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      expect(url).toBe('https://mcp.exa.ai/mcp')
      destinations.push(url)
      return nativeFetch(endpoint + '/mcp', init)
    })
    const selected = resolveSettings({}).connections.get('builtin:exa')!
    if (selected.kind !== 'adapter') throw new Error('expected the catalog Exa adapter')
    let reads = 0
    const backend = createRemoteBackend({ ...selected, label: 'Team Exa', endpoint: 'https://must-not-use.example/' }, {
      credential: async () => { reads++; return 'NEVER_SEND_THIS_KEY' },
    })
    expect(backend.available()).toBe(true)
    expect(destinations).toEqual([])
    const pending = backend.fetch(input)
    if (resultKind === 'rate-limited') {
      await expect(pending).rejects.toMatchObject({
        code: 'WEB_PROVIDER_ERROR',
        message: FETCH.packageName + ': Team Exa is rate limiting anonymous requests; retry later or ask the user to add a personal API key in fetch connection settings',
      })
      await expect(pending).rejects.not.toThrow('PRIVATE_UPSTREAM')
    } else {
      await expect(pending).resolves.toEqual({ url: input.url, statusCode: 200, body: { kind: 'text', content: 'Exa page evidence' }, truncated: false })
    }
    expect(reads).toBe(0)
    expect(destinations).toEqual(Array(3).fill('https://mcp.exa.ai/mcp'))
    expect(requests.map(request => request.body)).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: FETCH.packageName, version: __PLUGIN_VERSION__ } } },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'web_fetch_exa', arguments: { urls: [input.url], maxCharacters: MAX_BODY_CHARS } } },
    ])
    for (const request of requests) {
      expect(request.url).toBe('/mcp')
      expect(request.headers).toMatchObject({ 'content-type': 'application/json', accept: 'application/json, text/event-stream' })
      for (const header of ['authorization', 'x-api-key', 'cookie', 'api-key', 'x-exa-api-key']) expect(request.headers).not.toHaveProperty(header)
    }
    expect(requests.map(request => request.headers['mcp-session-id'])).toEqual([undefined, 'exa-fixture-session', 'exa-fixture-session'])
    expect(requests[2]!.headers['mcp-protocol-version']).toBe('2025-06-18')
    expect(JSON.stringify(requests)).not.toContain('NEVER_SEND_THIS_KEY')
  })
})
