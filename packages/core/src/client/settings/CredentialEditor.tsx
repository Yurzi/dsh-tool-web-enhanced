/** Write-only key entry: the value goes to DSH Credentials and never into settings. */
import { useId, useState } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CredentialStatusMap } from '../credentials.ts'
import type { ClientTranslate } from '../command.ts'
import type { SettingsClasses } from './parts.tsx'


export type SaveCredential = (ref: string, value: string) => Promise<void>

type Outcome = { readonly kind: 'saved' } | { readonly kind: 'failed'; readonly message: string } | undefined

export type CredentialCopyKey = "credential.label" | "credential.set" | "credential.unset" | "credential.placeholder" | "saving" | "credential.save" | "credential.saved" | "credential.failed" | "credential.hint"
export function createCredentialEditor<K extends string>({ classes: css, keys }: {
  classes: SettingsClasses
  keys: Readonly<Record<CredentialCopyKey, K>>
}) {
  function CredentialEditor({ credentialRef, status, save, t }: {
    credentialRef: string
    status: CredentialStatusMap[string] | undefined
    save: SaveCredential
    t: ClientTranslate<K>
  }) {
    const id = useId()
    const [value, setValue] = useState('')
    const [busy, setBusy] = useState(false)
    const [outcome, setOutcome] = useState<Outcome>(undefined)
  
    const submit = async (): Promise<void> => {
      const trimmed = value.trim()
      if (!trimmed) return
      setBusy(true)
      setOutcome(undefined)
      try {
        await save(credentialRef, trimmed)
        setValue('')
        setOutcome({ kind: 'saved' })
      } catch (error) {
        setOutcome({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
      } finally {
        setBusy(false)
      }
    }
  
    const isConfigured = status === 'configured'
    const isMissing = status === 'missing'
  
    return (
      <div className={css.formField}>
        <div className={css.fieldHead}>
          <label className={css.fieldLabel} htmlFor={id}>{t(keys['credential.label'])}</label>
          {isConfigured ? <Tag tone="success">{t(keys['credential.set'])}</Tag> : null}
          {isMissing ? <Tag tone="warning">{t(keys['credential.unset'])}</Tag> : null}
        </div>
        <div className={css.inline}>
          <Input
            id={id}
            className={css.input as string}
            type="password"
            value={value}
            disabled={busy}
            placeholder={t(keys['credential.placeholder'])}
            autoComplete="off"
            spellCheck={false}
            aria-label={t(keys['credential.label'])}
            onChange={event => { setValue(event.target.value) }}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void submit()
              }
            }}
          />
          <Button
            variant="outline"
            size="md"
            disabled={busy || value.trim() === ''}
            onClick={() => { void submit() }}
          >
            {busy ? t(keys['saving']) : t(keys['credential.save'])}
          </Button>
        </div>
        {outcome?.kind === 'saved' ? <p className={css.success} role="status">{t(keys['credential.saved'])}</p> : null}
        {outcome?.kind === 'failed' ? <p className={css.error} role="alert">{outcome.message || t(keys['credential.failed'])}</p> : null}
        <p className={css.hint}>{t(keys['credential.hint'], { ref: credentialRef })}</p>
      </div>
    )
  }
  return CredentialEditor
}
export type CredentialEditorComponent<K extends string> = ReturnType<typeof createCredentialEditor<K>>
