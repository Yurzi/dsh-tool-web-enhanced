import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { createUserMessage } from '@deepseek-ai/dsh-llm'
import { PROFILE_PACKAGE } from 'dsh-tool-web-enhanced-core/shared'
import { stringify } from 'yaml'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { anysearchFixture as fixture, anysearchRows, anysearchSearchResponse, anysearchExtractResponse, anysearchInvalidResponse } from './fixtures/anysearch.ts'
import { type MessagesRequest, toolResults } from './fixtures/enhanced-flow.ts'
import { isolatedContext, addPlugins, artifacts, enterIsolatedEnvironment } from './harness/environment.ts'
import { bootHost } from './harness/host.ts'
import { startAgentModelApi } from './harness/model-api.ts'
import { startRemoteFetchApi } from './harness/remote-fetch-api.ts'

const e2e = isolatedContext(inject('e2e'))
const require = createRequire(join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json'))
const { credentialRef: ref } = require('@deepseek-ai/dsh-credentials') as { credentialRef: typeof credentialRef }
const { createUserMessage: userMessage } = require('@deepseek-ai/dsh-llm') as { createUserMessage: typeof createUserMessage }
const key = ref(fixture.credentialRef)
const invalidMessage = 'dsh-web-fetch-enhanced: ' + fixture.fetchLabel + ' refused the URL as invalid or not allowed; check the URL'
  + '\n\n' + fixture.fetchLabel + ' responded (untrusted): URL is invalid.'

const calls = [
  { id: 'm7_search', name: 'web_search', input: { queries: [fixture.query] } },
  { id: 'm7_fetch', name: 'web_fetch', input: { url: fixture.url } },
  { id: 'm7_invalid', name: 'web_fetch', input: { url: fixture.invalidUrl } },
]

describe('AnySearch through the real DSH with loopback services only', () => {
  let api: Awaited<ReturnType<typeof startRemoteFetchApi>>
  let model: Awaited<ReturnType<typeof startAgentModelApi>>
  let overlay: string

  beforeAll(async () => {
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('The global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    api = await startRemoteFetchApi(request => {
      if (request.path === '/v1/search') return anysearchSearchResponse()
      if (request.path !== '/v1/extract') throw new Error('Unexpected loopback API path: ' + request.path)
      const body = JSON.parse(request.body) as { url: string }
      return body.url === fixture.invalidUrl ? anysearchInvalidResponse() : anysearchExtractResponse(body.url)
    })
    model = await startAgentModelApi(calls, 'AnySearch native tools completed against loopback.')
    e2e.env.DEEPSEEK_BASE_URL = model.url
    overlay = join(dirname(e2e.env.DSH_HOME!), 'anysearch.yml')
    writeFileSync(overlay, stringify(anysearchRows(api.url)))
  })

  afterAll(async () => {
    if (api !== undefined) {
      writeFileSync(join(artifacts, 'm7-anysearch-wire.json'), JSON.stringify(api.requests, null, 2))
      await api.close()
    }
    if (model !== undefined) {
      writeFileSync(join(artifacts, 'm7-anysearch-model-wire.json'), JSON.stringify(model.requests, null, 2))
      await model.close()
    }
  })

  it('maps search sources and sends the configured query, limit, region and language with Bearer auth', async () => {
    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e, [overlay])
    const start = api.requests.length
    try {
      await host.ctx.credentials.set(key, fixture.key)
      expect(await host.ctx.credentials.describe(key)).toMatchObject({ configured: true })
      const result = await host.web.search({ query: fixture.query, maxResults: 3 }, AbortSignal.timeout(15_000))
      expect(result.sources).toEqual([fixture.source])
      expect(api.requests).toHaveLength(start + 1)
      expect(api.requests[start]).toMatchObject({ method: 'POST', path: '/v1/search', headers: { authorization: 'Bearer ' + fixture.key, 'content-type': 'application/json' } })
      expect(JSON.parse(api.requests[start]!.body)).toEqual({ query: fixture.query, max_results: 3, zone: 'intl', language: 'en' })
    } finally {
      try { await host.ctx.credentials.unset(key) } finally { await host.dispose() }
    }
  })

  it('maps extract to the exact text and sends only url with Bearer auth', async () => {
    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e, [overlay])
    const start = api.requests.length
    try {
      await host.ctx.credentials.set(key, fixture.key)
      const result = await host.web.fetch({ url: fixture.url }, AbortSignal.timeout(15_000))
      expect(result).toEqual({ url: fixture.url, statusCode: 200, body: { kind: 'text', content: fixture.content }, truncated: false })
      expect(api.requests).toHaveLength(start + 1)
      expect(api.requests[start]).toMatchObject({ method: 'POST', path: '/v1/extract', headers: { authorization: 'Bearer ' + fixture.key, 'content-type': 'application/json' } })
      expect(JSON.parse(api.requests[start]!.body)).toEqual({ url: fixture.url })
    } finally {
      try { await host.ctx.credentials.unset(key) } finally { await host.dispose() }
    }
  })

  it('classifies HTTP 400 invalid_extract_url with the operator label and untrusted explanation', async () => {
    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e, [overlay])
    const start = api.requests.length
    try {
      await host.ctx.credentials.set(key, fixture.key)
      await expect(host.web.fetch({ url: fixture.invalidUrl }, AbortSignal.timeout(15_000))).rejects.toMatchObject({ code: 'WEB_INVALID_URL', message: invalidMessage })
      expect(api.requests).toHaveLength(start + 1)
      expect(JSON.parse(api.requests[start]!.body)).toEqual({ url: fixture.invalidUrl })
    } finally {
      try { await host.ctx.credentials.unset(key) } finally { await host.dispose() }
    }
  })

  it('delivers native web_search and web_fetch successes and invalid URL wording to the real Agent', async () => {
    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e, [overlay])
    const modelKey = ref('DEEPSEEK_API_KEY')
    const start = api.requests.length
    try {
      await host.ctx.credentials.set(key, fixture.key)
      await host.ctx.credentials.set(modelKey, 'm7-agent-model-loopback-only-key')
      const created = await host.ctx.sessionController.create({ cwd: dirname(e2e.env.DSH_HOME!) })
      await host.ctx.sessionController.rename({ sessionId: created.sessionId, title: 'M7 AnySearch native tools' })
      const resolved = await host.ctx.sessionController.resolveAgent(created.sessionId)
      if ('error' in resolved) throw resolved.error
      resolved.agent.followup(userMessage({ content: [{ type: 'text', text: 'Exercise the native web tools on the loopback connections.' }], source: { kind: 'user' } }))
      await resolved.agent.whenIdle()
      expect(model.requests).toHaveLength(2)
      const results = toolResults(JSON.parse(model.requests[1]!.body) as MessagesRequest)
      expect(results).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'm7_search', error: false, text: expect.stringContaining(fixture.source.url) }),
        expect.objectContaining({ id: 'm7_fetch', error: false, text: expect.stringContaining(fixture.content) }),
        expect.objectContaining({ id: 'm7_invalid', error: true, text: expect.stringContaining(invalidMessage) }),
      ]))
      expect(api.requests).toHaveLength(start + 3)
      for (const request of api.requests.slice(start)) {
        expect(request.method).toBe('POST')
        expect(request.headers.authorization).toBe('Bearer ' + fixture.key)
        const body = JSON.parse(request.body)
        if (request.path === '/v1/search') expect(body).toEqual({ query: fixture.query, max_results: 8, zone: 'intl', language: 'en' })
        else expect(Object.keys(body)).toEqual(['url'])
      }
    } finally {
      try {
        await host.ctx.credentials.unset(key)
        await host.ctx.credentials.unset(modelKey)
      } finally { await host.dispose() }
    }
  })
})
