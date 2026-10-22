import type { AccessMode, Descriptor, ProtocolDescriptor } from 'dsh-tool-web-enhanced-core/shared'

export { FRESHNESS, type Freshness } from 'dsh-tool-web-enhanced-core/shared'

export type SearchDescriptor = Descriptor & { readonly freshness: readonly AccessMode[] } & (
  | { readonly kind: 'native' | 'adapter'; readonly endpoint: string }
  | { readonly kind: 'model' }
)

const noControl = /^[\u0020-\u{10ffff}]+$/u
const nativeAccess = { keyless: false, apiKey: { credentialRef: 'DEEPSEEK_API_KEY' }, account: true } as const
const baseURL = { kind: 'url' } as const

/**
 * Model search options. Names are unique across protocols: a custom model
 * connection accepts its protocol's subset, the Session-model connection
 * accepts all of them and applies those of the route it follows. Unset
 * options keep each API's own default; defaults follow the current Anthropic
 * and OpenAI standards, and another vendor's compatibility is the operator's
 * to tune here.
 */
const maxTokens = { kind: 'integer', min: 1, max: 128_000 } as const
/** Anthropic Messages tool versions, newest first. */
const anthropicTool = { kind: 'enum', values: ['web_search_20260318', 'web_search_20260209', 'web_search_20250305'] } as const
const maxUses = { kind: 'integer', min: 1, max: 50 } as const
/** `direct` is required by models without programmatic tool calling on web_search_20260209 and later. */
const allowedCallers = { kind: 'enum', values: ['direct', 'code_execution_20260120'] } as const
const responseInclusion = { kind: 'enum', values: ['full', 'excluded'] } as const
const responsesTool = { kind: 'enum', values: ['web_search', 'web_search_preview'] } as const
const searchContextSize = { kind: 'enum', values: ['low', 'medium', 'high'] } as const
const externalWebAccess = { kind: 'boolean' } as const
const returnTokenBudget = { kind: 'enum', values: ['default', 'unlimited'] } as const
/** A bare domain with an optional path and no scheme, as both vendors document; disjoint classes keep the match linear. */
const DOMAIN = /^[A-Za-z0-9.-]{1,253}(?:\/[\x21-\x7e]{1,200})?$/u
const allowedDomains = { kind: 'list', pattern: DOMAIN, max: 100 } as const
const blockedDomains = { kind: 'list', pattern: DOMAIN, max: 100 } as const
const userCity = { kind: 'text', pattern: noControl, maxLength: 200 } as const
const userRegion = { kind: 'text', pattern: noControl, maxLength: 200 } as const
const userCountry = { kind: 'text', pattern: /^[A-Za-z]{2}$/u } as const
const userTimezone = { kind: 'text', pattern: /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,3}$/u, maxLength: 64 } as const
const location = { userCity, userRegion, userCountry, userTimezone } as const

/** Wire protocols of `model` connections, in display order; custom model connections name one of these keys. */
export const MODEL_PROTOCOLS = {
  'anthropic-messages': {
    label: 'Anthropic Messages', use: 'the model searches and answers',
    options: { maxTokens, anthropicTool, maxUses, allowedCallers, responseInclusion, allowedDomains, blockedDomains, ...location },
    /** Anthropic takes one domain policy; Responses takes both. */
    exclusive: [['allowedDomains', 'blockedDomains']],
  },
  'openai-responses': {
    label: 'OpenAI Responses', use: 'the model searches and answers',
    options: { maxTokens, responsesTool, searchContextSize, externalWebAccess, returnTokenBudget, allowedDomains, blockedDomains, ...location },
  },
  'openai-chat-completions': {
    label: 'OpenAI Chat Completions', use: 'the model searches and answers',
    options: { maxTokens, searchContextSize, ...location },
  },
} as const satisfies Record<string, ProtocolDescriptor>
export type ModelProtocol = keyof typeof MODEL_PROTOCOLS

/** Every protocol's options: the Session-model connection's rules. */
export const MODEL_OPTIONS = {
  ...MODEL_PROTOCOLS['anthropic-messages'].options,
  ...MODEL_PROTOCOLS['openai-responses'].options,
  ...MODEL_PROTOCOLS['openai-chat-completions'].options,
} as const

/**
 * What a request sends when the operator sets nothing. Anthropic requires
 * max_tokens; OpenAI token caps stay unset. Tool versions are each vendor's
 * current standard; DeepSeek's Messages dialect supplies different defaults
 * in model/deepseek.ts, unless the operator explicitly selects a tool version.
 */
export const MODEL_DEFAULTS = {
  maxTokens: 4096,
  maxUses: 5,
  anthropicTool: 'web_search_20260318',
  responsesTool: 'web_search',
} as const

/** Display order and secret-free facts shared by settings, Host and browser. */
export const CATALOG = {
  'deepseek-messages': {
    label: 'DeepSeek Messages', kind: 'native', remote: true, optIn: false, use: 'answers with a summary and sources',
    endpoint: 'https://api.deepseek.com/anthropic/v1', homepage: 'https://platform.deepseek.com',
    access: nativeAccess, freshness: [],
    options: {
      baseURL,
      model: { kind: 'text', pattern: /[\s\S]*/u },
      apiVersion: { kind: 'text', pattern: /[\s\S]*/u },
      maxTokens: { kind: 'integer', min: 1, max: Number.POSITIVE_INFINITY },
      maxUses: { kind: 'integer', min: 1, max: Number.POSITIVE_INFINITY },
    },
  },
  'deepseek-search-api': {
    label: 'DeepSeek Search API', kind: 'native', remote: true, optIn: true,
    endpoint: 'https://api.deepseek.com/v1/tools', homepage: 'https://platform.deepseek.com',
    access: nativeAccess, freshness: [],
    options: {
      baseURL,
      count: { kind: 'integer', min: 1, max: 50 },
      sendOriginalQuestion: { kind: 'boolean' },
    },
  },
  'session-model': {
    label: 'Session model', kind: 'model', remote: true, optIn: false, use: 'the session model searches and answers',
    access: { keyless: false, apiKey: false, account: false }, freshness: [], options: MODEL_OPTIONS,
    // It mostly follows Messages routes, so it keeps the stricter Anthropic rule.
    exclusive: MODEL_PROTOCOLS['anthropic-messages'].exclusive,
  },
  exa: {
    label: 'Exa', endpoint: 'https://api.exa.ai/search', access: { keyless: true, apiKey: { credentialRef: 'EXA_API_KEY' }, account: false },
    kind: 'adapter', remote: true, optIn: true, freshness: ['api-key'], homepage: 'https://exa.ai',
    options: { type: { kind: 'enum', values: ['auto', 'fast', 'instant'], keyless: false } },
  },
  firecrawl: {
    label: 'Firecrawl', endpoint: 'https://api.firecrawl.dev/v2/search', access: { keyless: true, apiKey: { credentialRef: 'FIRECRAWL_API_KEY' }, account: false },
    kind: 'adapter', remote: true, optIn: true, freshness: ['keyless', 'api-key'], homepage: 'https://www.firecrawl.dev',
    options: { country: { kind: 'text', pattern: /^[A-Za-z]{2}$/u }, location: { kind: 'text', pattern: noControl, maxLength: 200 }, safe: { kind: 'boolean' } },
  },
  tavily: {
    label: 'Tavily', endpoint: 'https://api.tavily.com/search', access: { keyless: true, apiKey: { credentialRef: 'TAVILY_API_KEY' }, account: false },
    kind: 'adapter', remote: true, optIn: true, freshness: [], homepage: 'https://www.tavily.com',
    options: {
      search_depth: { kind: 'enum', values: ['basic', 'advanced', 'fast', 'ultra-fast'] },
      topic: { kind: 'enum', values: ['general', 'news', 'finance'] },
    },
  },
  tinyfish: {
    label: 'Tinyfish', endpoint: 'https://api.search.tinyfish.ai', access: { keyless: true, apiKey: { credentialRef: 'TINYFISH_API_KEY' }, account: false },
    kind: 'adapter', remote: true, optIn: true, freshness: [], homepage: 'https://www.tinyfish.ai',
    options: {
      location: { kind: 'text', pattern: /^[A-Za-z]{2}$/u },
      language: { kind: 'text', pattern: /^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/u },
      purpose: { kind: 'text', pattern: /^[\u0020-\u{10ffff}]+$/u },
      domain_type: { kind: 'enum', values: ['web', 'news', 'research_paper'], keyless: ['web', 'news'] },
    },
  },
  openalex: {
    label: 'OpenAlex', endpoint: 'https://api.openalex.org/works', access: { keyless: true, apiKey: { credentialRef: 'OPENALEX_API_KEY' }, account: false },
    kind: 'adapter', remote: true, optIn: true, freshness: [], homepage: 'https://openalex.org',
    use: 'scholarly works (papers, citations); keyword queries',
    options: {
      sort: { kind: 'text', pattern: /^[a-z_]+:(?:asc|desc)(?:,[a-z_]+:(?:asc|desc))*$/u },
      filter: { kind: 'text', pattern: /^[\u0020-\u{10ffff}]+$/u, maxLength: 500 },
      is_oa: { kind: 'boolean' },
      // The core checks length first; @ and dot delimit disjoint, linear segments.
      mailto: { kind: 'text', maxLength: 254, pattern: /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u },
    },
  },
  semanticscholar: {
    label: 'Semantic Scholar', endpoint: 'https://api.semanticscholar.org/graph/v1/paper/search', access: { keyless: false, apiKey: { credentialRef: 'SEMANTIC_SCHOLAR_API_KEY' }, account: false },
    kind: 'adapter', remote: true, optIn: true, freshness: [], homepage: 'https://www.semanticscholar.org/product/api',
    use: 'academic papers (citations, TL;DR); keyword queries',
    options: {
      year: { kind: 'text', pattern: /^\d{4}(?:-\d{4})?$/u },
      fieldsOfStudy: { kind: 'text', pattern: /^[A-Za-z ,]+$/u, maxLength: 100 },
      publicationTypes: { kind: 'text', pattern: /^[A-Za-z,]+$/u, maxLength: 100 },
    },
  },
} as const satisfies Record<string, SearchDescriptor>

export type CatalogKey = keyof typeof CATALOG
export const NATIVE_KEYS = ['deepseek-messages', 'deepseek-search-api'] as const satisfies readonly CatalogKey[]
export const ADAPTER_KEYS = ['exa', 'firecrawl', 'tavily', 'tinyfish', 'openalex', 'semanticscholar'] as const satisfies readonly CatalogKey[]
export const MODEL_KEYS = ['session-model'] as const satisfies readonly CatalogKey[]
export type AdapterKey = typeof ADAPTER_KEYS[number]
export const isCatalogKey = (value: unknown): value is CatalogKey => typeof value === 'string' && Object.hasOwn(CATALOG, value)

export function honorsFreshness(key: CatalogKey, access: AccessMode): boolean {
  const modes: readonly AccessMode[] = CATALOG[key].freshness
  return modes.includes(access)
}

export const DEFAULT_CONNECTION = 'builtin:deepseek-messages'
