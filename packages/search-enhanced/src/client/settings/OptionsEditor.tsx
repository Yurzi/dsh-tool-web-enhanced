import { createOptionsEditor } from 'dsh-tool-web-enhanced-core/client'
import type { LocaleKey } from '../locales.ts'
import { valueLabel } from './model.ts'
import { settingsParts } from './parts.tsx'
import css from './Settings.module.css'
export const optionsEditor = createOptionsEditor<LocaleKey>({ classes: css, parts: settingsParts, valueLabel,
  keys: { 'options.default': 'options.default', 'options.invalid': 'options.invalid', 'options.invalidLine': 'options.invalidLine', 'options.tooMany': 'options.tooMany', 'options.invalidItem': 'options.invalidItem', 'options.exclusive': 'options.exclusive', 'options.on': 'options.on', 'options.off': 'options.off' },
})
export const { OptionFields, OptionsForm } = optionsEditor
