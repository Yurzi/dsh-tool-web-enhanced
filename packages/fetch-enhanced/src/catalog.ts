import type { Descriptor } from 'dsh-tool-web-enhanced-core/shared'
import type { LocalSettings } from './settings/types.ts'

export type FetchDescriptor =
  | (Descriptor & { readonly kind: 'local' })
  | (Descriptor & { readonly kind: 'native'; readonly endpoint: string })
  | (Descriptor & { readonly kind: 'adapter'; readonly endpoint: string })

const MAX_INT32 = 2_147_483_647
export const MAX_TIMER_DELAY_MS = MAX_INT32
export const ALLOWLIST_MAX_ENTRIES = 200
export const USER_AGENT_PATTERN = /^[\x20-\x7e\x80-\xff]*$/u

/** Mirrored from the native row; its Host-only module must not enter the browser bundle. */
export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  allowCidrs: [], allowHostnames: [],
  userAgent: 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)',
  maxResponseBytes: 5_000_000, maxBodyChars: 100_000, timeoutMs: 30_000, maxRedirects: 5,
}

const allowlist = { kind: 'list', pattern: /^[\s\S]{0,2000}$/u, max: ALLOWLIST_MAX_ENTRIES } as const

/**
 * Display order and secret-free facts shared by Host and browser. Remote
 * adapters receive the URL as requested; the service owns target access.
 * Option bounds stay inside the remote deadline (src/remote/http.ts).
 */
export const CATALOG = {
  local: {
    label: 'Local HTTP', kind: 'local', remote: false, optIn: false,
    access: { keyless: true, apiKey: false, account: false },
    options: {
      allowCidrs: allowlist, allowHostnames: allowlist,
      userAgent: { kind: 'text', pattern: USER_AGENT_PATTERN },
      maxResponseBytes: { kind: 'integer', min: 1, max: Number.MAX_SAFE_INTEGER },
      maxBodyChars: { kind: 'integer', min: 1, max: Number.MAX_SAFE_INTEGER },
      timeoutMs: { kind: 'integer', min: 1, max: MAX_TIMER_DELAY_MS },
      maxRedirects: { kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER },
    },
  },
  'deepseek-fetch-api': {
    label: 'DeepSeek Fetch API', kind: 'native', remote: true, optIn: true,
    endpoint: 'https://api.deepseek.com/v1/tools', homepage: 'https://platform.deepseek.com',
    access: { keyless: false, apiKey: { credentialRef: 'DEEPSEEK_API_KEY' }, account: true },
    options: { baseURL: { kind: 'url' } },
  },
  exa: {
    label: 'Exa', kind: 'adapter', remote: true, optIn: true,
    endpoint: 'https://api.exa.ai/contents', homepage: 'https://exa.ai',
    // Keyless goes through Exa's hosted MCP tool, which takes only the URL and a character budget.
    access: { keyless: true, apiKey: { credentialRef: 'EXA_API_KEY' }, account: false },
    options: {
      maxAgeHours: { kind: 'integer', min: -1, max: 720, keyless: false },
      livecrawlTimeout: { kind: 'integer', min: 1, max: 90_000, keyless: false },
    },
  },
  firecrawl: {
    label: 'Firecrawl', kind: 'adapter', remote: true, optIn: true,
    endpoint: 'https://api.firecrawl.dev/v2/scrape', homepage: 'https://www.firecrawl.dev',
    access: { keyless: true, apiKey: { credentialRef: 'FIRECRAWL_API_KEY' }, account: false },
    options: {
      onlyMainContent: { kind: 'boolean' },
      maxAge: { kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER },
      storeInCache: { kind: 'boolean' },
      timeout: { kind: 'integer', min: 1000, max: 110_000 },
      waitFor: { kind: 'integer', min: 0, max: 60_000 },
      proxy: { kind: 'enum', values: ['basic', 'enhanced', 'auto'] },
    },
  },
  tavily: {
    label: 'Tavily', kind: 'adapter', remote: true, optIn: true,
    endpoint: 'https://api.tavily.com/extract', homepage: 'https://www.tavily.com',
    access: { keyless: true, apiKey: { credentialRef: 'TAVILY_API_KEY' }, account: false },
    options: {
      extract_depth: { kind: 'enum', values: ['basic', 'advanced'] },
      format: { kind: 'enum', values: ['markdown', 'text'] },
      timeout: { kind: 'integer', min: 1, max: 60 },
    },
  },
  tinyfish: {
    label: 'Tinyfish', kind: 'adapter', remote: true, optIn: true,
    endpoint: 'https://api.fetch.tinyfish.ai', homepage: 'https://www.tinyfish.ai',
    // No documented anonymous fetch route: personal key only.
    access: { keyless: false, apiKey: { credentialRef: 'TINYFISH_API_KEY' }, account: false },
    options: {
      // Seconds of cache tolerance; the service documents no upper bound.
      ttl: { kind: 'integer', min: 0, max: MAX_INT32 },
      per_url_timeout_ms: { kind: 'integer', min: 1, max: 110_000 },
    },
  },
} as const satisfies Record<string, FetchDescriptor>

export type CatalogKey = keyof typeof CATALOG
export const NATIVE_KEYS = ['deepseek-fetch-api'] as const satisfies readonly CatalogKey[]
export const ADAPTER_KEYS = ['exa', 'firecrawl', 'tavily', 'tinyfish'] as const satisfies readonly CatalogKey[]
export type NativeKey = typeof NATIVE_KEYS[number]
export type AdapterKey = typeof ADAPTER_KEYS[number]
export const isCatalogKey = (value: unknown): value is CatalogKey => typeof value === 'string' && Object.hasOwn(CATALOG, value)
export const DEFAULT_CONNECTION = 'builtin:local'
