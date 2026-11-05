import { createServer } from 'node:http'
import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalBackend, type LocalSettings } from '../src/local/backend.ts'
import type { AddressLookup } from '../src/local/resolver.ts'

// Only preflight DNS is replaced; the official provider and HTTP are real.
const { lookup } = vi.hoisted(() => ({ lookup: vi.fn<AddressLookup>() }))
vi.mock('node:dns/promises', () => ({ lookup }))

beforeEach(() => {
  lookup.mockReset().mockImplementation(async hostname => {
    if (hostname === 'localhost') return [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }]
    if (hostname === 'ipv4only.arpa') return [{ address: '192.0.0.170', family: 4 }]
    throw new Error('unexpected DNS query')
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const seen: string[] = []
const server = createServer((request, response) => {
  seen.push(request.url ?? '')
  if (request.url === '/redirect') {
    response.writeHead(302, { location: 'http://secret-upstream.invalid/token' })
    response.end()
    return
  }
  if (request.url === '/same-origin') {
    response.writeHead(302, { location: '/' })
    response.end()
    return
  }
  if (request.url === '/redirect-loop') {
    response.writeHead(302, { location: '/redirect-loop' })
    response.end()
    return
  }
  if (request.url === '/redirect-credentials') {
    response.writeHead(302, { location: `http://user:password@${request.headers.host}/` })
    response.end()
    return
  }
  if (request.url === '/stream') {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.write('01234')
    response.end('56789')
    return
  }
  if (request.url === '/timeout') return
  if (request.url === '/binary') {
    response.writeHead(200, { 'content-type': 'application/octet-stream' })
    response.end('binary')
    return
  }
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': String(Buffer.byteLength(`ua=${request.headers['user-agent'] ?? ''}`)) })
  response.end(`ua=${request.headers['user-agent'] ?? ''}`)
})
let origin = ''

beforeAll(async () => {
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no server address')
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
})

const settings = (overrides: Partial<LocalSettings> = {}): LocalSettings => ({
  allowCidrs: [],
  allowHostnames: [],
  userAgent: 'wfe-test/1.0',
  maxResponseBytes: 1_000_000,
  maxBodyChars: 10_000,
  timeoutMs: 5_000,
  maxRedirects: 3,
  ...overrides,
})

describe('local provider over the official transport', () => {
  it('does no I/O or settings reads in available()', () => {
    const read = vi.fn(() => settings())
    expect(createLocalBackend(read).available()).toBe(true)
    expect(read).not.toHaveBeenCalled()
  })

  it('preserves caller cancellation before any settings read or connection', async () => {
    const read = vi.fn(() => settings({ allowCidrs: ['127.0.0.1/32'] }))
    const controller = new AbortController()
    controller.abort()
    const before = seen.length
    await expect(createLocalBackend(read).fetch({ url: origin }, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED', message: 'dsh-web-fetch-enhanced: The local fetch was cancelled.' })
    expect(read).not.toHaveBeenCalled()
    expect(seen).toHaveLength(before)
  })

  it('applies allowlist revocation and limits to the very next call', async () => {
    const read = vi.fn(() => settings({ allowCidrs: ['127.0.0.1/32'] }))
    const provider = createLocalBackend(read)
    await expect(provider.fetch({ url: origin })).resolves.toMatchObject({ truncated: false })
    read.mockReturnValue(settings({ allowCidrs: ['127.0.0.1/32'], maxBodyChars: 1 }))
    await expect(provider.fetch({ url: origin })).resolves.toMatchObject({ body: { content: 'u' }, truncated: true })
    read.mockReturnValue(settings({ allowHostnames: ['localhost'] }))
    const before = seen.length
    await expect(provider.fetch({ url: origin })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    expect(seen).toHaveLength(before)
    read.mockReturnValue(settings())
    await expect(provider.fetch({ url: origin })).resolves.toMatchObject({ statusCode: 200 })
    expect(read).toHaveBeenCalledTimes(4)
  })

  it('follows upstream any-address behaviour for empty allowlist settings', async () => {
    const delegated = vi.spyOn(HttpFetchProvider.prototype, 'fetch')
    const controller = new AbortController()
    const provider = createLocalBackend(() => settings())
    for (const url of [origin, origin.replace('127.0.0.1', 'localhost')]) {
      await expect(provider.fetch({ url }, controller.signal)).resolves.toMatchObject({ statusCode: 200 })
      expect(delegated).toHaveBeenLastCalledWith({ url }, controller.signal)
    }
    expect(lookup).not.toHaveBeenCalled()
  })

  it('fetches an allowed private destination with the configured User-Agent and limits', async () => {
    const provider = createLocalBackend(() => settings({ allowCidrs: ['127.0.0.1/32'], maxBodyChars: 6 }))
    await expect(provider.fetch({ url: `${origin}/` })).resolves.toMatchObject({
      statusCode: 200,
      body: { kind: 'text', content: 'ua=wfe' },
      truncated: true,
    })
  })

  it('applies the hostname second factor', async () => {
    const provider = createLocalBackend(() => settings({ allowCidrs: ['127.0.0.0/8', '::1/128'], allowHostnames: ['localhost'] }))
    await expect(provider.fetch({ url: `${origin}/` })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    await expect(provider.fetch({ url: origin.replace('127.0.0.1', 'localhost') })).resolves.toMatchObject({ statusCode: 200 })
  })

  it('preserves native cross-origin redirect instructions', async () => {
    const provider = createLocalBackend(() => settings({ allowCidrs: ['127.0.0.1/32'] }))
    const pending = provider.fetch({ url: `${origin}/redirect` })
    await expect(pending).rejects.toMatchObject({
      code: 'WEB_REDIRECT_BLOCKED', message: 'cross-origin redirect to http://secret-upstream.invalid is not followed automatically; retry against that URL directly',
    })
    await expect(pending).rejects.not.toHaveProperty('cause')
  })

  it.each([
    ['/credentials', {}, 'WEB_BLOCKED_URL', 'credentials in URLs are not allowed'],
    ['/', { maxResponseBytes: 1 }, 'WEB_FETCH_TOO_LARGE', 'response exceeds the maximum of 1 bytes'],
    ['/timeout', { timeoutMs: 10 }, 'WEB_FETCH_TIMEOUT', 'dsh-web-fetch-enhanced: The local fetch timed out.'],
    ['/binary', {}, 'WEB_UNSUPPORTED_CONTENT_TYPE', 'unsupported content type "application/octet-stream"'],
  ] as const)('keeps expected local error details for %s', async (path, limits, code, message) => {
    const provider = createLocalBackend(() => settings({ allowCidrs: ['127.0.0.1/32'], ...limits }))
    const url = path === '/credentials' ? origin.replace('http://', 'http://user:password@') : origin + path
    await expect(provider.fetch({ url })).rejects.toMatchObject({ code, message })
  })

  it('leaves URL credential validation to native transport even for blocked literals', async () => {
    const provider = createLocalBackend(() => settings())
    await expect(provider.fetch({ url: origin.replace('http://', 'http://user:password@') })).rejects.toMatchObject({
      code: 'WEB_BLOCKED_URL', message: 'credentials in URLs are not allowed',
    })
  })

  it('enables public-only filtering for hostname rules without CIDRs', async () => {
    const provider = createLocalBackend(() => settings({ allowHostnames: ['localhost'] }))
    for (const url of [origin, origin.replace('127.0.0.1', 'localhost')]) {
      await expect(provider.fetch({ url })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL', message: 'dsh-web-fetch-enhanced: The destination is outside the local allowlist. Ask the operator to review it.' })
    }
  })

  it('preserves the plugin prefix on preflight DNS failures', async () => {
    const provider = createLocalBackend(() => settings({ allowHostnames: ['failed.test'] }))
    await expect(provider.fetch({ url: 'http://failed.test/' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR', message: 'dsh-web-fetch-enhanced: Unable to resolve the destination. Check DNS and try again.',
    })
  })

  it.each([
    ['localhost', [{ address: '127.0.0.1', family: 4 }]],
    ['mixed.test', [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]],
  ] as const)('refuses %s before entering the official provider or target server', async (hostname, answers) => {
    lookup.mockResolvedValue([...answers])
    const delegated = vi.spyOn(HttpFetchProvider.prototype, 'fetch')
    const before = seen.length
    await expect(createLocalBackend(() => settings({ allowHostnames: [hostname] })).fetch({ url: origin.replace('127.0.0.1', hostname) }))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    expect(delegated).not.toHaveBeenCalled()
    expect(seen).toHaveLength(before)
  })

  it('checks NAT64 translations before delegating', async () => {
    lookup.mockImplementation(async hostname => hostname === 'ipv4only.arpa'
      ? [{ address: '2001:4860:64::c000:aa', family: 6 }]
      : [{ address: '2001:4860:64::c0a8:101', family: 6 }])
    const delegated = vi.spyOn(HttpFetchProvider.prototype, 'fetch')
    await expect(createLocalBackend(() => settings({ allowHostnames: ['nat64.test'] })).fetch({ url: 'http://nat64.test/' }))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    expect(delegated).not.toHaveBeenCalled()
  })

  it('passes an allowed hostname URL unchanged to the official provider', async () => {
    const delegated = vi.spyOn(HttpFetchProvider.prototype, 'fetch')
    const request = { url: origin.replace('127.0.0.1', 'localhost') }
    const provider = createLocalBackend(() => settings({ allowCidrs: ['127.0.0.0/8', '::1/128'], allowHostnames: ['localhost'] }))
    await expect(provider.fetch(request)).resolves.toMatchObject({ url: request.url + '/', statusCode: 200 })
    expect(delegated).toHaveBeenCalledWith(request, expect.any(AbortSignal))
    expect(lookup.mock.calls.map(([hostname]) => hostname)).toEqual(['localhost', 'ipv4only.arpa'])
  })

  it.each(['cancel', 'timeout', 'both'] as const)('stops pending DNS on %s without delegating a late answer', async reason => {
    vi.useFakeTimers()
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const cleared = vi.spyOn(globalThis, 'clearTimeout')
    const answer = Promise.withResolvers<Awaited<ReturnType<AddressLookup>>>()
    lookup.mockReturnValue(answer.promise)
    const delegated = vi.spyOn(HttpFetchProvider.prototype, 'fetch')
    const logger = { debug: vi.fn() }
    const controller = new AbortController()
    const provider = createLocalBackend(() => settings({ allowHostnames: ['localhost'], timeoutMs: 50 }), logger)
    const outcome = provider.fetch({ url: origin.replace('127.0.0.1', 'localhost') }, controller.signal).catch((error: unknown) => error)
    if (reason === 'cancel') controller.abort()
    else if (reason === 'both') {
      vi.advanceTimersByTime(50)
      controller.abort()
    } else await vi.advanceTimersByTimeAsync(50)
    await expect(outcome).resolves.toMatchObject(reason !== 'timeout'
      ? { code: 'WEB_ABORTED', message: 'dsh-web-fetch-enhanced: The local fetch was cancelled.' }
      : { code: 'WEB_FETCH_TIMEOUT', message: 'dsh-web-fetch-enhanced: The local fetch timed out.' })
    answer.resolve([{ address: '8.8.8.8', family: 4 }])
    await Promise.resolve()
    expect(delegated).not.toHaveBeenCalled()
    expect(logger.debug).not.toHaveBeenCalled()
    expect(cleared).toHaveBeenCalledWith(timers.mock.results[0]!.value)
  })

  it.each(['cancel', 'timeout'] as const)('stops pending NAT64 discovery on %s before delegation', async reason => {
    vi.useFakeTimers()
    lookup.mockImplementation(hostname => hostname === 'ipv4only.arpa'
      ? new Promise(() => {})
      : Promise.resolve([{ address: '2001:4860:64::c0a8:101', family: 6 }]))
    const delegated = vi.spyOn(HttpFetchProvider.prototype, 'fetch')
    const controller = new AbortController()
    const provider = createLocalBackend(() => settings({ allowHostnames: ['nat64.test'], timeoutMs: 50 }))
    const outcome = provider.fetch({ url: 'http://nat64.test/' }, controller.signal).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(lookup.mock.calls.map(([hostname]) => hostname)).toEqual(['nat64.test', 'ipv4only.arpa'])
    if (reason === 'cancel') controller.abort()
    else await vi.advanceTimersByTimeAsync(50)
    await expect(outcome).resolves.toMatchObject({ code: reason === 'cancel' ? 'WEB_ABORTED' : 'WEB_FETCH_TIMEOUT' })
    expect(delegated).not.toHaveBeenCalled()
  })

  it('shares the overall timeout between DNS preflight and the official request', async () => {
    vi.useFakeTimers()
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const cleared = vi.spyOn(globalThis, 'clearTimeout')
    const answer = Promise.withResolvers<Awaited<ReturnType<AddressLookup>>>()
    lookup.mockReturnValue(answer.promise)
    const delegated = vi.spyOn(HttpFetchProvider.prototype, 'fetch')
    const provider = createLocalBackend(() => settings({ allowCidrs: ['127.0.0.1/32'], timeoutMs: 50 }))
    const outcome = provider.fetch({ url: origin.replace('127.0.0.1', 'localhost') + '/timeout' }).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(30)
    answer.resolve([{ address: '127.0.0.1', family: 4 }])
    await vi.advanceTimersByTimeAsync(0)
    expect(delegated).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(20)
    await expect(outcome).resolves.toMatchObject({ code: 'WEB_FETCH_TIMEOUT', message: 'dsh-web-fetch-enhanced: The local fetch timed out.' })
    expect(delegated.mock.calls[0]![1]!.aborted).toBe(true)
    expect(cleared).toHaveBeenCalledWith(timers.mock.results[0]!.value)
  })

  it('keeps native same-origin redirects, redirect limits and streamed byte caps', async () => {
    const provider = createLocalBackend(() => settings({ allowCidrs: ['127.0.0.1/32'], maxResponseBytes: 6, maxRedirects: 1 }))
    await expect(provider.fetch({ url: origin + '/same-origin' })).rejects.toMatchObject({ code: 'WEB_FETCH_TOO_LARGE' })
    await expect(provider.fetch({ url: origin + '/redirect-loop' })).rejects.toMatchObject({ code: 'WEB_REDIRECT_BLOCKED', message: 'exceeded the maximum of 1 redirects' })
    await expect(provider.fetch({ url: origin + '/redirect-credentials' })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL', message: 'credentials in URLs are not allowed' })
    await expect(provider.fetch({ url: origin + '/stream' })).resolves.toMatchObject({ body: { content: '012345' }, truncated: true })
  })

  it.each([
    { allowCidrs: ['not-a-cidr'] },
    { allowHostnames: ['http://localhost'] },
  ])('never treats invalid rules %j as disabled filtering', async rules => {
    const delegated = vi.spyOn(HttpFetchProvider.prototype, 'fetch')
    const logger = { debug: vi.fn() }
    await expect(createLocalBackend(() => settings(rules), logger).fetch({ url: origin }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'dsh-web-fetch-enhanced: The local fetch failed. Check the URL and local connection settings.' })
    expect(delegated).not.toHaveBeenCalled()
    expect(lookup).not.toHaveBeenCalled()
    expect(logger.debug).toHaveBeenCalledOnce()
  })

  it.each([
    ['malformed', 'not a URL', 'WEB_INVALID_URL'],
    ['scheme', 'ftp://localhost/', 'WEB_INVALID_URL'],
    ['credentials', 'http://user:password@localhost/', 'WEB_BLOCKED_URL'],
    ['length', 'http://localhost/' + 'x'.repeat(2048), 'WEB_INVALID_URL'],
  ])('leaves invalid URL %s to the official provider without DNS', async (_reason, url, code) => {
    const delegated = vi.spyOn(HttpFetchProvider.prototype, 'fetch')
    await expect(createLocalBackend(() => settings({ allowHostnames: ['localhost'] })).fetch({ url }))
      .rejects.toMatchObject({ code })
    expect(delegated).toHaveBeenCalledOnce()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('logs unexpected exceptions and exposes only a generic provider error', async () => {
    const error = new Error('internal secret details')
    const logger = { debug: vi.fn() }
    const provider = createLocalBackend(() => { throw error }, logger)
    await expect(provider.fetch({ url: origin })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'dsh-web-fetch-enhanced: The local fetch failed. Check the URL and local connection settings.' })
    expect(logger.debug).toHaveBeenCalledWith('Local fetch failed', error)
  })

  it('reads settings once per request, so edits apply to the next fetch', async () => {
    const read = vi.fn(() => settings({ allowHostnames: ['localhost'] }))
    const provider = createLocalBackend(read)
    await expect(provider.fetch({ url: `${origin}/` })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    read.mockReturnValue(settings({ allowCidrs: ['127.0.0.1/32'], userAgent: '' }))
    await expect(provider.fetch({ url: `${origin}/` })).resolves.toMatchObject({ body: { content: 'ua=' } })
    expect(read).toHaveBeenCalledTimes(2)
  })
})
