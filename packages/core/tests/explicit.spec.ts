import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import Projections from '@deepseek-ai/dsh-session-projection'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { WebError } from '@deepseek-ai/dsh-web'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { afterEach, expect, it, vi } from 'vitest'
import { SEARCH, selectionContract, type ConnectionView } from '../src/shared/index.ts'
import { installCapability, InvalidSettingsError, type Capability, type EnhancedAccess, type ExplicitCall } from '../src/host/index.ts'
import { mountWebSettings } from './fixtures/web-settings.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).toReversed()) await cleanup() })
const connection = (id: string, disabled = false) => ({ id, label: id, kind: 'native' as const, disabled })
const initial = () => ({ defaultConnection: 'builtin:a', enhancedTools: true, connections: new Map([
  ['builtin:a', connection('builtin:a')], ['builtin:b', connection('builtin:b')], ['builtin:c', connection('builtin:c', true)],
]) })
type SettingsValue = ReturnType<typeof initial>
type Options = { freshness: string }
type Target = { id: string; options: Options; ambient: Agent | undefined; label: string }

async function host(enhancedTools = true, native = false) {
  const root = await mkdtemp(join(tmpdir(), 'core-explicit-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Loader)
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  await mountWebSettings(ctx, root)
  if (native) await ctx.plugin(ToolWeb, { fetch: false })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  let settings = { ...initial(), enhancedTools }
  let settingsError: Error | undefined
  let access!: EnhancedAccess<Options, string, Target>
  const describe = vi.fn(async (value: SettingsValue): Promise<ConnectionView[]> => [...value.connections.values()].map(c => ({
    id: c.id, label: c.label, kind: c.kind, remote: true, access: 'api-key', status: c.disabled ? 'disabled' : 'ready',
  })))
  const listing = vi.fn(() => ({ use: undefined, recipient: { kind: 'this-machine' as const } }))
  const target = vi.fn((c: ReturnType<typeof connection>, options: Options): Target => ({ id: c.id, options, ambient: ctx.agents.currentInitiator(), label: c.label }))
  const execute = vi.fn(async (value: Target) => value)
  const tools = vi.fn((value: EnhancedAccess<Options, string, Target>) => {
    access = value
    const definition = (name: string) => defineTool({ name, description: 'fixture', parameters: {}, output: { schema: { type: 'string' }, render: (_, text) => [{ type: 'text', text }] }, execute: async () => 'fixture' })
    return { action: definition(SEARCH.tools.action), list: definition(SEARCH.tools.list) }
  })
  const capability: Capability<SettingsValue, Options, ConnectionView, Target, string, Target> = {
    identity: SEARCH, tool: 'web_search', field: 'searchProvider', remoteNamespace: 'explicitFixture', storageDomain: 'explicit_fixture',
    contract: selectionContract({ namespace: 'explicitFixture', packageName: SEARCH.packageName, options: {}, extras: {} }),
    optionsCodec: { initial: () => ({ freshness: 'auto' }), fromRecord: r => ({ freshness: typeof r.freshness === 'string' ? r.freshness : 'auto' }), toRecord: o => ({ ...o }) },
    settings: () => { if (settingsError !== undefined) throw settingsError; return settings },
    describe, target, execute,
    register: (scope, invoke) => { scope.get('web')!.registerSearchProvider({ id: SEARCH.providerId, available: () => true,
      search: async (request, signal) => ({ sources: [], truncated: false, content: (await invoke(request.query, signal)).id }),
    }) },
    enhanced: { names: SEARCH.tools, tools, listing },
  }
  const plugin = await ctx.plugin({ apply(scope: Context) { installCapability(scope, capability) } })
  const create = async (id = 'a', options: Record<string, unknown> = {}) => {
    const handle = await ctx.agents.create({ sessionId: SessionId(id), ...options })
    cleanups.push(() => handle.dispose())
    return handle.agent
  }
  const call = (agent: Agent, signal = new AbortController().signal): ExplicitCall => ({ agent, signal })
  const update = async (change: Partial<SettingsValue>) => {
    settings = { ...settings, ...change }
    await ctx.parallel('settings/document-updated', SEARCH.rowId as SettingsNamespace, 1)
  }
  const domain = () => ctx.storageDomain.get('explicit_fixture')!
  return { ctx, plugin, create, call, update, domain, describe, listing, target, execute, tools,
    access: () => access, settings: () => settings, failSettings: (error: Error | undefined) => { settingsError = error }, capability }
}

it('runs either authorized connection, rebuilding the target from current settings without writing selection or memory', async () => {
  const h = await host()
  const agent = await h.create()
  const before = h.domain().table('selections').get(agent.id)
  const writes: unknown[] = []
  h.ctx.on('domain/changed', event => { writes.push(event) })
  const call = h.call(agent)
  const first = await h.access().run('builtin:b', 'query', call)
  expect(first).toMatchObject({ kind: 'done', value: { id: 'builtin:b', options: { freshness: 'auto' } } })
  if (first.kind === 'done') expect(first.value.ambient).toBe(agent)
  h.settings().connections.set('builtin:b', { ...connection('builtin:b', true), label: 'changed' })
  expect(await h.access().run('builtin:b', 'query', call)).toMatchObject({ kind: 'done', value: { label: 'changed' } })
  expect(h.target).toHaveBeenCalledTimes(2)
  expect(h.domain().table('selections').get(agent.id)).toEqual(before)
  expect(writes).toEqual([])
})

it('keeps the original authorization order and ignores disabled in readiness, but reports removed and unknown separately', async () => {
  const h = await host()
  const agent = await h.create()
  h.settings().connections.set('builtin:a', connection('builtin:a', true))
  h.settings().connections.delete('builtin:b')
  h.settings().connections.set('builtin:c', connection('builtin:c'))
  expect(await h.access().run('builtin:c', 'q', h.call(agent))).toEqual({ kind: 'rejected', reason: { kind: 'unknown', connectionId: 'builtin:c', ready: { kind: 'read', ids: ['builtin:a'] } } })
  expect(await h.access().run('builtin:b', 'q', h.call(agent))).toEqual({ kind: 'rejected', reason: { kind: 'removed', connectionId: 'builtin:b', ready: { kind: 'read', ids: ['builtin:a'] } } })
  expect(await h.access().list(h.call(agent))).toMatchObject({ kind: 'done', value: { session: { connectionId: 'builtin:a', selectable: false }, providers: [{ id: 'builtin:a', status: 'ready' }] } })
  expect(await h.access().ready(h.call(agent))).toEqual({ kind: 'read', ids: ['builtin:a'] })
  expect(h.describe.mock.calls.at(-1)![0].connections.get('builtin:a')!.disabled).toBe(false)
})

it.each(['run', 'list', 'ready'] as const)('enforces off plans for %s without reading readiness', async method => {
  const h = await host()
  const agent = await h.create()
  await h.domain().table('selections').put(agent.id, { connectionId: null, revision: 1 })
  await h.ctx.waterfall('agent/request', { agent, turn: 0, step: 0, signal: new AbortController().signal } as never, (async () => ({})) as never)
  const call = h.call(agent)
  const result = method === 'run' ? await h.access().run('builtin:b', 'q', call) : await h.access()[method](call)
  expect(result).toEqual(method === 'ready' ? { kind: 'unread' } : { kind: 'rejected', reason: { kind: 'off' } })
  expect(h.describe).not.toHaveBeenCalled()
})

it('returns the original invalid-settings error before withdrawal, and selection unavailable after unload', async () => {
  const h = await host()
  const agent = await h.create()
  const error = new InvalidSettingsError(SEARCH.packageName, 'search')
  h.failSettings(error)
  await h.update({ enhancedTools: false })
  expect(await h.access().run('builtin:a', 'q', h.call(agent))).toEqual({ kind: 'rejected', reason: { kind: 'unavailable', error } })
  await h.plugin.dispose()
  expect(await h.access().list(h.call(agent))).toMatchObject({ kind: 'rejected', reason: { kind: 'unavailable', error: { code: 'WEB_PROVIDER_ERROR' } } })
  expect(await h.access().ready(h.call(agent))).toEqual({ kind: 'unread' })
})

it.each(['elsewhere', 'auto', ''])('withdraws on unconfirmed route %s', async route => {
  const h = await host()
  const agent = await h.create()
  await h.ctx.settings.update('web', { searchProvider: route })
  expect(await h.access().run('builtin:a', 'q', h.call(agent))).toEqual({ kind: 'rejected', reason: { kind: 'withdrawn' } })
  expect(await h.access().list(h.call(agent))).toMatchObject({ kind: 'rejected', reason: { kind: 'withdrawn' } })
})

it('does not construct tools before the switch is enabled and never backfills conversations created while disabled', async () => {
  const h = await host(false)
  const old = await h.create('old')
  expect(h.tools).not.toHaveBeenCalled()
  await h.update({ enhancedTools: true })
  expect(h.tools).toHaveBeenCalledTimes(1)
  expect(await h.access().list(h.call(old))).toMatchObject({ kind: 'rejected', reason: { kind: 'withdrawn' } })
  const fresh = await h.create('new')
  expect(await h.access().ready(h.call(fresh))).toEqual({ kind: 'read', ids: ['builtin:a', 'builtin:b'] })
  await h.update({ enhancedTools: false })
  await h.update({ enhancedTools: true })
  expect(h.tools).toHaveBeenCalledTimes(1)
})

it('isolates explicit identity from ambient callers and concurrent executions', async () => {
  const h = await host()
  const a = await h.create('a')
  const b = await h.create('b')
  const gates = new Map([['builtin:a', Promise.withResolvers<void>()], ['builtin:b', Promise.withResolvers<void>()]])
  h.execute.mockImplementation(async target => {
    expect(h.ctx.agents.currentInitiator()).toBe(target.ambient)
    await gates.get(target.id)!.promise
    expect(h.ctx.agents.currentInitiator()).toBe(target.ambient)
    return target
  })
  await h.ctx.agents.withInitiator(b, async () => {
    const first = h.access().run('builtin:a', 'a', h.call(a))
    const second = h.access().run('builtin:b', 'b', h.call(b))
    gates.get('builtin:b')!.resolve()
    gates.get('builtin:a')!.resolve()
    const one = await first
    const two = await second
    expect(one.kind).toBe('done')
    expect(two.kind).toBe('done')
    if (one.kind === 'done') expect(one.value.ambient).toBe(a)
    if (two.kind === 'done') expect(two.value.ambient).toBe(b)
    expect(h.ctx.agents.currentInitiator()).toBe(b)
  })
})

it.each([new Error('test-secret-credential'), new WebError('test-secret-credential', 'WEB_ABORTED')])('sanitizes every describe exception, including WebError, without leaking diagnostics: %s', async error => {
  const h = await host()
  const agent = await h.create()
  const diagnostics: unknown[] = []
  h.ctx.logger.exporter({ levels: { default: 3 }, export: message => { diagnostics.push(message.args) } })
  h.describe.mockRejectedValue(error)
  await expect(h.access().list(h.call(agent))).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: SEARCH.packageName + ': provider availability could not be read; retry the request' })
  expect(await h.access().ready(h.call(agent))).toEqual({ kind: 'unread' })
  expect(await h.access().run('builtin:c', 'q', h.call(agent))).toMatchObject({ reason: { kind: 'unknown', ready: { kind: 'unread' } } })
  expect(JSON.stringify(diagnostics)).not.toContain('test-secret')
})

it('sanitizes synchronous listing exceptions with the same fixed boundary', async () => {
  const h = await host()
  const agent = await h.create()
  h.listing.mockImplementation(() => { throw new WebError('test-secret-credential', 'WEB_PROVIDER_ERROR') })
  await expect(h.access().list(h.call(agent))).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: SEARCH.packageName + ': provider availability could not be read; retry the request' })
})

it('cancels listing immediately, drains a rejected read, and never propagates its secret', async () => {
  const h = await host()
  const agent = await h.create()
  const entered = Promise.withResolvers<void>()
  const pending = Promise.withResolvers<ConnectionView[]>()
  h.describe.mockImplementation(() => { entered.resolve(); return pending.promise })
  const abort = new AbortController()
  const listing = h.access().list(h.call(agent, abort.signal))
  await entered.promise
  abort.abort()
  await expect(listing).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  pending.reject(new Error('test-secret-credential'))
  await expect(pending.promise).rejects.toThrow('test-secret')
  expect(await h.access().ready(h.call(agent, abort.signal))).toEqual({ kind: 'unread' })
})

it('preserves backend WebErrors unchanged and refuses already cancelled calls before execution', async () => {
  const h = await host()
  const agent = await h.create()
  const error = new WebError('safe backend message', 'WEB_PROVIDER_ERROR')
  h.execute.mockRejectedValue(error)
  await expect(h.access().run('builtin:a', 'q', h.call(agent))).rejects.toBe(error)
  const abort = new AbortController()
  abort.abort()
  await expect(h.access().run('builtin:a', 'q', h.call(agent, abort.signal))).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  expect(h.execute).toHaveBeenCalledTimes(1)
})

it.each([false, true])('copies parent authorization for spawn/fork (seeded=%s), never expanded settings', async seeded => {
  const h = await host()
  const parent = await h.create('parent')
  h.settings().connections.set('builtin:c', connection('builtin:c'))
  const child = await h.create('child', {
    meta: { parentSession: parent.session.id, origin: 'subagent', isSeeded: seeded },
    ...(seeded ? { seed: [], inheritedEventCount: SessionLogOffset(0) } : {}),
  })
  expect(await h.access().ready(h.call(child))).toEqual({ kind: 'read', ids: ['builtin:a', 'builtin:b'] })
  expect(h.domain().table('provider_lists').get(child.id)).toEqual(['builtin:a', 'builtin:b'])
})

it('does not grant children a list when their parent had none', async () => {
  const h = await host(false)
  const parent = await h.create('parent')
  await h.update({ enhancedTools: true })
  const child = await h.create('child', { meta: { parentSession: parent.session.id, origin: 'subagent' } })
  expect(await h.access().ready(h.call(child))).toEqual({ kind: 'unread' })
  expect(h.domain().table('provider_lists').get(child.id)).toEqual([])
})

it('restores recorded authorization and treats an unrecorded truly empty seed as new', async () => {
  const h = await host()
  const missing = await h.create('no-record', { seed: [] })
  expect(await h.access().ready(h.call(missing))).toEqual({ kind: 'read', ids: ['builtin:a', 'builtin:b'] })
  await h.domain().table('provider_lists').put('recorded', ['builtin:b'])
  const restored = await h.create('recorded', { seed: [] })
  expect(await h.access().ready(h.call(restored))).toEqual({ kind: 'read', ids: ['builtin:b'] })
})

it('preserves a failed frozen plan after settings recover', async () => {
  const h = await host()
  const agent = await h.create()
  const error = new InvalidSettingsError(SEARCH.packageName, 'search')
  h.failSettings(error)
  await h.ctx.waterfall('agent/request', { agent, turn: 1, step: 0, signal: new AbortController().signal } as never, (async () => ({})) as never)
  h.failSettings(undefined)
  expect(await h.access().run('builtin:a', 'q', h.call(agent))).toEqual({ kind: 'rejected', reason: { kind: 'unavailable', error } })
  expect(h.execute).not.toHaveBeenCalled()
})

it('maps API-key, account, and unsupported readiness', async () => {
  const h = await host()
  const agent = await h.create()
  h.describe.mockResolvedValue([
    { id: 'builtin:a', label: 'API', kind: 'native', remote: true, access: 'api-key', status: 'needs-credential' },
    { id: 'builtin:b', label: 'Account', kind: 'native', remote: true, access: 'account', status: 'needs-credential' },
  ])
  expect(await h.access().list(h.call(agent))).toMatchObject({ value: { providers: [
    { name: 'API', status: 'needs-credential', credential: 'api-key' },
    { name: 'Account', status: 'needs-credential', credential: 'account' },
  ] } })
  expect(await h.access().ready(h.call(agent))).toEqual({ kind: 'read', ids: [] })
  expect(await h.access().run('builtin:c', 'q', h.call(agent))).toEqual({ kind: 'rejected', reason: { kind: 'unknown', connectionId: 'builtin:c', ready: { kind: 'read', ids: [] } } })
  h.describe.mockResolvedValue([
    { id: 'builtin:a', label: 'Unsupported', kind: 'model', remote: true, access: 'api-key', status: 'unsupported', reason: 'no-model' },
    { id: 'builtin:b', label: 'Ready', kind: 'native', remote: true, access: 'api-key', status: 'ready' },
  ])
  expect(await h.access().list(h.call(agent))).toMatchObject({ value: { providers: [{ status: 'unsupported', reason: 'no-model' }, { status: 'ready' }] } })
})

it('refuses a live Agent without the current install’s frozen plan after remount, even with its recorded provider list', async () => {
  const h = await host()
  const agent = await h.create()
  await h.plugin.dispose()
  await h.ctx.plugin({ apply(scope: Context) { installCapability(scope, h.capability) } })
  await h.ctx.fiber.await()
  expect(await h.access().run('builtin:a', 'q', h.call(agent))).toMatchObject({ kind: 'rejected', reason: { kind: 'unavailable', error: { code: 'WEB_PROVIDER_ERROR' } } })
  expect(await h.access().list(h.call(agent))).toMatchObject({ kind: 'rejected', reason: { kind: 'unavailable' } })
  expect(await h.access().ready(h.call(agent))).toEqual({ kind: 'unread' })
})

it('checks cancellation after readiness awaited for an unknown-provider rejection', async () => {
  const h = await host()
  const agent = await h.create()
  const entered = Promise.withResolvers<void>()
  const read = Promise.withResolvers<ConnectionView[]>()
  h.describe.mockImplementation(() => { entered.resolve(); return read.promise })
  const controller = new AbortController()
  const result = h.access().run('builtin:c', 'q', h.call(agent, controller.signal))
  await entered.promise
  controller.abort()
  await expect(result).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  read.resolve([])
})

it('does not create authorization while routed elsewhere or when row settings are invalid', async () => {
  const h = await host()
  await h.ctx.settings.update('web', { searchProvider: 'elsewhere' })
  const unrouted = await h.create('unrouted')
  await h.ctx.settings.update('web', { searchProvider: SEARCH.providerId })
  expect(await h.access().list(h.call(unrouted))).toMatchObject({ kind: 'rejected', reason: { kind: 'withdrawn' } })
  h.failSettings(new InvalidSettingsError(SEARCH.packageName, 'search'))
  const invalid = await h.create('invalid')
  h.failSettings(undefined)
  await h.ctx.waterfall('agent/request', { agent: invalid, turn: 1, step: 0, signal: new AbortController().signal } as never, (async () => ({})) as never)
  expect(await h.access().list(h.call(invalid))).toMatchObject({ kind: 'rejected', reason: { kind: 'withdrawn' } })
})

it('freezes only the session options until the next capture, never taking per-call overrides', async () => {
  const h = await host()
  const agent = await h.create()
  await h.domain().table('selections').put(agent.id, { connectionId: 'builtin:b', revision: 1, freshness: 'fresh' })
  expect(await h.access().run('builtin:a', 'q', h.call(agent))).toMatchObject({ value: { options: { freshness: 'auto' } } })
  await h.ctx.waterfall('agent/request', { agent, turn: 1, step: 0, signal: new AbortController().signal } as never, (async () => ({})) as never)
  expect(await h.access().run('builtin:a', 'q', h.call(agent))).toMatchObject({ value: { options: { freshness: 'fresh' } } })
  expect(await h.access().list(h.call(agent))).toMatchObject({ value: { session: { connectionId: 'builtin:b' }, options: { freshness: 'fresh' } } })
})

it.each([true, false])('a malformed provider-list record never fails the native plan (enhanced=%s)', async enhanced => {
  const h = await host(enhanced, true)
  const agent = await h.create()
  // Public domain puts validate on reopen, not on write; corrupt only this table in the open real domain.
  await h.domain().table('provider_lists').put(agent.id, {})
  expect(h.domain().table('selections').get(agent.id)).toMatchObject({ connectionId: 'builtin:a' })
  const diagnostics: unknown[] = []
  h.ctx.logger.exporter({ levels: { default: 3 }, export: message => { diagnostics.push(message.args) } })
  await h.ctx.waterfall('agent/request', { agent, turn: 1, step: 0, signal: new AbortController().signal } as never, (async () => ({})) as never)
  const native = await h.ctx.agents.withInitiator(agent, () => h.ctx.tools.execute({
    name: 'web_search', arguments: { queries: ['q'] }, agent, callId: ToolCallId('native-list-failure'), signal: new AbortController().signal,
  }))
  expect(native.error).toBeUndefined()
  expect(native.isError).toBe(false)
  expect(h.execute).toHaveBeenCalledOnce()
  const scope = scopeOf(agent.ctx)!
  expect(h.ctx.tools.get('web_search', scope)).toBeDefined()
  expect(h.ctx.tools.get(SEARCH.tools.action, scope)).toBeUndefined()
  expect(h.ctx.tools.get(SEARCH.tools.list, scope)).toBeUndefined()
  if (enhanced) {
    expect(JSON.stringify(diagnostics)).toContain('conversation provider list could not be read')
    expect(JSON.stringify(diagnostics)).not.toContain('TypeError')
    expect(await h.access().run('builtin:a', 'q', h.call(agent))).toMatchObject({ kind: 'rejected', reason: { kind: 'unavailable', error: { code: 'WEB_PROVIDER_ERROR', message: SEARCH.packageName + ': the search selection could not be read; retry the request' } } })
    expect(await h.access().list(h.call(agent))).toMatchObject({ kind: 'rejected', reason: { kind: 'unavailable' } })
  } else {
    // Reading the malformed table would log a failure: default-off captures must not read it at all.
    expect(diagnostics).toEqual([])
  }
  await h.domain().table('selections').put(agent.id, { connectionId: null, revision: 1 })
  await h.ctx.waterfall('agent/request', { agent, turn: 1, step: 1, signal: new AbortController().signal } as never, (async () => ({})) as never)
  expect(h.ctx.tools.get('web_search', scope)).toBeUndefined()
})
