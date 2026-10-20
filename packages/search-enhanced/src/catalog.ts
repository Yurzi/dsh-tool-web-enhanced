import type { AccessMode, Descriptor } from 'dsh-tool-web-enhanced-core/shared'

export const FRESHNESS = ['auto', 'fresh', 'realtime'] as const
/** Content-cache preference, not a publication-date filter. */
export type Freshness = typeof FRESHNESS[number]

export interface SearchDescriptor extends Descriptor {
  readonly endpoint: string
  readonly freshness: readonly AccessMode[]
}

const noControl = /^[\u0020-\u{10ffff}]+$/u
const nativeAccess = { keyless: false, apiKey: { credentialRef: 'DEEPSEEK_API_KEY' }, account: true } as const
const baseURL = { kind: 'url' } as const

/** Display order and secret-free facts shared by settings, Host and browser. */
export const CATALOG = {
  'deepseek-messages': {
    label: 'DeepSeek Messages', kind: 'native', remote: true,
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
    label: 'DeepSeek Search API', kind: 'native', remote: true,
    endpoint: 'https://api.deepseek.com/v1/tools', homepage: 'https://platform.deepseek.com',
    access: nativeAccess, freshness: [],
    options: {
      baseURL,
      count: { kind: 'integer', min: 1, max: 50 },
      sendOriginalQuestion: { kind: 'boolean' },
    },
  },
  exa: {
    label: 'Exa', endpoint: 'https://api.exa.ai/search', access: { keyless: true, apiKey: { credentialRef: 'EXA_API_KEY' }, account: false },
    kind: 'adapter', remote: true, freshness: ['api-key'], homepage: 'https://exa.ai',
    options: { type: { kind: 'enum', values: ['auto', 'fast', 'instant'], keyless: false } },
  },
  firecrawl: {
    label: 'Firecrawl', endpoint: 'https://api.firecrawl.dev/v2/search', access: { keyless: true, apiKey: { credentialRef: 'FIRECRAWL_API_KEY' }, account: false },
    kind: 'adapter', remote: true, freshness: ['keyless', 'api-key'], homepage: 'https://www.firecrawl.dev',
    options: { country: { kind: 'text', pattern: /^[A-Za-z]{2}$/u }, location: { kind: 'text', pattern: noControl, maxLength: 200 }, safe: { kind: 'boolean' } },
  },
  tavily: {
    label: 'Tavily', endpoint: 'https://api.tavily.com/search', access: { keyless: true, apiKey: { credentialRef: 'TAVILY_API_KEY' }, account: false },
    kind: 'adapter', remote: true, freshness: [], homepage: 'https://www.tavily.com',
    options: {
      search_depth: { kind: 'enum', values: ['basic', 'advanced', 'fast', 'ultra-fast'] },
      topic: { kind: 'enum', values: ['general', 'news', 'finance'] },
    },
  },
  tinyfish: {
    label: 'Tinyfish', endpoint: 'https://api.search.tinyfish.ai', access: { keyless: true, apiKey: { credentialRef: 'TINYFISH_API_KEY' }, account: false },
    kind: 'adapter', remote: true, freshness: [], homepage: 'https://www.tinyfish.ai',
    options: {
      location: { kind: 'text', pattern: /^[A-Za-z]{2}$/u },
      language: { kind: 'text', pattern: /^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/u },
      purpose: { kind: 'text', pattern: /^[\u0020-\u{10ffff}]+$/u },
      domain_type: { kind: 'enum', values: ['web', 'news', 'research_paper'], keyless: ['web', 'news'] },
    },
  },
  openalex: {
    label: 'OpenAlex', endpoint: 'https://api.openalex.org/works', access: { keyless: true, apiKey: { credentialRef: 'OPENALEX_API_KEY' }, account: false },
    kind: 'adapter', remote: true, freshness: [], homepage: 'https://openalex.org',
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
    kind: 'adapter', remote: true, freshness: [], homepage: 'https://www.semanticscholar.org/product/api',
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
export type AdapterKey = typeof ADAPTER_KEYS[number]
export const isCatalogKey = (value: unknown): value is CatalogKey => typeof value === 'string' && Object.hasOwn(CATALOG, value)

export function honorsFreshness(key: CatalogKey, access: AccessMode): boolean {
  const modes: readonly AccessMode[] = CATALOG[key].freshness
  return modes.includes(access)
}

export const DEFAULT_CONNECTION = 'builtin:deepseek-messages'
