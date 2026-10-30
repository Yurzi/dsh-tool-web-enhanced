import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionCreateRequest } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '../packages/search-enhanced/src/host/remote.ts'
import { PROFILE_PACKAGE, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { stringify } from 'yaml'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { toolResults, type MessagesRequest } from './fixtures/enhanced-flow.ts'
import { alphaAnswer, alphaDocument, alphaFixture, modelFixture } from './fixtures/search-model.ts'
import { addPlugins, artifacts, enterIsolatedEnvironment, isolatedContext, profilePatchPath } from './harness/environment.ts'
import { bootHost } from './harness/host.ts'
import { startAgentModelApi, startModelApi } from './harness/model-api.ts'

const e2e = isolatedContext(inject('e2e'))
const require = createRequire(join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json'))
const { credentialRef: ref } = require('@deepseek-ai/dsh-credentials') as { credentialRef: typeof credentialRef }
const { createUserMessage: userMessage } = require('@deepseek-ai/dsh-llm') as { createUserMessage: typeof createUserMessage }
const call = { id: 'alpha_search', name: SEARCH.tools.action, input: { queries: [alphaFixture.query], provider: alphaFixture.connectionId } } as const

describe('Codex Alpha fixed search protocol in the real Host', () => {
  let api: Awaited<ReturnType<typeof startModelApi>>
  let model: Awaited<ReturnType<typeof startAgentModelApi>>
  const diagnostics: string[] = []

  beforeAll(async () => {
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    api = await startModelApi(alphaAnswer())
    model = await startAgentModelApi([call])
    e2e.env.DEEPSEEK_BASE_URL = model.url
    writeFileSync(profilePatchPath(e2e), stringify([{
      id: SEARCH.rowId,
      config: { ...alphaDocument(new URL('v1', api.url).href), enhancedTools: true },
    }]))
    enterIsolatedEnvironment(e2e.env)
  })

  afterAll(async () => {
    writeFileSync(join(artifacts, 'search-codex-alpha-host.log'), diagnostics.join('\n'))
    for (const [name, server] of [['search', api], ['model', model]] as const) {
      if (server !== undefined) {
        writeFileSync(join(artifacts, 'search-codex-alpha-' + name + '-wire.json'), JSON.stringify(server.requests, null, 2))
        await server.close()
      }
    }
  })

  function expectAlphaRequest(index: number) {
    const request = api.requests[index]!
    expect(request).toMatchObject({ method: 'POST', path: '/v1/alpha/search', headers: { authorization: 'Bearer ' + modelFixture.key } })
    expect(request.headers).not.toHaveProperty('x-api-key')
    expect(JSON.parse(request.body)).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u),
      model: alphaFixture.model,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: alphaFixture.query }] }],
      commands: { search_query: [{ q: alphaFixture.query }] },
      settings: { allowed_callers: ['direct'], external_web_access: true },
      max_output_tokens: 2048,
    })
  }

  it('keeps the Alpha answer and normalized sources through the native web provider seat', async () => {
    const host = await bootHost(e2e, [], root => {
      root.logger.exporter({ levels: { default: 3 }, export: message => { diagnostics.push(message.args.map(String).join(' ')) } })
    })
    const key = ref(modelFixture.credentialRef)
    const start = api.requests.length
    try {
      await host.ctx.credentials.set(key, modelFixture.key)
      const result = await host.web.search({ query: alphaFixture.query }, AbortSignal.timeout(15_000))
      expect(result.content).toBe(alphaFixture.content)
      expect(result.sources).toEqual([{ url: alphaFixture.source, title: 'Alpha source' }])
      expect(result.truncated).toBe(false)
      expect(api.requests).toHaveLength(start + 1)
      expectAlphaRequest(start)
      expect(model.requests).toEqual([])
    } finally {
      try { await host.ctx.credentials.unset(key) } finally { await host.dispose() }
    }
  })

  it('preserves Alpha answer and citation in the actual enhanced tool result sent back to the Agent model', async () => {
    const host = await bootHost(e2e)
    const key = ref(modelFixture.credentialRef)
    const modelKey = ref('DEEPSEEK_API_KEY')
    const start = api.requests.length
    try {
      await host.ctx.credentials.set(key, modelFixture.key)
      await host.ctx.credentials.set(modelKey, 'alpha-e2e-loopback-model-only')
      const registry = host.ctx.get('workspaceRegistry') as { create(path: string, title: string): Promise<{ id: NonNullable<SessionCreateRequest['workspaceId']> }> }
      const workspace = await registry.create(e2e.env.DSH_HOME!, 'Codex Alpha loopback workspace')
      const created = await host.ctx.sessionController.create({ workspaceId: workspace.id })
      await host.ctx.sessionController.rename({ sessionId: created.sessionId, title: 'Codex Alpha loopback search' })
      const resolved = await host.ctx.sessionController.resolveAgent(created.sessionId)
      if ('error' in resolved) throw resolved.error
      const before = await host.ctx.searchConnections.get({ sessionId: created.sessionId })
      resolved.agent.followup(userMessage({ content: [{ type: 'text', text: 'Search with the fixed Codex Alpha fixture connection.' }], source: { kind: 'user' } }))
      await resolved.agent.whenIdle()
      expect(model.requests).toHaveLength(2)
      const first = JSON.parse(model.requests[0]!.body) as MessagesRequest
      expect(first.tools.map(tool => tool.name)).toContain(SEARCH.tools.action)
      const results = toolResults(JSON.parse(model.requests[1]!.body) as MessagesRequest)
      expect(results).toHaveLength(1)
      const result = results[0]!
      expect(result.error, result.text).toBe(false)
      expect(result.id).toBe(call.id)
      expect(result.text).toContain(alphaFixture.content)
      expect(result.text).toContain(alphaFixture.source)
      expect(result.text).toContain('Alpha source')
      expect(result.text).not.toContain('javascript:')
      expect(result.text).not.toContain('user:secret')
      expect(api.requests).toHaveLength(start + 1)
      expectAlphaRequest(start)
      expect((await host.ctx.searchConnections.get({ sessionId: created.sessionId })).selection).toEqual(before.selection)
      writeFileSync(join(artifacts, 'search-codex-alpha-tool-result.json'), JSON.stringify(result, null, 2))
    } finally {
      try {
        await host.ctx.credentials.unset(key)
        await host.ctx.credentials.unset(modelKey)
      } finally { await host.dispose() }
    }
  })
})
