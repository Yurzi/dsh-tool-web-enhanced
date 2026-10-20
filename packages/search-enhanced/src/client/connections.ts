import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionText } from 'dsh-tool-web-enhanced-core/client'
import type { ConnectionView, SelectionView } from 'dsh-tool-web-enhanced-core/shared'
import type { Freshness } from '../catalog.ts'
import type { LocaleKey, NS } from './locales.ts'

export type Translate = TranslateNS<typeof NS>

export function connectionLabel(connection: ConnectionView, _t: Translate): string {
  return connection.label
}

export function describe(connection: ConnectionView, t: Translate): ConnectionText {
  const label = connectionLabel(connection, t)
  switch (connection.status) {
    case 'disabled': return { label, caption: t('services.off'), reason: t('status.disabled', { name: label }) }
    case 'unsupported': return { label, caption: t('status.short.unsupported'), reason: t('status.unsupported', { name: label }) }
    case 'needs-credential': return { label, caption: t('status.short.needsCredential'), reason: t(connection.kind === 'native' ? 'status.needsAccount' : 'status.needsCredential') }
    case 'ready': {
      const caption = connection.access === 'keyless' ? undefined : t(connection.access === 'account' ? 'access.account' : 'access.apiKey')
      return { label, ...(caption === undefined ? {} : { caption }) }
    }
  }
}

export function sourceText(view: SelectionView, t: Translate): string {
  const keys = { session: 'source.session', inherited: 'source.inherited', model: 'source.model', default: 'source.default' } as const
  return t(keys[view.source])
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
