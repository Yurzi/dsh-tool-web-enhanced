import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionText } from 'dsh-tool-web-enhanced-core/client'
import type { Access, ConnectionView, SelectionView } from 'dsh-tool-web-enhanced-core/shared'
import type { Freshness } from '../catalog.ts'
import type { LocaleKey, NS } from './locales.ts'

export type Translate = TranslateNS<typeof NS>

export function connectionLabel(connection: ConnectionView, _t: Translate): string {
  return connection.label
}

const ACCESS_LABELS = { keyless: 'access.keyless', 'api-key': 'access.apiKey', account: 'access.account' } as const satisfies Record<Access, LocaleKey>

export function describe(connection: ConnectionView, t: Translate): ConnectionText {
  const label = connectionLabel(connection, t)
  switch (connection.status) {
    case 'disabled': return { label, caption: t('services.off'), reason: t('status.disabled', { name: label }) }
    case 'unsupported': return { label, caption: t('status.short.unsupported'), reason: t('status.unsupported', { name: label }) }
    // Native connections can also use a DeepSeek account; adapters only take a key.
    case 'needs-credential': return { label, caption: t('status.short.needsCredential'), reason: t(connection.kind === 'native' ? 'status.needsAccount' : 'status.needsCredential') }
    case 'ready': return { label, caption: readyCaption(connection, label, t) }
  }
}

/** How the connection authenticates, and for a remote one which service receives the query. */
function readyCaption(connection: ConnectionView, label: string, t: Translate): string {
  const access = t(ACCESS_LABELS[connection.access])
  return connection.remote ? t('status.remoteReady', { access, name: label }) : access
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
