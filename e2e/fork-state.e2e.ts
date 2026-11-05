import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { FETCH, PROFILE_PACKAGE } from 'dsh-tool-web-enhanced-core/shared'
import { expect, inject, it } from 'vitest'
import { toolCall } from '../packages/core/tests/fixtures/tool-call.ts'
import { addPlugins, enterIsolatedEnvironment, isolatedContext } from './harness/environment.ts'
import { bootHost, type Host } from './harness/host.ts'
import { startTextModelApi } from './harness/model-api.ts'

const e2e = isolatedContext(inject('e2e'))

it('real user fork owns its selection and provider list; persisted resume never backfills an empty or existing list', async () => {
  const model = await startTextModelApi('Fork and resume fixture')
  e2e.env.DEEPSEEK_BASE_URL = model.url
  e2e.env.DEEPSEEK_API_KEY = 'fork-fixture-key'
  const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
  if (profile === undefined) throw new Error('profile tarball is missing')
  let host: Host | undefined
  const freshConnection = { kind: 'adapter', adapter: 'exa', label: 'Fork candidate', credentialRef: 'FORK_FIXTURE_KEY' }
  const send = async (agent: Agent) => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Return a short response.' }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  const visible = async (active: Host, agent: Agent) => {
    const toolSet = await active.ctx.tools.resolve({ agent, modelSelection: agent.model.current()!, signal: new AbortController().signal })
    try { return [...toolSet.view(agent).keys()] } finally { toolSet.dispose() }
  }
  const list = async (active: Host, agent: Agent) => {
    const result = await toolCall(active.ctx, { name: FETCH.tools.list, arguments: {}, callId: ToolCallId('fork-list-' + agent.id), agent, signal: new AbortController().signal })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    return result.value as { providers: Array<{ id: string }> }
  }
  try {
    addPlugins(e2e, [profile], plugins)
    enterIsolatedEnvironment(e2e.env)
    host = await bootHost(e2e)
    await host.ctx.settings.update(FETCH.rowId, { version: 2, enhancedTools: false })
    const parentId = (await host.ctx.sessionController.create({ cwd: e2e.env.DSH_HOME! })).sessionId
    const parent = await host.ctx.sessionController.resolveAgent(parentId)
    if ('error' in parent) throw parent.error
    await send(parent.agent)
    await host.ctx.fetchConnections.set({ sessionId: parentId, connectionId: null, expectedRevision: 0 })
    const selection = parent.agent.model.current()!
    await host.ctx.fetchConnections.forgetPairing({ provider: selection.provider, model: selection.model })
    await host.ctx.settings.update(FETCH.rowId, { version: 2, enhancedTools: true, connections: { 'custom:fork': freshConnection } })
    const childId = (await host.ctx.sessionController.fork({ sessionId: parentId })).sessionId
    const child = await host.ctx.sessionController.resolveAgent(childId)
    if ('error' in child) throw child.error
    expect((await host.ctx.fetchConnections.get({ sessionId: parentId })).selection.connectionId).toBeNull()
    expect((await host.ctx.fetchConnections.get({ sessionId: childId })).selection.connectionId).toBe('builtin:local')
    await send(child.agent)
    const parentView = await host.ctx.fetchConnections.get({ sessionId: parentId })
    await host.ctx.fetchConnections.set({ sessionId: parentId, connectionId: 'builtin:local', expectedRevision: parentView.selection.revision })
    expect((await host.ctx.fetchConnections.get({ sessionId: parentId })).selection.connectionId).toBe('builtin:local')
    expect(await visible(host, child.agent)).toContain(FETCH.tools.list)
    expect(await visible(host, parent.agent)).not.toContain(FETCH.tools.list)
    expect((await list(host, child.agent)).providers.map(provider => provider.id)).toEqual(['builtin:local', 'custom:fork'])
    await host.ctx.settings.update(FETCH.rowId, { version: 2, enhancedTools: true, connections: { 'custom:fork': freshConnection, 'custom:later': { ...freshConnection, label: 'Later' } } })
    await host.dispose()
    host = undefined
    host = await bootHost(e2e)
    const restoredParent = await host.ctx.sessionController.resolveAgent(parentId)
    const restoredChild = await host.ctx.sessionController.resolveAgent(childId)
    if ('error' in restoredParent) throw restoredParent.error
    if ('error' in restoredChild) throw restoredChild.error
    expect((await host.ctx.fetchConnections.get({ sessionId: parentId })).selection.connectionId).toBe('builtin:local')
    expect(await visible(host, restoredChild.agent)).toContain(FETCH.tools.list)
    expect(await visible(host, restoredParent.agent)).not.toContain(FETCH.tools.list)
    expect((await list(host, restoredChild.agent)).providers.map(provider => provider.id)).toEqual(['builtin:local', 'custom:fork'])
  } finally {
    try { await host?.dispose() } finally { await model.close() }
  }
})
