import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '../packages/search-enhanced/src/host/remote.ts'
import { PROFILE_PACKAGE, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { stringify } from 'yaml'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { messagesAnswer, modelDocument, modelFixture, piAiFixture, piAiRows, responsesAnswer } from './fixtures/search-model.ts'
import { addPlugins, artifacts, enterIsolatedEnvironment } from './harness/environment.ts'
import { bootHost } from './harness/host.ts'
import { modelResponse, startModelApi } from './harness/model-api.ts'
import { upgradeEnvironment } from './harness/upgrade.ts'

const e2e = upgradeEnvironment(inject('e2e'))
const require = createRequire(join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json'))
const credentials = require('@deepseek-ai/dsh-credentials') as { credentialRef: typeof credentialRef }
const key = credentials.credentialRef(modelFixture.credentialRef)
const deepseekKey = credentials.credentialRef('DEEPSEEK_API_KEY')

describe('Model search in the real Host', () => {
  let api: Awaited<ReturnType<typeof startModelApi>>
  let overlay: string
  const diagnostics: string[] = []
  const prepare: Parameters<typeof bootHost>[2] = root => {
    root.logger.exporter({ levels: { default: 3 }, export: message => { diagnostics.push(message.args.map(String).join(' ')) } })
  }

  beforeAll(async () => {
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    api = await startModelApi(messagesAnswer())
    overlay = join(dirname(e2e.env.DSH_HOME!), 'model-search.yml')
  })
  afterAll(async () => {
    writeFileSync(join(artifacts, 'search-model-host.log'), diagnostics.join('\n'))
    if (api !== undefined) {
      writeFileSync(join(artifacts, 'search-model-wire-all.json'), JSON.stringify(api.requests, null, 2))
      await api.close()
    }
  })

  it.each(['anthropic-messages', 'openai-responses'] as const)('executes trusted fixed %s with exact answer and filtered sources', async protocol => {
    writeFileSync(overlay, stringify([{ id: SEARCH.rowId, config: modelDocument(api.url, protocol) }]))
    enterIsolatedEnvironment(e2e.env)
    api.respondWith(modelResponse(protocol === 'anthropic-messages' ? messagesAnswer() : responsesAnswer()))
    const start = api.requests.length
    const host = await bootHost(e2e, [overlay], prepare)
    try {
      await host.ctx.credentials.set(key, modelFixture.key)
      const result = await host.web.search({ query: modelFixture.query }, AbortSignal.timeout(15_000))
      expect(result.content).toBe(modelFixture.content)
      expect(result.sources).toEqual(protocol === 'anthropic-messages' ? [{
        url: modelFixture.source, title: 'Model source', snippet: 'source quote', publishedAt: '2026-10-21T00:00:00.000Z',
      }] : [{ url: modelFixture.source, title: 'Model source' }])
      expect(api.requests).toHaveLength(start + 1)
      const request = api.requests[start]!
      const body = JSON.parse(request.body)
      expect(request.method).toBe('POST')
      expect(body.model).toBe(modelFixture.model)
      if (protocol === 'anthropic-messages') {
        expect(request).toMatchObject({ path: '/v1/messages', headers: { 'x-api-key': modelFixture.key, 'anthropic-version': '2023-06-01' } })
        expect(request.headers).not.toHaveProperty('authorization')
        expect(body).toEqual({
          model: modelFixture.model, max_tokens: 4096,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Perform a web search for the query: ' + modelFixture.query }] }],
          tools: [{ type: 'web_search_20260318', name: 'web_search', max_uses: 5 }],
        })
        expect(body).not.toHaveProperty('thinking')
      } else {
        expect(request).toMatchObject({ path: '/responses', headers: { authorization: 'Bearer ' + modelFixture.key } })
        expect(request.headers).not.toHaveProperty('x-api-key')
        expect(body).toEqual({
          model: modelFixture.model,
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Perform a web search for the query: ' + modelFixture.query }] }],
          tools: [{ type: 'web_search' }], tool_choice: 'auto', include: ['web_search_call.action.sources'], store: false, stream: false,
        })
        expect(body).not.toHaveProperty('max_output_tokens')
      }
      writeFileSync(join(artifacts, 'search-model-wire-' + protocol + '.json'), JSON.stringify({ request, result }, null, 2))
    } finally {
      try { await host.ctx.credentials.unset(key) } finally { await host.dispose() }
    }
  })

  it('refuses session-model outside an initiating Agent without sending a request', async () => {
    writeFileSync(overlay, stringify([{ id: SEARCH.rowId, config: { version: 2, defaultConnection: 'builtin:session-model' } }]))
    enterIsolatedEnvironment(e2e.env)
    const start = api.requests.length
    const host = await bootHost(e2e, [overlay], prepare)
    try {
      await expect(host.web.search({ query: modelFixture.query })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
      expect(api.requests).toHaveLength(start)
    } finally { await host.dispose() }
  })

  it('follows a hand-written real pi-ai Responses route after a Session model switch', async () => {
    writeFileSync(overlay, stringify([
      ...piAiRows(api.url),
      { id: SEARCH.rowId, config: { version: 2, defaultConnection: 'builtin:session-model' } },
    ]))
    enterIsolatedEnvironment(e2e.env)
    api.respondWith(modelResponse(responsesAnswer()))
    const start = api.requests.length
    const host = await bootHost(e2e, [overlay], prepare)
    try {
      const entry = host.ctx.llm.listConfigurableProviders().find(item => item.provider === piAiFixture.provider)
      expect(entry).toMatchObject({ settingsNs: 'llm-pi-ai', settingsPath: ['providers', piAiFixture.provider] })
      const { sessionId } = await host.ctx.sessionController.create({ cwd: dirname(e2e.env.DSH_HOME!) })
      // DSH only admits a model switch after that route has usable credentials.
      await host.ctx.credentials.set(key, modelFixture.key)
      await host.ctx.sessionController.selectModel({ sessionId, ...piAiFixture })
      await host.ctx.credentials.unset(key)
      const status = () => host.ctx.searchConnections.get({ sessionId })
      expect((await status()).connections.find(connection => connection.id === 'builtin:session-model')).toMatchObject({ kind: 'model', status: 'needs-credential' })
      await host.ctx.credentials.set(key, modelFixture.key)
      expect((await status()).connections.find(connection => connection.id === 'builtin:session-model')).toMatchObject({ kind: 'model', access: 'api-key', status: 'ready' })
      const resolved = await host.ctx.sessionController.resolveAgent(sessionId)
      if ('error' in resolved) throw resolved.error
      const { agent } = resolved
      agent.session.append('request/context', piAiFixture)
      await host.ctx.waterfall('agent/request', { agent, turn: 1, step: 0, signal: new AbortController().signal } as never,
        (async () => piAiFixture) as never)
      const result = await host.ctx.agents.withInitiator(agent, () => host.web.search({ query: modelFixture.query }, AbortSignal.timeout(15_000)))
      expect(result.content).toBe(modelFixture.content)
      expect(result.sources).toEqual([{ url: modelFixture.source, title: 'Model source' }])
      expect(api.requests).toHaveLength(start + 1)
      const request = api.requests[start]!
      expect(request).toMatchObject({ method: 'POST', path: '/responses', headers: { authorization: 'Bearer ' + modelFixture.key } })
      expect(request.headers).not.toHaveProperty('x-api-key')
      expect(JSON.parse(request.body)).toEqual({
        model: piAiFixture.model,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Perform a web search for the query: ' + modelFixture.query }] }],
        tools: [{ type: 'web_search' }], tool_choice: 'auto', include: ['web_search_call.action.sources'], store: false, stream: false,
      })
      writeFileSync(join(artifacts, 'search-model-wire-pi-ai.json'), JSON.stringify({ entry, route: piAiFixture, request, result }, null, 2))
    } finally {
      try {
        await host.ctx.credentials.unset(key)
        for (const memory of (await host.ctx.searchConnections.pairings({})).pairings) await host.ctx.searchConnections.forgetPairing({ provider: memory.provider, model: memory.model })
      } finally { await host.dispose() }
    }
  })

  it('follows the real Agent request route and launch DeepSeek endpoint with its dialect', async () => {
    writeFileSync(overlay, stringify([{ id: SEARCH.rowId, config: { version: 2, defaultConnection: 'builtin:session-model' } }]))
    const env = { ...e2e.env, DEEPSEEK_BASE_URL: new URL('anthropic', api.url).href }
    enterIsolatedEnvironment(env)
    api.respondWith(modelResponse(messagesAnswer()))
    const start = api.requests.length
    const host = await bootHost({ ...e2e, env }, [overlay], prepare)
    try {
      await host.ctx.credentials.set(deepseekKey, modelFixture.key)
      const { sessionId } = await host.ctx.sessionController.create({ cwd: dirname(e2e.env.DSH_HOME!) })
      const resolved = await host.ctx.sessionController.resolveAgent(sessionId)
      if ('error' in resolved) throw resolved.error
      const { agent } = resolved
      // Public durable request metadata, not a mocked Agent or a model inference request.
      const route = { provider: 'deepseek-official', model: 'deepseek-v4-pro' }
      agent.session.append('request/context', route)
      await host.ctx.waterfall('agent/request', { agent, turn: 1, step: 0, signal: new AbortController().signal } as never,
        (async () => route) as never)
      const result = await host.ctx.agents.withInitiator(agent, () => host.web.search({ query: modelFixture.query }, AbortSignal.timeout(15_000)))
      expect(result.content).toBe(modelFixture.content)
      expect(api.requests).toHaveLength(start + 1)
      const request = api.requests[start]!
      expect(request).toMatchObject({ path: '/anthropic/v1/messages', headers: { 'x-api-key': modelFixture.key, 'anthropic-version': '2023-06-01' } })
      expect(JSON.parse(request.body)).toMatchObject({ model: route.model, max_tokens: 4096, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }], thinking: { type: 'disabled' } })
      writeFileSync(join(artifacts, 'search-model-wire-deepseek.json'), JSON.stringify({ route, request, result }, null, 2))
    } finally {
      try {
        await host.ctx.credentials.unset(deepseekKey)
        for (const memory of (await host.ctx.searchConnections.pairings({})).pairings) await host.ctx.searchConnections.forgetPairing({ provider: memory.provider, model: memory.model })
      } finally { await host.dispose() }
    }
  })
})
