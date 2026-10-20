import { useId, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ExtraEditor, ExtraEditorProps } from 'dsh-tool-web-enhanced-core/client'
import { DEFAULT_LOCAL_SETTINGS, USER_AGENT_PATTERN } from '../../catalog.ts'
import type { FetchSettings } from '../../settings/types.ts'
import type { LocaleKey } from '../locales.ts'
import { AllowlistEditor } from './AllowlistEditor.tsx'
import { builtinOverride } from './model.ts'
import { ErrorText, useWrite } from './parts.tsx'
import { sparseSettingOperations } from './sparse.ts'
import css from './Settings.module.css'

/** The local connection's own editors; they take over the allowlist and User-Agent options. */
export const localExtras: ExtraEditor<FetchSettings, LocaleKey> = {
  options: ['allowCidrs', 'allowHostnames', 'userAgent'],
  Editor: LocalExtras,
}

type ExtraProps = ExtraEditorProps<FetchSettings, LocaleKey>

function LocalExtras({ doc, write, disabled, t }: ExtraProps) {
  const stored = builtinOverride(doc.config, 'local').options ?? {}
  return <>
    <AllowlistEditor allowCidrs={(stored.allowCidrs ?? []) as string[]} allowHostnames={(stored.allowHostnames ?? []) as string[]} disabled={disabled} revision={doc.revision} write={write} t={t} />
    <UserAgentEditor doc={doc} write={write} disabled={disabled} t={t} />
  </>
}

function UserAgentEditor({ doc, write, disabled, t }: ExtraProps) {
  const id = useId()
  const stored = builtinOverride(doc.config, 'local').options ?? {}
  const inherited = typeof stored.userAgent === 'string' ? stored.userAgent : DEFAULT_LOCAL_SETTINGS.userAgent
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const action = useWrite(t)
  const text = draft === undefined ? inherited : draft
  const valid = USER_AGENT_PATTERN.test(text)
  const commit = async (value: string | undefined) => {
    if (value !== undefined && !USER_AGENT_PATTERN.test(value)) return
    if (value === inherited) { setDraft(undefined); return }
    const ops = sparseSettingOperations(doc.layers, ['connections', 'builtin:local', 'options', 'userAgent'], value, DEFAULT_LOCAL_SETTINGS.userAgent)
    if (await action.run(() => write(ops))) setDraft(undefined)
  }
  return <div className={css.formField}>
    <label className={css.fieldLabel} htmlFor={id}>{t('option.local.userAgent')}</label>
    <div className={css.inline}>
      <Input id={id} className={css.input as string} value={text} disabled={disabled || action.busy} aria-invalid={!valid}
        onChange={event => { setDraft(event.target.value) }} onBlur={() => { void commit(text) }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void commit(text) } }} />
      <Button variant="ghost" disabled={disabled || action.busy} onClick={() => { void commit(undefined) }}>{t('option.local.userAgentReset')}</Button>
    </div>
    <p className={css.hint}>{t('option.local.userAgentHint')}</p>
    {valid ? null : <p className={css.fieldError}>{t('options.invalid')}</p>}
    <ErrorText title={action.errorTitle}>{action.error}</ErrorText>
  </div>
}
