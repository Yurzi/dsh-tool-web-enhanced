import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId, SessionLogOffset, type SessionHeader, type SessionStore } from '@deepseek-ai/dsh-session'
import * as SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, expect, it } from 'vitest'
import { isNewConversation, ProviderLists } from '../src/host/provider-lists.ts'
import { parentOf, sessionOrigin } from '../src/host/session-origin.ts'
import { liveSession, Sessions } from '../src/host/sessions.ts'
import { Pairings, SessionStorage, ToolRestriction, type OptionsCodec } from '../src/host/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).toReversed()) await cleanup() })

type HeaderFacts = Pick<SessionHeader, 'parentSession' | 'isSeeded' | 'origin'>
const parentId = SessionId('origin-parent')
const cases = [false, true].flatMap(subagent => [false, true].flatMap(hasParent => [false, true].map(seeded => ({
  name: 'origin=' + (subagent ? 'subagent' : 'absent') + ', parent=' + hasParent + ', seeded=' + seeded,
  header: {
    ...(subagent ? { origin: 'subagent' } : {}),
    ...(hasParent ? { parentSession: parentId } : {}),
    isSeeded: seeded,
  } satisfies HeaderFacts,
  expected: subagent
    ? { kind: 'subagent', parent: hasParent ? parentId : undefined, seeded }
    : { kind: 'top-level', seeded },
}))))

it.each(cases)('classifies every public header combination: $name', ({ header, expected }) => {
  const origin = sessionOrigin(header)
  expect(origin).toEqual(expected)
  expect(parentOf(origin)).toBe(header.origin === 'subagent' ? header.parentSession : undefined)
})

async function host() {
  const root = await mkdtemp(join(tmpdir(), 'core-session-origin-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(AgentLoop)
  await ctx.plugin(SessionPersistenceJsonl, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const settings = {
    defaultConnection: 'builtin:default', enhancedTools: false,
    connections: new Map(['builtin:default', 'builtin:parent'].map(id => [id, { id, kind: 'local' as const, disabled: false }])),
  }
  const codec: OptionsCodec<Record<string, never>, typeof settings> = {
    initial: () => ({}), fromRecord: () => ({}), toRecord: () => ({}),
  }
  const storage = new SessionStorage(ctx, 'core_session_origin', codec)
  const sessions = new Sessions(ctx, () => settings, storage, new Pairings(storage),
    new ToolRestriction(ctx, { tool: 'web_fetch', routed: () => false }))
  return { ctx, root, storage, sessions, pairings: new Pairings(storage), lists: new ProviderLists(storage) }
}

it.each(cases)('uses subagent lineage only, leaving ordinary forks independent: $name', async ({ header }) => {
  const h = await host()
  const domain = await h.storage.domain()
  await domain.table('selections').put(parentId, { connectionId: 'builtin:parent', revision: 3 })
  await domain.table('provider_lists').put(parentId, ['builtin:parent'])
  const handle = await h.ctx.agents.create({
    sessionId: SessionId('origin-child'), meta: header,
    ...(header.isSeeded ? { seed: [], inheritedEventCount: SessionLogOffset(0) } : {}),
  })
  cleanups.push(() => handle.dispose())
  const { agent } = handle
  expect(agent.session.header).toMatchObject(header)

  const inheritsSelection = header.origin === 'subagent' && header.parentSession !== undefined && header.isSeeded
  const copiesProviders = header.origin === 'subagent' && header.parentSession !== undefined
  const newConversation = header.origin !== 'subagent'

  const current = await h.sessions.current(liveSession(agent))
  expect(current).toEqual({
    source: inheritsSelection ? 'inherited' : 'default',
    selection: { connectionId: inheritsSelection ? 'builtin:parent' : 'builtin:default', revision: 0, options: {} },
  })
  expect(domain.table('selections').get(agent.session.id)).toEqual({
    connectionId: inheritsSelection ? 'builtin:parent' : 'builtin:default', revision: 0,
    ...(inheritsSelection ? { inherited: true } : {}),
  })

  const expectedProviders = copiesProviders ? ['builtin:parent'] : ['builtin:initial']
  expect(await h.lists.create(agent, ['builtin:initial'])).toEqual(expectedProviders)
  expect(domain.table('provider_lists').get(agent.session.id)).toEqual(expectedProviders)
  expect(isNewConversation(agent.session)).toBe(newConversation)

  // Later parent updates and a different initial list must not rewrite the child's first record.
  await domain.table('selections').put(parentId, { connectionId: null, revision: 4 })
  await domain.table('provider_lists').put(parentId, ['builtin:changed'])
  expect(await h.sessions.current(liveSession(agent))).toEqual(current)
  expect(await h.lists.create(agent, ['builtin:replacement'])).toEqual(expectedProviders)
})

const resumedForks = [false, true].flatMap(empty => [false, true].flatMap(legacyParent =>
  [undefined, [], ['builtin:kept']].map(stored => ({ empty, legacyParent, stored }))))

it.each(resumedForks)('never backfills a JSONL-resumed ordinary fork (empty=$empty, legacyParent=$legacyParent, stored=$stored)', async ({ empty, legacyParent, stored }) => {
  const h = await host()
  const parent = await h.ctx.agents.create({ sessionId: parentId, meta: { cwd: h.root } })
  cleanups.push(() => parent.dispose())
  const event = parent.agent.session.append('model/selection', { provider: 'fixture', model: 'm' })
  const first = await h.ctx.agents.create({ sessionId: SessionId('durable-fork'),
    meta: { cwd: h.root, isSeeded: true, ...(legacyParent ? { parentSession: parentId } : {}) },
    seed: empty ? [] : [event], inheritedEventCount: SessionLogOffset(empty ? 0 : 1) })
  expect(first.agent.session.firstLifecycleSeq).toBe(first.agent.session.inheritedEventCount)
  expect(isNewConversation(first.agent.session)).toBe(true)
  const domain = await h.storage.domain()
  if (stored !== undefined) await domain.table('provider_lists').put(first.agent.id, [...stored])
  const store = h.ctx.sessions as unknown as SessionStore
  await store.flush(first.agent.session)
  await first.dispose()
  const restored = await h.ctx.agents.resume({ resumeSessionId: SessionId('durable-fork') })
  cleanups.push(() => restored.dispose())
  expect(restored.agent.session.firstLifecycleSeq).toBeGreaterThan(restored.agent.session.inheritedEventCount)
  expect(isNewConversation(restored.agent.session)).toBe(false)
  const initial = isNewConversation(restored.agent.session) ? ['builtin:new'] : undefined
  expect(await h.lists.create(restored.agent, initial)).toEqual(stored?.length ? [...stored] : undefined)
  expect(domain.table('provider_lists').get(restored.agent.id)).toEqual(stored === undefined ? undefined : [...stored])
})

it.each([0, 3])('retains an ordinary historical fork’s own selection (revision=%s) without consulting its former parent', async revision => {
  const h = await host()
  const domain = await h.storage.domain()
  const id = SessionId('historical-fork')
  const record = { connectionId: null, revision, ...(revision === 0 ? { inherited: true } : {}) }
  await domain.table('selections').put(id, record)
  await domain.table('selections').put(parentId, { connectionId: 'builtin:parent', revision: 9 })
  const handle = await h.ctx.agents.create({ sessionId: id, seed: [], inheritedEventCount: SessionLogOffset(0),
    meta: { parentSession: parentId, isSeeded: true } })
  cleanups.push(() => handle.dispose())
  expect((await h.sessions.current(liveSession(handle.agent))).selection).toMatchObject({ connectionId: null, revision })
  expect(domain.table('selections').get(id)).toEqual(record)
})

it.each([false, true])('does not write model memory from subagent selection changes (seeded=%s)', async seeded => {
  const h = await host()
  const model = { provider: 'fixture', model: 'm' }
  await h.pairings.set(model, 'builtin:default')
  const handle = await h.ctx.agents.create({ sessionId: SessionId('child-memory'), agentOptions: model,
    meta: { parentSession: parentId, origin: 'subagent', isSeeded: seeded },
    ...(seeded ? { seed: [], inheritedEventCount: SessionLogOffset(0) } : {}) })
  cleanups.push(() => handle.dispose())
  await h.sessions.change(liveSession(handle.agent), { connectionId: null }, 0)
  expect(await h.pairings.get(model)).toBe('builtin:default')
})
