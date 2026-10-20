/** Shared custom connection list; capability-specific editor and data stay outside core. */
import { useState, type ComponentType, type ReactNode } from 'react'
import { Button, IconPlusOutlineRegular, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CredentialStatusMap } from '../credentials.ts'
import type { ClientTranslate } from '../command.ts'
import type { CredentialEditorComponent, SaveCredential } from './CredentialEditor.tsx'
import type { SettingsClasses, SettingsParts, SettingsDoc, WriteSettings } from './parts.tsx'
import type { SparseSettings } from './sparse.ts'

export type CustomEditorTarget = { readonly kind: 'new' } | { readonly kind: 'edit'; readonly id: string }
export interface CustomEditorProps<S, K extends string> {
  target: CustomEditorTarget
  doc: SettingsDoc<S>
  write: WriteSettings
  saveCredential: SaveCredential
  taken: readonly string[]
  t: ClientTranslate<K>
  onClose: (problem?: string) => void
}
export interface CustomEditorConnection { readonly label: string; readonly disabled?: boolean }
export type CustomCopyKey = "custom.title" | "custom.addStructured" | "custom.empty" | "credential.set" | "credential.unset" | "credential.manage" | "custom.edit" | "custom.remove" | "services.enable" | "custom.removeConfirm" | "confirm.cancel"
export function createCustomConnectionsSection<S, C extends CustomEditorConnection, K extends string>({
  classes: css, keys, parts: { Section, ErrorText, ConfirmRow, useWrite }, CredentialEditor, Editor: ConnectionEditor,
  sparse, connectionsOf, takenIds, credentialRefOf, kindLabel, unsupported,
}: {
  classes: SettingsClasses
  keys: Readonly<Record<CustomCopyKey, K>>
  parts: SettingsParts<K>
  CredentialEditor: CredentialEditorComponent<K>
  Editor: ComponentType<CustomEditorProps<S, K>>
  sparse: SparseSettings
  connectionsOf: (config: S) => readonly (readonly [string, C])[]
  takenIds: (config: S) => readonly string[]
  credentialRefOf: (connection: C) => string
  kindLabel: (connection: C, t: ClientTranslate<K>) => string
  unsupported: (connection: C, t: ClientTranslate<K>) => string | undefined
}) {
  type EditorTarget = CustomEditorTarget
  interface CustomProps {
    doc: SettingsDoc<S>
    write: WriteSettings
    credentials: CredentialStatusMap
    saveCredential: SaveCredential
    t: ClientTranslate<K>
  }
  
  function CustomConnectionsSection({ doc, write, credentials, saveCredential, t }: CustomProps) {
    const [editor, setEditor] = useState<EditorTarget | undefined>(undefined)
    const [notice, setNotice] = useState<string | undefined>(undefined)
    const connections = connectionsOf(doc.config)
    const taken = takenIds(doc.config)
  
    const open = (target: EditorTarget | undefined) => {
      setNotice(undefined)
      setEditor(target)
    }
  
    const editorFor = (target: EditorTarget) => (
      <ConnectionEditor
        key={target.kind === 'edit' ? target.id : 'new'}
        target={target}
        doc={doc}
        write={write}
        saveCredential={saveCredential}
        taken={taken}
        t={t}
        onClose={(problem) => {
          setEditor(undefined)
          setNotice(problem)
        }}
      />
    )
  
    return (
      <Section
        title={t(keys['custom.title'])}
        actions={(
          <div className={css.sectionActions}>
            <Button
              variant="ghost"
              size="sm"
              icon={<IconPlusOutlineRegular size={14} />}
              disabled={!doc.editable}
              onClick={() => { open({ kind: 'new' }) }}
            >
              {t(keys['custom.addStructured'])}
            </Button>
          </div>
        )}
      >
        <ErrorText>{notice}</ErrorText>
        {editor?.kind === 'new' ? editorFor(editor) : null}
        {connections.length === 0 ? <p className={css.empty}>{t(keys['custom.empty'])}</p> : (
          <ul className={css.list}>
            {connections.map(([id, connection]) => unsupported(connection, t) !== undefined ? (
              <li key={id} className={css.row}>
                <div className={css.rowLine}>
                  <StateDot state="idle" />
                  <div className={css.rowMain}>
                    <span className={css.rowTitle}>{connection.label}<Tag tone="neutral">{kindLabel(connection, t)}</Tag></span>
                    <span className={css.rowMeta}><code>{id}</code></span>
                    <p className={css.hint}>{unsupported(connection, t)}</p>
                  </div>
                </div>
              </li>
            ) : (
              <CustomRow
                key={id}
                id={id}
                connection={connection}
                doc={doc}
                write={write}
                credentials={credentials}
                saveCredential={saveCredential}
                t={t}
                editing={editor?.kind === 'edit' && editor.id === id}
                onEdit={() => { open(editor?.kind === 'edit' && editor.id === id ? undefined : { kind: 'edit', id }) }}
                editor={editor?.kind === 'edit' && editor.id === id ? editorFor(editor) : null}
              />
            ))}
          </ul>
        )}
      </Section>
    )
  }
  
  function CustomRow({ id, connection, doc, write, credentials, saveCredential, editing, onEdit, editor, t }: CustomProps & {
    id: string
    connection: C
    editing: boolean
    onEdit: () => void
    editor: ReactNode
  }) {
    const [keyOpen, setKeyOpen] = useState(false)
    const [confirming, setConfirming] = useState(false)
    const action = useWrite(t)
    const credentialRef = credentialRefOf(connection)
    const credentialStatus = credentials[credentialRef]
    const enabled = connection.disabled !== true
    const disabled = !doc.editable || action.busy
  
    const userConnections = (doc.layers.user as { connections?: Record<string, unknown> } | undefined)?.connections
    const removable = userConnections !== undefined && Object.hasOwn(userConnections, id)
  
    const save = (path: string[], target: unknown, fallback?: unknown) =>
      action.run(() => write(sparse.sparseSettingOperations(doc.layers, ['connections', id, ...path], target, fallback)))
  
    return (
      <li className={css.row}>
        <div className={css.rowLine}>
          <StateDot state={!enabled ? 'idle' : credentialStatus === 'configured' ? 'done' : 'warning'} />
          <div className={css.rowMain}>
            <span className={css.rowTitle}>
              {connection.label}
              <Tag tone="neutral">{kindLabel(connection, t)}</Tag>
            </span>
            <span className={css.rowMeta}>
              <code>{id}</code>
              {' · '}
              <code>{credentialRef}</code>
              {credentialStatus === 'configured' ? ' · ' + t(keys['credential.set']) : ''}
              {credentialStatus === 'missing' ? ' · ' + t(keys['credential.unset']) : ''}
            </span>
          </div>
          <div className={css.rowActions}>
            <Button variant="ghost" size="sm" aria-expanded={keyOpen} onClick={() => { setKeyOpen(!keyOpen) }}>{t(keys['credential.manage'])}</Button>
            <Button variant="ghost" size="sm" aria-expanded={editing} disabled={!doc.editable} onClick={onEdit}>{t(keys['custom.edit'])}</Button>
            {removable ? (
              <Button variant="ghost" size="sm" className={css.danger} disabled={disabled} aria-expanded={confirming} onClick={() => { setConfirming(true) }}>
                {t(keys['custom.remove'])}
              </Button>
            ) : null}
          </div>
          <Switch
            checked={enabled}
            label={t(keys['services.enable'], { name: connection.label })}
            disabled={disabled}
            onChange={next => void save(['disabled'], !next, false)}
          />
        </div>
        {confirming ? (
          <ConfirmRow
            message={t(keys['custom.removeConfirm'], { name: connection.label })}
            confirmLabel={t(keys['custom.remove'])}
            cancelLabel={t(keys['confirm.cancel'])}
            disabled={disabled}
            onConfirm={() => { void save([], undefined) }}
            onCancel={() => { setConfirming(false) }}
          />
        ) : null}
        <ErrorText title={action.errorTitle}>{action.error}</ErrorText>
        {keyOpen ? (
          <div className={css.panel}>
            <CredentialEditor credentialRef={credentialRef} status={credentialStatus} save={saveCredential} t={t} />
          </div>
        ) : null}
        {editor}
      </li>
    )
  }
  return CustomConnectionsSection
}
