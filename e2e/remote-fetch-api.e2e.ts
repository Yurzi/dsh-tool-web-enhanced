import { describe, expect, it } from 'vitest'
import { startRemoteFetchApi } from './harness/remote-fetch-api.ts'

describe('Loopback remote fetch API fixture', () => {
  it('records methods, raw paths, headers and bodies without reaching the target URL', async () => {
    const api = await startRemoteFetchApi({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' })
    const body = '{"url":"https://example.invalid/a%2Fb?q=x%20y&n=1#fragment","text":"网页"}'
    try {
      const response = await fetch(new URL('extract?mode=a%2Fb', api.url), {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-fixture': 'wire-value' }, body,
      })
      expect(await response.json()).toEqual({ ok: true })
      expect(api.requests).toHaveLength(1)
      expect(api.requests[0]).toMatchObject({
        method: 'POST', path: '/extract?mode=a%2Fb', body,
        headers: { 'content-type': 'application/json', 'x-fixture': 'wire-value' },
      })
      expect(api.requests[0]!.headers).not.toHaveProperty('authorization')
      expect(api.requests[0]!.headers).not.toHaveProperty('x-api-key')
    } finally {
      await api.close()
    }
  })

  it('allows changing the response and retains every request', async () => {
    const api = await startRemoteFetchApi({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'first' })
    try {
      expect(await (await fetch(api.url)).text()).toBe('first')
      api.respondWith({ status: 429, headers: { 'content-type': 'application/json', 'x-fixture': 'second' }, body: '{"error":"fixture quota"}' })
      const response = await fetch(new URL('second', api.url), { method: 'PUT', body: 'second request' })
      expect(response.status).toBe(429)
      expect(response.headers.get('x-fixture')).toBe('second')
      expect(await response.json()).toEqual({ error: 'fixture quota' })
      expect(api.requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
        { method: 'GET', path: '/', body: '' },
        { method: 'PUT', path: '/second', body: 'second request' },
      ])
    } finally {
      await api.close()
    }
  })
})
