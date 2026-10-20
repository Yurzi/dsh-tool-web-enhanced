/**
 * Add or edit one custom adapter connection with plain fields. The editor keeps
 * the document layers and revision it opened with, so a save never overwrites
 * a change made since. An optional key goes to DSH Credentials once the
 * connection is saved.
 */
import { useId, useState } from 'react'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { CUSTOM_PREFIX } from '../../shared/connections.ts'
import type { ClientTranslate } from '../command.ts'
import { emptyForm, formOf, suggestCredentialRef, type ConnectionForm, type ConnectionFormRules, type FormError } from './connection-form.ts'
import type { SaveCredential } from './CredentialEditor.tsx'
import { catalogEntry, type AdapterKeyOf, type CatalogSettings, type CustomConnection, type SettingsCatalog } from './model.ts'
import type { OptionsEditor } from './OptionsEditor.tsx'
import { classNames, type SettingsClasses, type SettingsDoc, type SettingsParts, type WriteSettings } from './parts.tsx'
import type { SparseSettings } from './sparse.ts'

export type CustomEditorTarget = { readonly kind: 'new' } | { readonly kind: 'edit'; readonly id: string }

export interface CustomEditorProps<S, K extends string> {
  target: CustomEditorTarget
  doc: SettingsDoc<S>
  write: WriteSettings
  saveCredential: SaveCredential
  /** Ids of every existing connection. */
  taken: readonly string[]
  t: ClientTranslate<K>
  /** Close the editor, with a problem to report after the connection saved. */
  onClose: (problem?: string) => void
}

export type EditorCopyKey =
  | 'editor.titleNew' | 'editor.titleEdit' | 'editor.id' | 'editor.idHint' | 'editor.idPlaceholder' | 'editor.label' | 'editor.adapter'
  | 'editor.endpoint' | 'editor.endpointHint' | 'editor.credentialRef' | 'editor.credentialRefHint' | 'editor.trust' | 'editor.trustUnnamed'
  | 'editor.save' | 'editor.cancel' | 'editor.stale' | 'editor.optionsHint' | 'editor.apiKey' | 'editor.apiKeyHint' | 'editor.keyFailed'
  | 'draft.id' | 'draft.duplicate' | 'draft.label' | 'draft.trust' | 'draft.credentialRef' | 'draft.endpoint' | 'draft.options'
  | 'options.title' | 'credential.placeholder' | 'saving'

const FORM_ERRORS = {
  id: 'draft.id',
  duplicate: 'draft.duplicate',
  label: 'draft.label',
  credentialRef: 'draft.credentialRef',
  endpoint: 'draft.endpoint',
  options: 'draft.options',
  trust: 'draft.trust',
} as const satisfies Record<FormError, EditorCopyKey>

export function createConnectionEditor<S extends CatalogSettings, T extends SettingsCatalog, K extends string>({
  classes: css, keys, parts: { ErrorText, SelectMenu, useWrite }, optionsEditor: { OptionFields }, sparse, catalog, rules, initialAdapter,
}: {
  classes: SettingsClasses
  keys: Readonly<Record<EditorCopyKey, K>>
  parts: SettingsParts<K>
  optionsEditor: OptionsEditor<K>
  sparse: SparseSettings
  catalog: T
  rules: ConnectionFormRules<T, K>
  /** The format a new connection starts with. */
  initialAdapter: AdapterKeyOf<T>
}) {
  type A = AdapterKeyOf<T>
  const { adapters, buildConnection, destination, formFields, needsTrust } = rules

  function ConnectionEditor({ target, doc, write, saveCredential, taken, onClose, t }: CustomEditorProps<S, K>) {
    const formId = useId()
    const [opened] = useState(() => ({
      layers: doc.layers,
      revision: doc.revision,
      previous: target.kind === 'edit' ? storedConnection(doc.config, target.id) : undefined,
    }))
    const [form, setForm] = useState<ConnectionForm<A>>(() => opened.previous === undefined || target.kind !== 'edit'
      ? emptyForm(initialAdapter)
      : formOf(target.id, opened.previous))

    // The reference follows the id until the user edits it.
    const [refEdited, setRefEdited] = useState(target.kind === 'edit')
    const [apiKey, setApiKey] = useState('')
    // Consent covers the destination it was given for; a stored trust covers the stored one.
    const [consentFor, setConsentFor] = useState<string | undefined>(() =>
      opened.previous !== undefined && opened.previous.trustedEndpoint === true ? destination(form) : undefined)
    const consent = consentFor === destination(form)
    const [error, setError] = useState<FormError | undefined>(undefined)
    const action = useWrite(t)

    const update = (patch: Partial<ConnectionForm<A>>) => {
      setForm(current => ({ ...current, ...patch }))
      setError(undefined)
    }

    const changeId = (suffix: string) => {
      const id = CUSTOM_PREFIX + suffix
      update(refEdited ? { id } : { id, credentialRef: suggestCredentialRef(id) })
    }

    const askTrust = needsTrust(form)

    const submit = async (): Promise<void> => {
      const others = target.kind === 'edit' ? taken.filter(existing => existing !== target.id) : taken
      const result = buildConnection(form, consent, others, opened.previous)
      if (!result.ok) return setError(result.error)
      const ops = sparse.sparseSettingOperations(opened.layers, ['connections', result.id], result.connection)
      if (!await action.run(() => write(ops, opened.revision))) return

      const key = apiKey.trim()
      if (key === '') return onClose()

      try {
        await saveCredential(form.credentialRef.trim(), key)
        onClose()
      } catch {
        onClose(t(keys['editor.keyFailed']))
      }
    }

    const trustLabel = form.credentialRef.trim() === ''
      ? t(keys['editor.trustUnnamed'])
      : t(keys['editor.trust'], { ref: form.credentialRef.trim() })

    return (
      <form className={css.editor} aria-labelledby={formId + '-title'} onSubmit={event => { event.preventDefault(); void submit() }}>
        <h5 className={css.editorTitle} id={formId + '-title'}>
          {target.kind === 'edit' ? t(keys['editor.titleEdit'], { id: target.id }) : t(keys['editor.titleNew'])}
        </h5>
        <div className={css.formGrid}>
          <TextField id={formId + '-label'} label={t(keys['editor.label'])} value={form.label} onChange={label => update({ label })} />
          <div className={css.formField}>
            <label className={css.fieldLabel} htmlFor={formId + '-id'}>{t(keys['editor.id'])}</label>
            <span className={classNames(css.prefixed, target.kind === 'edit' && css.prefixedDisabled)}>
              <span className={css.prefix} aria-hidden="true">{CUSTOM_PREFIX}</span>
              <input
                id={formId + '-id'}
                className={css.prefixedInput}
                value={form.id.slice(CUSTOM_PREFIX.length)}
                disabled={target.kind === 'edit'}
                placeholder={t(keys['editor.idPlaceholder'])}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={formId + '-id-hint'}
                onChange={event => { changeId(event.target.value) }}
              />
            </span>
            <p className={css.hint} id={formId + '-id-hint'}>{t(keys['editor.idHint'])}</p>
          </div>
          <div className={css.formField}>
            <span className={css.fieldLabel}>{t(keys['editor.adapter'])}</span>
            <SelectMenu<A>
              compact
              label={t(keys['editor.adapter'])}
              value={form.adapter}
              options={adapters.map(adapter => ({ id: adapter, label: catalogEntry(catalog, adapter).label }))}
              disabled={false}
              onChange={adapter => update({ adapter, options: {} })}
            />
          </div>
          <TextField
            id={formId + '-endpoint'}
            label={t(keys['editor.endpoint'])}
            hint={t(keys['editor.endpointHint'])}
            type="url"
            placeholder={catalogEntry(catalog, form.adapter).endpoint}
            value={form.endpoint}
            onChange={endpoint => update({ endpoint })}
          />
          <TextField
            id={formId + '-ref'}
            label={t(keys['editor.credentialRef'])}
            hint={t(keys['editor.credentialRefHint'])}
            value={form.credentialRef}
            onChange={credentialRef => {
              setRefEdited(true)
              update({ credentialRef })
            }}
          />
          <div className={css.formField}>
            <label className={css.fieldLabel} htmlFor={formId + '-key'}>{t(keys['editor.apiKey'])}</label>
            <Input
              id={formId + '-key'}
              className={css.input as string}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              placeholder={t(keys['credential.placeholder'])}
              value={apiKey}
              onChange={event => { setApiKey(event.target.value) }}
            />
            <p className={css.hint}>{t(keys['editor.apiKeyHint'])}</p>
          </div>
        </div>
        <div className={css.field}>
          <span className={css.fieldLabel}>{t(keys['options.title'])}</span>
          <OptionFields
            id={formId + '-option'}
            fields={formFields(form)}
            texts={form.options}
            disabled={false}
            t={t}
            onEdit={(name, value) => update({ options: { ...form.options, [name]: value } })}
          />
          <p className={css.hint}>{t(keys['editor.optionsHint'])}</p>
        </div>
        {askTrust ? <Checkbox checked={consent} onChange={checked => { setConsentFor(checked ? destination(form) : undefined) }} label={trustLabel} /> : null}
        {doc.revision === opened.revision ? null : <p className={css.warning} role="alert">{t(keys['editor.stale'])}</p>}
        <ErrorText title={error === undefined ? action.errorTitle : undefined}>{error === undefined ? action.error : t(keys[FORM_ERRORS[error]])}</ErrorText>
        <div className={css.actions}>
          <Button type="button" variant="ghost" onClick={() => { onClose() }}>{t(keys['editor.cancel'])}</Button>
          <Button type="submit" variant="primary" disabled={(askTrust && !consent) || !doc.editable || action.busy}>
            {action.busy ? t(keys['saving']) : t(keys['editor.save'])}
          </Button>
        </div>
      </form>
    )
  }

  function storedConnection(config: S, id: string): CustomConnection<A> | undefined {
    const stored = config.connections === undefined ? undefined : config.connections[id]
    return stored === undefined ? undefined : stored as CustomConnection<A>
  }

  function TextField({ id, label, hint, value, onChange, type = 'text', placeholder }: {
    id: string
    label: string
    hint?: string
    value: string
    onChange: (value: string) => void
    type?: string
    placeholder?: string | undefined
  }) {
    return (
      <div className={css.formField}>
        <label className={css.fieldLabel} htmlFor={id}>{label}</label>
        <Input
          id={id}
          className={css.input as string}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={event => { onChange(event.target.value) }}
        />
        {hint === undefined ? null : <p className={css.hint}>{hint}</p>}
      </div>
    )
  }

  return ConnectionEditor
}
