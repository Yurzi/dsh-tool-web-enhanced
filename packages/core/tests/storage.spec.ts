import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, expect, it } from 'vitest'
import { openDomain, type DomainAccess } from '../src/host/storage.ts'

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
