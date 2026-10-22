import { WebError, type WebSearchRequest, type WebSearchResult } from '@deepseek-ai/dsh-web'
import { UNSUPPORTED_REASON_TEXT, redactDiagnostic, secretMatcher, storedApiKey, type SecretMatcher } from 'dsh-tool-web-enhanced-core/host'
import { credentialMissing, credentialInvalid, abortable, searchError, throwIfAborted, type OnDiagnostic } from '../search/errors.ts'
import { requestJson, withDeadline } from '../search/http.ts'
import { SourceList } from '../search/sources.ts'
import { modelRequest, modelUrl, parseModelResponse } from './protocols.ts'
import type { ModelOptions, ModelRoute, SessionRoute } from './types.ts'

export interface ModelSearchDeps {
  apiKey(ref: string, source: 'credentials' | 'route'): Promise<string | undefined>
  accountToken(url: string): Promise<string | undefined>
  readonly onDiagnostic?: OnDiagnostic
}

export interface ModelSearchTarget {
  readonly kind: 'model'
  readonly label: string
  readonly route: SessionRoute
  readonly options: ModelOptions
}

export async function executeModelSearch(target: ModelSearchTarget, request: WebSearchRequest, deps: ModelSearchDeps, signal?: AbortSignal): Promise<WebSearchResult> {
  throwIfAborted(signal)
  if (target.route.kind === 'unsupported') {
    throw searchError('WEB_PROVIDER_CONFIGURED_UNAVAILABLE', 'the session model cannot run web search: ' + UNSUPPORTED_REASON_TEXT[target.route.reason] + '; choose another search connection')
  }
  const route = target.route.route
  let matcher: SecretMatcher | undefined
  try {
    return await withDeadline(signal, async deadline => {
      throwIfAborted(deadline)
      const authSecret = await credential(route, deps, deadline)
      matcher = secretMatcher([authSecret])
      const wire = modelRequest(route, target.options, request.query, authSecret)
      const payload = await requestJson(wire, deadline, { label: target.label, access: route.auth.kind, matcher, onDiagnostic: deps.onDiagnostic })
      const outcome = parseModelResponse(route.protocol, payload)
      if (outcome.kind === 'failure') {
        throw searchError('WEB_PROVIDER_ERROR', target.label + ' returned an incompatible model search response; choose another search connection or report the incompatible response')
      }
      const list = new SourceList()
      for (const row of outcome.rows) list.add(row)
      return { sources: list.sources, ...(outcome.content === undefined ? {} : { content: outcome.content }), truncated: false }
    })
  } catch (error) {
    if (!(error instanceof WebError) && deps.onDiagnostic !== undefined) {
      const diagnostic = matcher === undefined ? new Error('Model credential resolution failed') : error
      deps.onDiagnostic(redactDiagnostic(diagnostic, matcher ?? secretMatcher([])))
    }
    throwIfAborted(signal)
    if (error instanceof WebError) throw error
    throw searchError('WEB_PROVIDER_ERROR', 'search failed; check the connection settings or choose another connection')
  }
}

async function credential(route: ModelRoute, deps: ModelSearchDeps, signal: AbortSignal): Promise<string> {
  const { auth } = route
  if (auth.kind === 'account') {
    const endpoint = modelUrl(route.protocol, route.baseURL)
    const token = await readCredential(() => deps.accountToken(endpoint), signal)
    // Account tokens are opaque service output, not operator input: never trim.
    if (token === undefined || !/^[\x20-\x7e]+$/u.test(token)) {
      throw searchError('WEB_PROVIDER_CREDENTIAL_MISSING', 'the DeepSeek account sign-in is unavailable for this search; ask the user to sign in again or choose another search connection')
    }
    return token
  }
  const stored = storedApiKey(await readCredential(() => deps.apiKey(auth.credentialRef, auth.source), signal))
  if (stored.kind === 'missing') {
    throw searchError('WEB_PROVIDER_CREDENTIAL_MISSING', credentialMissing(auth.credentialRef, auth.source))
  }
  if (stored.kind === 'malformed') {
    throw searchError('WEB_PROVIDER_CREDENTIAL_MISSING', credentialInvalid(auth.credentialRef, auth.source))
  }
  return stored.key
}

async function readCredential(resolve: () => Promise<string | undefined>, signal: AbortSignal): Promise<string | undefined> {
  try {
    return await abortable(resolve(), signal)
  } catch {
    throwIfAborted(signal)
    // An exception from the resolver is untrusted, even when it is a WebError.
    throw new Error('Model credential resolution failed')
  }
}
