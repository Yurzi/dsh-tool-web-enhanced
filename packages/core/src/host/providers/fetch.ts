/**
 * The fetch side of the provider wires: what every fetch wire receives and the
 * page outcome it parses into. Mapping a page to a WebFetchResult, and a
 * failure to a model-facing WebError, stays in the fetch plugin.
 */
import { sourceUrl } from '../../shared/url.ts'
import type { AdapterWire } from '../adapter.ts'

/** Body characters returned to tool-web, and the budget requested from services that take one; equals the native `maxBodyChars` default. */
export const MAX_BODY_CHARS = 100_000

export interface FetchInput {
  /** The URL exactly as requested; remote services own target access policy. */
  readonly url: string
  /** Options already validated against the catalog rules for this access. */
  readonly options: Readonly<Record<string, unknown>>
}

/** The target's response as the service reports it. */
export interface ReportedTarget {
  readonly statusCode: number
  readonly url: string
}

/** What a remote service retrieved, before the plugin's own bounds. */
export interface Page {
  readonly content: string
  /** Present only when the service reports the target's status code. */
  readonly target: ReportedTarget | undefined
  /** The service reports, or its budget implies, that it cut the content. */
  readonly truncated: boolean
}

/** Why a service could not read a page; the plugin words each one with the connection label. */
export type PageFailure = 'timeout' | 'too-large' | 'invalid-url' | 'empty' | 'rate-limited' | 'failed' | 'invalid'

export type PageOutcome =
  | { readonly kind: 'page'; readonly page: Page }
  | { readonly kind: 'failure'; readonly failure: PageFailure; readonly detail: string | undefined }

export type FetchWire = AdapterWire<FetchInput, PageOutcome>

/**
 * The reported target when the service gives a plausible HTTP status; a
 * missing or unusable final URL falls back to the requested one.
 */
export function reportedTarget(statusCode: unknown, url: unknown, requested: string): ReportedTarget | undefined {
  if (typeof statusCode !== 'number' || !Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) return undefined
  return { statusCode, url: sourceUrl(url)?.raw ?? requested }
}

/**
 * A URL the service could not read but whose HTTP status it reports (a target
 * 404 or 403): that is a fetch result, not an error, as in DSH's own fetch.
 */
export function statusPage(target: ReportedTarget): Page {
  return { content: '', target, truncated: false }
}
