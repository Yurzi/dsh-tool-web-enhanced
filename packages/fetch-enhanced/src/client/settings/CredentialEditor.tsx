import { createCredentialEditor } from 'dsh-tool-web-enhanced-core/client'
import type { LocaleKey } from '../locales.ts'
import css from './Settings.module.css'
export type { SaveCredential } from 'dsh-tool-web-enhanced-core/client'
export const CredentialEditor = createCredentialEditor<LocaleKey>({ classes: css, keys: {
  'credential.label': 'credential.label',
  'credential.set': 'credential.set',
  'credential.unset': 'credential.unset',
  'credential.placeholder': 'credential.placeholder',
  'saving': 'saving',
  'credential.save': 'credential.save',
  'credential.saved': 'credential.saved',
  'credential.failed': 'credential.failed',
  'credential.hint': 'credential.hint',
} })
