/**
 * Operator-defined adapter connections. The catalog's adapter entries are the
 * formats; without one the section does not render. Removing the connection
 * that is the default restores the catalog default in the same write.
 */
import { useState, type ReactNode } from 'react'
import { Button, IconPlusOutlineRegular, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CredentialStatusMap } from '../credentials.ts'
import type { ClientTranslate } from '../command.ts'
import { createConnectionForm } from './connection-form.ts'
import { createConnectionEditor, type CustomEditorTarget, type EditorCopyKey } from './ConnectionEditor.tsx'
import type { CredentialEditorComponent, SaveCredential } from './CredentialEditor.tsx'
import { catalogEntry, customConnections, type AdapterKeyOf, type CatalogSettings, type CustomConnection, type OptionCopyTable, type SettingsCatalog } from './model.ts'
import type { OptionsEditor } from './OptionsEditor.tsx'
import type { SettingsClasses, SettingsParts, SettingsDoc, WriteSettings } from './parts.tsx'
import type { SparseSettings } from './sparse.ts'

export type CustomCopyKey = EditorCopyKey | "services.remoteNotice" | "custom.title" | "custom.addStructured" | "custom.empty" | "custom.kindStructured" | "credential.set" | "credential.unset" | "credential.manage" | "custom.edit" | "custom.remove" | "services.enable" | "custom.removeConfirm" | "confirm.cancel"

interface CustomProps<S, K extends string> {
  doc: SettingsDoc<S>
  write: WriteSettings
  credentials: CredentialStatusMap
  saveCredential: SaveCredential
  t: ClientTranslate<K>
}

export function createCustomConnectionsSection<S extends CatalogSettings, T extends SettingsCatalog, K extends string>({
  classes: css, keys, parts, CredentialEditor, optionsEditor, sparse, catalog, optionCopy, defaultConnection,
}: {
  classes: SettingsClasses
  keys: Readonly<Record<CustomCopyKey, K>>
  parts: SettingsParts<K>
  CredentialEditor: CredentialEditorComponent<K>
  optionsEditor: OptionsEditor<K>
  sparse: SparseSettings
  catalog: T
  /** Copy for the options of each adapter entry. */
  optionCopy: (key: AdapterKeyOf<T>) => OptionCopyTable<K>
  /** The catalog default that replaces a removed default connection. */
  defaultConnection: string
}): (props: CustomProps<S, K>) => ReactNode {
  type A = AdapterKeyOf<T>
  const { Section, ErrorText, ConfirmRow, useWrite } = parts
  const rules = createConnectionForm({ catalog, optionCopy })
  const [initialAdapter] = rules.adapters
  if (initialAdapter === undefined) return () => null
  const ConnectionEditor = createConnectionEditor<S, T, K>({ classes: css, keys, parts, optionsEditor, sparse, catalog, rules, initialAdapter })

  /** Who receives what a connection sends: the catalog service, and the host when the endpoint is not the catalog's. */
  function recipient(connection: CustomConnection<A>): string {
    const info = catalogEntry(catalog, connection.adapter)
    if (connection.endpoint === undefined || connection.endpoint === info.endpoint) return info.label
    return info.label + ' (' + new URL(connection.endpoint).host + ')'
  }

  function CustomConnectionsSection({ doc, write, credentials, saveCredential, t }: CustomProps<S, K>) {
    const [editor, setEditor] = useState<CustomEditorTarget | undefined>(undefined)
    const [notice, setNotice] = useState<string | undefined>(undefined)
    const connections = customConnections<A>(doc.config)
    const taken = doc.config.connections === undefined ? [] : Object.keys(doc.config.connections)

    const open = (target: CustomEditorTarget | undefined) => {
      setNotice(undefined)
      setEditor(target)
    }

    const editorFor = (target: CustomEditorTarget) => (
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

    const editing = (id: string) => editor !== undefined && editor.kind === 'edit' && editor.id === id

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
        {editor !== undefined && editor.kind === 'new' ? editorFor(editor) : null}
        {connections.length === 0 ? <p className={css.empty}>{t(keys['custom.empty'])}</p> : (
          <ul className={css.list}>
            {connections.map(([id, connection]) => (
              <CustomRow
                key={id}
                id={id}
                connection={connection}
                doc={doc}
                write={write}
                credentials={credentials}
                saveCredential={saveCredential}
                t={t}
                editing={editing(id)}
                onEdit={() => { open(editing(id) ? undefined : { kind: 'edit', id }) }}
                editor={editing(id) ? editorFor({ kind: 'edit', id }) : null}
              />
            ))}
          </ul>
        )}
      </Section>
    )
  }

  function CustomRow({ id, connection, doc, write, credentials, saveCredential, editing, onEdit, editor, t }: CustomProps<S, K> & {
    id: string
    connection: CustomConnection<A>
    editing: boolean
    onEdit: () => void
    editor: ReactNode
  }) {
    const [keyOpen, setKeyOpen] = useState(false)
    const [confirming, setConfirming] = useState(false)
    const action = useWrite(t)
    const credentialRef = connection.credentialRef
    const credentialStatus = credentials[credentialRef]
    const enabled = connection.disabled !== true
    const disabled = !doc.editable || action.busy

    const userConnections = (doc.layers.user as { connections?: Record<string, unknown> } | undefined)?.connections
    const removable = userConnections !== undefined && Object.hasOwn(userConnections, id)

    const save = (path: string[], target: unknown, fallback?: unknown) =>
      action.run(() => write(sparse.sparseSettingOperations(doc.layers, ['connections', id, ...path], target, fallback)))

    /** Removing the default connection puts the catalog default back in the same write. */
    const remove = () => {
      const ops = sparse.sparseSettingOperations(doc.layers, ['connections', id], undefined)
      const restore = doc.config.defaultConnection === id ? sparse.sparseSettingOperations(doc.layers, ['defaultConnection'], defaultConnection, defaultConnection) : []
      return action.run(() => write([...ops, ...restore]))
    }

    return (
      <li className={css.row}>
        <div className={css.rowLine}>
          <StateDot state={!enabled ? 'idle' : credentialStatus === 'configured' ? 'done' : 'warning'} />
          <div className={css.rowMain}>
            <span className={css.rowTitle}>
              {connection.label}
              <Tag tone="neutral">{t(keys['custom.kindStructured'])}</Tag>
            </span>
            <span className={css.rowMeta}>
              <code>{id}</code>
              {' · '}
              <code>{credentialRef}</code>
              {credentialStatus === 'configured' ? ' · ' + t(keys['credential.set']) : ''}
              {credentialStatus === 'missing' ? ' · ' + t(keys['credential.unset']) : ''}
              {' · ' + t(keys['services.remoteNotice'], { name: recipient(connection) })}
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
            onConfirm={() => { void remove() }}
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
