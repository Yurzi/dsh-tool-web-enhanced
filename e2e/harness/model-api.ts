import { startRemoteFetchApi, type RemoteFetchResponse } from './remote-fetch-api.ts'

/** Reuse the loopback-only wire recorder; no upstream model or search URL is ever fetched. */
export const startModelApi = (payload: unknown) => startRemoteFetchApi(modelResponse(payload))

export interface ModelToolCall {
  readonly id: string
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
}

type ModelBlock = { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: Readonly<Record<string, unknown>> }
  | { readonly type: 'text'; readonly text: string }

/** Deterministic Messages SSE transcript: real Agent loop, only model transport is fake. */
export function startAgentModelApi(calls: readonly ModelToolCall[], answer = 'Enhanced tools completed.') {
  let step = 0
  return startRemoteFetchApi(() => {
    const blocks: ModelBlock[] = step++ === 0
      ? calls.map(call => ({ type: 'tool_use', id: call.id, name: call.name, input: call.input }))
      : [{ type: 'text', text: answer }]
    return messagesStream(blocks, step === 1 ? 'tool_use' : 'end_turn')
  })
}

export function messagesStream(blocks: readonly ModelBlock[], stopReason: string): RemoteFetchResponse {
  const events: Record<string, unknown>[] = [{
    type: 'message_start', message: {
      id: 'msg_e2e', type: 'message', role: 'assistant', model: 'deepseek-v4-pro', content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 },
    },
  }]
  for (const [index, block] of blocks.entries()) {
    events.push(
      { type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } },
      { type: 'content_block_delta', index, delta: block.type === 'tool_use'
        ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
        : { type: 'text_delta', text: block.text } },
      { type: 'content_block_stop', index },
    )
  }
  events.push(
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  )
  return { status: 200, headers: { 'content-type': 'text/event-stream' },
    body: events.map(event => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n').join('') }
}

/** A reusable text-only model for real GUI request-schema checks. */
export function startTextModelApi(answer: string) {
  return startRemoteFetchApi(() => messagesStream([{ type: 'text', text: answer }], 'end_turn'))
}

export function modelResponse(payload: unknown) {
  return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
}
