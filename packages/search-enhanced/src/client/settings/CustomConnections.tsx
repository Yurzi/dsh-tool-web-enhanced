import { createCustomConnectionsSection, type CustomEditorProps } from 'dsh-tool-web-enhanced-core/client'
import type { ComponentProps } from 'react'
import { DEFAULT_CONNECTION } from '../../catalog.ts'
import type { WriteSettings } from './parts.tsx'
import type { SearchSettings, CustomConnection } from '../../settings/types.ts'
import type { LocaleKey } from '../locales.ts'
import { ConnectionEditor } from './ConnectionEditor.tsx'
import { CredentialEditor } from './CredentialEditor.tsx'
import { customConnections, customCredentialRef } from './model.ts'
import { settingsParts } from './parts.tsx'
import * as sparse from './sparse.ts'
import css from './Settings.module.css'

function Editor(props: CustomEditorProps<SearchSettings, LocaleKey>) {
  return <ConnectionEditor {...props} target={props.target.kind === 'new' ? { kind: 'new', type: 'adapter' } : props.target} />
}
const BaseCustomConnectionsSection = createCustomConnectionsSection<SearchSettings, CustomConnection, LocaleKey>({
  classes: css, parts: settingsParts, CredentialEditor, Editor, sparse,
  connectionsOf: customConnections, takenIds: config => Object.keys(config.connections ?? {}), credentialRefOf: customCredentialRef,
  kindLabel: (_connection, t) => t('custom.kindStructured'),
  unsupported: () => undefined,
  keys: {
    'custom.title': 'custom.title',
    'custom.addStructured': 'custom.addStructured',
    'custom.empty': 'custom.empty',
    'credential.set': 'credential.set',
    'credential.unset': 'credential.unset',
    'credential.manage': 'credential.manage',
    'custom.edit': 'custom.edit',
    'custom.remove': 'custom.remove',
    'services.enable': 'services.enable',
    'custom.removeConfirm': 'custom.removeConfirm',
    'confirm.cancel': 'confirm.cancel',
  },
})

export function CustomConnectionsSection(props: ComponentProps<typeof BaseCustomConnectionsSection>) {
  const write: WriteSettings = (ops, revision) => {
    const id = props.doc.config.defaultConnection
    const removesDefault = id !== undefined && ops.some(op => op.op === 'unset' && op.path[0] === 'connections' && (op.path.length === 1 || (op.path.length === 2 && op.path[1] === id)))
    const resetDefault = removesDefault ? sparse.sparseSettingOperations(props.doc.layers, ['defaultConnection'], DEFAULT_CONNECTION, DEFAULT_CONNECTION) : []
    return props.write([...ops, ...resetDefault], revision)
  }
  return <BaseCustomConnectionsSection {...props} write={write} />
}
