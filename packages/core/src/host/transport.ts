import { WebError } from '@deepseek-ai/dsh-web'
import type { Access } from '../shared/index.ts'
import type { CapabilityErrors, OnDiagnostic } from './errors.ts'
import { isRecord } from './adapter.ts'
import { containsSecret, redactDiagnostic, redactJson, secretMatcher, type SecretMatcher } from './redaction.ts'

export interface HttpRequest {
  readonly url: string
  readonly method: 'GET' | 'POST'
  readonly headers: Readonly<Record<string, string>>
  readonly body?: unknown
}

export interface Upstream {
  readonly label: string
  readonly access: Access
  readonly matcher?: SecretMatcher
  readonly onDiagnostic?: OnDiagnostic | undefined
}

export interface TransportMessages {
  readonly timedOut: string
  readonly unreachable: (label: string) => string
  readonly invalidResponse: (detail: string) => string
  readonly tooLarge: string
  readonly brokenResponse: string
}

export interface TransportOptions {
  readonly timeoutMs: number
  readonly maxResponseBytes: number
  readonly messages: TransportMessages
}

/** Bounded transport; one deadline spans authentication, handshake and body reads. */
export function createTransport(errors: CapabilityErrors, { timeoutMs, maxResponseBytes, messages }: TransportOptions) {
  const { error: capabilityError, aborted, abortable, throwIfAborted } = errors

  async function withDeadline<T>(signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    throwIfAborted(signal)
    const deadline = new AbortController()
    const timer = setTimeout(() => { deadline.abort() }, timeoutMs)
    const fused = signal === undefined ? deadline.signal : AbortSignal.any([signal, deadline.signal])
    try {
      return await abortable(operation(fused), fused)
    } catch (error) {
      if (signal !== undefined && signal.aborted) throw aborted()
      if (deadline.signal.aborted) throw capabilityError('WEB_PROVIDER_ERROR', messages.timedOut)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async function send(request: HttpRequest, signal: AbortSignal, upstream: Upstream): Promise<Response> {
    throwIfAborted(signal)
    const matcher = upstream.matcher === undefined ? secretMatcher([]) : upstream.matcher
    let response: Response
    try {
      response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        redirect: 'error',
        signal,
      })
    } catch (error) {
      emitDiagnostic(error, upstream.onDiagnostic, matcher)
      throwIfAborted(signal)
      throw capabilityError('WEB_PROVIDER_ERROR', messages.unreachable(upstream.label))
    }
    if (!response.ok) {
      const failure = statusError(response.status, upstream)
      const body = await readFailureText(response, signal, upstream, matcher)
      const detail = failureExplanation(body.text, matcher, body.truncated)
      if (detail === undefined) throw failure
      throw new WebError(failure.message + upstreamSuffix(upstream.label, detail), failure.code)
    }
    return response
  }

  function statusError(status: number, { label, access }: Upstream): WebError {
    if (status === 401 || status === 403) {
      if (access === 'keyless') return capabilityError('WEB_PROVIDER_ERROR', label + ' refused anonymous access (HTTP ' + status + '); ask the user to add a personal API key in connection settings or choose another connection')
      if (access === 'account') return capabilityError('WEB_PROVIDER_ERROR', label + ' rejected the account sign-in (HTTP ' + status + '); ask the user to sign in to DeepSeek again')
      return capabilityError('WEB_PROVIDER_ERROR', label + ' rejected the API key (HTTP ' + status + '); ask the user to check the key in connection settings')
    }
    if (status === 402) return capabilityError('WEB_PROVIDER_ERROR', label + ' refused the request (HTTP 402); check account credit and API access')
    if (status === 429) return capabilityError('WEB_PROVIDER_ERROR', label + ' is rate limiting requests (HTTP 429); retry later or choose another connection')
    return capabilityError('WEB_PROVIDER_ERROR', label + ' failed (HTTP ' + status + '); retry later or choose another connection')
  }

  async function discard(response: Response, signal: AbortSignal, onDiagnostic?: OnDiagnostic, matcher = secretMatcher([])): Promise<void> {
    if (response.body === null) return
    try {
      await response.body.cancel()
    } catch (error) {
      emitDiagnostic(error, onDiagnostic, matcher)
      throwIfAborted(signal)
      throw brokenResponse()
    }
  }

  async function readFailureText(response: Response, signal: AbortSignal, upstream: Upstream, matcher: SecretMatcher): Promise<{ readonly text: string; readonly truncated: boolean }> {
    if (response.body === null) return { text: '', truncated: false }
    const onDiagnostic = upstream.onDiagnostic
    const declared = response.headers.get('content-length')
    const encoding = response.headers.get('content-encoding')
    const knownEnd = declared !== null && (encoding === null || encoding.toLowerCase() === 'identity') && Number(declared) <= 16_384
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let remaining = 16_384
    let body = ''
    let ended = false
    try {
      while (remaining > 0) {
        const { done, value } = await abortable(reader.read(), signal)
        throwIfAborted(signal)
        if (done) { ended = true; break }
        const prefix = value.subarray(0, remaining)
        body += decoder.decode(prefix, { stream: true })
        remaining -= prefix.byteLength
      }
      return { text: body + decoder.decode(), truncated: !ended && !knownEnd }
    } catch (error) {
      if (error instanceof WebError) throw error
      emitDiagnostic(error, onDiagnostic, matcher)
      throwIfAborted(signal)
      ended = true
      throw brokenResponse()
    } finally {
      await releaseReader(reader, ended, signal, onDiagnostic, matcher)
    }
  }

  async function* readText(response: Response, signal: AbortSignal, onDiagnostic?: OnDiagnostic, matcher = secretMatcher([])): AsyncGenerator<string, void, undefined> {
    throwIfAborted(signal)
    if (Number(response.headers.get('content-length')) > maxResponseBytes) {
      await discard(response, signal, onDiagnostic, matcher)
      throw tooLarge()
    }
    if (response.body === null) return
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let size = 0
    let ended = false
    try {
      for (;;) {
        const { done, value } = await abortable(reader.read(), signal)
        throwIfAborted(signal)
        if (done) { ended = true; break }
        size += value.byteLength
        if (size > maxResponseBytes) throw tooLarge()
        yield decoder.decode(value, { stream: true })
      }
      const tail = decoder.decode()
      if (tail !== '') yield tail
    } catch (error) {
      if (error instanceof WebError) throw error
      emitDiagnostic(error, onDiagnostic, matcher)
      throwIfAborted(signal)
      ended = true // The errored stream is already closed; cancelling would rethrow its private error.
      throw brokenResponse()
    } finally {
      await releaseReader(reader, ended, signal, onDiagnostic, matcher)
    }
  }

  async function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>, ended: boolean, signal: AbortSignal, onDiagnostic?: OnDiagnostic, matcher = secretMatcher([])): Promise<void> {
    try {
      if (!ended) await reader.cancel()
    } catch (error) {
      emitDiagnostic(error, onDiagnostic, matcher)
      throwIfAborted(signal)
      throw brokenResponse()
    } finally {
      reader.releaseLock()
    }
  }

  async function readJson(response: Response, signal: AbortSignal, onDiagnostic?: OnDiagnostic, matcher = secretMatcher([])): Promise<unknown> {
    let body = ''
    for await (const chunk of readText(response, signal, onDiagnostic, matcher)) body += chunk
    let payload: unknown
    try {
      payload = JSON.parse(body) as unknown
    } catch {
      // JSON.parse quotes an excerpt of the body; even a short one may hold part of a credential.
      if (onDiagnostic !== undefined) onDiagnostic(parseDiagnostic())
      throw invalidResponse('a body that is not JSON')
    }
    return payload
  }

  async function requestJson(request: HttpRequest, signal: AbortSignal, upstream: Upstream): Promise<unknown> {
    const matcher = upstream.matcher === undefined ? secretMatcher([]) : upstream.matcher
    const payload = await readJson(await send(request, signal, { ...upstream, matcher }), signal, upstream.onDiagnostic, matcher)
    return redactJson(payload, matcher)
  }

  function invalidResponse(detail: string): WebError {
    return capabilityError('WEB_PROVIDER_ERROR', messages.invalidResponse(detail))
  }

  const tooLarge = (): WebError => capabilityError('WEB_PROVIDER_ERROR', messages.tooLarge)
  const brokenResponse = (): WebError => capabilityError('WEB_PROVIDER_ERROR', messages.brokenResponse)

  return { withDeadline, send, discard, readText, readJson, requestJson, invalidResponse }
}

/** Normalize untrusted service text before including it in a model-facing failure. */
export function upstreamText(value: string): string | undefined {
  const text = value.trim()
  if (text === '') return undefined
  if (text.length <= 2000) return text
  const last = text.charCodeAt(1998)
  const boundary = last >= 0xd800 && last <= 0xdbff ? 1998 : 1999
  return text.slice(0, boundary) + '…'
}

export type UpstreamDetail = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'withheld' } | undefined

/** Sensitive raw explanations are withheld, not precisely edited. */
export function upstreamDetail(value: string, matcher: SecretMatcher, truncated = false): UpstreamDetail {
  if (containsSecret(value, matcher)) return { kind: 'withheld' }
  const text = upstreamText(truncated ? stripPrefix(value, matcher) : value)
  return text === undefined ? undefined : { kind: 'text', text }
}

export function upstreamSuffix(label: string, detail: UpstreamDetail): string {
  if (detail === undefined) return ''
  if (detail.kind === 'withheld') return '\n\n' + label + "'s response was withheld because it contained this request's credential."
  return '\n\n' + label + ' responded (untrusted): ' + detail.text
}

function stripPrefix(text: string, matcher: SecretMatcher): string {
  for (let length = Math.min(7, text.length); length > 0; length--) {
    if (matcher.prefixes.has(text.slice(-length))) return text.slice(0, -length)
  }
  return text
}

function failureExplanation(body: string, matcher: SecretMatcher, truncated: boolean): UpstreamDetail {
  // Detect before removing a tail so an intact eight-character match cannot be destroyed.
  if (containsSecret(body, matcher)) return { kind: 'withheld' }
  const text = truncated ? stripPrefix(body, matcher) : body
  let payload: unknown
  try {
    payload = JSON.parse(text) as unknown
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return upstreamDetail(text, matcher)
  }
  if (isRecord(payload)) {
    const nested = isRecord(payload.error) ? payload.error.message : undefined
    for (const candidate of [payload.error, nested, payload.message, payload.detail]) {
      if (typeof candidate !== 'string' || candidate.trim() === '') continue
      return upstreamDetail(candidate, matcher)
    }
  }
  return upstreamDetail(text, matcher)
}

function parseDiagnostic(): Error {
  const error = new Error('could not parse the JSON response; the body is not logged')
  error.name = 'SyntaxError'
  return error
}

function emitDiagnostic(error: unknown, onDiagnostic: OnDiagnostic | undefined, matcher: SecretMatcher): void {
  if (onDiagnostic !== undefined) onDiagnostic(redactDiagnostic(error, matcher))
}

export type Transport = ReturnType<typeof createTransport>
