import { WebError } from '@deepseek-ai/dsh-web'
import { redactDiagnostic, redactJson, secretMatcher, type SecretMatcher } from './redaction.ts'
import type { CapabilityErrors, OnDiagnostic } from './errors.ts'
import type { McpClient, McpToolCall, McpToolResult } from './mcp.ts'
import type { HttpRequest, Transport } from './transport.ts'

export type Auth =
  | { readonly kind: 'keyless' }
  | { readonly kind: 'api-key'; readonly key: string }

export interface McpRoute<I, O> extends Omit<McpToolCall, 'arguments'> {
  arguments(input: I): Record<string, unknown>
  parse(result: McpToolResult, input: I): O
}

export interface AdapterWire<I, O> {
  request(input: I, endpoint: string, auth: Auth): HttpRequest
  parse(payload: unknown, input: I): O
  readonly keyless?: 'rest' | McpRoute<I, O>
}

/** A keyless catalog entry cannot compile without its anonymous route. */
export type KeylessBound<Facts extends { readonly keyless: boolean }, W extends AdapterWire<never, unknown>> = Facts['keyless'] extends true
  ? W & Required<Pick<W, 'keyless'>>
  : W

/** A wire whose anonymous route is statically required. */
export type KeylessWire<W extends AdapterWire<never, unknown>> = KeylessBound<{ readonly keyless: true }, W>

/**
 * The same wire with every parse result, REST or MCP, passed through `map`.
 * Requests and routes are untouched, and an anonymous route stays present
 * exactly when the source wire has one.
 */
export function mapWire<I, A, B>(wire: KeylessWire<AdapterWire<I, A>>, map: (outcome: A) => B): KeylessWire<AdapterWire<I, B>>
export function mapWire<I, A, B>(wire: AdapterWire<I, A>, map: (outcome: A) => B): AdapterWire<I, B>
export function mapWire<I, A, B>(wire: AdapterWire<I, A>, map: (outcome: A) => B): AdapterWire<I, B> {
  const mapped: AdapterWire<I, B> = {
    request: (input, endpoint, auth) => wire.request(input, endpoint, auth),
    parse: (payload, input) => map(wire.parse(payload, input)),
  }
  const route = wire.keyless
  if (route === undefined) return mapped
  if (route === 'rest') return { ...mapped, keyless: 'rest' }
  return { ...mapped, keyless: { ...route, parse: (result, input) => map(route.parse(result, input)) } }
}

export type AdapterTarget =
  | { readonly access: 'keyless'; readonly label: string; readonly endpoint: string }
  | { readonly access: 'api-key'; readonly label: string; readonly endpoint: string; readonly credentialRef: string }

/** Anonymous requests always use the catalog endpoint and carry no credential reference. */
export function adapterTarget(connection: AdapterTarget, catalogEndpoint: string): AdapterTarget {
  return connection.access === 'keyless'
    ? { access: 'keyless', label: connection.label, endpoint: catalogEndpoint }
    : { access: 'api-key', label: connection.label, endpoint: connection.endpoint, credentialRef: connection.credentialRef }
}

export interface AdapterIO {
  readonly errors: CapabilityErrors
  readonly transport: Transport
  readonly mcp: McpClient
  credential(ref: string): Promise<string | undefined>
  readonly onDiagnostic?: OnDiagnostic | undefined
  readonly credentialMissing: (ref: string) => string
  readonly credentialInvalid: (ref: string) => string
}

export type StoredApiKey =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'malformed' }

/**
 * A stored key, trimmed, before any request: empty is missing, and anything
 * but printable ASCII and spaces is malformed (fetch would throw while
 * building the header, with the whole value in the error).
 */
export function storedApiKey(stored: string | undefined): StoredApiKey {
  const key = stored === undefined ? '' : stored.trim()
  if (key === '') return { kind: 'missing' }
  return /^[\x20-\x7e]+$/u.test(key) ? { kind: 'key', key } : { kind: 'malformed' }
}

/** One deadline covers credentials, the anonymous route and bounded response reads. */
export function runAdapter<I, O>(io: AdapterIO, wire: AdapterWire<I, O>, target: AdapterTarget, input: I, signal: AbortSignal | undefined): Promise<O> {
  return io.transport.withDeadline(signal, async deadline => {
    let matcher: SecretMatcher | undefined
    try {
      if (target.access === 'keyless') {
        matcher = secretMatcher([])
        const upstream = { label: target.label, access: target.access, onDiagnostic: io.onDiagnostic, matcher }
        // Catalog validation binds every selectable keyless target to an anonymous route.
        const route = wire.keyless!
        if (route !== 'rest') {
          const result = await io.mcp.callTool({ ...route, arguments: route.arguments(input) }, deadline, upstream)
          return route.parse(result, input)
        }
        const request = wire.request(input, target.endpoint, { kind: 'keyless' })
        return wire.parse(await io.transport.requestJson(request, deadline, upstream), input)
      }
      const stored = storedApiKey(await adapterCredential(io, target.credentialRef, deadline))
      if (stored.kind === 'missing') throw io.errors.error('WEB_PROVIDER_CREDENTIAL_MISSING', io.credentialMissing(target.credentialRef))
      if (stored.kind === 'malformed') throw io.errors.error('WEB_PROVIDER_CREDENTIAL_MISSING', io.credentialInvalid(target.credentialRef))
      matcher = secretMatcher([stored.key])
      const upstream = { label: target.label, access: target.access, onDiagnostic: io.onDiagnostic, matcher }
      const request = wire.request(input, target.endpoint, { kind: 'api-key', key: stored.key })
      const result = wire.parse(await io.transport.requestJson(request, deadline, upstream), input)
      // Parsers can turn JSON property names into text (OpenAlex inverted abstracts).
      return redactJson(result, matcher)
    } catch (error) {
      if (error instanceof WebError) throw error
      // Unknown failures reach outer diagnostic callbacks only as safe copies.
      throw redactDiagnostic(error, matcher === undefined ? secretMatcher([]) : matcher)
    }
  })
}

async function adapterCredential(io: AdapterIO, ref: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    return await io.errors.abortable(io.credential(ref), signal)
  } catch (error) {
    if (error instanceof WebError) throw error
    // A resolver can fail before returning any value we could safely recognize.
    // oxlint-disable-next-line preserve-caught-error -- The original cause can contain unknown credentials.
    throw new Error('Adapter credential resolution failed')
  }
}

export function postJson(url: string, headers: Readonly<Record<string, string>>, body: Readonly<Record<string, unknown>>): HttpRequest {
  return { url, method: 'POST', headers: { 'accept': 'application/json', 'content-type': 'application/json', ...headers }, body }
}

export function getJson(url: string, query: Readonly<Record<string, string>>, headers: Readonly<Record<string, string>> = {}): HttpRequest {
  const target = new URL(url)
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value)
  return { url: target.href, method: 'GET', headers: { accept: 'application/json', ...headers } }
}

export function bearer(auth: Auth): Record<string, string> {
  switch (auth.kind) {
    case 'keyless': return {}
    case 'api-key': return { authorization: 'Bearer ' + auth.key }
  }
}

export function apiKeyHeader(auth: Auth): Record<string, string> {
  return auth.kind === 'api-key' ? { 'x-api-key': auth.key } : {}
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
