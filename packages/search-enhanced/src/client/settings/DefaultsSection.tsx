/** Defaults for new sessions and the composer button switch. */
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { CATALOG, FRESHNESS, honorsFreshness, type CatalogKey, type Freshness } from '../../catalog.ts'
import { connectionLabel, freshnessLabel, listText, type Translate } from '../connections.ts'
import { connectionChoices } from './model.ts'
import { createDefaultsSection, type CredentialStatusMap } from 'dsh-tool-web-enhanced-core/client'
import { resolveSettings, type Connection } from '../../settings/resolve.ts'
import { credentialRefsOf } from '../credentials.ts'
import type { LocaleKey } from '../locales.ts'
import { settingsParts, SelectMenu, SettingRow, type SettingsDoc, type WriteSettings } from './parts.tsx'
import * as sparse from './sparse.ts'

const BaseDefaultsSection = createDefaultsSection<LocaleKey>({ parts: settingsParts, sparse, keys: {
  title: 'defaults.title', connection: 'defaults.connection', connectionHint: 'defaults.connectionHint',
  connectionUnset: 'defaults.connectionUnset', connectionMissing: 'defaults.connectionMissing',
} })

/**
 * What the page can tell about the default from local facts: whether it is on
 * and has its key. The Session-model connection's route, and so its
 * credential, is known only per conversation.
 */
function availability(connection: Connection, credentials: CredentialStatusMap, t: Translate) {
  const [ref] = credentialRefsOf(connection)
  const warning = t(connection.disabled ? 'status.disabled' : connection.kind === 'native' ? 'status.needsAccount' : 'status.needsCredential', { name: connectionLabel(connection, t) })
  if (ref === undefined) return { disabled: connection.disabled, access: 'none', credentialStatus: undefined, warning } as const
  return { disabled: connection.disabled, access: connection.kind === 'model' ? 'api-key' : connection.access, credentialStatus: credentials[ref], warning } as const
}

export function DefaultsSection({ doc, write, credentials = {}, t }: { doc: SettingsDoc; write: WriteSettings; credentials?: CredentialStatusMap; t: Translate }) {
  const { defaultConnection, showSelector = true } = doc.config
  const freshness = doc.config.defaults?.freshness ?? 'auto'
  const choices = connectionChoices(doc.config, t)
  const resolved = resolveSettings(doc.config)
  const connection = resolved.connections.get(resolved.defaultConnection)
  const defaultAvailability = connection && availability(connection, credentials, t)

  const freshnessOptions = FRESHNESS.map(value => ({
    id: value,
    label: freshnessLabel(value, t),
  }))

  const freshnessServices = listText((Object.keys(CATALOG) as CatalogKey[])
    .filter(key => CATALOG[key].freshness.length > 0)
    .map(key => {
      const name = CATALOG[key].label
      return honorsFreshness(key, 'api-key') && !honorsFreshness(key, 'keyless')
        ? t('defaults.freshnessKeyOnly', { name })
        : name
    }), t)

  return (
    <BaseDefaultsSection doc={doc} write={write} t={t} choices={choices} defaultConnection={defaultConnection} defaultLabel={CATALOG['deepseek-messages'].label} defaultAvailability={defaultAvailability}>
      {({ disabled, save }) => <>
      <SettingRow
        title={t('defaults.freshness')}
        hint={t('defaults.freshnessHint', { services: freshnessServices })}
      >
        <SelectMenu<Freshness>
          label={t('defaults.freshness')}
          value={freshness}
          options={freshnessOptions}
          disabled={disabled}
          onChange={next => { save(['defaults', 'freshness'], next, 'auto') }}
        />
      </SettingRow>

      <SettingRow title={t('defaults.showSelector')} hint={t('defaults.showSelectorHint')}>
        <Switch
          checked={showSelector}
          label={t('defaults.showSelector')}
          disabled={disabled}
          onChange={next => { save(['showSelector'], next, true) }}
        />
      </SettingRow>

      </>}
    </BaseDefaultsSection>
  )
}
