import { createCustomConnectionsSection } from 'dsh-tool-web-enhanced-core/client'
import { CATALOG, DEFAULT_CONNECTION, MODEL_PROTOCOLS, type ModelProtocol } from '../../catalog.ts'
import type { SearchSettings } from '../../settings/types.ts'
import type { LocaleKey } from '../locales.ts'
import { CredentialEditor } from './CredentialEditor.tsx'
import { optionCopy, protocolCopy } from './model.ts'
import { optionsEditor } from './OptionsEditor.tsx'
import { settingsParts } from './parts.tsx'
import * as sparse from './sparse.ts'
import css from './Settings.module.css'

export const CustomConnectionsSection = createCustomConnectionsSection<SearchSettings, typeof CATALOG, LocaleKey, ModelProtocol>({
  classes: css, parts: settingsParts, CredentialEditor, optionsEditor, sparse, catalog: CATALOG, optionCopy, defaultConnection: DEFAULT_CONNECTION,
  protocols: {
    catalog: MODEL_PROTOCOLS,
    optionCopy: protocolCopy,
    notes: {
      'anthropic-messages': 'model.protocol.anthropic-messages',
      'openai-responses': 'model.protocol.openai-responses',
      'openai-chat-completions': 'model.protocol.openai-chat-completions',
    },
    keys: {
      'model.format': 'model.format',
      'model.id': 'model.id',
      'model.idHint': 'model.idHint',
      'model.endpointHint': 'model.endpointHint',
      'model.note': 'model.note',
      'draft.model': 'draft.model',
    },
  },
  keys: {
    'services.remoteNotice': 'services.remoteNotice',
    'custom.title': 'custom.title',
    'custom.addStructured': 'custom.addStructured',
    'custom.empty': 'custom.empty',
    'custom.kindStructured': 'custom.kindStructured',
    'credential.set': 'credential.set',
    'credential.unset': 'credential.unset',
    'credential.manage': 'credential.manage',
    'credential.placeholder': 'credential.placeholder',
    'custom.edit': 'custom.edit',
    'custom.remove': 'custom.remove',
    'services.enable': 'services.enable',
    'custom.removeConfirm': 'custom.removeConfirm',
    'confirm.cancel': 'confirm.cancel',
    'editor.titleNew': 'editor.titleNew',
    'editor.titleEdit': 'editor.titleEdit',
    'editor.id': 'editor.id',
    'editor.idHint': 'editor.idHint',
    'editor.idPlaceholder': 'editor.idPlaceholder',
    'editor.label': 'editor.label',
    'editor.adapter': 'editor.adapter',
    'editor.endpoint': 'editor.endpoint',
    'editor.endpointHint': 'editor.endpointHint',
    'editor.credentialRef': 'editor.credentialRef',
    'editor.credentialRefHint': 'editor.credentialRefHint',
    'editor.trust': 'editor.trust',
    'editor.trustUnnamed': 'editor.trustUnnamed',
    'editor.save': 'editor.save',
    'editor.cancel': 'editor.cancel',
    'editor.stale': 'editor.stale',
    'editor.optionsHint': 'editor.optionsHint',
    'editor.apiKey': 'editor.apiKey',
    'editor.apiKeyHint': 'editor.apiKeyHint',
    'editor.keyFailed': 'editor.keyFailed',
    'draft.id': 'draft.id',
    'draft.duplicate': 'draft.duplicate',
    'draft.label': 'draft.label',
    'draft.trust': 'draft.trust',
    'draft.credentialRef': 'draft.credentialRef',
    'draft.endpoint': 'draft.endpoint',
    'draft.options': 'draft.options',
    'options.title': 'options.title',
    'saving': 'saving',
  },
})
