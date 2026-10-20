/** Core-only capability fixture over real WebRuntime, Agents and JSON storage. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import WebRuntime, { type WebSearchRequest, type WebSearchResult } from '@deepseek-ai/dsh-web'
import { z } from 'zod'
import { afterEach, expect, it } from 'vitest'
import { SEARCH, selectionContract, type ConnectionView } from '../src/shared/index.ts'
import { installCapability, type Capability, type OptionsCodec } from '../src/host/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).toReversed()) await cleanup() })

type Options = { flavor: string }
type Connection = { id: string; kind: 'adapter'; disabled: boolean; parameter: string }
const initial = () => ({ defaultConnection: 'builtin:first', flavor: 'initial', connections: new Map<string, Connection>([
  ['builtin:first', { id: 'builtin:first', kind: 'adapter', disabled: false, parameter: 'initial' }],
  ['builtin:second', { id: 'builtin:second', kind: 'adapter', disabled: false, parameter: 'other' }],
]) })
type Settings = ReturnType<typeof initial>
type Target = { connectionId: string; parameter: string; flavor: string }
const codec: OptionsCodec<Options, Settings> = {
  initial: settings => ({ flavor: settings.flavor }),
  fromRecord: (record, settings) => ({ flavor: typeof record.flavor === 'string' ? record.flavor : settings.flavor }),
  toRecord: options => ({ ...options }),
}

async function host(disabled = false) {
  const root = await mkdtemp(join(tmpdir(), 'core-plans-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(WebRuntime, { searchProvider: SEARCH.providerId })
  const settings = initial()
  settings.connections.get('builtin:first')!.disabled = disabled
  const calls: Target[] = []
  const capability: Capability<Settings, Options, ConnectionView, Target, WebSearchRequest, WebSearchResult> = {
    identity: SEARCH, tool: 'web_search', field: 'searchProvider', remoteNamespace: 'corePlans', storageDomain: 'core_plans',
    contract: selectionContract({ namespace: 'corePlans', packageName: SEARCH.packageName, options: { flavor: z.string() }, extras: {} }),
    optionsCodec: codec, settings: () => settings,
    describe: async () => [],
    target: (connection, options) => ({ connectionId: connection.id, parameter: connection.parameter, flavor: options.flavor }),
    execute: async target => { calls.push(target); return { sources: [], truncated: false } },
    register: (scope, search) => { scope.web.registerSearchProvider({ id: SEARCH.providerId, available: () => true, search }) },
  }
  await ctx.plugin({ inject: ['web'], apply: (scope: Context) => { installCapability(scope, capability) } })
  const handle = await ctx.agents.create({ sessionId: SessionId('one') })
  cleanups.push(() => handle.dispose())
  const request = async (step = 0) => {
    await ctx.waterfall('agent/request', { agent: handle.agent, turn: 1, step, signal: new AbortController().signal } as never, (async () => ({ provider: 'p', model: 'm' })) as never)
  }
  const search = () => ctx.agents.withInitiator(handle.agent, () => ctx.web.search({ query: 'query' }))
  return { settings, calls, request, search }
}

it('freezes the connection and session options, not its operational adapter parameters', async () => {
  const h = await host()
  await h.request()
  await h.search()
  h.settings.defaultConnection = 'builtin:second'
  h.settings.flavor = 'changed'
  h.settings.connections.get('builtin:first')!.parameter = 'changed'
  await h.search()
  expect(h.calls).toEqual([
    { connectionId: 'builtin:first', parameter: 'initial', flavor: 'initial' },
    { connectionId: 'builtin:first', parameter: 'changed', flavor: 'initial' },
  ])
  await h.request(1)
  await h.search()
  expect(h.calls[2]?.connectionId).toBe('builtin:second')
})

it('rechecks both newly enabled and newly disabled connections inside a captured step', async () => {
  const h = await host(true)
  await h.request()
  await expect(h.search()).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
  h.settings.connections.get('builtin:first')!.disabled = false
  await expect(h.search()).resolves.toHaveProperty('sources')
  h.settings.connections.get('builtin:first')!.disabled = true
  await expect(h.search()).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
  expect(h.calls).toHaveLength(1)
})
