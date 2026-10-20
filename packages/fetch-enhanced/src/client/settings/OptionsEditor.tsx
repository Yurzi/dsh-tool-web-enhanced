import { createOptionsEditor } from 'dsh-tool-web-enhanced-core/client'
import type { LocaleKey } from '../locales.ts'
import { settingsParts } from './parts.tsx'
import css from './Settings.module.css'
export const optionsEditor = createOptionsEditor<LocaleKey>({ classes: css, parts: settingsParts, valueLabel: value => value,
  keys: { 'options.default': 'options.default', 'options.invalid': 'options.invalid' },
})
export const { OptionFields, OptionsForm } = optionsEditor
