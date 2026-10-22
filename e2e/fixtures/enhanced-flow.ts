import { FETCH, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { modelDocument, modelFixture } from './search-model.ts'
import { customFetchDocument, remoteFetchFixture } from './remote-fetch.ts'
import type { ModelToolCall } from '../harness/model-api.ts'

export const enhancedFlow = {
  title: 'M5 enhanced tools loopback',
  answer: 'All four enhanced tools completed through loopback services.',
  query: 'M5 provider routing',
  searchContent: 'Search came from the explicitly chosen loopback provider.',
} as const

export const enhancedCalls: readonly ModelToolCall[] = [
  { id: 'm5_list_search', name: SEARCH.tools.list, input: {} },
  { id: 'm5_list_fetch', name: FETCH.tools.list, input: {} },
  { id: 'm5_search', name: SEARCH.tools.action, input: { queries: [enhancedFlow.query], provider: modelFixture.connectionId } },
  { id: 'm5_fetch', name: FETCH.tools.action, input: { url: remoteFetchFixture.requestedUrl, provider: remoteFetchFixture.connectionId } },
]

export function enhancedRows(searchEndpoint: string, fetchEndpoint: string) {
  return [
    { id: SEARCH.rowId, config: { ...modelDocument(searchEndpoint), enhancedTools: true, defaultConnection: 'builtin:deepseek-messages' } },
    { id: FETCH.rowId, config: { ...customFetchDocument(fetchEndpoint), enhancedTools: true, defaultConnection: 'builtin:local' } },
  ]
}

/** The protocol fixture is ours; parse only the documented Messages request vocabulary. */
export interface MessagesRequest {
  readonly tools: readonly { readonly name: string }[]
  readonly messages: readonly { readonly role: string; readonly content: string | readonly MessagesBlock[] }[]
}

type MessagesBlock = { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_result'; readonly tool_use_id: string; readonly is_error?: boolean;
    readonly content: string | readonly { readonly type: string; readonly text: string }[] }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }

export function toolResults(request: MessagesRequest) {
  return request.messages.flatMap(message => typeof message.content === 'string' ? [] : message.content)
    .filter(block => block.type === 'tool_result')
    .map(block => ({ id: block.tool_use_id, error: block.is_error === true,
      text: typeof block.content === 'string' ? block.content : block.content.map(part => part.text).join('\n') }))
}
