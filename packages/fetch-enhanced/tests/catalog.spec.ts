import { DEFAULT_USER_AGENT } from '@deepseek-ai/dsh-web-fetch-http'
import { describe, expect, it } from 'vitest'
import { validateOptions } from 'dsh-tool-web-enhanced-core/shared'
import { CATALOG, DEFAULT_CONNECTION, DEFAULT_LOCAL_SETTINGS, isCatalogKey } from '../src/catalog.ts'
import { contract } from '../src/contract.ts'

describe('fetch catalog and contract', () => {
  it('lists local, native and four adapters in display order with explicit access facts', () => {
    expect(Object.keys(CATALOG)).toEqual(['local', 'deepseek-fetch-api', 'exa', 'firecrawl', 'tavily', 'tinyfish'])
    for (const [key, keyless, credentialRef] of [['exa', true, 'EXA_API_KEY'], ['firecrawl', true, 'FIRECRAWL_API_KEY'], ['tavily', true, 'TAVILY_API_KEY'], ['tinyfish', false, 'TINYFISH_API_KEY']] as const) {
      expect(CATALOG[key]).toMatchObject({ kind: 'adapter', remote: true, access: { keyless, apiKey: { credentialRef }, account: false } })
    }
    expect(DEFAULT_CONNECTION).toBe('builtin:local')
    expect(CATALOG.local).toMatchObject({ kind: 'local', remote: false, access: { keyless: true, apiKey: false, account: false } })
    expect(CATALOG['deepseek-fetch-api']).toMatchObject({ kind: 'native', remote: true, access: { keyless: false, apiKey: { credentialRef: 'DEEPSEEK_API_KEY' }, account: true } })
    expect(CATALOG['deepseek-fetch-api'].options.baseURL.kind).toBe('url')
    expect(isCatalogKey('constructor')).toBe(false)
    expect(isCatalogKey('local')).toBe(true)
    expect(isCatalogKey(null)).toBe(false)
  })
  it('mirrors native HTTP defaults without importing the Host in shared code', () => {
    expect(DEFAULT_LOCAL_SETTINGS).toEqual({ allowCidrs: [], allowHostnames: [], userAgent: DEFAULT_USER_AGENT, maxResponseBytes: 5_000_000, maxBodyChars: 100_000, timeoutMs: 30_000, maxRedirects: 5 })
    expect(validateOptions('Local', CATALOG.local.options, { userAgent: '' }, 'keyless')).toEqual([])
  })
  it('accepts no Session options and generates the fetch namespace', () => {
    expect(contract.options.parse({})).toEqual({})
    expect(contract.options.safeParse({ allowCidrs: [] }).success).toBe(false)
    expect(contract.selectionChange.safeParse({ sessionId: 's', connectionId: null, expectedRevision: 0, options: {} }).success).toBe(true)
    expect(contract.selectionChange.safeParse({ sessionId: 's', expectedRevision: 0, options: { freshness: 'auto' } }).success).toBe(false)
  })
})
