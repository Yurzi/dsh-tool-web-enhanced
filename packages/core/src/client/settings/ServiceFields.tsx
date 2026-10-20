/** Per-connection editors every built-in connection gets from its catalog facts. */
import { useId, useState, type KeyboardEvent } from 'react'
import { Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { CREDENTIAL_REF } from '../../shared/connections.ts'
import type { BuiltinOverride } from '../../shared/settings.ts'
import type { ClientTranslate } from '../command.ts'
import { isValidText, type OptionField } from './fields.ts'
import type { SettingsClasses, SettingsDoc, SettingsParts, WriteSettings } from './parts.tsx'
import type { SparseSettings } from './sparse.ts'

export type ServiceFieldsCopyKey = 'credential.reference' | 'credential.referenceHint' | 'services.trust' | 'services.trustUnsaved' | 'options.invalid' | 'options.default'

const onEnter = (commit: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
  event.preventDefault()
  commit()
}

export function createServiceFields<K extends string>({ classes: css, keys, parts: { ErrorText, useWrite }, sparse }: {
  classes: SettingsClasses
  keys: Readonly<Record<ServiceFieldsCopyKey, K>>
  parts: SettingsParts<K>
  sparse: SparseSettings
}) {
  interface FieldProps {
    connectionId: string
    doc: SettingsDoc
    write: WriteSettings
    disabled: boolean
    t: ClientTranslate<K>
  }

  /** The DSH Credentials name the API-key route resolves; empty returns to the catalog's name. */
  function CredentialRefField({ connectionId, credentialRef, catalogRef, doc, write, disabled, t }: FieldProps & {
    credentialRef: string
    catalogRef: string
  }) {
    const id = useId()
    const [draft, setDraft] = useState<string | undefined>(undefined)
    const action = useWrite(t)
    const text = draft === undefined ? credentialRef : draft
    const valid = text === '' || CREDENTIAL_REF.test(text)

    const commit = async (): Promise<void> => {
      if (!valid || text === credentialRef) return
      const ops = sparse.sparseSettingOperations(doc.layers, ['connections', connectionId, 'credentialRef'], text === '' ? undefined : text, catalogRef)
      if (await action.run(() => write(ops))) setDraft(undefined)
    }

    return (
      <div className={css.formField}>
        <label className={css.fieldLabel} htmlFor={id}>{t(keys['credential.reference'])}</label>
        <Input
          id={id}
          className={css.input as string}
          value={text}
          placeholder={catalogRef}
          disabled={disabled || action.busy}
          aria-invalid={!valid}
          autoComplete="off"
          spellCheck={false}
          onChange={event => { setDraft(event.target.value) }}
          onBlur={() => { void commit() }}
          onKeyDown={onEnter(() => { void commit() })}
        />
        <p className={css.hint}>{t(keys['credential.referenceHint'])}</p>
        {valid ? null : <p className={css.fieldError}>{t(keys['options.invalid'])}</p>}
        <ErrorText title={action.errorTitle}>{action.error}</ErrorText>
      </div>
    )
  }

  /**
   * A URL option such as a native base URL. A value other than the catalog
   * endpoint is written only together with `trustedEndpoint: true`, and only
   * after the trust switch was turned on for that very address: a stored trust
   * covers the stored address, not a new one typed over it. Turning an active
   * trust off revokes it for the whole connection and returns every URL option
   * to the official endpoint in the same write.
   */
  function UrlOptionField({ connectionId, field, official, override, urlOptions, doc, write, disabled, t }: FieldProps & {
    field: OptionField<K>
    official: string | undefined
    override: BuiltinOverride
    /** Names of every URL option of this connection. */
    urlOptions: readonly string[]
  }) {
    const id = useId()
    const stored = override.options === undefined ? {} : override.options
    const storedText = textOf(stored, field.name)
    const storedTrust = override.trustedEndpoint === true
    const [urlDraft, setUrlDraft] = useState<string | undefined>(undefined)
    /** The address the switch was turned on for in this edit. */
    const [confirmed, setConfirmed] = useState<string | undefined>(undefined)
    const action = useWrite(t)

    const url = urlDraft === undefined ? storedText : urlDraft
    const valid = isValidText(field, url)
    const differs = (text: string) => text !== '' && text !== official
    const needsTrust = differs(url)
    const trusted = url === confirmed || (url === storedText && storedTrust)
    const othersNeedTrust = urlOptions.some(name => name !== field.name && differs(textOf(stored, name)))
    const path = ['connections', connectionId]

    const settled = (accepted: boolean) => {
      if (!accepted) return
      setUrlDraft(undefined)
      setConfirmed(undefined)
    }

    /** Store the address with the trust it needs; an unconfirmed other address stays a draft. */
    const save = async (trust: boolean): Promise<void> => {
      if (!valid || (needsTrust && !trust)) return
      const ops = [
        ...sparse.sparseSettingOperations(doc.layers, [...path, 'options', field.name], url === '' ? official : url, official),
        ...sparse.sparseSettingOperations(doc.layers, [...path, 'trustedEndpoint'], needsTrust || othersNeedTrust, false),
      ]
      settled(await action.run(() => write(ops)))
    }

    const revoke = async (): Promise<void> => {
      const ops = [
        ...urlOptions.flatMap(name => differs(textOf(stored, name)) ? sparse.sparseSettingOperations(doc.layers, [...path, 'options', name], official, official) : []),
        ...sparse.sparseSettingOperations(doc.layers, [...path, 'trustedEndpoint'], false, false),
      ]
      settled(await action.run(() => write(ops)))
    }

    const toggle = (on: boolean) => {
      if (on) {
        setConfirmed(url)
        void save(true)
      } else if (storedTrust && url === storedText) {
        void revoke()
      } else {
        setConfirmed(undefined)
      }
    }

    return (
      <div className={css.formField}>
        <label className={css.fieldLabel} htmlFor={id}>{t(field.label)}</label>
        <Input
          id={id}
          className={css.input as string}
          type="url"
          value={url}
          placeholder={official === undefined ? t(keys['options.default']) : official}
          title={field.name}
          disabled={disabled || action.busy}
          aria-invalid={!valid}
          spellCheck={false}
          onChange={event => { setUrlDraft(event.target.value.trim() === '' ? '' : event.target.value) }}
          onBlur={() => { void save(trusted) }}
          onKeyDown={onEnter(() => { void save(trusted) })}
        />
        {valid ? null : <p className={css.fieldError}>{t(keys['options.invalid'])}</p>}
        {needsTrust ? (
          <div className={css.inline}>
            <Switch
              checked={trusted}
              disabled={disabled || action.busy}
              label={t(keys['services.trust'])}
              onChange={toggle}
            />
            <span className={css.hint}>{t(keys['services.trust'])}</span>
          </div>
        ) : null}
        {needsTrust && valid && !trusted ? <p className={css.fieldError}>{t(keys['services.trustUnsaved'])}</p> : null}
        <ErrorText title={action.errorTitle}>{action.error}</ErrorText>
      </div>
    )
  }

  return { CredentialRefField, UrlOptionField }
}

function textOf(options: Readonly<Record<string, unknown>>, name: string): string {
  const value = Object.hasOwn(options, name) ? options[name] : undefined
  return typeof value === 'string' ? value : ''
}
