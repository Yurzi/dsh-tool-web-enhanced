import { FETCH, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { messagesStream, modelResponse, type ModelToolCall } from '../harness/model-api.ts'
import { startRemoteFetchApi } from '../harness/remote-fetch-api.ts'
import { firecrawlResponse, remoteFetchFixture } from './remote-fetch.ts'
import { toolResults, type MessagesRequest } from './enhanced-flow.ts'

export const subagentSelection = {
  title: 'M5.5 selection parent',
  answer: 'M5.5 loopback turn completed.',
  credentialRef: 'M55_LOOPBACK_KEY',
  key: 'm55-fixture-never-real',
  kinds: ['spawn', 'fork'],
} as const

export function selectionRows(endpointA: string, endpointB: string) {
  const search = (endpoint: string, suffix: string) => ({
    kind: 'model', protocol: 'anthropic-messages', model: 'm55-search',
    label: 'M55 Search ' + suffix.toUpperCase(), endpoint, trustedEndpoint: true,
    credentialRef: subagentSelection.credentialRef,
  })
  const fetch = (endpoint: string, suffix: string) => ({
    kind: 'adapter', adapter: 'firecrawl', label: 'M55 Fetch ' + suffix.toUpperCase(),
    endpoint: new URL('v2/scrape', endpoint).href, trustedEndpoint: true,
    credentialRef: subagentSelection.credentialRef,
  })
  return [
    { id: SEARCH.rowId, config: { version: 2, defaultConnection: 'custom:m55-search-a', connections: {
      'custom:m55-search-a': search(endpointA, 'a'), 'custom:m55-search-b': search(endpointB, 'b'),
    } } },
    { id: FETCH.rowId, config: { version: 2, defaultConnection: 'custom:m55-fetch-a', connections: {
      'custom:m55-fetch-a': fetch(endpointA, 'a'), 'custom:m55-fetch-b': fetch(endpointB, 'b'),
    } } },
  ]
}

/** Two independently observable destinations, neither ever contacts the requested URL. */
export function startSelectionBackend() {
  return startRemoteFetchApi(request => request.path === '/v2/scrape'
    ? firecrawlResponse()
    : modelResponse({ content: [{ type: 'text', text: 'M55 selected search destination.' }] }))
}

/** Parent commands are queued explicitly; children request native web tools only on a follow-up. */
export async function startSubagentModel() {
  let pending: readonly ModelToolCall[] = []
  let boundary: { reached: ReturnType<typeof Promise.withResolvers<void>>; release: ReturnType<typeof Promise.withResolvers<void>> } | undefined
  const api = await startRemoteFetchApi(async request => {
    if (pending.length > 0) {
      const calls = pending
      pending = []
      return messagesStream(calls.map(call => ({ type: 'tool_use', ...call })), 'tool_use')
    }
    const body = JSON.parse(request.body) as MessagesRequest
    const last = body.messages.findLast(message => message.role === 'user')
    const text = last === undefined ? '' : typeof last.content === 'string' ? last.content
      : last.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (text.includes('M55_WAIT_WEB_')) {
      if (boundary === undefined) throw new Error('No child request boundary was armed')
      const current = boundary
      current.reached.resolve()
      await current.release.promise
      return messagesStream([{ type: 'tool_use', id: 'm55_boundary', name: 'list_agents', input: {} }], 'tool_use')
    }
    const lastResults = last === undefined ? [] : toolResults({ tools: [], messages: [last] })
    if (text.includes('M55_RUN_WEB_') || lastResults.some(result => result.id === 'm55_boundary')) {
      return messagesStream([
        { type: 'tool_use', id: 'm55_search', name: 'web_search', input: { queries: ['M55 child selected route'] } },
        { type: 'tool_use', id: 'm55_fetch', name: 'web_fetch', input: { url: remoteFetchFixture.requestedUrl } },
      ], 'tool_use')
    }
    return messagesStream([{ type: 'text', text: subagentSelection.answer }], 'end_turn')
  })
  return { ...api, blockNextChild() {
    const current = { reached: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }
    boundary = current
    return { reached: current.reached.promise, release: () => { current.release.resolve() } }
  }, next(calls: readonly ModelToolCall[]) {
    if (pending.length > 0) throw new Error('The previous parent command has not been consumed')
    pending = calls
  } }
}
