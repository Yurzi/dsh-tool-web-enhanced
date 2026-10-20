import { createSettingsParts, type SettingsDoc as CoreSettingsDoc } from 'dsh-tool-web-enhanced-core/client'
import type { SearchSettings } from '../../settings/types.ts'
import type { LocaleKey } from '../locales.ts'
import css from './Settings.module.css'
export { classNames, applyOps, SettingsValidationError, type WriteSettings, type WriteState, type SelectOption } from 'dsh-tool-web-enhanced-core/client'
export type SettingsDoc = CoreSettingsDoc<SearchSettings>
export const settingsParts = createSettingsParts<LocaleKey>({ classes: css, keys: {
  refused: 'settings.refused', invalid: 'settings.invalid', failed: 'settings.failed',
} })
export const { Section, SettingRow, SelectMenu, ErrorText, ConfirmRow, useWrite } = settingsParts
