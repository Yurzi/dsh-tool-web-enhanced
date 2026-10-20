import { createServicesSection } from 'dsh-tool-web-enhanced-core/client'
import { CATALOG, type CatalogKey } from '../../catalog.ts'
import type { SearchSettings } from '../../settings/types.ts'
import type { LocaleKey } from '../locales.ts'
import { CredentialEditor } from './CredentialEditor.tsx'
import { optionCopy } from './model.ts'
import { optionsEditor } from './OptionsEditor.tsx'
import { settingsParts } from './parts.tsx'
import * as sparse from './sparse.ts'
import css from './Settings.module.css'
export const ServicesSection = createServicesSection<SearchSettings, CatalogKey, LocaleKey>({
  classes: css, parts: settingsParts, CredentialEditor, optionsEditor, sparse, catalog: CATALOG, optionCopy,
  keys: {
    'services.title': 'services.title',
    'options.hint': 'options.hint',
    'options.keylessMore': 'options.keylessMore',
    'options.invalid': 'options.invalid',
    'options.default': 'options.default',
    'services.remoteNotice': 'services.remoteNotice',
    'services.off': 'services.off',
    'services.configureLabel': 'services.configureLabel',
    'services.configure': 'services.configure',
    'services.enable': 'services.enable',
    'services.access': 'services.access',
    'services.accessKeyless': 'services.accessKeyless',
    'services.accessPersonal': 'services.accessPersonal',
    'services.accessHint.keyless': 'services.accessHint.keyless',
    'services.accessHint.apiKey': 'services.accessHint.apiKey',
    'services.accountHint': 'services.accountHint',
    'services.getKey': 'services.getKey',
    'services.trust': 'editor.trustUnnamed',
    'options.title': 'options.title',
    'services.keyless': 'services.keyless',
    'services.account': 'services.account',
    'services.personalKey': 'services.personalKey',
    'credential.set': 'credential.set',
    'credential.unset': 'credential.unset',
    'credential.reference': 'credential.reference',
    'credential.referenceHint': 'credential.referenceHint',
    'services.trustUnsaved': 'services.trustUnsaved',
  },
})
