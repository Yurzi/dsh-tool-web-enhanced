import { createPairingsSection } from 'dsh-tool-web-enhanced-core/client'
import { builtinKey } from 'dsh-tool-web-enhanced-core/shared'
import { CATALOG, type CatalogKey } from '../../catalog.ts'
import type { FetchSettings } from '../../settings/types.ts'
import type { LocaleKey } from '../locales.ts'
import type { Translate } from '../connections.ts'
import { settingsParts } from './parts.tsx'
import css from './Settings.module.css'
export const PairingsSection = createPairingsSection<FetchSettings, LocaleKey>({ classes: css, parts: settingsParts, formatConnectionName, keys: {
  'pairings.forgetFailed': 'pairings.forgetFailed',
  'pairings.title': 'pairings.title',
  'pairings.hint': 'pairings.hint',
  'pairings.failed': 'pairings.failed',
  'pairings.loading': 'pairings.loading',
  'pairings.empty': 'pairings.empty',
  'connection.off': 'connection.off',
  'saving': 'saving',
  'pairings.forget': 'pairings.forget',
} })

function formatConnectionName(id: string, config: FetchSettings, t: Translate): string {
  const key = builtinKey(id)
  if (key !== undefined && Object.hasOwn(CATALOG, key)) {
    const override = config.connections?.[id]
    return override?.label ?? (key === 'local' ? t('connection.local') : CATALOG[key as CatalogKey].label)
  }
  return id
}
