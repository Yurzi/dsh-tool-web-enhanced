import { WEB_SEARCH_MAX_QUERIES, formatSearchOutput, searchMetaFromValue } from '@deepseek-ai/dsh-tool-web'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import {
  explicitCall, listProviders, providerArgument, rejectUnknownProperties, renderSearchListing, runOnProvider, searchListingSchema, searchListingValue,
  type EnhancedAccess, type EnhancedTools, type EnhancedVoice,
} from 'dsh-tool-web-enhanced-core/host'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import type { SearchOptions } from '../host/options.ts'
import { parseQueries, projectSource, searchQueries } from './queries.ts'

const { action, list } = SEARCH.tools
const VOICE: EnhancedVoice = { identity: SEARCH, capability: 'web search', nativeTool: 'web_search', sends: 'queries' }

/** Slightly longer than the remote backends' 90 s deadline, so their worded timeout arrives first (docs/design.md, "工具与输出"). */
const SEARCH_TIMEOUT_MS = 100_000

/** `web_search`'s output schema plus the provider that served the call. */
const SEARCH_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    provider: { type: 'string', required: true },
    content: { type: 'string' },
    sources: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          title: { type: 'string' },
          snippet: { type: 'string' },
          publishedAt: { type: 'string' },
        },
      },
    },
    truncated: { type: 'boolean', required: true },
  },
} as const

/** The two static search definitions (docs/design.md, "工具与输出"); available providers never enter them. */
export function searchTools(access: EnhancedAccess<SearchOptions, WebSearchRequest, WebSearchResult>): EnhancedTools {
  return {
    action: defineTool({
      name: action,
      description: `Search the web through a provider you choose. Use web_search unless you need a specific provider: one the user named, a specialized index, or another after web_search fails.`,
      parameters: {
        queries: { type: 'array', required: true, items: { type: 'string' }, description: `1–${WEB_SEARCH_MAX_QUERIES} search queries; their results are merged.` },
        provider: { type: 'string', required: true, description: `Provider id exactly as listed by ${list}.` },
      },
      output: {
        schema: SEARCH_RESULT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: `Provider: ${value.provider}\n\n${formatSearchOutput(value)}` }],
        presentationMeta: (_args, value) => searchMetaFromValue(value),
      },
      timeoutMs: SEARCH_TIMEOUT_MS,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        rejectUnknownProperties(args, ['queries', 'provider'])
        const queries = parseQueries(args.queries)
        const call = explicitCall(action, exec)
        const provider = await providerArgument(VOICE, args.provider, access, call)
        const result = await searchQueries(queries, (request, signal) => runOnProvider(VOICE, access, provider, request, { agent: call.agent, signal }), call.signal)
        return {
          provider,
          ...result.content !== undefined ? { content: result.content } : {},
          sources: result.sources.map(projectSource),
          truncated: result.truncated,
        }
      },
    }),
    list: defineTool({
      name: list,
      description: `List the providers ${action} accepts, with what each is for and whether it is ready.`,
      parameters: {},
      output: {
        schema: searchListingSchema(),
        render: (_args, value) => [{ type: 'text', text: renderSearchListing(VOICE, value) }],
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        rejectUnknownProperties(args, [])
        return searchListingValue(await listProviders(VOICE, access, explicitCall(list, exec)))
      },
    }),
  }
}
