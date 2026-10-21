import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionText } from 'dsh-tool-web-enhanced-core/client'
import { builtinId, isBuiltinId, type Access, type ConnectionView, type SelectionView, type UnsupportedReason } from 'dsh-tool-web-enhanced-core/shared'
import { CATALOG, type Freshness } from '../catalog.ts'
import type { LocaleKey, NS } from './locales.ts'

export type Translate = TranslateNS<typeof NS>

/** The Session-model connection keeps its catalog name only until the operator renames it; that name is localized. */
export function connectionLabel(connection: Pick<ConnectionView, 'id' | 'label'>, t: Translate): string {
  const sessionModel = connection.id === builtinId('session-model') && connection.label === CATALOG['session-model'].label
  return sessionModel ? t('connection.sessionModel') : connection.label
}

const ACCESS_LABELS = { keyless: 'access.keyless', 'api-key': 'access.apiKey', account: 'access.account' } as const satisfies Record<Access, LocaleKey>

/** Why the conversation model cannot serve, worded so the operator knows where to fix it. */
const REASON_TEXT = {
  'no-model': 'status.reason.no-model',
  'unknown-route': 'status.reason.unknown-route',
  protocol: 'status.reason.protocol',
  endpoint: 'status.reason.endpoint',
  headers: 'status.reason.headers',
  credential: 'status.reason.credential',
} as const satisfies Record<UnsupportedReason, LocaleKey>

export function describe(connection: ConnectionView, t: Translate): ConnectionText {
  const label = connectionLabel(connection, t)
  switch (connection.status) {
    case 'disabled': return { label, caption: t('services.off'), reason: t('status.disabled', { name: label }) }
    case 'unsupported': {
      const reason = connection.reason === undefined ? t('status.unsupported', { name: label }) : t(REASON_TEXT[connection.reason])
      return { label, caption: t('status.short.unsupported'), reason }
    }
    case 'needs-credential': {
      const need = credentialNeed(connection)
      // A sign-in is not a key: the short caption (/setup-search) must not send the operator to configure one.
      return { label, caption: t(need === 'status.sessionModelNeedsSignIn' ? 'status.short.needsSignIn' : 'status.short.needsCredential'), reason: t(need) }
    }
    case 'ready': return { label, caption: readyCaption(connection, label, t) }
  }
}

/**
 * What a connection waits for. The conversation model names its own key, or on
 * the DeepSeek account route a fresh sign-in (that route never falls back to a
 * key); native connections take an account or a key; the rest a key.
 */
function credentialNeed(connection: ConnectionView): 'status.sessionModelNeedsSignIn' | 'status.sessionModelNeedsKey' | 'status.needsAccount' | 'status.needsCredential' {
  if (connection.kind === 'model' && isBuiltinId(connection.id)) {
    return connection.access === 'account' ? 'status.sessionModelNeedsSignIn' : 'status.sessionModelNeedsKey'
  }
  return connection.kind === 'native' ? 'status.needsAccount' : 'status.needsCredential'
}

/**
 * How the connection authenticates, and for a remote one who receives the
 * query: the service, or for a model connection the conversation model's
 * provider (built-in, follows the conversation) or the fixed connection.
 */
function readyCaption(connection: ConnectionView, label: string, t: Translate): string {
  const access = t(ACCESS_LABELS[connection.access])
  if (!connection.remote) return access
  if (connection.kind !== 'model') return t('status.remoteReady', { access, name: label })
  return isBuiltinId(connection.id) ? t('status.sessionModelReady', { access }) : t('status.modelReady', { access, name: label })
}

export function sourceText(view: SelectionView, t: Translate): string {
  const keys = { session: 'source.session', inherited: 'source.inherited', model: 'source.model', default: 'source.default' } as const
  return t(keys[view.source])
}

/** Names joined as the dictionary's language joins them: "A and B", "A和B". */
export function listText(items: readonly string[], t: Translate): string {
  return new Intl.ListFormat(t('list.locale'), { type: 'conjunction' }).format(items)
}

const FRESHNESS_LABELS = { auto: 'freshness.auto', fresh: 'freshness.fresh', realtime: 'freshness.realtime' } as const satisfies Record<Freshness, LocaleKey>
export function freshnessLabel(freshness: Freshness, t: Translate): string {
  return t(FRESHNESS_LABELS[freshness])
}

export function pickerGroups<V extends ConnectionView>(view: { connections: V[] }): { services: V[] } {
  const visible = view.connections.filter(connection => connection.status !== 'disabled')
  return { services: visible }
}

export function writeFailureText(error: RemoteFailure, t: Translate): string {
  switch (error.code) {
    case 'searchConnections/conflict': return t('write.conflict')
    case 'searchConnections/unavailable': return t('write.unavailable')
    default: return t('write.failed')
  }
}
