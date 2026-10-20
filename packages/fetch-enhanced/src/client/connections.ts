import type { ClientTranslate } from 'dsh-tool-web-enhanced-core/client'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionText } from 'dsh-tool-web-enhanced-core/client'
import type { Access, ConnectionView, SelectionView } from 'dsh-tool-web-enhanced-core/shared'
import type { LocaleKey } from './locales.ts'
import { CATALOG } from '../catalog.ts'
import { builtinId } from 'dsh-tool-web-enhanced-core/shared'

export type Translate = ClientTranslate<LocaleKey>

export function connectionLabel(connection: Pick<ConnectionView, 'id' | 'label'>, t: Translate): string {
  return connection.id === builtinId('local') && connection.label === CATALOG.local.label ? t('connection.local') : connection.label
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

/** How the connection reaches pages, and for a remote one which service receives the URL. */
function readyCaption(connection: ConnectionView, label: string, t: Translate): string {
  if (connection.kind === 'local') return t('access.local')
  const access = t(ACCESS_LABELS[connection.access])
  return connection.remote ? t('status.remoteReady', { access, name: label }) : access
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
