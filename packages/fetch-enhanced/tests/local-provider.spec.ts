import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLocalBackend, type LocalSettings } from '../src/local/backend.ts'

// Only DNS is replaced: transport, address pinning and HTTP are real.
vi.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) => {
    if (hostname === 'localhost') return [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }]
    if (hostname === 'ipv4only.arpa') return [{ address: '192.0.0.170', family: 4 }]
    throw new Error('unexpected DNS query')
  },
}))

const seen: string[] = []
const server = createServer((request, response) => {
  seen.push(request.url ?? '')
  if (request.url === '/redirect') {
    response.writeHead(302, { location: 'http://secret-upstream.invalid/token' })
    response.end()
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
    await expect(createLocalBackend(read).fetch({ url: origin }, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(read).not.toHaveBeenCalled()
    expect(seen).toHaveLength(before)
  })

  it('applies allowlist revocation and limits to the very next call', async () => {
    const read = vi.fn(() => settings({ allowCidrs: ['127.0.0.1/32'] }))
    const provider = createLocalBackend(read)
    await expect(provider.fetch({ url: origin })).resolves.toMatchObject({ truncated: false })
    read.mockReturnValue(settings({ allowCidrs: ['127.0.0.1/32'], maxBodyChars: 1 }))
    await expect(provider.fetch({ url: origin })).resolves.toMatchObject({ body: { content: 'u' }, truncated: true })
    read.mockReturnValue(settings())
    const before = seen.length
    await expect(provider.fetch({ url: origin })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    expect(seen).toHaveLength(before)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('keeps loopback blocked until the operator allows it', async () => {
    const provider = createLocalBackend(() => settings())
    await expect(provider.fetch({ url: `${origin}/` })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
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
    ['/timeout', { timeoutMs: 10 }, 'WEB_FETCH_TIMEOUT', 'web fetch timed out'],
    ['/binary', {}, 'WEB_UNSUPPORTED_CONTENT_TYPE', 'unsupported content type "application/octet-stream"'],
  ] as const)('preserves native error details for %s', async (path, limits, code, message) => {
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

  it('uses plugin wording only for its own literal and resolver blocks', async () => {
    const provider = createLocalBackend(() => settings())
    for (const url of [origin, origin.replace('127.0.0.1', 'localhost')]) {
      await expect(provider.fetch({ url })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL', message: 'The destination is outside the local allowlist. Ask the operator to review it.' })
    }
  })

  it('logs unexpected exceptions and exposes only a generic provider error', async () => {
    const error = new Error('internal secret details')
    const logger = { debug: vi.fn() }
    const provider = createLocalBackend(() => { throw error }, logger)
    await expect(provider.fetch({ url: origin })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'The local fetch failed. Check the URL and local connection settings.' })
    expect(logger.debug).toHaveBeenCalledWith('Local fetch failed', error)
  })

  it('reads settings once per request, so edits apply to the next fetch', async () => {
    const read = vi.fn(() => settings())
    const provider = createLocalBackend(read)
    await expect(provider.fetch({ url: `${origin}/` })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    read.mockReturnValue(settings({ allowCidrs: ['127.0.0.1/32'], userAgent: '' }))
    await expect(provider.fetch({ url: `${origin}/` })).resolves.toMatchObject({ body: { content: 'ua=' } })
    expect(read).toHaveBeenCalledTimes(2)
  })
})
