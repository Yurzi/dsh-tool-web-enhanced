import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { liveSession, Pairings, Sessions as SearchSessions, SelectionConflict } from 'dsh-tool-web-enhanced-core/host'
import { SearchRestriction, searchDomain, SearchStorage, type StoredSelection, Snapshots, type SearchPlan } from './fixtures/core-host.ts'
import { searchError } from '../src/search/errors.ts'
import { resolveSettings } from '../src/settings/resolve.ts'
import type { SearchSettings } from '../src/settings/types.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).toReversed()) await cleanup() })

async function setup(records: Record<string, StoredSelection> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'search-selections-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const seed = await ctx.storageDomain.open(searchDomain)
  for (const [id, record] of Object.entries(records)) await seed.table('selections').put(id, record)
  await seed.close()
  const storage = new SearchStorage(ctx)
  const pairings = new Pairings(storage)
  let settings = resolveSettings({})
  const sessions = new SearchSessions(ctx, () => settings, storage, pairings, new SearchRestriction(ctx))
  const agent = async (id: string, parent?: string) => {
    const handle = await ctx.agents.create({ sessionId: SessionId(id), agentOptions: { provider: 'p', model: 'm' },
      ...(parent === undefined ? {} : { meta: { parentSession: SessionId(parent), isSeeded: true }, inheritedEventCount: SessionLogOffset(0), seed: [] }),
    })
    cleanups.push(() => handle.dispose())
    return handle.agent
  }
  return { ctx, storage, sessions, pairings, agent, configure: (document: SearchSettings) => { settings = resolveSettings(document) } }
}

describe('persistent selection semantics', () => {
  it('reads predecessor records and materializes missing freshness exactly once', async () => {
    const h = await setup({ old: { connectionId: null, revision: 7 } })
    h.configure({ defaults: { freshness: 'fresh' } })
    const agent = await h.agent('old')
    expect(await h.sessions.current(liveSession(agent))).toEqual({ source: 'session', selection: { connectionId: null, revision: 7, options: { freshness: 'fresh' } } })
    h.configure({ defaults: { freshness: 'realtime' } })
    expect((await h.sessions.current(liveSession(agent))).selection.options.freshness).toBe('fresh')
    expect((await h.storage.domain()).table('selections').get('old')).toEqual({ connectionId: null, revision: 7, freshness: 'fresh' })
  })

  it('serializes all reads and writes and resumes the queue after a conflict', async () => {
    const h = await setup()
    const agent = await h.agent('a')
    const first = h.sessions.change(liveSession(agent), { connectionId: null }, 0)
    const conflict = h.sessions.change(liveSession(agent), { connectionId: 'builtin:exa' }, 0)
    const read = h.sessions.current(liveSession(agent))
    await expect(first).resolves.toMatchObject({ selection: { revision: 1, connectionId: null } })
    await expect(conflict).rejects.toBeInstanceOf(SelectionConflict)
    await expect(read).resolves.toMatchObject({ source: 'session', selection: { revision: 1, connectionId: null } })
    await expect(h.sessions.change(liveSession(agent), { freshness: 'fresh' }, 1)).resolves.toMatchObject({ selection: { revision: 2, connectionId: null } })
  })

  it('does not guess a sole available connection when the default is invalid', async () => {
    const h = await setup()
    h.configure({ defaultConnection: 'builtin:exa', connections: { 'builtin:exa': { disabled: true } } })
    const agent = await h.agent('a')
    expect(await h.sessions.current(liveSession(agent))).toMatchObject({ source: 'default', selection: { connectionId: 'builtin:exa', revision: 0 } })
  })

  it('skips removed model memories while preserving them for explicit clearing', async () => {
    const h = await setup()
    await h.pairings.set({ provider: 'p', model: 'm' }, 'custom:removed')
    const agent = await h.agent('a')
    expect(await h.sessions.current(liveSession(agent))).toMatchObject({ source: 'default', selection: { connectionId: 'builtin:deepseek-messages' } })
    expect(await h.pairings.list()).toEqual([{ provider: 'p', model: 'm', connectionId: 'custom:removed' }])
    await h.pairings.forget({ provider: 'p', model: 'm' })
    expect(await h.pairings.list()).toEqual([])
  })

  it('skips disabled custom adapter memories and keeps the configured default', async () => {
    const h = await setup()
    h.configure({ defaultConnection: 'builtin:openalex', connections: {
      'custom:legacy': { kind: 'adapter', adapter: 'exa', label: 'Disabled adapter', disabled: true, credentialRef: 'EXA_KEY' },
    } })
    await h.pairings.set({ provider: 'p', model: 'm' }, 'custom:legacy')
    expect(await h.sessions.current(liveSession(await h.agent('legacy-memory')))).toMatchObject({ source: 'default', selection: { connectionId: 'builtin:openalex' } })
  })

  it.each(['default', 'model'] as const)('a fork with no parent record reports %s on repeated reads', async source => {
    const h = await setup()
    if (source === 'model') await h.pairings.set({ provider: 'p', model: 'm' }, null)
    const fork = await h.agent('orphan', 'missing-parent')
    const expected = { source, selection: { connectionId: source === 'model' ? null : 'builtin:deepseek-messages', revision: 0 } }
    expect(await h.sessions.current(liveSession(fork))).toMatchObject(expected)
    expect(await h.sessions.current(liveSession(fork))).toMatchObject(expected)
  })

  it('does not relabel a fallback as inherited when a missing parent record appears later', async () => {
    const h = await setup()
    const fork = await h.agent('orphan', 'late-parent')
    expect(await h.sessions.current(liveSession(fork))).toMatchObject({ source: 'default' })
    await (await h.storage.domain()).table('selections').put('late-parent', { connectionId: null, revision: 1 })
    expect(await h.sessions.current(liveSession(fork))).toMatchObject({ source: 'default', selection: { connectionId: 'builtin:deepseek-messages' } })
    const reopened = new SearchSessions(h.ctx, () => resolveSettings({}), h.storage, h.pairings, new SearchRestriction(h.ctx))
    expect(await reopened.current(liveSession(fork))).toMatchObject({ source: 'default' })
  })

  it('a fork resolves its live parent before freezing inherited revision-zero state', async () => {
    const h = await setup()
    const parent = await h.agent('parent')
    await h.sessions.current(liveSession(parent))
    h.configure({ defaultConnection: 'builtin:openalex' })
    const fork = await h.agent('fork', 'parent')
    expect(await h.sessions.current(liveSession(fork))).toMatchObject({ source: 'inherited', selection: { connectionId: 'builtin:openalex', revision: 0 } })
    h.configure({ defaultConnection: 'builtin:firecrawl' })
    expect((await h.sessions.current(liveSession(fork))).selection.connectionId).toBe('builtin:openalex')
    expect((await h.sessions.current(liveSession(parent))).selection.connectionId).toBe('builtin:firecrawl')
  })

  it('a fork inherits persisted parent choices even when the parent is not running', async () => {
    const h = await setup({ parent: { connectionId: null, revision: 2, freshness: 'realtime' } })
    const fork = await h.agent('fork', 'parent')
    expect(await h.sessions.current(liveSession(fork))).toEqual({ source: 'inherited', selection: { connectionId: null, revision: 0, options: { freshness: 'realtime' } } })
  })
})

describe('step snapshot identity', () => {
  it('shares concurrent capture and preserves a completed plan until the next step', async () => {
    const h = await setup()
    const agent = await h.agent('a')
    const snapshots = new Snapshots()
    const deferred = Promise.withResolvers<SearchPlan>()
    let captures = 0
    const capture = () => { captures++; return deferred.promise }
    const first = snapshots.capture(agent, 1, 0, capture)
    const second = snapshots.capture(agent, 1, 0, capture)
    expect(captures).toBe(1)
    deferred.resolve({ kind: 'off' })
    await Promise.all([first, second])
    await snapshots.capture(agent, 1, 0, capture)
    expect(captures).toBe(1)
    expect(snapshots.get(agent)).toEqual({ kind: 'off' })
    await snapshots.capture(agent, 1, 1, async () => ({ kind: 'invalid', connectionId: 'custom:gone' }))
    expect(snapshots.get(agent)).toEqual({ kind: 'invalid', connectionId: 'custom:gone' })
    snapshots.forget(agent)
    expect(snapshots.get(agent)).toBeUndefined()
  })

  it('retries failed capture for the same step after the unavailable context recovers', async () => {
    const h = await setup()
    const agent = await h.agent('a')
    const snapshots = new Snapshots()
    await snapshots.capture(agent, 1, 0, async () => ({ kind: 'failed', error: searchError('WEB_PROVIDER_ERROR', 'storage is unavailable') }))
    expect(snapshots.get(agent)?.kind).toBe('failed')
    await snapshots.capture(agent, 1, 0, async () => ({ kind: 'off' }))
    expect(snapshots.get(agent)).toEqual({ kind: 'off' })
  })
})
