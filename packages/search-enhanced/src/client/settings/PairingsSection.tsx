import { createPairingsSection } from 'dsh-tool-web-enhanced-core/client'
import { builtinKey } from 'dsh-tool-web-enhanced-core/shared'
import { CATALOG, type CatalogKey } from '../../catalog.ts'
import type { SearchSettings } from '../../settings/types.ts'
import type { LocaleKey } from '../locales.ts'
import { settingsParts } from './parts.tsx'
import css from './Settings.module.css'
export const PairingsSection = createPairingsSection<SearchSettings, LocaleKey>({ classes: css, parts: settingsParts, formatConnectionName, keys: {
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

function formatConnectionName(id: string, config: SearchSettings): string {
  const key = builtinKey(id)
  if (key !== undefined && Object.hasOwn(CATALOG, key)) {
    const override = config.connections?.[id]
    return override?.label ?? CATALOG[key as CatalogKey].label
  }
  const custom = config.connections?.[id]
  return custom?.label ?? id
}
