/** The bounded HTTP transport and the keyless MCP client. */
import { createServer, type RequestListener } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { abortable } from '../src/search/errors.ts'
import { executeSearch } from '../src/search/execute.ts'
import { resolveSettings } from '../src/settings/resolve.ts'
import { MAX_RESPONSE_BYTES, readText, requestJson, TIMEOUT_MS, withDeadline, type HttpRequest, type Upstream } from '../src/search/http.ts'

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

const REQUEST: HttpRequest = { url: 'https://search.test/api', method: 'POST', headers: { 'content-type': 'application/json' }, body: { query: 'q' } }
const UPSTREAM: Upstream = { label: 'Fixture', access: 'api-key' }
const search = (signal?: AbortSignal, upstream = UPSTREAM) => withDeadline(signal, deadline => requestJson(REQUEST, deadline, upstream))

function stub(fetch: (url: string, init: RequestInit) => Promise<Response>) {
  const mock = vi.fn(fetch)
  vi.stubGlobal('fetch', mock)
  return mock
}
/** A fetch that never answers but honors its signal, like the real one. */
const hanging = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init.signal!.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
})
/** A body that never yields a chunk; `cancel` records its release. */
function stalledBody() {
  const cancel = vi.fn()
  let pulled!: () => void
  const started = new Promise<void>(resolve => { pulled = resolve })
  const body = new ReadableStream<Uint8Array>({ pull: () => { pulled(); return new Promise(() => {}) }, cancel }, { highWaterMark: 0 })
  return { body, cancel, started }
}

describe('HTTP transport', () => {
  it.each(['network', 'body', 'json', 'cancel'] as const)('reports the original %s error privately through diagnostics', async phase => {
    const failure = new Error('private-transport-detail')
    const diagnostics: unknown[] = []
    const upstream = { ...UPSTREAM, onDiagnostic: (cause: unknown) => { diagnostics.push(cause) } }
    stub(async () => {
      if (phase === 'network') throw failure
      if (phase === 'body') return new Response(new ReadableStream({ pull: controller => { controller.error(failure) } }))
      if (phase === 'cancel') return new Response(new ReadableStream({ cancel: () => { throw failure } }), { status: 401 })
      return new Response('not-json-private-transport-detail')
    })
    const error = await rejection(search(undefined, upstream))
    expect(error.message).not.toContain('private-transport-detail')
    expect(error.cause).toBeUndefined()
    if (phase === 'json') expect(diagnostics).toEqual([expect.any(SyntaxError)])
    else expect(diagnostics).toEqual([failure])
  })

  it.each(['keyless', 'api-key', 'account'] as const)('asks the user to resolve %s authentication refusal', async access => {
    stub(async () => new Response(null, { status: 401 }))
    expect((await rejection(search(undefined, { ...UPSTREAM, access }))).message).toContain('ask the user to')
  })

  it('reports an execution failure privately and asks the user for adapter credentials', async () => {
    const connection = resolveSettings({ connections: { 'builtin:exa': { access: 'api-key' } } }).connections.get('builtin:exa')!
    if (connection.kind !== 'adapter') throw new Error('expected adapter')
    const failure = new Error('private-credential-detail')
    const diagnostics: unknown[] = []
    const target = { kind: 'adapter', connection, freshness: 'auto' } as const
    const error = await rejection(executeSearch(target, { query: 'q' }, { credential: async () => { throw failure }, onDiagnostic: cause => { diagnostics.push(cause) } }))
    expect(error.message).not.toContain('private-credential-detail')
    expect(error.cause).toBeUndefined()
    expect(diagnostics).toEqual([failure])
    const missing = await rejection(executeSearch(target, { query: 'q' }, { credential: async () => undefined }))
    expect(missing.message).toContain('ask the user to')
  })
  it('sends JSON, refuses redirects and parses the reply', async () => {
    const fetch = stub(async () => Response.json({ ok: true }))
    await expect(search()).resolves.toEqual({ ok: true })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(REQUEST.url)
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', body: '{"query":"q"}' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('reports transport failures (including refused redirects) without their details', async () => {
    stub(async () => { throw new TypeError('redirect to https://secret.test?key=fixture-key') })
    const error = await rejection(search())
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('Fixture could not be reached') })
    expect(error.message).not.toMatch(/secret|fixture-key/)
    expect(error.cause).toBeUndefined()
  })

  it.each<[number, Upstream['access'], string]>([
    [401, 'api-key', 'WEB_PROVIDER_ERROR'],
    [403, 'api-key', 'WEB_PROVIDER_ERROR'],
    [401, 'keyless', 'WEB_PROVIDER_ERROR'],
    [403, 'keyless', 'WEB_PROVIDER_ERROR'],
    [401, 'account', 'WEB_PROVIDER_ERROR'],
    [402, 'api-key', 'WEB_PROVIDER_ERROR'],
    [429, 'keyless', 'WEB_PROVIDER_ERROR'],
    [500, 'api-key', 'WEB_PROVIDER_ERROR'],
  ])('maps HTTP %i (%s) to %s without reading the body', async (status, access, code) => {
    const cancel = vi.fn()
    stub(async () => new Response(new ReadableStream({ start: c => { c.enqueue(new TextEncoder().encode('private upstream body')) }, cancel }), { status }))
    const error = await rejection(search(undefined, { label: 'Fixture', access }))
    expect(error).toMatchObject({ code, message: expect.stringContaining(`HTTP ${status}`) })
    expect(error.message).not.toContain('private')
    expect(cancel).toHaveBeenCalled()
  })

  it('rejects bodies that are not JSON without echoing them', async () => {
    stub(async () => new Response('private-invalid-json'))
    const error = await rejection(search())
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(error.message).not.toContain('private')
  })

  it('reports a body that breaks off without its cause', async () => {
    stub(async () => new Response(new ReadableStream({ pull: c => { c.error(new Error('secret socket detail')) } })))
    const error = await rejection(search())
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('broke off') })
    expect(error.message).not.toContain('secret')
    expect(error.cause).toBeUndefined()
  })

  it.each([true, false])('caps the body at 2 MiB (declared length: %s)', async declared => {
    const cancel = vi.fn()
    const chunk = new Uint8Array(MAX_RESPONSE_BYTES / 2 + 1)
    const body = new ReadableStream<Uint8Array>({ pull: c => { c.enqueue(chunk) }, cancel })
    stub(async () => new Response(body, { headers: declared ? { 'content-length': String(MAX_RESPONSE_BYTES + 1) } : {} }))
    await expect(search()).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('exceeds 2 MiB') })
    if (!declared) expect(cancel).toHaveBeenCalled()
  })

  it('aborts a pending request and releases a stalled body', async () => {
    stub(hanging)
    const first = new AbortController()
    const pending = search(first.signal)
    first.abort('sensitive reason')
    const error = await rejection(pending)
    expect(error).toMatchObject({ code: 'WEB_ABORTED' })
    expect(error.message).not.toContain('sensitive')
    expect(error.cause).toBeUndefined()

    const { body, cancel, started } = stalledBody()
    stub(async () => new Response(body))
    const second = new AbortController()
    const reading = search(second.signal)
    await started
    second.abort()
    await expect(reading).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(cancel).toHaveBeenCalled()
  })

  it.each(['request', 'body'] as const)('times out a stalled %s after 90 s', async stall => {
    vi.useFakeTimers()
    const { body, cancel } = stalledBody()
    stub(stall === 'request' ? hanging : async () => new Response(body))
    const pending = expect(search()).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    await pending
    if (stall === 'body') expect(cancel).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('abortable', () => {
  it('observes work an already-cancelled search no longer waits for', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const late = Promise.withResolvers<never>()
      await expect(abortable(late.promise, AbortSignal.abort())).rejects.toMatchObject({ code: 'WEB_ABORTED' })
      late.reject(new Error('late failure'))
      await new Promise(resolve => setImmediate(resolve))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})


async function localServer(handler: RequestListener) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected a TCP listener')
  return {
    url: 'http://127.0.0.1:' + address.port,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => { if (error === undefined) resolve(); else reject(error) }))
    },
  }
}

describe('real HTTP boundary', () => {
  it('rejects the API redirect without accessing its target or leaking credentials', async () => {
    let targetVisits = 0
    let authorization: string | undefined
    const server = await localServer((req, res) => {
      if (req.url === '/target') { targetVisits++; res.end('{}'); return }
      authorization = req.headers.authorization
      res.writeHead(307, { location: '/target' })
      res.end('private upstream body')
    })
    try {
      const request: HttpRequest = { ...REQUEST, url: server.url + '/api', headers: { authorization: 'Bearer fixture-secret' } }
      const error = await rejection(withDeadline(undefined, signal => requestJson(request, signal, UPSTREAM)))
      expect(error).toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
      expect(error.message).not.toMatch(/127\.0\.0\.1|fixture-secret|private upstream/)
      expect(authorization).toBe('Bearer fixture-secret')
      expect(targetVisits).toBe(0)
    } finally { await server.close() }
  })

  it.each([true, false])('enforces byte limits on real HTTP (Content-Length: %s)', async declared => {
    const server = await localServer((_req, res) => {
      if (declared) res.setHeader('content-length', String(MAX_RESPONSE_BYTES + 1))
      else res.setHeader('transfer-encoding', 'chunked')
      res.end(Buffer.alloc(MAX_RESPONSE_BYTES + 1, 65))
    })
    try {
      await expect(withDeadline(undefined, signal => requestJson({ ...REQUEST, url: server.url }, signal, UPSTREAM))).rejects.toMatchObject({
        code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('exceeds 2 MiB'),
      })
    } finally { await server.close() }
  })

  it('cancels while reading a real HTTP response, using a chunk barrier rather than timing', async () => {
    const server = await localServer((_req, res) => { res.writeHead(200); res.write('partial response') })
    const controller = new AbortController()
    const received = Promise.withResolvers<void>()
    try {
      const pending = withDeadline(controller.signal, async signal => {
        const response = await fetch(server.url, { signal, redirect: 'error' })
        for await (const chunk of readText(response, signal)) { if (chunk !== '') received.resolve() }
      })
      await received.promise
      controller.abort('private abort reason')
      const error = await rejection(pending)
      expect(error).toMatchObject({ code: 'WEB_ABORTED' })
      expect(error.message).not.toContain('private')
    } finally { await server.close() }
  })
})
