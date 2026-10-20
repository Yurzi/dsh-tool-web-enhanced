import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Projections from '@deepseek-ai/dsh-session-projection'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it } from 'vitest'
import { Snapshots } from '../src/host/plans.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).toReversed()) await cleanup() })

async function setup() {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  const handle = await ctx.agents.create({ sessionId: SessionId('snapshot') })
  cleanups.push(() => handle.dispose())
  return { agent: handle.agent, snapshots: new Snapshots<{ kind: 'ready'; value: string }>() }
}

it('allows same-step retry after a rejected capture and shares the original rejection', async () => {
  const { agent, snapshots } = await setup()
  const deferred = Promise.withResolvers<{ kind: 'ready'; value: string }>()
  const first = snapshots.capture(agent, 1, 0, () => deferred.promise)
  const concurrent = snapshots.capture(agent, 1, 0, async () => ({ kind: 'ready', value: 'unused' }))
  expect(concurrent).toBe(first)
  const failure = new Error('capture failed')
  deferred.reject(failure)
  await expect(first).rejects.toBe(failure)
  expect(snapshots.get(agent)).toBeUndefined()
  await snapshots.capture(agent, 1, 0, async () => ({ kind: 'ready', value: 'retry' }))
  expect(snapshots.get(agent)).toEqual({ kind: 'ready', value: 'retry' })
})

it('does not discard a newer snapshot when an older capture rejects', async () => {
  const { agent, snapshots } = await setup()
  const deferred = Promise.withResolvers<{ kind: 'ready'; value: string }>()
  const first = snapshots.capture(agent, 1, 0, () => deferred.promise)
  await snapshots.capture(agent, 1, 1, async () => ({ kind: 'ready', value: 'newer' }))
  const failure = new Error('old capture failed')
  deferred.reject(failure)
  await expect(first).rejects.toBe(failure)
  await snapshots.capture(agent, 1, 1, async () => ({ kind: 'ready', value: 'must not replace' }))
  expect(snapshots.get(agent)).toEqual({ kind: 'ready', value: 'newer' })
})
