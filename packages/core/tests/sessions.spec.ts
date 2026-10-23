import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Projections from '@deepseek-ai/dsh-session-projection'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, expect, it } from 'vitest'
import { liveSession, Pairings, Sessions, SessionStorage, ToolRestriction, type OptionsCodec, type SessionChange } from '../src/host/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).toReversed()) await cleanup() })

it('supports a capability with no session options and isolates its storage from another install', async () => {
  const root = await mkdtemp(join(tmpdir(), 'core-sessions-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const settings = { defaultConnection: 'builtin:local', enhancedTools: false, connections: new Map([['builtin:local', { id: 'builtin:local', kind: 'local' as const, disabled: false }]]) }
  const codec: OptionsCodec<Record<string, never>, typeof settings> = { initial: () => ({}), fromRecord: () => ({}), toRecord: () => ({}) }
  const sessions = (name: string) => {
    const storage = new SessionStorage(ctx, name, codec)
    return new Sessions(ctx, () => settings, storage, new Pairings(storage), new ToolRestriction(ctx, { tool: 'web_fetch', routed: () => false }))
  }
  const one = sessions('core_one')
  const two = sessions('core_two')
  const handle = await ctx.agents.create({ sessionId: SessionId('shared-session'), agentOptions: { provider: 'fixture', model: 'm' } })
  cleanups.push(() => handle.dispose())
  const change: SessionChange<Record<string, never>> = { connectionId: null }
  expect(await one.change(liveSession(handle.agent), change, 0)).toEqual({ source: 'session', selection: { connectionId: null, revision: 1, options: {} } })
  expect(await two.current(liveSession(handle.agent))).toEqual({ source: 'default', selection: { connectionId: 'builtin:local', revision: 0, options: {} } })
})
