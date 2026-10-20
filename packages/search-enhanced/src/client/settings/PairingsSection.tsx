import { createPairingsSection } from 'dsh-tool-web-enhanced-core/client'
import type { SearchSettings } from '../../settings/types.ts'
import type { LocaleKey } from '../locales.ts'
import { connectionName } from './model.ts'
import { settingsParts } from './parts.tsx'
import css from './Settings.module.css'
export const PairingsSection = createPairingsSection<SearchSettings, LocaleKey>({ classes: css, parts: settingsParts, formatConnectionName: connectionName, keys: {
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
