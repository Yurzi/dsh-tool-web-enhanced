/** URL shape checks both faces apply to endpoints and to search sources. */

/** Absolute http(s) URL without credentials, query or fragment: what an API endpoint may look like. */
export function isEndpoint(value: string): boolean {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.password === '' && url.search === '' && url.hash === ''
}

/** Longest URL a search source may carry. */
export const MAX_SOURCE_URL_LENGTH = 8192

/**
 * A public http(s) URL without user information, as a search source may cite.
 * @returns the raw string and its normalized href, or undefined when the value is not acceptable.
 */
export function sourceUrl(value: unknown): { readonly raw: string; readonly href: string } | undefined {
  if (typeof value !== 'string') return undefined
  const raw = value.trim()
  if (raw === '' || raw.length > MAX_SOURCE_URL_LENGTH || !URL.canParse(raw)) return undefined
  const url = new URL(raw)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') return undefined
  return { raw, href: url.href }
}
