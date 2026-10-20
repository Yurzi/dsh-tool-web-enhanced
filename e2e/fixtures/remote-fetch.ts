import type { RemoteFetchResponse } from '../harness/remote-fetch-api.ts'

export const remoteFetchFixture = {
  connectionId: 'custom:e2e-firecrawl',
  label: 'E2E loopback fetch',
  credentialRef: 'E2E_FETCH_API_KEY',
  key: 'wfe-e2e-loopback-only-key',
  requestedUrl: 'http://127.0.0.1:9/a%2Fb?q=x%20y&n=1#fragment',
  content: 'Remote fetch fixture body; the target URL was never contacted.',
} as const

export function customFetchDocument(endpoint: string) {
  return {
    version: 2,
    defaultConnection: remoteFetchFixture.connectionId,
    connections: {
      [remoteFetchFixture.connectionId]: {
        kind: 'adapter',
        adapter: 'firecrawl',
        label: remoteFetchFixture.label,
        endpoint,
        credentialRef: remoteFetchFixture.credentialRef,
        trustedEndpoint: true,
      },
    },
  } as const
}

export function firecrawlResponse(url: string = remoteFetchFixture.requestedUrl): RemoteFetchResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      success: true,
      data: {
        markdown: remoteFetchFixture.content,
        metadata: { statusCode: 200, url },
      },
    }),
  }
}
