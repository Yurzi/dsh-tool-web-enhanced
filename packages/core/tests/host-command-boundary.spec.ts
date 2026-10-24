import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Message } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Projections from '@deepseek-ai/dsh-session-projection'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import WebRuntime, { WebError } from '@deepseek-ai/dsh-web'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import { afterEach, expect, it } from 'vitest'
import { installCapability, type CapabilityRuntime } from '../src/host/runtime.ts'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import type { PeerId, PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import { searchCapability } from '../../search-enhanced/src/host/runtime.ts'
import { resolveSettings } from '../../search-enhanced/src/settings/resolve.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).toReversed()) await cleanup() })

async function host(document: object = {}, describeGate?: () => Promise<void>, terminalFailure = false) {
  const root = await mkdtemp(join(tmpdir(), 'command-boundary-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const logs: Message[] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: message => { logs.push(message) } })
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(WebRuntime, {})
  if (terminalFailure) ctx.provide('tuiCommandTrees', { register() { throw new Error('completion fixture rejected') } })
  const settings = () => resolveSettings(document)
  const capability = searchCapability(ctx, settings)
  let runtime: CapabilityRuntime<{ readonly freshness: 'auto' | 'fresh' | 'realtime' }>
  await ctx.plugin({ name: 'search-command-boundary', inject: ['web'], apply(scope: Context) {
    runtime = installCapability(scope, { ...capability, describe: async (current, model) => {
      if (describeGate !== undefined) await describeGate()
      return capability.describe(current, model)
    } })
  } })
  await ctx.fiber.await()
  const handle = await ctx.agents.create({ sessionId: SessionId('ordinary'), agentOptions: { provider: 'fixture', model: 'fixture' } })
  cleanups.push(() => handle.dispose())
  const agent = handle.agent
  const run = async (args: string) => {
    const execution = await ctx.commands.execute(agent, '/setup-search' + args, [], new AbortController().signal)
    if (execution === undefined) throw new Error('missing command')
    return execution.result
  }
  return { root, ctx, agent, run, logs, runtime: runtime! }
}

it('uses the unknown route wording without requiring the Settings service', async () => {
  const h = await host()
  expect(await h.run('')).toMatchObject({ text: expect.stringContaining('Routing: the web row could not be read, so this selection may have no effect.') })
  expect(await h.run(' off')).toEqual({ kind: 'success', text: 'Web search is off for this session from the next model request.\nRouting: the web row could not be read, so this selection may have no effect.' })
})

it('isolates optional completion registration failure from command execution', async () => {
  const h = await host({}, undefined, true)
  expect(await h.run(' off')).toMatchObject({ kind: 'success' })
})

it('shows the empty-enabled-list wording and missing default summary', async () => {
  const connections = Object.fromEntries([...resolveSettings().connections.keys()].map(id => [id, { disabled: true }]))
  const h = await host({ connections })
  expect(await h.run('')).toMatchObject({ text: expect.stringContaining('- (none; turn connections on in the row settings)') })
  expect(await h.run('')).toMatchObject({ text: expect.stringContaining('builtin:deepseek-messages · the default connection · missing or turned off in the settings; web_search fails until another connection is chosen') })
})

it('rejects a stale command revision with deferred description, preserving the winning write', async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let blocked = true
  const h = await host({ connections: { 'builtin:exa': { disabled: false } } }, async () => {
    if (blocked) { blocked = false; entered.resolve(); await release.promise }
  })
  const stale = h.run(' builtin:exa')
  await entered.promise
  expect(await h.run(' off')).toMatchObject({ kind: 'success' })
  release.resolve()
  expect(await stale).toEqual({ kind: 'error', text: 'The selection changed while this command ran. Run /setup-search to see it, then try again.' })
  expect(h.ctx.storageDomain.get('web_search_enhanced')!.table('selections').get(h.agent.id)).toMatchObject({ connectionId: null, revision: 1 })
})

it('writes Host selection into the same Remote view and next request snapshot', async () => {
  const h = await host()
  await h.ctx.plugin(TypertRegistry)
  void new Gateway(h.ctx, {})
  const resolvers = new Set<unknown>()
  h.ctx.provide('fileUploads', { registerAgentResolver(resolver: unknown) {
    resolvers.add(resolver)
    return () => { resolvers.delete(resolver) }
  } } as never)
  void new SessionController(h.ctx, { nativeOpen: false })
  await h.ctx.fiber.await()
  expect(h.runtime.plan(h.agent)).toMatchObject({ kind: 'ready' })
  expect(await h.run(' off')).toMatchObject({ kind: 'success' })
  const peer: PeerScope = { id: 'command-owner' as PeerId, ctx: h.ctx, principal: { kind: 'owner' }, interactions: 'answer', signal: new AbortController().signal, dispose: async () => {} }
  expect(await h.ctx.typertGateway.invoke({ peer, namespace: 'searchConnections', method: 'get', args: { request: { sessionId: h.agent.id } } })).toMatchObject({ selection: { connectionId: null, revision: 1 } })
  // Writes change the durable selection, never the already frozen request step.
  expect(h.runtime.plan(h.agent)).toMatchObject({ kind: 'ready' })
  await h.ctx.waterfall('agent/request', { agent: h.agent, turn: 0, step: 0, signal: new AbortController().signal } as never, (async () => ({})) as never)
  expect(h.runtime.plan(h.agent)).toEqual({ kind: 'off' })
})

it('contains real storage write errors without exposing internal paths', async () => {
  const h = await host()
  const path = join(h.root, 'web_search_enhanced.json')
  expect(path.startsWith(h.root + '/')).toBe(true)
  await rm(path, { force: true })
  await mkdir(path)
  expect(await h.run(' off')).toEqual({ kind: 'error', text: 'The web search selection could not be read or saved; retry, or check the Host logs.' })
  expect(h.logs.flatMap(message => message.args).some(value => value instanceof Error && value.message.includes(h.root))).toBe(true)
})

it.each([false, true])('rethrows unexpected description failures with fixed wording for DSH settlement (WebError=%s)', async webError => {
  const h = await host({}, async () => {
    if (webError) throw new WebError('private diagnostic secret and path', 'WEB_PROVIDER_ERROR')
    throw new Error('private diagnostic secret and path')
  })
  await expect(h.run('')).rejects.toThrow('The web search command failed; retry, or check the Host logs.')
  expect(h.logs.flatMap(message => message.args).some(value => value instanceof Error && value.message === 'private diagnostic secret and path')).toBe(true)
})
