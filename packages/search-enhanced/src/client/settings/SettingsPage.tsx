/**
 * The search plugin's row settings page on plugins.row.config.
 * Controls write immediately as sparse operations against the revision the
 * page shows; credentials go to DSH Credentials only.
 */
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createResetSection, createRouteNotice, useSettingsDocument } from 'dsh-tool-web-enhanced-core/client'
import { resolveSettings } from '../../settings/resolve.ts'
import type { SettingsPageInjected } from '../injected.ts'
import type { NS, LocaleKey } from '../locales.ts'
import { CustomConnectionsSection } from './CustomConnections.tsx'
import { DefaultsSection } from './DefaultsSection.tsx'
import { EnhancedToolsSection } from './EnhancedToolsSection.tsx'
import { PairingsSection } from './PairingsSection.tsx'
import { settingsParts, type SettingsDoc } from './parts.tsx'
import { ServicesSection } from './ServicesSection.tsx'
import * as sparse from './sparse.ts'
import css from './Settings.module.css'

export type SettingsPageProps =
  & PropsRuntime<'plugins.row.config'>
  & InjectFace<SettingsPageInjected>
  & PropsLocale<typeof NS>

export function SettingsPage({
  useSettings,
  useCredentials,
  useRoute,
  usePairings,
  readSettings,
  mutate,
  saveCredential,
  forgetPairing,
  t,
}: SettingsPageProps) {
  const snapshot = useSettings(value => value)
  const credentials = useCredentials(value => value)
  const route = useRoute(value => value)
  const pairings = usePairings(value => value)
  const { view, write, migrationError } = useSettingsDocument(snapshot, readSettings, resolveSettings, mutate)

  if (snapshot.status === 'unavailable') return null
  if (snapshot.value === undefined || snapshot.revision === undefined) {
    return <p className={css.status} role="status"><StateDot state="ongoing" />{t('settings.loading')}</p>
  }

  if (view === undefined) return null
  const resetDoc = { config: snapshot.value, layers: view.layers, revision: snapshot.revision, editable: snapshot.writable }
  if (view.kind === 'invalid') return <div className={css.page}>
    <p className={css.warning} role="alert" title={view.diagnostic}>{t('settings.unsupported')}</p>
    <ResetSection doc={resetDoc} write={write} t={t} />
  </div>
  const doc: SettingsDoc = { ...resetDoc, config: view.config, editable: snapshot.writable && !view.needsWriteback }

  return (
    <div className={css.page}>
      <p className={css.intro}>{t('settings.intro')}</p>
      {view.needsWriteback ? <p className={css.warning} role="status">{t('settings.loading')}</p> : null}
      {snapshot.writable ? null : <p className={css.warning} role="status">{t('settings.readOnly')}</p>}
      {migrationError === undefined ? null : <p className={css.warning} role="alert" title={migrationError}>{t('settings.invalid')}</p>}
      <RouteNotice route={route} t={t} />
      <DefaultsSection doc={doc} write={write} credentials={credentials} t={t} />
      <EnhancedToolsSection doc={doc} write={write} t={t} />
      <ServicesSection doc={doc} write={write} credentials={credentials} saveCredential={saveCredential} t={t} />
      <CustomConnectionsSection doc={doc} write={write} credentials={credentials} saveCredential={saveCredential} t={t} />
      <PairingsSection pairingsState={pairings} config={doc.config} forgetPairing={forgetPairing} t={t} />
      <ResetSection doc={resetDoc} write={write} t={t} />
    </div>
  )
}

const RouteNotice = createRouteNotice<LocaleKey>({ classes: css, keys: { unknown: 'route.unknown', auto: 'route.auto', other: 'route.other' },
  other: (route, t) => route.provider === 'deepseek-search-api' ? t('route.deepseekApi', { id: route.providerId }) : undefined,
})
const ResetSection = createResetSection<LocaleKey>({ classes: css, parts: settingsParts, sparse, keys: {
  'reset.confirm': 'reset.confirm',
  'reset.confirmButton': 'reset.confirmButton',
  'confirm.cancel': 'confirm.cancel',
  'reset.hint': 'reset.hint',
  'reset.button': 'reset.button',
} })
