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

/** One deadline covers credentials, the anonymous route and bounded response reads. */
export function runAdapter<I, O>(io: AdapterIO, wire: AdapterWire<I, O>, target: AdapterTarget, input: I, signal: AbortSignal | undefined): Promise<O> {
  return io.transport.withDeadline(signal, async deadline => {
    const upstream = { label: target.label, access: target.access, onDiagnostic: io.onDiagnostic }
    if (target.access === 'keyless') {
      // Catalog validation binds every selectable keyless target to an anonymous route.
      const route = wire.keyless!
      if (route !== 'rest') {
        const result = await io.mcp.callTool({ ...route, arguments: route.arguments(input) }, deadline, upstream)
        return route.parse(result, input)
      }
      const request = wire.request(input, target.endpoint, { kind: 'keyless' })
      return wire.parse(await io.transport.requestJson(request, deadline, upstream), input)
    }
    const resolved = await io.errors.abortable(io.credential(target.credentialRef), deadline)
    const key = resolved === undefined ? '' : resolved.trim()
    if (key === '') throw io.errors.error('WEB_PROVIDER_CREDENTIAL_MISSING', io.credentialMissing(target.credentialRef))
    if (!/^[\x20-\x7e]+$/u.test(key)) {
      throw io.errors.error('WEB_PROVIDER_CREDENTIAL_MISSING', io.credentialInvalid(target.credentialRef))
    }
    const request = wire.request(input, target.endpoint, { kind: 'api-key', key })
    return wire.parse(await io.transport.requestJson(request, deadline, upstream), input)
  })
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
