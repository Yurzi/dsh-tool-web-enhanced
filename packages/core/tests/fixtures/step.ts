/** Inspect the model-facing request through rc.1 step admission, in Native or PTC mode. */
import type { Context } from '@deepseek-ai/cordis'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'

export async function assembleStep(ctx: Context, agent: Agent) {
  const signal = new AbortController().signal
  const toolSet = await ctx.tools.resolve({
    agent, modelSelection: agent.model.current() ?? { provider: 'fixture', model: 'fixture' }, signal,
  })
  try {
    return await ctx.systemPrompt.assemble({ ...assembleContextFor(agent, signal), toolSet })
  } finally { toolSet.dispose() }
}
