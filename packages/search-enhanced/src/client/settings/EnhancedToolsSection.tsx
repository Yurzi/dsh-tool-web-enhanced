import { createEnhancedToolsSection } from 'dsh-tool-web-enhanced-core/client'
import type { LocaleKey } from '../locales.ts'
import { settingsParts } from './parts.tsx'
import * as sparse from './sparse.ts'
import css from './Settings.module.css'

export const EnhancedToolsSection = createEnhancedToolsSection<LocaleKey>({
  classes: css, parts: settingsParts, sparse,
  keys: { title: 'enhanced.title', description: 'enhanced.description', consent: 'enhanced.consent' },
})
