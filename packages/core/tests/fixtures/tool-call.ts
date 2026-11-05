/** Single-call assertions over rc.1's real batch executor and step admission. */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { expect } from 'vitest'

type Call = Pick<ToolExecutionInput, 'callId' | 'name' | 'arguments' | 'agent' | 'signal'>

export async function toolCall(ctx: Context, input: Call): Promise<ToolExecutionResult> {
  const toolSet = input.agent === undefined ? undefined : await ctx.tools.resolve({
    agent: input.agent,
    // Fixtures without an LLM route still exercise the real registration conditions.
    modelSelection: input.agent.model.current() ?? { provider: 'fixture', model: 'fixture' },
    signal: input.signal,
  })
  try {
    const batch = await ctx.tools.execute({
      calls: [{ type: 'tool-call', id: input.callId, name: input.name, arguments: JSON.stringify(input.arguments) }],
      ...input.agent === undefined ? {} : { agent: input.agent },
      ...toolSet === undefined ? {} : { toolSet },
      signal: input.signal,
    })
    expect(batch.results).toHaveLength(1)
    expect(batch.results[0]!.callId).toBe(input.callId)
    return batch.results[0]!.result
  } finally {
    toolSet?.dispose()
  }
}
