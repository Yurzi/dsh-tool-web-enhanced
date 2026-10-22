import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, expect, it } from 'vitest'
import { openDomain, selectionDomain, SessionStorage, type DomainAccess } from '../src/host/storage.ts'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { ProviderLists } from '../src/host/provider-lists.ts'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).toReversed()) await cleanup() })

it('never reopens storage from queued work after its owning plugin was disposed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'core-storage-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const accesses: DomainAccess[] = []
  const plugin = { apply: (scope: Context) => { accesses.push(openDomain(scope, 'core_lifecycle')) } }
  const first = await ctx.plugin(plugin)
  const access = accesses[0]!
  await (await access.domain()).table('selections').put('session', { connectionId: null, revision: 1 })
  await first.dispose()
  await expect(access.domain().then(() => 'reopened')).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  await ctx.plugin(plugin)
  expect((await accesses[1]!.domain()).table('selections').get('session')).toEqual({ connectionId: null, revision: 1 })
})

it('adds provider_lists to the existing version-one domain without migrating selections or pairings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'core-domain-upgrade-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const old = defineDomain({ name: 'core_upgrade', version: 1, tables: {
    selections: domainTable<string, { connectionId: string | null; revision: number }>(z.looseObject({ connectionId: z.string().nullable(), revision: z.number() })),
    pairings: domainTable<string, { connectionId: string | null }>(z.object({ connectionId: z.string().nullable() })),
  } })
  const first = await ctx.storageDomain.open(old)
  await first.table('selections').put('old', { connectionId: null, revision: 2 })
  await first.table('pairings').put('p/m', { connectionId: 'builtin:old' })
  await first.close()
  const next = await ctx.storageDomain.open(selectionDomain('core_upgrade'))
  expect(next.table('selections').get('old')).toEqual({ connectionId: null, revision: 2 })
  expect(next.table('pairings').get('p/m')).toEqual({ connectionId: 'builtin:old' })
  expect(next.table('provider_lists').get('old')).toBeUndefined()
  await next.table('provider_lists').put('new', ['builtin:a'])
  await next.close()
  const restored = await ctx.storageDomain.open(selectionDomain('core_upgrade'))
  expect(restored.table('provider_lists').get('new')).toEqual(['builtin:a'])
  expect(restored.table('selections').get('old')).toEqual({ connectionId: null, revision: 2 })
  await restored.close()
})

it('shares the session queue with provider lists, writes authorization once, and keeps empty lists absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'core-list-queue-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const storage = new SessionStorage(ctx, 'core_queued_lists', { initial: () => ({}), fromRecord: () => ({}), toRecord: () => ({}) })
  const lists = new ProviderLists(storage)
  const agent = { session: Session.create(SessionId('queued')) } as Agent
  const gate = Promise.withResolvers<void>()
  const order: string[] = []
  const selection = storage.exclusive(agent.session.id, async () => { await gate.promise; order.push('selection') })
  const create = lists.create(agent, ['builtin:b', 'builtin:a']).then(value => { order.push('list'); return value })
  expect(order).toEqual([])
  gate.resolve()
  await selection
  expect(await create).toEqual(['builtin:b', 'builtin:a'])
  expect(order).toEqual(['selection', 'list'])
  expect(await lists.create(agent, ['builtin:c'])).toEqual(['builtin:b', 'builtin:a'])
  const empty = { session: Session.create(SessionId('empty')) } as Agent
  expect(await lists.create(empty, [])).toBeUndefined()
  expect(await lists.create(empty, ['builtin:c'])).toBeUndefined()
})
