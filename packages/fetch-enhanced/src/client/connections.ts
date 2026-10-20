import type { ClientTranslate } from 'dsh-tool-web-enhanced-core/client'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionText } from 'dsh-tool-web-enhanced-core/client'
import type { ConnectionView, SelectionView } from 'dsh-tool-web-enhanced-core/shared'
import type { LocaleKey } from './locales.ts'
import { CATALOG } from '../catalog.ts'
import { builtinId } from 'dsh-tool-web-enhanced-core/shared'

export type Translate = ClientTranslate<LocaleKey>

export function connectionLabel(connection: Pick<ConnectionView, 'id' | 'label'>, t: Translate): string {
  return connection.id === builtinId('local') && connection.label === CATALOG.local.label ? t('connection.local') : connection.label
}

export function describe(connection: ConnectionView, t: Translate): ConnectionText {
  const label = connectionLabel(connection, t)
  switch (connection.status) {
    case 'disabled': return { label, caption: t('services.off'), reason: t('status.disabled', { name: label }) }
    case 'unsupported': return { label, caption: t('status.short.unsupported'), reason: t('status.unsupported', { name: label }) }
    case 'needs-credential': return { label, caption: t('status.short.needsCredential'), reason: t('status.needsAccount', { name: label }) }
    case 'ready': return { label, caption: t(connection.kind === 'local' ? 'access.local' : connection.access === 'account' ? 'access.account' : 'access.apiKey') }
  }
}

export function sourceText(view: SelectionView, t: Translate): string {
  const keys = { session: 'source.session', inherited: 'source.inherited', model: 'source.model', default: 'source.default' } as const
  return t(keys[view.source])
}

export function writeFailureText(error: RemoteFailure, t: Translate): string {
  switch (error.code) {
    case 'fetchConnections/conflict': return t('write.conflict')
    case 'fetchConnections/unavailable': return t('write.unavailable')
    default: return t('write.failed')
  }
}
