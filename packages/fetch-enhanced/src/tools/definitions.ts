import { DEFAULT_FETCH_MAX_OUTPUT_CHARS, fetchMetaFromValue, formatFetchOutput, parseFetchArgs } from '@deepseek-ai/dsh-tool-web'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import {
  explicitCall, fetchListingSchema, fetchListingValue, invalidArguments, listProviders, providerArgument, rejectUnknownProperties, renderFetchListing, runOnProvider,
  type EnhancedAccess, type EnhancedTools, type EnhancedVoice,
} from 'dsh-tool-web-enhanced-core/host'
import { FETCH, builtinId } from 'dsh-tool-web-enhanced-core/shared'
import type { FetchOptions } from '../host/options.ts'

const { action, list } = FETCH.tools
const VOICE: EnhancedVoice = { identity: FETCH, capability: 'web fetch', nativeTool: 'web_fetch', sends: 'URLs' }
const LOCAL = builtinId('local')
/**
 * local's own URL and allowlist refusals get no switch-provider hint: an invalid URL fails
 * everywhere, and the operator's allowlist is not something to route around.
 */
const LOCAL_REFUSALS: readonly string[] = ['WEB_INVALID_URL', 'WEB_BLOCKED_URL']

/** Slightly longer than the remote backends' 120 s deadline, so their worded timeout arrives first (docs/design.md, "工具与输出"). */
const FETCH_TIMEOUT_MS = 130_000

/** `web_fetch`'s output schema plus the provider that served the call. */
const FETCH_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    provider: { type: 'string', required: true },
    url: { type: 'string', required: true },
    statusCode: { type: 'integer', required: true },
    body: {
      required: true,
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'html' },
            content: { type: 'string', required: true },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'text' },
            content: { type: 'string', required: true },
          },
        },
      ],
    },
    truncated: { type: 'boolean', required: true },
  },
} as const

/** tool-web's `parseFetchArgs`, its problem worded as an argument error like DSH's own. */
function fetchArgs(args: { readonly url: string }): { url: string } {
  try {
    return parseFetchArgs(args)
  } catch (error) {
    throw invalidArguments((error as Error).message)
  }
}

/** The two static fetch definitions (docs/design.md, "工具与输出"); available providers never enter them. */
export function fetchTools(access: EnhancedAccess<FetchOptions, WebFetchRequest, WebFetchResult>): EnhancedTools {
  return {
    action: defineTool({
      name: action,
      description: 'Fetch a URL through a provider you choose and return it as text. Use web_fetch unless you need a specific provider: one the user named, or another after web_fetch fails.',
      parameters: {
        url: { type: 'string', required: true, description: 'The HTTP(S) URL to fetch.' },
        provider: { type: 'string', required: true, description: `Provider id exactly as listed by ${list}.` },
      },
      output: {
        schema: FETCH_RESULT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: `Provider: ${value.provider}\n\n${formatFetchOutput(value, DEFAULT_FETCH_MAX_OUTPUT_CHARS)}` }],
        presentationMeta: (_args, value) => fetchMetaFromValue(value, DEFAULT_FETCH_MAX_OUTPUT_CHARS),
      },
      timeoutMs: FETCH_TIMEOUT_MS,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        rejectUnknownProperties(args, ['url', 'provider'])
        const { url } = fetchArgs(args)
        const call = explicitCall(action, exec)
        const provider = await providerArgument(VOICE, args.provider, access, call)
        const result = await runOnProvider(VOICE, access, provider, { url }, call, error => provider === LOCAL && LOCAL_REFUSALS.includes(error.code))
        return {
          provider,
          url: result.url,
          statusCode: result.statusCode,
          body: { kind: result.body.kind, content: result.body.content },
          truncated: result.truncated,
        }
      },
    }),
    list: defineTool({
      name: list,
      description: `List the providers ${action} accepts, with who receives the URL and whether each is ready.`,
      parameters: {},
      output: {
        schema: fetchListingSchema(),
        render: (_args, value) => [{ type: 'text', text: renderFetchListing(VOICE, value) }],
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        rejectUnknownProperties(args, [])
        return fetchListingValue(await listProviders(VOICE, access, explicitCall(list, exec)))
      },
    }),
  }
}
