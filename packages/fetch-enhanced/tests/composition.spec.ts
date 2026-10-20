/** Real WebRuntime, Settings, session selection and storage-domain; only API network routing is replaced. */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CATALOG } from '../src/catalog.ts'
import type { FetchSettings } from '../src/settings/types.ts'
import { composeFetch } from './fixtures/composition-host.ts'
import { json, readJson, serve } from './fixtures/http.ts'

afterEach(() => { vi.unstubAllGlobals() })

const local: FetchSettings['connections'] = { 'builtin:local': { options: { allowCidrs: ['198.18.0.0/15'] } } }

describe('fetch remote/local composition', () => {
  it('sends private literal and localhost URLs unchanged to the selected custom service, then restores local policy and notice', async () => {
    let targetVisits = 0
    const target = await serve((_request, response) => { targetVisits += 1; response.end('must not be visited') })
    const calls: Array<{ url: unknown; authorization: string | undefined }> = []
    const endpoint = await serve((request, response) => {
      void readJson(request).then(body => {
        calls.push({ url: body.url, authorization: request.headers.authorization })
        json(response, { success: true, data: { markdown: 'service page body' } })
      })
    })
    const h = await composeFetch({ connections: { ...local, 'custom:proxy': { kind: 'adapter', adapter: 'firecrawl', label: 'Local fake service', credentialRef: 'TEST_KEY', endpoint, trustedEndpoint: true } } })
    expect(await h.notice()).toContain('within [198.18.0.0/15]')
    await h.select('custom:proxy')
    expect(h.ctx.storageDomain.get('web_fetch_enhanced')).toBeDefined()
    expect(await h.ctx.fetchConnections.get({ sessionId: h.agent.id })).toMatchObject({ source: 'session', selection: { connectionId: 'custom:proxy', revision: 1 } })
    expect(await h.notice()).toBe('')
    const targets = [target + '/private?token=unchanged#fragment', target.replace('127.0.0.1', 'localhost') + '/private?encoded=%2f%2F', 'http://10.23.45.67/internal?x=raw']
    for (const url of targets) await expect(h.fetch(url)).resolves.toEqual({ url, statusCode: 200, body: { kind: 'text', content: 'service page body' }, truncated: false })
    expect(calls).toEqual(targets.map(url => ({ url, authorization: 'Bearer composition-secret' })))
    expect(targetVisits).toBe(0)

    // Current Settings, not the frozen connection, own the next operation's credentials/options.
    await h.credentials.set(credentialRef('TEST_KEY'), 'rotated-key')
    await h.fetch(targets[0]!)
    expect(calls[3]).toMatchObject({ authorization: 'Bearer rotated-key' })
    await h.select('builtin:local')
    expect(await h.notice()).toContain('within [198.18.0.0/15]')
    await expect(h.fetch(targets[0]!)).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    await expect(h.fetch(targets[1]!)).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    expect(targetVisits).toBe(0)
    expect(calls).toHaveLength(4)
    await h.ctx.settings.update(FETCH.rowId, { connections: { 'builtin:local': { options: { allowCidrs: [] } } } })
    expect(await h.notice()).toBe('')
  })

  it('rebuilds the selected adapter from live Settings without waiting for a new model step', async () => {
    const calls: Record<string, unknown>[] = []
    const first = await serve((request, response) => {
      void readJson(request).then(body => { calls.push({ endpoint: 'first', ...body }); json(response, { success: true, data: { markdown: 'first service' } }) })
    })
    const second = await serve((request, response) => {
      void readJson(request).then(body => { calls.push({ endpoint: 'second', ...body }); json(response, { success: true, data: { markdown: 'second service' } }) })
    })
    const custom = { kind: 'adapter', adapter: 'firecrawl', label: 'Hot service', credentialRef: 'TEST_KEY', endpoint: first, trustedEndpoint: true, options: { storeInCache: true } } as const
    const h = await composeFetch({ connections: { 'custom:hot': custom } })
    await h.select('custom:hot')
    const url = 'http://127.0.0.1:8123/private'
    await expect(h.fetch(url)).resolves.toMatchObject({ body: { content: 'first service' } })
    await h.ctx.settings.update(FETCH.rowId, { connections: { 'custom:hot': { ...custom, endpoint: second, options: { storeInCache: false } } } })
    await expect(h.fetch(url)).resolves.toMatchObject({ body: { content: 'second service' } })
    expect(calls).toEqual([
      { endpoint: 'first', url, formats: ['markdown'], storeInCache: true },
      { endpoint: 'second', url, formats: ['markdown'], storeInCache: false },
    ])
    await h.ctx.settings.update(FETCH.rowId, { connections: { 'custom:hot': { ...custom, disabled: true } } })
    await expect(h.fetch(url)).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
    expect(calls).toHaveLength(2)
  })

  it.each(['firecrawl', 'tavily'] as const)('uses the immutable %s keyless directory endpoint without secret headers', async adapter => {
    const bodies: Record<string, unknown>[] = []
    const apiHeaders: Record<string, unknown>[] = []
    const endpoint = await serve((request, response) => {
      void readJson(request).then(body => {
        bodies.push(body)
        apiHeaders.push(request.headers)
        json(response, adapter === 'firecrawl' ? { success: true, data: { markdown: 'anonymous page' } } : { results: [{ raw_content: 'anonymous page' }], failed_results: [] })
      })
    })
    const h = await composeFetch({ connections: local })
    const ref = credentialRef(CATALOG[adapter].access.apiKey.credentialRef)
    await h.credentials.set(ref, 'keyless-must-not-send-this')
    const nativeFetch = globalThis.fetch
    const routed: string[] = []
    vi.stubGlobal('fetch', (url: string | URL | Request, init: RequestInit) => {
      const address = url instanceof Request ? url.url : url.toString()
      expect(address).toBe(CATALOG[adapter].endpoint)
      expect(init.redirect).toBe('error')
      const headers = new Headers(init.headers)
      expect(headers.has('authorization')).toBe(false)
      expect(headers.has('x-api-key')).toBe(false)
      routed.push(address)
      return nativeFetch(endpoint, init)
    })
    await h.select('builtin:' + adapter)
    expect(await h.notice()).toBe('')
    const url = 'http://localhost:8123/internal?x=%2F#keep'
    await expect(h.fetch(url)).resolves.toMatchObject({ url, statusCode: 200, body: { kind: 'text', content: 'anonymous page' } })
    expect(routed).toEqual([CATALOG[adapter].endpoint])
    expect(bodies).toEqual([adapter === 'firecrawl' ? { url, formats: ['markdown'] } : { urls: [url], include_images: false }])
    expect(apiHeaders).toHaveLength(1)
    expect(apiHeaders[0]).not.toHaveProperty('authorization')
    expect(apiHeaders[0]).not.toHaveProperty('x-api-key')
    expect(JSON.stringify(apiHeaders)).not.toContain('keyless-must-not-send-this')
    if (adapter === 'tavily') expect(apiHeaders[0]).toHaveProperty('x-tavily-access-mode', 'keyless')
  })
})
