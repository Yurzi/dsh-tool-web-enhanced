import { describe, expect, it } from 'vitest'
import { isEndpoint, validateOptions } from 'dsh-tool-web-enhanced-core/shared'
import { ADAPTER_KEYS, CATALOG, DEFAULT_CONNECTION, FRESHNESS, NATIVE_KEYS, honorsFreshness, isCatalogKey } from '../src/catalog.ts'

describe('search catalog', () => {
  it('places native backends first and retains the adapter display order', () => {
    expect(Object.keys(CATALOG)).toEqual(['deepseek-messages', 'deepseek-search-api', 'session-model', 'exa', 'firecrawl', 'tavily', 'tinyfish', 'openalex', 'semanticscholar'])
    expect(NATIVE_KEYS).toEqual(['deepseek-messages', 'deepseek-search-api'])
    expect(ADAPTER_KEYS).toEqual(['exa', 'firecrawl', 'tavily', 'tinyfish', 'openalex', 'semanticscholar'])
    expect(DEFAULT_CONNECTION).toBe('builtin:deepseek-messages')
    expect(FRESHNESS).toEqual(['auto', 'fresh', 'realtime'])
  })

  it.each(NATIVE_KEYS)('describes %s as native with both DeepSeek credential routes', key => {
    expect(CATALOG[key]).toMatchObject({ kind: 'native', remote: true, freshness: [], access: { keyless: false, apiKey: { credentialRef: 'DEEPSEEK_API_KEY' }, account: true } })
    expect(isEndpoint(CATALOG[key].endpoint)).toBe(true)
  })

  it.each(ADAPTER_KEYS)('describes %s as a remote adapter without account access', key => {
    expect(CATALOG[key]).toMatchObject({ kind: 'adapter', remote: true, access: { account: false } })
    expect(isEndpoint(CATALOG[key].endpoint)).toBe(true)
  })

  it('describes Session model without an endpoint or operator-selected authentication', () => {
    expect(isCatalogKey('session-model')).toBe(true)
    expect(CATALOG['session-model']).toMatchObject({ kind: 'model', remote: true, access: { keyless: false, apiKey: false, account: false }, freshness: [] })
    expect(CATALOG['session-model']).not.toHaveProperty('endpoint')
  })

  it('does not recognize retired or inherited object keys', () => {
    for (const value of ['deepseek', 'toString', '__proto__', null, 1]) expect(isCatalogKey(value)).toBe(false)
    for (const value of Object.keys(CATALOG)) expect(isCatalogKey(value)).toBe(true)
  })

  it('honors freshness only on the supported access routes', () => {
    expect(honorsFreshness('exa', 'api-key')).toBe(true)
    expect(honorsFreshness('exa', 'keyless')).toBe(false)
    expect(honorsFreshness('firecrawl', 'api-key')).toBe(true)
    expect(honorsFreshness('firecrawl', 'keyless')).toBe(true)
    for (const key of ['deepseek-messages', 'deepseek-search-api', 'session-model', 'tavily', 'tinyfish', 'openalex', 'semanticscholar'] as const) {
      expect(honorsFreshness(key, 'api-key')).toBe(false)
      expect(honorsFreshness(key, 'keyless')).toBe(false)
    }
  })

  it('keeps native option names and numeric ranges aligned with the native rows', () => {
    const messages = CATALOG['deepseek-messages']
    const search = CATALOG['deepseek-search-api']
    expect(Object.keys(messages.options)).toEqual(['baseURL', 'model', 'apiVersion', 'maxTokens', 'maxUses'])
    expect(Object.keys(search.options)).toEqual(['baseURL', 'count', 'sendOriginalQuestion'])
    expect(validateOptions(messages.label, messages.options, { maxTokens: 1, maxUses: 1000000 }, 'api-key')).toEqual([])
    expect(validateOptions(messages.label, messages.options, { maxTokens: 0, maxUses: 1.5 }, 'api-key')).toHaveLength(2)
    for (const count of [1, 50]) expect(validateOptions(search.label, search.options, { count }, 'api-key')).toEqual([])
    for (const count of [0, 51, 1.5, '10']) expect(validateOptions(search.label, search.options, { count }, 'api-key')).toHaveLength(1)
  })

  it('bounds mailto and requires nonempty dot-separated domain segments', () => {
    const options = CATALOG.openalex.options
    for (const mailto of ['a@b.org', 'first.last@sub.example.org', 'a'.repeat(242) + '@example.org']) {
      expect(validateOptions('OpenAlex', options, { mailto }, 'keyless')).toEqual([])
    }
  })

  it.each(['a@b..org', 'a@.org', 'a@b.', 'a@@b.org', 'a@b.org ', 'a'.repeat(243) + '@example.org', 'a@' + '.'.repeat(250) + '!'])('rejects malformed or oversized mailto %s', mailto => {
    expect(validateOptions('OpenAlex', CATALOG.openalex.options, { mailto }, 'keyless')).toHaveLength(1)
  })

  it.each(NATIVE_KEYS)('validates %s baseURL directly through its catalog URL rule', key => {
    const info = CATALOG[key]
    expect(info.options.baseURL).toEqual({ kind: 'url' })
    for (const baseURL of ['http://localhost:8000/v1', 'https://gateway.test/v1']) {
      expect(validateOptions(info.label, info.options, { baseURL }, 'api-key')).toEqual([])
    }
    for (const baseURL of ['relative', 'https://user:pass@gateway.test', 'https://gateway.test?key=x', 'https://gateway.test#fragment']) {
      expect(validateOptions(info.label, info.options, { baseURL }, 'api-key')).toHaveLength(1)
    }
  })

  it('retains adapter-specific option validation and anonymous restrictions', () => {
    expect(validateOptions('Tinyfish', CATALOG.tinyfish.options, { purpose: 'Explicit purpose', location: 'US', domain_type: 'news' }, 'keyless')).toEqual([])
    expect(validateOptions('OpenAlex', CATALOG.openalex.options, { sort: 'publication_year:desc,cited_by_count:desc', is_oa: true, mailto: 'a@b.org' }, 'keyless')).toEqual([])
    expect(validateOptions('Firecrawl', CATALOG.firecrawl.options, { limit: 3, safe: 'yes' }, 'api-key')).toEqual(['Firecrawl has no option "limit"', 'Firecrawl option "safe" has an invalid value'])
    expect(validateOptions('Exa', CATALOG.exa.options, { type: 'fast' }, 'keyless')).toHaveLength(1)
    expect(validateOptions('Tinyfish', CATALOG.tinyfish.options, { domain_type: 'research_paper' }, 'keyless')).toHaveLength(1)
    expect(validateOptions('Tinyfish', CATALOG.tinyfish.options, { domain_type: 'research_paper' }, 'api-key')).toEqual([])
  })
})
