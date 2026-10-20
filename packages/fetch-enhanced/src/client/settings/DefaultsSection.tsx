import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { createDefaultsSection, type CredentialStatusMap } from 'dsh-tool-web-enhanced-core/client'
import { resolveSettings } from '../../settings/resolve.ts'
import { connectionLabel, type Translate } from '../connections.ts'
import type { LocaleKey } from '../locales.ts'
import { builtinOverride, connectionChoices } from './model.ts'
import { settingsParts, SettingRow, type SettingsDoc, type WriteSettings } from './parts.tsx'
import * as sparse from './sparse.ts'

const Defaults = createDefaultsSection<LocaleKey>({ parts: settingsParts, sparse, keys: {
  title: 'defaults.title', connection: 'defaults.connection', connectionHint: 'defaults.connectionHint',
  connectionUnset: 'defaults.connectionUnset', connectionMissing: 'defaults.connectionMissing',
} })
export function DefaultsSection({ doc, write, credentials = {}, t }: { doc: SettingsDoc; write: WriteSettings; credentials?: CredentialStatusMap; t: Translate }) {
  const resolved = resolveSettings(doc.config)
  const connection = resolved.connections.get(resolved.defaultConnection)
  const defaultAvailability = connection && {
    disabled: connection.disabled,
    access: connection.access,
    credentialStatus: connection.kind === 'native' ? credentials[connection.credentialRef] : undefined,
    warning: t(connection.disabled ? 'status.disabled' : 'status.needsAccount', { name: connectionLabel(connection, t) }),
  }
  return <Defaults doc={doc} write={write} t={t} defaultConnection={doc.config.defaultConnection} defaultLabel={builtinOverride(doc.config, 'local').label ?? t('connection.local')} defaultAvailability={defaultAvailability} choices={connectionChoices(doc.config, t)}>
    {({ disabled, save }) => <SettingRow title={t('defaults.showSelector')} hint={t('defaults.showSelectorHint')}>
      <Switch checked={doc.config.showSelector ?? true} label={t('defaults.showSelector')} disabled={disabled}
        onChange={next => { save(['showSelector'], next, true) }} />
    </SettingRow>}
  </Defaults>
}
