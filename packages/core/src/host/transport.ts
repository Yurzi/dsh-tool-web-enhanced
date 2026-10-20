import { WebError } from '@deepseek-ai/dsh-web'
import type { Access } from '../shared/index.ts'
import type { CapabilityErrors, OnDiagnostic } from './errors.ts'

export interface HttpRequest {
  readonly url: string
  readonly method: 'GET' | 'POST'
  readonly headers: Readonly<Record<string, string>>
  readonly body?: unknown
}

export interface Upstream {
  readonly label: string
  readonly access: Access
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
      if (upstream.onDiagnostic !== undefined) upstream.onDiagnostic(error)
      throwIfAborted(signal)
      throw capabilityError('WEB_PROVIDER_ERROR', messages.unreachable(upstream.label))
    }
    if (!response.ok) {
      await discard(response, signal, upstream.onDiagnostic)
      throw statusError(response.status, upstream)
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

  async function discard(response: Response, signal: AbortSignal, onDiagnostic?: OnDiagnostic): Promise<void> {
    if (response.body === null) return
    try {
      await response.body.cancel()
    } catch (error) {
      if (onDiagnostic !== undefined) onDiagnostic(error)
      throwIfAborted(signal)
      throw brokenResponse()
    }
  }

  async function* readText(response: Response, signal: AbortSignal, onDiagnostic?: OnDiagnostic): AsyncGenerator<string, void, undefined> {
    throwIfAborted(signal)
    if (Number(response.headers.get('content-length')) > maxResponseBytes) {
      await discard(response, signal, onDiagnostic)
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
      if (onDiagnostic !== undefined) onDiagnostic(error)
      throwIfAborted(signal)
      ended = true // The errored stream is already closed; cancelling would rethrow its private error.
      throw brokenResponse()
    } finally {
      await releaseReader(reader, ended, signal, onDiagnostic)
    }
  }

  async function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>, ended: boolean, signal: AbortSignal, onDiagnostic?: OnDiagnostic): Promise<void> {
    try {
      if (!ended) await reader.cancel()
    } catch (error) {
      if (onDiagnostic !== undefined) onDiagnostic(error)
      throwIfAborted(signal)
      throw brokenResponse()
    } finally {
      reader.releaseLock()
    }
  }

  async function readJson(response: Response, signal: AbortSignal, onDiagnostic?: OnDiagnostic): Promise<unknown> {
    let body = ''
    for await (const chunk of readText(response, signal, onDiagnostic)) body += chunk
    try {
      return JSON.parse(body) as unknown
    } catch (error) {
      if (onDiagnostic !== undefined) onDiagnostic(error)
      throw invalidResponse('a body that is not JSON')
    }
  }

  async function requestJson(request: HttpRequest, signal: AbortSignal, upstream: Upstream): Promise<unknown> {
    return readJson(await send(request, signal, upstream), signal, upstream.onDiagnostic)
  }

  function invalidResponse(detail: string): WebError {
    return capabilityError('WEB_PROVIDER_ERROR', messages.invalidResponse(detail))
  }

  const tooLarge = (): WebError => capabilityError('WEB_PROVIDER_ERROR', messages.tooLarge)
  const brokenResponse = (): WebError => capabilityError('WEB_PROVIDER_ERROR', messages.brokenResponse)

  return { withDeadline, send, discard, readText, readJson, requestJson, invalidResponse }
}

export type Transport = ReturnType<typeof createTransport>
