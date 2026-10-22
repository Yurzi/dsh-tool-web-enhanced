import { WebError } from '@deepseek-ai/dsh-web'
import type { PluginIdentity } from '../../shared/index.ts'
import type { ReadyProviders, Rejection } from '../enhanced.ts'
import { capabilityErrors } from '../errors.ts'

/** The model-facing words in which the two capabilities' enhanced tools differ (docs/design.md, "增强工具的错误"). */
export interface EnhancedVoice {
  /** The package name prefixes rejections; `tools` names the action and list tools. */
  readonly identity: PluginIdentity
  /** The capability in prose: `web search` / `web fetch`. */
  readonly capability: string
  /** The native tool the Agent falls back to: `web_search` / `web_fetch`. */
  readonly nativeTool: string
  /** What a listed provider receives: `queries` / `URLs`. */
  readonly sends: string
}

/** Why an id the operator added after the conversation started is unknown here (the list is fixed per conversation). */
const LATER_PROVIDERS = '. Providers added or turned on after this conversation started are available only in new conversations.'

/** At most this many ready ids are named in one message; the list tool shows the rest. */
const READY_SHOWN = 20

/**
 * The tail of a message naming the ready providers the Agent can switch to:
 * `ready providers: <ids>` without `except`, at most twenty in list order, or
 * `no other provider is ready` in place of the whole clause. When readiness could
 * not be read, the list tool is named instead, so "none" is never claimed unread.
 */
export function readyClause(voice: EnhancedVoice, ready: ReadyProviders, except?: string): string {
  if (ready.kind === 'unread') return `${voice.identity.tools.list} shows the ready providers`
  const others = ready.ids.filter(id => id !== except)
  if (others.length === 0) return 'no other provider is ready'
  const hidden = others.length - READY_SHOWN
  const more = hidden > 0 ? ` and ${hidden} more (${voice.identity.tools.list})` : ''
  return `ready providers: ${others.slice(0, READY_SHOWN).join(', ')}${more}`
}

/** Word a refusal core reported before any backend ran; `unavailable` passes core's own error on unchanged. */
export function rejectionError(voice: EnhancedVoice, reason: Rejection): WebError {
  const { error } = capabilityErrors(voice.identity.packageName)
  switch (reason.kind) {
    case 'unknown':
      return error('WEB_PROVIDER_CONFIGURED_MISSING', `unknown provider "${reason.connectionId}"; ${readyClause(voice, reason.ready, reason.connectionId)}${LATER_PROVIDERS}`)
    case 'removed':
      return error('WEB_PROVIDER_CONFIGURED_MISSING', `provider "${reason.connectionId}" was removed by the user; ${readyClause(voice, reason.ready, reason.connectionId)}`)
    case 'off':
      return error('WEB_PROVIDER_UNAVAILABLE', `${voice.capability} is off for this session; only the user can turn it back on (composer menu). Do not retry.`)
    case 'withdrawn':
      return error('WEB_PROVIDER_UNAVAILABLE', `${voice.identity.tools.action} is unavailable now; use ${voice.nativeTool}.`)
    case 'unavailable':
      return reason.error
  }
}

/**
 * Point a backend failure at the list tool: the hint ends the first paragraph,
 * before any untrusted upstream explanation, after a full stop when that paragraph
 * has no sentence end; the code and the rest of the message stay as the execution
 * layer wrote them. Cancellation, and failures `unhinted` marks, pass on unchanged.
 */
export function providerFailure(voice: EnhancedVoice, cause: unknown, connectionId: string, unhinted: (error: WebError) => boolean): unknown {
  if (!(cause instanceof WebError) || cause.code === 'WEB_ABORTED' || unhinted(cause)) return cause
  const hint = ` Provider "${connectionId}" failed; ${voice.identity.tools.list} shows the others.`
  const end = cause.message.indexOf('\n\n')
  const first = end === -1 ? cause.message : cause.message.slice(0, end)
  const rest = end === -1 ? '' : cause.message.slice(end)
  const stop = /[.!?]$/u.test(first) ? '' : '.'
  return new WebError(first + stop + hint + rest, cause.code)
}
