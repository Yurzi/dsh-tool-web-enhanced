import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Agents, { type Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import Projections from '@deepseek-ai/dsh-session-projection'
import { SessionId } from '@deepseek-ai/dsh-session'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterEach, expect, it } from 'vitest'
import { SEARCH } from '../src/shared/index.ts'
import { ToolRestriction, type EnhancedTools } from '../src/host/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).toReversed()) await cleanup() })
const names = [SEARCH.tools.action, SEARCH.tools.list]
function definitions(): EnhancedTools {
  const tool = (name: string) => defineTool({ name, description: 'fixture', parameters: {}, output: { schema: { type: 'string' }, render: (_, text) => [{ type: 'text', text }] }, execute: async () => 'fixture' })
  return { action: tool(names[0]!), list: tool(names[1]!) }
}
async function host() {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  const create = async (id: string) => {
    const handle = await ctx.agents.create({ sessionId: SessionId(id) })
    cleanups.push(() => handle.dispose())
    return handle.agent
  }
  return { ctx, create }
}
async function controller(ctx: Context, options: { routed?: boolean; enabled?: boolean; selection?: (agent: Agent) => Promise<string | null>; providers?: (agent: Agent) => Promise<readonly string[] | undefined> } = {}) {
  let routed = options.routed ?? true
  let enabled = options.enabled ?? true
  let builds = 0
  let control!: ToolRestriction
  let started!: Promise<void>
  const plugin = await ctx.plugin({ apply(scope: Context) {
    control = new ToolRestriction(scope, {
      tool: 'web_search', routed: () => routed,
      selection: options.selection ?? (async () => 'builtin:a'),
      enhanced: { rowId: SEARCH.rowId, names: SEARCH.tools, enabled: () => enabled,
        tools: () => { builds++; return definitions() }, providers: options.providers ?? (async () => ['builtin:a']) },
    })
    started = control.start()
  } })
  await started
  const update = async (change: { routed?: boolean; enabled?: boolean }) => {
    if (change.routed !== undefined) routed = change.routed
    if (change.enabled !== undefined) enabled = change.enabled
    await ctx.parallel('settings/document-updated', 'web' as SettingsNamespace, 1)
  }
  return { control, plugin, update, builds: () => builds }
}
function visible(ctx: Context, agent: Agent) { return names.filter(name => ctx.tools.get(name, scopeOf(agent.ctx)) !== undefined) }

it('registers, synchronously masks hot-start Agents while unread, and unmasks only after both facts are known', async () => {
  const { ctx, create } = await host()
  const agent = await create('hot')
  const entered = Promise.withResolvers<void>()
  const read = Promise.withResolvers<string | null>()
  const pending = controller(ctx, { selection: () => { entered.resolve(); return read.promise } })
  await entered.promise
  expect(names.every(name => ctx.tools.get(name) !== undefined)).toBe(true)
  expect(visible(ctx, agent)).toEqual([])
  read.resolve('builtin:a')
  const h = await pending
  expect(visible(ctx, agent)).toEqual(names)
  expect(h.builds()).toBe(1)
})

it('builds definitions lazily once and synchronously unregisters before lifting masks on withdrawal and unload', async () => {
  const { ctx, create } = await host()
  const agent = await create('off')
  const h = await controller(ctx, { enabled: false, selection: async () => null })
  expect(h.builds()).toBe(0)
  await h.update({ enabled: true })
  expect(visible(ctx, agent)).toEqual([])
  const changes: string[][] = []
  const stop = ctx.on('tools/change', () => { changes.push(visible(ctx, agent)) })
  await h.update({ enabled: false })
  expect(changes.every(value => value.length === 0)).toBe(true)
  await h.update({ enabled: true })
  expect(h.builds()).toBe(1)
  changes.length = 0
  await h.plugin.dispose()
  stop()
  expect(changes.every(value => value.length === 0)).toBe(true)
  expect(names.every(name => ctx.tools.get(name) === undefined)).toBe(true)
})

it('installs its enhanced mask even when somebody else already masks both registered names', async () => {
  const { ctx, create } = await host()
  const h = await controller(ctx)
  const agent = await create('other-mask')
  const other = agent.ctx.tools.restrict({ deny: names })
  h.control.created(agent)
  h.control.sync(agent, null)
  other()
  expect(visible(ctx, agent)).toEqual([])
})

it('keeps unknown, off, absent and failed states hidden and only lifts its own mask', async () => {
  const { ctx, create } = await host()
  const h = await controller(ctx)
  const agent = await create('states')
  h.control.created(agent)
  expect(visible(ctx, agent)).toEqual([])
  h.control.captured(agent, h.control.begin(agent), 'builtin:a', { kind: 'read', ids: undefined })
  expect(visible(ctx, agent)).toEqual([])
  h.control.captured(agent, h.control.begin(agent), null, { kind: 'read', ids: ['builtin:a'] })
  expect(visible(ctx, agent)).toEqual([])
  h.control.captured(agent, h.control.begin(agent), 'builtin:a', { kind: 'read', ids: ['builtin:a'] })
  const other = agent.ctx.tools.restrict({ deny: names })
  h.control.failed(agent, h.control.begin(agent))
  h.control.captured(agent, h.control.begin(agent), 'builtin:a', { kind: 'read', ids: ['builtin:a'] })
  expect(visible(ctx, agent)).toEqual([])
  other()
  expect(visible(ctx, agent)).toEqual(names)
})

it('discards an old read that arrives after a newer Remote selection commit', async () => {
  const { ctx, create } = await host()
  const agent = await create('version')
  let deferred: ReturnType<typeof Promise.withResolvers<string | null>> | undefined
  const h = await controller(ctx, { selection: async () => deferred === undefined ? 'builtin:a' : deferred.promise })
  deferred = Promise.withResolvers<string | null>()
  const refreshing = h.update({ routed: true })
  h.control.sync(agent, null)
  deferred.resolve('builtin:a')
  await refreshing
  expect(visible(ctx, agent)).toEqual([])
})

it('invalidates previous registration generations across route-away and re-registration', async () => {
  const { ctx, create } = await host()
  const agent = await create('generation')
  let deferred: ReturnType<typeof Promise.withResolvers<string | null>> | undefined
  let selection: string | null = 'builtin:a'
  const h = await controller(ctx, { selection: async () => deferred === undefined ? selection : deferred.promise })
  deferred = Promise.withResolvers<string | null>()
  const late = deferred
  const refreshing = h.update({ routed: true })
  await h.update({ routed: false })
  deferred = undefined
  selection = null
  await h.update({ routed: true })
  late.resolve('builtin:a')
  await refreshing
  expect(visible(ctx, agent)).toEqual([])
})

it.each(['forget', 'unload'] as const)('never commits a read after %s', async action => {
  const { ctx, create } = await host()
  const agent = await create(action)
  let deferred: ReturnType<typeof Promise.withResolvers<string | null>> | undefined
  const h = await controller(ctx, { selection: async () => deferred === undefined ? 'builtin:a' : deferred.promise })
  deferred = Promise.withResolvers<string | null>()
  const refreshing = h.update({ routed: true })
  if (action === 'forget') h.control.forget(agent)
  else await h.plugin.dispose()
  deferred.resolve(null)
  await refreshing
  if (action === 'forget') expect(visible(ctx, agent)).toEqual(names)
  else expect(names.every(name => ctx.tools.get(name) === undefined)).toBe(true)
})

it('waits for late tools services, then re-registers against a replacement service without rebuilding definitions', async () => {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const h = await controller(ctx)
  expect(h.builds()).toBe(0)
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.fiber.await()
  expect(names.every(name => ctx.tools.get(name) !== undefined)).toBe(true)
  expect(h.builds()).toBe(1)
  const oldTools = ctx.tools
  // Public plugin removal triggers the dependent injection disposer before replacement.
  ctx.registry.delete(Tools)
  await ctx.fiber.await()
  expect(names.every(name => oldTools.get(name) === undefined)).toBe(true)
  await ctx.plugin(Tools, { mode: 'native' })
  await ctx.fiber.await()
  expect(names.every(name => ctx.tools.get(name) !== undefined)).toBe(true)
  expect(h.builds()).toBe(1)
})

it('withdraws and re-registers the pair when the Agents service is replaced', async () => {
  const { ctx } = await host()
  const h = await controller(ctx)
  expect(names.every(name => ctx.tools.get(name) !== undefined)).toBe(true)
  ctx.registry.delete(Agents)
  await ctx.fiber.await()
  expect(names.every(name => ctx.tools.get(name) === undefined)).toBe(true)
  await ctx.plugin(Agents)
  await ctx.fiber.await()
  expect(names.every(name => ctx.tools.get(name) !== undefined)).toBe(true)
  expect(h.builds()).toBe(1)
})

it.each(['switch', 'route'] as const)('rolls back a partial hot registration and recovers after a collision (%s)', async trigger => {
  const { ctx, create } = await host()
  const agent = await create('hot-collision')
  const h = await controller(ctx, trigger === 'switch' ? { enabled: false, selection: async () => null } : { routed: false, selection: async () => null })
  const other = await ctx.plugin({ inject: ['tools'], apply(scope: Context) { scope.tools.register(definitions().list) } })
  // The old implementation rejects the event but leaves its first definition exposed.
  const attempt = await h.update(trigger === 'switch' ? { enabled: true } : { routed: true }).then(
    () => ({ kind: 'done' }), error => ({ kind: 'failed', error }),
  )
  expect(h.control.registered).toBe(false)
  expect(ctx.tools.get(SEARCH.tools.action, scopeOf(agent.ctx))).toBeUndefined()
  expect(ctx.tools.get(SEARCH.tools.list)).toBeDefined()
  expect(attempt).toEqual({ kind: 'done' })
  await h.update({ enabled: false })
  expect(ctx.tools.get(SEARCH.tools.action)).toBeUndefined()
  await h.update({ enabled: true })
  expect(ctx.tools.get(SEARCH.tools.action)).toBeUndefined()
  await h.update({ enabled: false })
  await other.dispose()
  await h.update({ enabled: true, routed: true })
  expect(h.control.registered).toBe(true)
  expect(names.every(name => ctx.tools.get(name) !== undefined)).toBe(true)
  expect(visible(ctx, agent)).toEqual([])
})

it('commits the native selection when only the enhanced provider-list refresh fails', async () => {
  const { ctx, create } = await host()
  ctx.tools.register({ ...definitions().action, name: 'web_search' })
  const agent = await create('native-refresh')
  let selected: string | null = null
  let broken = false
  const h = await controller(ctx, { selection: async () => selected, providers: async () => {
    if (broken) throw new Error('private provider-list read detail')
    return ['builtin:a']
  } })
  h.control.sync(agent, null)
  const scope = scopeOf(agent.ctx)!
  expect(ctx.tools.get('web_search', scope)).toBeUndefined()
  const diagnostics: unknown[] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: message => { diagnostics.push(message.args) } })
  selected = 'builtin:a'
  broken = true
  await h.update({ routed: true })
  expect(ctx.tools.get('web_search', scope)).toBeDefined()
  expect(visible(ctx, agent)).toEqual([])
  expect(JSON.stringify(diagnostics)).toContain('conversation provider list could not be read')
  expect(JSON.stringify(diagnostics)).not.toContain('private provider-list read detail')
})
