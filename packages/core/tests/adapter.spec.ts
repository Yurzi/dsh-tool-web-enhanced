import { createServer, type RequestListener } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adapterTarget, apiKeyHeader, bearer, capabilityErrors, createMcpClient, createTransport, getJson, isRecord, postJson, runAdapter,
  type AdapterIO, type AdapterTarget, type AdapterWire,
} from '../src/host/index.ts'

afterEach(() => { vi.useRealTimers() })

interface Input { readonly value: string }
interface Output { readonly value: string; readonly input: string }

function fixture(credential: AdapterIO['credential']): AdapterIO {
  const errors = capabilityErrors('fixture')
  const transport = createTransport(errors, {
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    messages: {
      timedOut: 'fixture timed out',
      unreachable: label => label + ' unreachable; check the connection',
      invalidResponse: detail => 'fixture returned ' + detail,
      tooLarge: 'fixture response too large',
      brokenResponse: 'fixture response broke off',
    },
  })
  return {
    errors, transport, credential,
    mcp: createMcpClient(transport, errors, {
      clientInfo: { name: 'fixture', version: '1' },
      messages: { toolFailed: label => label + ' tool failed', serverError: 'fixture server error' },
    }),
    credentialMissing: ref => 'add an API key for ' + ref,
    credentialInvalid: ref => 'the API key stored for ' + ref + ' is malformed; re-enter it in connection settings',
  }
}

const INPUT: Input = { value: 'input-value' }
const WIRE: AdapterWire<Input, Output> = {
  request(input, endpoint, auth) {
    return postJson(endpoint, { ...bearer(auth), ...apiKeyHeader(auth) }, { value: input.value })
  },
  parse(payload, input) {
    if (!isRecord(payload) || typeof payload.value !== 'string') throw new Error('invalid fixture response')
    return { value: payload.value, input: input.value }
  },
  keyless: 'rest',
}

const personal = (endpoint: string): AdapterTarget => ({ access: 'api-key', label: 'Fixture', endpoint, credentialRef: 'FIXTURE_KEY' })

async function localServer(handler: RequestListener) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected TCP listener')
  return {
    url: 'http://127.0.0.1:' + address.port,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => {
        if (error === undefined) resolve()
        else reject(error)
      }))
    },
  }
}

describe('adapter through a real remote API', () => {
  it.each(['rest', 'mcp'] as const)('never resolves or sends credentials on the keyless %s route', async route => {
    const requests: { url: string | undefined; headers: Record<string, unknown>; body: unknown }[] = []
    let credentialReads = 0
    const io = fixture(async () => { credentialReads++; throw new Error('keyless must never read a credential') })
    const server = await localServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      req.on('end', () => {
        requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) as unknown })
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(route === 'rest' ? { value: 'answer' } : { jsonrpc: '2.0', id: 1, result: { value: 'answer' } }))
      })
    })
    try {
      const wire: AdapterWire<Input, Output> = route === 'rest' ? WIRE : {
        ...WIRE,
        keyless: {
          url: server.url + '/mcp', tool: 'fixture', handshake: false,
          arguments: input => ({ value: input.value }),
          parse: (result, input) => WIRE.parse(result, input),
        },
      }
      const result = await runAdapter(io, wire, { access: 'keyless', label: 'Fixture', endpoint: server.url + '/api' }, INPUT, undefined)
      expect(result).toEqual({ value: 'answer', input: 'input-value' })
      expect(credentialReads).toBe(0)
      expect(requests).toHaveLength(1)
      expect(requests[0]!.url).toBe(route === 'rest' ? '/api' : '/mcp')
      for (const name of ['authorization', 'x-api-key', 'cookie']) expect(requests[0]!.headers).not.toHaveProperty(name)
      expect(requests[0]!.body).toEqual(route === 'rest' ? { value: 'input-value' } : {
        jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fixture', arguments: { value: 'input-value' } },
      })
    } finally { await server.close() }
  })

  it.each([undefined, '', ' \t\n '])('rejects missing or blank API keys (%j) without sending a request', async key => {
    let requests = 0
    const refs: string[] = []
    const server = await localServer((_req, res) => { requests++; res.end('{}') })
    try {
      const io = fixture(async ref => { refs.push(ref); return key })
      await expect(runAdapter(io, WIRE, personal(server.url), INPUT, undefined)).rejects.toMatchObject({
        code: 'WEB_PROVIDER_CREDENTIAL_MISSING', message: 'fixture: add an API key for FIXTURE_KEY',
      })
      expect(refs).toEqual(['FIXTURE_KEY'])
      expect(requests).toBe(0)
    } finally { await server.close() }
  })

  it.each(['bearer', 'x-api-key'] as const)('rejects malformed %s credentials before request construction, network or diagnostics', async header => {
    const diagnostics: unknown[] = []
    let requests = 0
    let networkCalls = 0
    let requestConstructions = 0
    const nativeFetch = globalThis.fetch
    const server = await localServer((_req, res) => { requests++; res.end('{}') })
    vi.stubGlobal('fetch', (...args: Parameters<typeof fetch>) => { networkCalls++; return nativeFetch(...args) })
    const wire: AdapterWire<Input, Output> = {
      ...WIRE,
      request(input, endpoint, auth) {
        requestConstructions++
        return postJson(endpoint, header === 'bearer' ? bearer(auth) : apiKeyHeader(auth), { value: input.value })
      },
    }
    try {
      for (const key of ['SECRET\rVALUE', 'SECRET\nVALUE', 'SECRET\0VALUE', 'SECRET界VALUE']) {
        const io = { ...fixture(async () => key), onDiagnostic: (error: unknown) => { diagnostics.push(error) } }
        const pending = runAdapter(io, wire, personal(server.url), INPUT, undefined)
        await expect(pending).rejects.toMatchObject({
          code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
          message: 'fixture: the API key stored for FIXTURE_KEY is malformed; re-enter it in connection settings',
        })
        await expect(pending).rejects.not.toHaveProperty('cause')
        await expect(pending).rejects.not.toThrow(key)
      }
      expect(requestConstructions).toBe(0)
      expect(networkCalls).toBe(0)
      expect(requests).toBe(0)
      expect(diagnostics).toEqual([])
    } finally { vi.unstubAllGlobals(); await server.close() }
  })

  it('trims and resolves the API key anew on every invocation', async () => {
    const headers: { authorization: string | undefined; apiKey: string | string[] | undefined }[] = []
    const refs: string[] = []
    const server = await localServer((req, res) => {
      headers.push({ authorization: req.headers.authorization, apiKey: req.headers['x-api-key'] })
      res.end(JSON.stringify({ value: 'answer' }))
    })
    try {
      const io = fixture(async ref => { refs.push(ref); return '  key-' + refs.length + ' \n' })
      for (let index = 0; index < 2; index++) await runAdapter(io, WIRE, personal(server.url), INPUT, undefined)
      expect(refs).toEqual(['FIXTURE_KEY', 'FIXTURE_KEY'])
      expect(headers).toEqual([{ authorization: 'Bearer key-1', apiKey: 'key-1' }, { authorization: 'Bearer key-2', apiKey: 'key-2' }])
    } finally { await server.close() }
  })

  it('rejects API redirects without visiting the target or exposing the key', async () => {
    let targetVisits = 0
    let authorization: string | undefined
    const server = await localServer((req, res) => {
      if (req.url === '/target') { targetVisits++; res.end('{}'); return }
      authorization = req.headers.authorization
      res.writeHead(307, { location: '/target' })
      res.end('private upstream body')
    })
    try {
      const io = fixture(async () => 'fixture-secret')
      const pending = runAdapter(io, WIRE, personal(server.url + '/api'), INPUT, undefined)
      await expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
      await expect(pending).rejects.not.toThrow(/127\.0\.0\.1|fixture-secret|private upstream/)
      expect(authorization).toBe('Bearer fixture-secret')
      expect(targetVisits).toBe(0)
    } finally { await server.close() }
  })

  it.each(['cancel', 'deadline'] as const)('stops a pending credential on %s and never dispatches a late key', async reason => {
    let requests = 0
    const server = await localServer((_req, res) => { requests++; res.end('{}') })
    const resolved = Promise.withResolvers<string>()
    const controller = new AbortController()
    const io = fixture(() => resolved.promise)
    try {
      vi.useFakeTimers()
      const pending = runAdapter(io, WIRE, personal(server.url), INPUT, controller.signal)
      const rejected = expect(pending).rejects.toMatchObject(reason === 'cancel'
        ? { code: 'WEB_ABORTED', message: 'fixture: request aborted' }
        : { code: 'WEB_PROVIDER_ERROR', message: 'fixture: fixture timed out' })
      if (reason === 'cancel') controller.abort('private cancellation reason')
      else await vi.advanceTimersByTimeAsync(1000)
      await rejected
      resolved.resolve('late-secret')
      await vi.runAllTimersAsync()
      expect(requests).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers(); await server.close() }
  })

  it.each(['rest', 'mcp'] as const)('cancels a stalled keyless %s response at the real HTTP boundary', async route => {
    const received = Promise.withResolvers<void>()
    const closed = Promise.withResolvers<void>()
    const server = await localServer((_req, res) => {
      res.on('close', () => { closed.resolve() })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{')
      received.resolve()
    })
    try {
      const controller = new AbortController()
      const io = fixture(async () => { throw new Error('must not resolve a credential') })
      const wire: AdapterWire<Input, Output> = route === 'rest' ? WIRE : {
        ...WIRE,
        keyless: { url: server.url, tool: 'fixture', handshake: false, arguments: () => ({}), parse: (result, input) => WIRE.parse(result, input) },
      }
      const pending = runAdapter(io, wire, { access: 'keyless', label: 'Fixture', endpoint: server.url }, INPUT, controller.signal)
      await received.promise
      controller.abort('private cancellation reason')
      await expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED', message: 'fixture: request aborted' })
      await closed.promise
    } finally { await server.close() }
  })

  it('shares the deadline between credential resolution and the HTTP response', async () => {
    const received = Promise.withResolvers<void>()
    const closed = Promise.withResolvers<void>()
    const server = await localServer((_req, res) => {
      res.on('close', () => { closed.resolve() })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{')
      received.resolve()
    })
    const credential = Promise.withResolvers<string>()
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const pending = runAdapter(fixture(() => credential.promise), WIRE, personal(server.url), INPUT, undefined)
      const rejected = expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'fixture: fixture timed out' })
      await vi.advanceTimersByTimeAsync(999)
      credential.resolve('fixture-key')
      await received.promise
      await vi.advanceTimersByTimeAsync(1)
      await rejected
      vi.useRealTimers()
      await closed.promise
    } finally { vi.useRealTimers(); await server.close() }
  })

  it.each(['rest', 'mcp'] as const)('does not fall back to credentials when the keyless %s request is refused', async route => {
    let requests = 0
    let credentialReads = 0
    const server = await localServer((_req, res) => {
      requests++
      res.writeHead(403)
      res.end('private service detail')
    })
    try {
      const io = fixture(async () => { credentialReads++; return 'must-not-be-used' })
      const wire: AdapterWire<Input, Output> = route === 'rest' ? WIRE : {
        ...WIRE,
        keyless: { url: server.url, tool: 'fixture', handshake: false, arguments: () => ({}), parse: (result, input) => WIRE.parse(result, input) },
      }
      await expect(runAdapter(io, wire, { access: 'keyless', label: 'Fixture', endpoint: server.url }, INPUT, undefined)).rejects.toMatchObject({
        code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('refused anonymous access'),
      })
      expect(requests).toBe(1)
      expect(credentialReads).toBe(0)
    } finally { await server.close() }
  })

  it('preserves non-WebError credential failures for the capability execution boundary', async () => {
    const failure = new Error('private credential failure')
    const io = fixture(async () => { throw failure })
    await expect(runAdapter(io, WIRE, personal('http://127.0.0.1:1'), INPUT, undefined)).rejects.toBe(failure)
  })
})

describe('adapter target mapping', () => {
  it('binds keyless access to the catalog endpoint and strips the credential reference', () => {
    const connection = { access: 'keyless', label: 'Team fetch', endpoint: 'https://custom.example/', credentialRef: 'NEVER_READ' } as const
    expect(adapterTarget(connection, 'https://catalog.example/')).toEqual({ access: 'keyless', label: 'Team fetch', endpoint: 'https://catalog.example/' })
  })

  it('retains the selected API-key endpoint, reference and label without extra connection fields', () => {
    const connection = { ...personal('https://custom.example/'), options: { ignored: true } }
    expect(adapterTarget(connection, 'https://catalog.example/')).toEqual(personal('https://custom.example/'))
  })
})

describe('request helpers', () => {
  it('constructs and encodes query parameters internally, retaining unrelated endpoint parameters', () => {
    const query = Object.freeze({ query: 'a & 中文', page: '0' })
    expect(getJson('https://fixture.test/api?query=old&keep=yes', query, { 'x-api-key': 'key' })).toEqual({
      url: 'https://fixture.test/api?query=a+%26+%E4%B8%AD%E6%96%87&keep=yes&page=0',
      method: 'GET', headers: { accept: 'application/json', 'x-api-key': 'key' },
    })
    expect(query).toEqual({ query: 'a & 中文', page: '0' })
  })

  it('builds a keyless GET without credential headers', () => {
    expect(getJson('https://fixture.test/api', {})).toEqual({ url: 'https://fixture.test/api', method: 'GET', headers: { accept: 'application/json' } })
    expect(bearer({ kind: 'keyless' })).toEqual({})
    expect(apiKeyHeader({ kind: 'keyless' })).toEqual({})
  })
})
