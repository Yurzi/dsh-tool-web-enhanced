import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import Projections from '@deepseek-ai/dsh-session-projection'
import { SessionId, SessionLogOffset, type SessionHeader } from '@deepseek-ai/dsh-session'
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
    : hasParent ? { kind: 'fork', parent: parentId, seeded } : { kind: 'top-level', seeded },
}))))

it.each(cases)('classifies every public header combination: $name', ({ header, expected }) => {
  const origin = sessionOrigin(header)
  expect(origin).toEqual(expected)
  expect(parentOf(origin)).toBe(header.parentSession)
})

async function host() {
  const root = await mkdtemp(join(tmpdir(), 'core-session-origin-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
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
  return { ctx, storage, sessions, lists: new ProviderLists(storage) }
}

it.each(cases)('preserves the three old consumer oracles through real seams: $name', async ({ header }) => {
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

  // Keep the pre-refactor formulas independent of sessionOrigin and its helpers.
  const inheritsSelection = header.parentSession !== undefined && header.isSeeded
  const copiesProviders = header.parentSession !== undefined
  const newConversation = header.parentSession === undefined && !header.isSeeded
    && agent.session.firstLiveSeq === 0 && agent.session.firstLifecycleSeq === 0

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
