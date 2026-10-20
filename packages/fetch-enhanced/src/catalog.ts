import type { Descriptor } from 'dsh-tool-web-enhanced-core/shared'
import type { LocalSettings } from './settings/types.ts'

export type FetchDescriptor =
  | (Descriptor & { readonly kind: 'local' })
  | (Descriptor & { readonly kind: 'native'; readonly endpoint: string })

export const MAX_TIMER_DELAY_MS = 2_147_483_647
export const ALLOWLIST_MAX_ENTRIES = 200
export const USER_AGENT_PATTERN = /^[\x20-\x7e\x80-\xff]*$/u

/** Mirrored from the native row; its Host-only module must not enter the browser bundle. */
export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  allowCidrs: [], allowHostnames: [],
  userAgent: 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)',
  maxResponseBytes: 5_000_000, maxBodyChars: 100_000, timeoutMs: 30_000, maxRedirects: 5,
}

const allowlist = { kind: 'list', pattern: /^[\s\S]{0,2000}$/u, max: ALLOWLIST_MAX_ENTRIES } as const

/** Display order and secret-free facts shared by Host and browser. */
export const CATALOG = {
  local: {
    label: 'Local HTTP', kind: 'local', remote: false,
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
    label: 'DeepSeek Fetch API', kind: 'native', remote: true,
    endpoint: 'https://api.deepseek.com/v1/tools', homepage: 'https://platform.deepseek.com',
    access: { keyless: false, apiKey: { credentialRef: 'DEEPSEEK_API_KEY' }, account: true },
    options: { baseURL: { kind: 'url' } },
  },
} as const satisfies Record<string, FetchDescriptor>

export type CatalogKey = keyof typeof CATALOG
export const NATIVE_KEYS = ['deepseek-fetch-api'] as const satisfies readonly CatalogKey[]
export const isCatalogKey = (value: unknown): value is CatalogKey => typeof value === 'string' && Object.hasOwn(CATALOG, value)
export const DEFAULT_CONNECTION = 'builtin:local'
