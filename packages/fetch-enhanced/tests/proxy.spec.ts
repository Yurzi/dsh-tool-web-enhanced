import { createServer } from 'node:http'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalBackend } from '../src/local/backend.ts'

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn(async (hostname: string) => {
  if (hostname === 'localhost') return [{ address: '127.0.0.1', family: 4 }]
  if (hostname === 'ipv4only.arpa') return [{ address: '192.0.0.170', family: 4 }]
  throw new Error('proxied hostnames must not use local DNS')
}) }))
vi.mock('node:dns/promises', () => ({ lookup }))
beforeEach(() => { lookup.mockClear() })

const seen: string[] = []
const proxy = createServer((request, response) => {
  seen.push(request.url ?? '')
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end('via proxy')
})
let uninstall: () => Promise<void>

beforeAll(async () => {
  await new Promise<void>((resolve) => { proxy.listen(0, '127.0.0.1', resolve) })
  const address = proxy.address()
  if (address === null || typeof address === 'string') throw new Error('no proxy address')
  // The launcher installs this policy for the whole process before plugins load.
  const value = `http://127.0.0.1:${address.port}`
  uninstall = await installProxyFromEnvironment({ get: name => name === 'HTTP_PROXY' ? { value } : undefined }, () => {})
})

afterAll(async () => {
  await uninstall()
  proxy.closeAllConnections()
  await new Promise(resolve => proxy.close(resolve))
})

const settings = () => ({
  allowCidrs: [],
  allowHostnames: ['only-the-proxy-can-resolve.invalid'],
  userAgent: 'wfe-test/1.0',
  maxResponseBytes: 100_000,
  maxBodyChars: 10_000,
  timeoutMs: 5_000,
  maxRedirects: 0,
})
const provider = createLocalBackend(settings)

describe('local provider behind an outbound proxy', () => {
  it('sends public destinations through the proxy', async () => {
    await expect(provider.fetch({ url: 'http://93.184.216.34/page' })).resolves.toMatchObject({ body: { content: 'via proxy' } })
    expect(seen).toEqual(['http://93.184.216.34/page'])
  })

  it('delegates hostname resolution to the proxy even with filtering enabled', async () => {
    seen.length = 0
    await expect(provider.fetch({ url: 'http://only-the-proxy-can-resolve.invalid/page' }))
      .resolves.toMatchObject({ body: { content: 'via proxy' } })
    expect(seen).toEqual(['http://only-the-proxy-can-resolve.invalid/page'])
    expect(lookup).not.toHaveBeenCalled()
  })

  it('preflights a proxy-bypassed hostname instead of delegating its DNS', async () => {
    seen.length = 0
    await expect(provider.fetch({ url: 'http://localhost:8080/private' })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    expect(lookup).toHaveBeenCalledWith('localhost', { all: true, order: 'verbatim' })
    expect(seen).toEqual([])
  })

  it('keeps upstream any-address proxy behaviour when both rule lists are empty', async () => {
    seen.length = 0
    const unfiltered = createLocalBackend(() => ({ ...settings(), allowHostnames: [] }))
    await expect(unfiltered.fetch({ url: 'http://10.0.0.1/private' })).resolves.toMatchObject({ body: { content: 'via proxy' } })
    expect(seen).toEqual(['http://10.0.0.1/private'])
    expect(lookup).not.toHaveBeenCalled()
  })

  it.each(['http://[::7f00:1]:8080/', 'http://[::a00:1]/', 'http://10.0.0.1/'])('never hands a disallowed IP literal to the proxy: %s', async (url) => {
    seen.length = 0
    await expect(provider.fetch({ url })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    expect(seen).toEqual([])
  })
})
