import { startRemoteFetchApi } from './remote-fetch-api.ts'

/** Reuse the loopback-only wire recorder; no upstream model or search URL is ever fetched. */
export const startModelApi = (payload: unknown) => startRemoteFetchApi(modelResponse(payload))

export function modelResponse(payload: unknown) {
  return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
}
