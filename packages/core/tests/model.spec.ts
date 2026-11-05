import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it } from 'vitest'
import { nextModel, requestModel } from '../src/host/model.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).toReversed()) await cleanup() })

async function host() {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(AgentLoop)
  const handle = await ctx.agents.create({ sessionId: SessionId('model-api'),
    agentOptions: { provider: 'initial', model: 'initial-model' } })
  cleanups.push(() => handle.dispose())
  return { ctx, agent: handle.agent }
}

it('uses the Agent-owned current selection without requiring a caller projection service', async () => {
  const { agent } = await host()
  const caller = new Context()
  cleanups.push(() => caller.fiber.dispose())
  expect(nextModel(caller, agent)).toEqual({ provider: 'initial', model: 'initial-model' })
  agent.model.select({ provider: 'selected', model: 'next-model' })
  expect(nextModel(caller, agent)).toEqual({ provider: 'selected', model: 'next-model' })
})

it('keeps request authentication on frozen requestContext while a different next model is selected', async () => {
  const { ctx, agent } = await host()
  expect(requestModel(agent)).toBeUndefined()
  const request = { provider: 'deepseek-account', model: 'request-model' }
  agent.session.append('request/header', { header: { config: request }, reason: 'initial' })
  agent.session.append('request/context', request)
  agent.model.select({ provider: 'next-provider', model: 'next-model' })
  expect(nextModel(ctx, agent)).toEqual({ provider: 'next-provider', model: 'next-model' })
  expect(requestModel(agent)).toEqual(request)
  agent.model.select({ provider: 'another-provider', model: 'later-model' })
  expect(requestModel(agent)).toEqual(request)
})
