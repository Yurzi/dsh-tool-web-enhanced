import { FETCH, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import type { RemoteFetchResponse } from '../harness/remote-fetch-api.ts'

export const anysearchFixture = {
  searchId: 'custom:e2e-anysearch-search',
  fetchId: 'custom:e2e-anysearch-fetch',
  searchLabel: 'E2E regional search',
  fetchLabel: 'E2E document reader',
  credentialRef: 'E2E_ANYSEARCH_API_KEY',
  key: 'm7-9b4e61d8c2fa7035a6ef19d2',
  query: 'M7 loopback search query',
  source: { title: 'Loopback search source', url: 'https://example.test/m7/source', snippet: 'A summary from the AnySearch protocol fixture.' },
  url: 'https://example.test/m7/page?q=one%20two#section',
  invalidUrl: 'https://example.test/m7/invalid',
  content: 'AnySearch loopback page body; the target URL was never contacted.',
} as const

export function anysearchRows(baseUrl: string) {
  const connection = (label: string, path: string) => ({
    kind: 'adapter', adapter: 'anysearch', label,
    endpoint: new URL(path, baseUrl).href,
    credentialRef: anysearchFixture.credentialRef, trustedEndpoint: true,
  })
  return [
    { id: SEARCH.rowId, config: {
      version: 2, defaultConnection: anysearchFixture.searchId,
      connections: { [anysearchFixture.searchId]: {
        ...connection(anysearchFixture.searchLabel, 'v1/search'), options: { zone: 'intl', language: 'en' },
      } },
    } },
    { id: FETCH.rowId, config: {
      version: 2, defaultConnection: anysearchFixture.fetchId,
      connections: { [anysearchFixture.fetchId]: connection(anysearchFixture.fetchLabel, 'v1/extract') },
    } },
  ]
}

export function anysearchResponse(payload: unknown, status = 200): RemoteFetchResponse {
  return { status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
}

export function anysearchSearchResponse(): RemoteFetchResponse {
  return anysearchResponse({ code: 0, message: 'success', data: { results: [anysearchFixture.source] } })
}

export function anysearchExtractResponse(url: string = anysearchFixture.url): RemoteFetchResponse {
  return anysearchResponse({ code: 0, data: { url, title: 'Not prepended to the body', content: anysearchFixture.content } })
}

export function anysearchInvalidResponse(): RemoteFetchResponse {
  return anysearchResponse({ code: -1, message: 'URL is invalid.', error_code: 'invalid_extract_url' }, 400)
}
